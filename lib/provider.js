/**
 * The `smart-session-title` session-title provider.
 *
 * Responsibilities, and deliberately nothing else:
 *  - gate out first prompts that carry no task,
 *  - delete the configured exclusion terms before anything is sent,
 *  - compress an oversized prompt instead of failing,
 *  - make bounded auxiliary `ctx.llm.stream()` calls through the shared service,
 *  - hand a validated title back to the service.
 *
 * It never calls `session.append()`. Persistence, revision tracking,
 * cancellation, stale-result rejection, manual-title protection, normalization
 * and projection all belong to `@deepseek-ai/dsh-session-title`, and routing
 * around it would forfeit every one of those guarantees.
 *
 * It also never builds an HTTP request: the model call goes through the shared
 * `llm` service, so the deployment's adapters, credentials and provider
 * registry stay the single source of truth.
 */
import { isAiTitleDisabled, isSessionTitleLocked } from "./settings.js";
import { resolveTitleRoute } from "./route.js";
import { sanitizeDiagnosticLine } from "./observability.js";
import { byteLength, compileTitleExclusions, findExcludedTerm, prepareTitleInput, redactExcludedTerms, selectExplicitFallbackTarget, selectTaskTarget, validateGeneratedTitle } from "./title-policy.js";
import { buildTitleAffix, bodyBudgetBytes, bodyBudgetCharacters, fitTitleAffix, composeTitle } from "./title-affix.js";
import { PLUGIN_NAME, buildSystemPrompt, buildUserInput } from "./title-prompt.js";
/** Stable provider id recorded on every accepted `session/title` event. */
export const PROVIDER_ID = "smart-session-title";
/**
 * Title-source cadence registered with the service.
 *
 * Phase 1 used `first-prompt`, which asks the service to schedule exactly one
 * generation for the session's first eligible message. That is precisely why a
 * session opened with "你好" could never recover: the single opportunity was
 * spent on a greeting, and `count === 1` never holds again.
 *
 * Phase 2 registers `all-prompts`, so the service schedules on every eligible
 * human message and owns the scheduling, revision, cancellation and persistence
 * semantics. Whether a given schedule actually becomes a model call is decided
 * by this provider's eligibility policy, which abstains without I/O in every
 * case except the first real task.
 */
export const PROVIDER_CADENCE = "all-prompts";
/**
 * Byte budget used for our own title shortening.
 *
 * Matches the shipped `dsh-base` row (`maxTitleBytes: 80`). The service
 * re-normalizes against its own configured cap afterwards, so a deployment
 * lowering the cap still wins; this value only ensures *we* cut at a sane
 * boundary instead of leaving the service to slice mid-word.
 *
 * A configured date affix is reserved OUT of this budget before the model's
 * text is shortened (see `bodyBudgetBytes`): the service truncates the title's
 * tail, so an unreserved suffix would be the first thing lost.
 */
export const TITLE_BYTE_BUDGET = 80;
/** A provider failure handled by Core; explicit commands report it to the caller. */
export class TitleGenerationError extends Error {
    reason;
    retryable;
    /** Structural class of the failure, for diagnostics classification. */
    kind;
    retryAfterMs;
    constructor(reason, retryable = false, kind = "model", retryAfterMs = 0) {
        super(`smart-session-title: ${reason}`);
        this.name = "TitleGenerationError";
        this.reason = reason;
        this.retryable = retryable;
        this.kind = kind;
        this.retryAfterMs = retryAfterMs;
    }
}
/**
 * Thrown for an abstention: a deliberate non-generation that the service logs
 * and swallows, leaving the current title in place.
 *
 * Extends {@link TitleGenerationError} so it keeps the Phase 1 contract — a
 * non-retryable generation failure — while callers that care can single it out
 * with `instanceof TitleAbstention` and read `reason`.
 */
export class TitleAbstention extends TitleGenerationError {
    /** Why generation was declined (the base class's `reason` is the message). */
    abstentionReason;
    constructor(reason, detail) {
        super(detail, false);
        this.name = "TitleAbstention";
        this.abstentionReason = reason;
    }
}
function describe(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * Render the provider-neutral facts of an adapter failure snapshot.
 *
 * The harness normalizes a terminal adapter error into `{ message, code,
 * status?, providerRetryAfterMs?, requestId? }` (see
 * `@deepseek-ai/dsh-llm`'s `normalizeLlmFailure`). Without them every upstream
 * failure reads identically in the UI and the log — the exact gap that made a
 * saved model NAME (`commandcode/DeepSeek V4.1 Flash`) look like a transient
 * outage when the adapter was rejecting the ID in ~8ms with `UNKNOWN_MODEL`.
 *
 * `message` is deliberately NOT rendered: it is provider text and may quote
 * request details or credentials. `code` and `status` are taxonomy, not content.
 */
function failureFacts(failure) {
    if (failure === null || typeof failure !== "object")
        return "";
    const parts = [];
    if (typeof failure.code === "string" && failure.code.length > 0)
        parts.push(`code=${failure.code}`);
    if (typeof failure.status === "number" && Number.isInteger(failure.status))
        parts.push(`status=${failure.status}`);
    return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}
/** Permanent route/credential failures cannot improve by repeating the same call. */
export function isRetryableModelFailure(failure) {
    if (failure === null || typeof failure !== "object") return false;
    const permanent = new Set(["AUTH", "INVALID_CREDENTIAL", "UNKNOWN_MODEL", "NO_ADAPTER",
        "INVALID_REQUEST", "CONTEXT_WINDOW_EXCEEDED", "UNSUPPORTED_REASONING_EFFORT",
        "QUOTA", "ACCOUNT_QUOTA"]);
    if (permanent.has(failure.code)) return false;
    const status = failure.status;
    return !(Number.isInteger(status) && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status));
}
function waitForRetry(delay, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
        signal.addEventListener("abort", abort, { once: true });
    });
}
/** JSON log line fields; never the prompt text and never the model output. */
function logFields(fields) {
    return Object.entries(fields)
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join(" ");
}
/**
 * Build the provider object handed to `ctx.sessionTitle.register()`.
 *
 * @param getPolicy - reads the configuration in force right now, so a settings
 *   change applies to the next generation without a restart.
 * @param deps - the `llm` service plus optional logger/clock/diagnostics.
 */
export function createSmartSessionTitleProvider(getPolicy, deps) {
    const now = deps.now ?? (() => Date.now());
    const logger = deps.logger;
    const diagnostics = deps.diagnostics;
    /** One model call. Resolves to raw text, or throws an AttemptFailure. */
    async function callOnce(request, config, route, preparedText, retry, attempt, rawBytes, preparedBytes, layout) {
        const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
        const signal = AbortSignal.any([request.signal, timeoutSignal]);
        const options = {
            provider: route.provider,
            model: route.model,
            messages: [
                deps.createUserMessage({
                    content: [{ type: "text", text: redactExcludedTerms(buildUserInput(preparedText, retry, layout.promptOptions), layout.exclusions).text }],
                    source: { kind: "plugin", plugin: PLUGIN_NAME }
                })
            ],
            system: redactExcludedTerms(buildSystemPrompt(config, layout.promptOptions), layout.exclusions).text,
            maxTokens: config.maxOutputTokens,
            // An auxiliary title request needs no session-log delivery. The shipped
            // dsh-session-log-deepseek extension skips requests without sessionId;
            // including it can fail before title generation (REQUEST_EXTENSION).
            // Omit this optional field from the FIRST attempt, including when
            // maxAttempts is 1. Attribution stays in our logs and provider result.
            purpose: "session-title",
            signal
        };
        logger?.info?.(sanitizeDiagnosticLine(`smart-session-title generation started ${logFields({
            sessionId: request.session.id,
            outcome: "started",
            attempt,
            rawBytes,
            preparedBytes,
            route: `${route.provider}/${route.model}`,
            retry,
            isolatedRequest: true
        })}`));
        const assembler = new deps.BlockAssembler();
        try {
            for await (const chunk of deps.llm.stream(options)) {
                // Caller cancellation must surface immediately and never be retried.
                if (request.signal.aborted) {
                    throw new TitleGenerationError("cancelled by caller", false, "cancelled");
                }
                assembler.push(chunk);
            }
        }
        catch (error) {
            // Never convert a caller cancellation into a retryable failure, and keep
            // our own deadline distinguishable in the log.
            if (request.signal.aborted) {
                throw new TitleGenerationError("cancelled by caller", false, "cancelled");
            }
            if (timeoutSignal.aborted) {
                throw new TitleGenerationError(`title request timed out after ${config.timeoutMs}ms`, true, "timeout");
            }
            throw new TitleGenerationError("model stream failed", true, "model", Math.min(1000, 250 * 2 ** (attempt - 1)));
        }
        const finish = assembler.finish;
        if (finish.kind === "aborted") {
            if (request.signal.aborted) {
                throw new TitleGenerationError("cancelled by caller", false, "cancelled");
            }
            throw new TitleGenerationError(`title request timed out after ${config.timeoutMs}ms`, true, "timeout");
        }
        if (finish.kind === "error") {
            // A conforming finish always carries `failure` (see the harness
            // FinishReason contract and every adapter's error mapping), but the
            // stream is runtime data: a malformed/middleware-injected finish must
            // not crash with a TypeError, and a structural violation is not a
            // transient provider failure, so it must not be retried either.
            const failure = finish.failure;
            if (failure?.code === "REQUEST_EXTENSION") {
                throw new TitleGenerationError(
                    "DSH request extension failed without session association (code=REQUEST_EXTENSION); check global DSH request extensions",
                    false,
                    "extension"
                );
            }
            const message = failure === undefined ? "unknown model error" : "upstream failure";
            const retryAfter = typeof failure?.providerRetryAfterMs === "number" && Number.isFinite(failure.providerRetryAfterMs) && failure.providerRetryAfterMs > 0
                ? failure.providerRetryAfterMs : Math.min(1000, 250 * 2 ** (attempt - 1));
            const retryable = isRetryableModelFailure(failure) && retryAfter <= Math.min(5000, config.timeoutMs);
            throw new TitleGenerationError(`model error: ${message}${failureFacts(failure)}`, retryable, "model", retryAfter);
        }
        if (finish.kind === "max-tokens") {
            // A reasoning model can spend the whole output budget on its thinking
            // and return `max-tokens` with NO text block at all. That is a budget
            // problem, not disobedience, so it is worth the single retry the caller
            // allows. A model that DID emit text and still ran on has ignored the
            // one-line instruction: that stays a terminal protocol failure, and its
            // paragraph is never salvaged into a title.
            const producedText = assembler.blocks().some((block) => block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0);
            throw new TitleGenerationError("title output reached maxOutputTokens", !producedText, producedText ? "protocol" : "output");
        }
        if (finish.kind === "tool-calls") {
            throw new TitleGenerationError("title model unexpectedly requested a tool", false, "protocol");
        }
        const blocks = assembler.blocks();
        if (blocks.some((block) => block.type === "tool-call")) {
            throw new TitleGenerationError("title output must contain text only", false, "protocol");
        }
        // Reasoning blocks are dropped on purpose: they are never the title.
        const text = blocks
            .filter((block) => block.type === "text")
            .map((block) => (typeof block.text === "string" ? block.text : ""))
            .join(" ");
        const validation = validateGeneratedTitle(text, layout.maxBodyBytes, layout.maxBodyCharacters);
        if (!validation.ok) {
            // Every rejection reason is a malformed-output reason, so one retry is
            // worth making; the service keeps the fallback if the retry also fails.
            throw new TitleGenerationError(`model returned an unusable title (${validation.reason})`, true, "output");
        }
        // Post-generation exclusion gate. The check runs on the validated,
        // truncated title — the exact string that would be stored — so a term
        // cannot appear only after shortening, and a term cut in half by shortening
        // is not falsely reported.
        //
        // A surviving term is retried once, because the usual cause is the model
        // ignoring the "names were removed" instruction. On the LAST attempt we do
        // not abstain: abstaining hands the session back to the service's fallback
        // title, which is derived from the raw first message and would therefore put
        // the very term back on the sidebar. Masking is deterministic (deletion, no
        // model) and is the only outcome that actually keeps the term out.
        let body = validation.title;
        let composed = composeTitle(body, layout.affix, layout.position);
        // An exclusion spanning the body/date boundary also wins over the date.
        // Omit the whole affix rather than leave a damaged date decoration.
        let affix = layout.affix;
        if (affix !== "" && findExcludedTerm(body, layout.exclusions) === undefined && findExcludedTerm(composed, layout.exclusions) !== undefined) {
            affix = "";
            composed = body;
        }
        const offending = findExcludedTerm(composed, layout.exclusions);
        if (offending !== undefined) {
            if (attempt < config.maxAttempts) {
                throw new TitleGenerationError("model returned a title containing an excluded term", true, "excluded");
            }
            let removed = 0;
            let recheck;
            for (;;) {
                const masked = redactExcludedTerms(body, layout.exclusions);
                removed += masked.removed;
                recheck = validateGeneratedTitle(masked.text, layout.maxBodyBytes, layout.maxBodyCharacters);
                if (!recheck.ok) break;
                if (findExcludedTerm(recheck.title, layout.exclusions) === undefined) break;
                if (recheck.title.length >= body.length) break;
                body = recheck.title;
            }
            if (!recheck.ok || findExcludedTerm(recheck.title, layout.exclusions) !== undefined) {
                // Nothing usable survives masking. Fail loudly rather than accept an
                // empty title; the caller's fallback is a known, documented limit.
                throw new TitleGenerationError("title still contains an excluded term after masking", false, "excluded");
            }
            logger?.warn?.(sanitizeDiagnosticLine(`smart-session-title generation masked excluded terms ${logFields({
                sessionId: request.session.id,
                outcome: "masked",
                attempt,
                removed,
                result: "accepted-masked"
            })}`));
            body = recheck.title;
            composed = composeTitle(body, affix, layout.position);
            if (findExcludedTerm(composed, layout.exclusions) !== undefined) composed = body;
        }
        // The affix is joined HERE, after validation: the policy's wrapping strip
        // would otherwise treat a decorated affix ("- 0914") as title decoration.
        if (findExcludedTerm(composed, layout.exclusions) !== undefined) {
            throw new TitleGenerationError("title still contains an excluded term after masking", false, "excluded");
        }
        return composed;
    }
    return {
        id: PROVIDER_ID,
        automatic: PROVIDER_CADENCE,
        async generate(request) {
            const started = now();
            const sessionId = request.session.id;
            // Read the live policy once per generation: a Settings change applies to
            // the next generation without a restart.
            const { config, settings } = getPolicy();
            const messages = request.messages ?? [];
            /**
             * Log an abstention and fail: the service keeps the current title.
             * The explicit `const` annotation is what lets TypeScript treat a call as
             * terminating, so `target` narrows to defined below.
             */
            const abstain = (reason, detail, extra = {}) => {
                diagnostics?.record("abstained", { sessionId, reason });
                logger?.info?.(sanitizeDiagnosticLine(`smart-session-title generation skipped ${logFields({
                    sessionId,
                    outcome: "abstained",
                    // `reason` is the stable key; `failureReason` keeps the Phase 1/2
                    // wording that earlier assertions rely on.
                    reason,
                    failureReason: `abstained:${reason}`,
                    result: "abstained",
                    ...extra
                })}`));
                throw new TitleAbstention(reason, detail);
            };
            // AI titles off: nothing is called, and the session keeps its fallback.
            if (isAiTitleDisabled(settings)) {
                abstain("disabled", "AI title generation is disabled", { mode: settings.mode ?? "enabled-off" });
            }
            // The user's lock comes FIRST among the per-session gates, and before the
            // explicit marker is consumed below: a locked session must not spend the
            // `/retitle` permission, or the next automatic schedule would inherit it
            // and rewrite the very title the lock exists to protect. `/retitle`
            // refuses a locked session in its own handler, so reaching here locked
            // means an automatic schedule (or a token granted before the lock was
            // set). Ordering it above the content gates also makes the diagnostic
            // unambiguous: a locked session reports "locked", not "no task yet".
            if (isSessionTitleLocked(settings, sessionId)) {
                abstain("locked", "this session's title is locked by the user", { lockedSessions: settings.lockedSessionIds?.length ?? 0 });
            }
            if (messages.length === 0) {
                abstain("no-source-message", "no eligible human message was supplied");
            }
            // Delegated child sessions never receive an automatic model title. The
            // service enforces this for `first-prompt`; under `all-prompts` it does
            // not, so the policy keeps the Phase 1 invariant here.
            if (request.session.header?.parentSession !== undefined) {
                abstain("child-session", "child sessions do not receive automatic titles");
            }
            // An explicit /retitle consumes its marker before any further abstention
            // test (the lock above is the deliberate exception).
            const explicit = deps.consumeExplicitRegeneration?.(sessionId) === true;
            const selection = selectTaskTarget(messages);
            // An explicit `/retitle` outranks the weak-prompt filter: the filter
            // protects AUTOMATIC titling from noise, but a user who asked for a title
            // must not be answered with a failure just because every message is a
            // terse command ("继续写" / "发布"). Only the short-imperative shape is
            // eligible — a session made of greetings still abstains below.
            const fallbackTarget = selection.target === undefined && explicit
                ? selectExplicitFallbackTarget(messages)
                : undefined;
            const target = selection.target ?? fallbackTarget;
            if (target === undefined) {
                // Phrasing keeps the Phase 1 diagnostic ("carries no task") while adding
                // the recovery-specific reason for the first weak message.
                abstain("no-meaningful-prompt", `no user message in this session carries a task yet: first prompt carries no task (${selection.weakReasons[0] ?? "unknown"})`, { weakPrompts: selection.weakCount, explicit });
            }
            // Automatic schedules must never rewrite a title the session already has:
            // a user-owned title is pinned outright, and a provider title means the
            // automatic lifecycle for this session is already complete. `/retitle` is
            // the explicit, user-initiated exception (verified against the real
            // service: refresh() deliberately unpins).
            if (!explicit) {
                const current = deps.readTitle?.(request.session);
                if (current?.source.kind === "user") {
                    abstain("manual-title-protected", "the session title was set by the user");
                }
                if (current?.source.kind === "provider") {
                    abstain("already-provider-titled", "this session already has a generated title");
                }
            }
            const rawBytes = byteLength(target.text);
            // Title content: phrasing, language and the exclusion words. The terms are
            // compiled once per generation and NEVER sent to the model — the message is
            // redacted instead, and the prompt only says that names were removed.
            const exclusions = compileTitleExclusions(settings.titleExclusions);
            const promptOptions = {
                style: settings.titleStyle,
                language: settings.titleLanguage,
                hasExclusions: exclusions.length > 0
            };
            const prepared = prepareTitleInput(target.text, config, settings.titleExclusions);
            // Redaction can empty a prompt whose entire content was an excluded name.
            // Calling the model with nothing left would buy either a generic title or
            // a failure, so decline instead of paying for it.
            if (prepared.text.trim().length === 0) {
                abstain("empty-after-redaction", "every meaningful word of the prompt was an excluded term", { excludedTerms: prepared.excludedTerms });
            }
            // Title shape: the optional date affix and the user's character cap.
            //
            // The date comes from the SESSION's creation time, not from this
            // instant: regenerating a title (or batch-retitling an old session)
            // must not move the date, and createdAt is validated by the session
            // store, so it is the one stable timestamp available here. An absent
            // or unusable value yields no affix rather than a broken title.
            const configuredAffix = buildTitleAffix({
                position: settings.titleDatePosition,
                format: settings.titleDateFormat ?? "ymd",
                createdAt: request.session.header?.createdAt
            });
            const affix = findExcludedTerm(configuredAffix, exclusions) === undefined
                ? fitTitleAffix(configuredAffix, settings.maxTitleCharacters) : "";
            const layout = {
                affix,
                position: settings.titleDatePosition ?? "prefix",
                maxBodyBytes: bodyBudgetBytes(TITLE_BYTE_BUDGET, affix),
                maxTitleCharacters: settings.maxTitleCharacters,
                maxBodyCharacters: bodyBudgetCharacters(settings.maxTitleCharacters, affix),
                // Carried together so one attempt cannot use the title's phrasing while
                // its retry uses the default (see callOnce).
                promptOptions,
                exclusions
            };
            // ONE place decides the route (see route.ts). Disabled mode never gets
            // here; a missing or half-specified route abstains with a clear reason
            // rather than silently falling back to another provider.
            const resolution = resolveTitleRoute({
                enabled: !isAiTitleDisabled(settings),
                mode: settings.mode,
                pinned: config.provider !== undefined && config.model !== undefined
                    ? { provider: config.provider, model: config.model }
                    : undefined,
                configured: settings.provider !== undefined && settings.model !== undefined
                    ? { provider: settings.provider, model: settings.model }
                    : undefined,
                session: request.route
            });
            if (resolution.kind === "abstain") {
                abstain(resolution.reason, resolution.detail, { mode: settings.mode ?? "-" });
            }
            const route = {
                provider: resolution.provider,
                model: resolution.model
            };
            const routeText = `${route.provider}/${route.model}`;
            const lockAbort = new AbortController();
            let lockedDuringGeneration = false;
            const checkLock = () => {
                if (isSessionTitleLocked(getPolicy().settings, sessionId)) {
                    lockedDuringGeneration = true;
                    lockAbort.abort(new TitleAbstention("locked", "the title was locked during generation"));
                }
            };
            const unsubscribe = deps.subscribeSettings?.(checkLock) ?? (() => {});
            request = { ...request, signal: AbortSignal.any([request.signal, lockAbort.signal]) };
            let lastFailure = "unknown";
            let lastKind = "model";
            try {
                for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
                    checkLock();
                    if (lockedDuringGeneration) abstain("locked", "the title was locked during generation");
                    request.signal.throwIfAborted();
                    try {
                        const title = await callOnce(request, config, route, prepared.text, attempt > 1, attempt, rawBytes, prepared.preparedBytes, layout);
                        checkLock();
                        if (lockedDuringGeneration) abstain("locked", "the title was locked during generation");
                        request.signal.throwIfAborted();
                        const elapsedMs = now() - started;
                        diagnostics?.record("generated", { sessionId, route: routeText, elapsedMs });
                        logger?.info?.(sanitizeDiagnosticLine(`smart-session-title generation succeeded ${logFields({
                            sessionId,
                            outcome: "generated",
                            attempt,
                            explicit,
                            mode: settings.mode ?? "default",
                            routeSource: resolution.source,
                            sourceSeq: target.seq,
                            weakSkipped: selection.weakCount,
                            // True when this title came from the explicit `/retitle`
                            // fallback (a short imperative the weak filter would skip on an
                            // automatic schedule) — otherwise `weakSkipped` would look like
                            // the title was generated from no message at all.
                            explicitFallback: fallbackTarget !== undefined,
                            rawBytes,
                            preparedBytes: prepared.preparedBytes,
                            strategy: prepared.strategy,
                            omittedCodeBlocks: prepared.omittedCodeBlocks,
                            // Count only: the terms themselves must never reach a log line.
                            excludedTerms: prepared.excludedTerms,
                            titleStyle: settings.titleStyle ?? "default",
                            titleLanguage: settings.titleLanguage ?? "auto",
                            route: routeText,
                            titleBytes: byteLength(title),
                            // Shape diagnostics: an affix that silently did not apply
                            // (missing createdAt, unknown zone) shows up as 0 here.
                            affixBytes: affix !== "" && (layout.position === "prefix" ? title.startsWith(affix) : title.endsWith(affix)) ? byteLength(affix) : 0,
                            maxBodyBytes: layout.maxBodyBytes,
                            maxTitleCharacters: layout.maxTitleCharacters ?? "-",
                            elapsedMs,
                            result: "accepted"
                        })}`));
                        return { title, messageSeqs: [target.seq], model: route };
                    }
                    catch (error) {
                        if (error instanceof TitleAbstention) throw error;
                        if (lockedDuringGeneration) abstain("locked", "the title was locked during generation");
                        if (request.signal.aborted) {
                            diagnostics?.record("cancelled", { sessionId, reason: "cancelled-by-caller" });
                            logger?.info?.(`smart-session-title generation cancelled ${logFields({ sessionId, result: "cancel", outcome: "cancelled", route: routeText, attempt, rawBytes, preparedBytes: prepared.preparedBytes, elapsedMs: now() - started, failureReason: "cancelled-by-caller" })}`);
                            throw error;
                        }
                        const terminal = error instanceof TitleGenerationError && !error.retryable;
                        lastFailure = describe(error);
                        lastKind = error instanceof TitleGenerationError ? error.kind : "model";
                        const elapsedMs = now() - started;
                        const willRetry = !terminal && attempt < config.maxAttempts;
                        if (willRetry) {
                            diagnostics?.record(lastKind === "timeout" ? "timed-out" : "retried", {
                                sessionId,
                                reason: lastKind,
                                route: routeText,
                                elapsedMs
                            });
                        }
                        logger?.warn?.(sanitizeDiagnosticLine(`smart-session-title generation attempt failed ${logFields({
                            sessionId,
                            outcome: willRetry ? (lastKind === "timeout" ? "timed-out" : "retried") : "failed",
                            attempt,
                            maxAttempts: config.maxAttempts,
                            explicit,
                            mode: settings.mode ?? "default",
                            routeSource: resolution.source,
                            rawBytes,
                            preparedBytes: prepared.preparedBytes,
                            route: routeText,
                            failureReason: lastFailure,
                            failureKind: lastKind,
                            elapsedMs
                        })}`));
                        if (terminal) {
                            diagnostics?.record("failed", { sessionId, reason: lastKind, route: routeText });
                            throw error;
                        }
                        if (willRetry && error instanceof TitleGenerationError && error.retryAfterMs > 0) {
                            try {
                                await (deps.waitForRetry ?? waitForRetry)(error.retryAfterMs, request.signal);
                            } catch (delayError) {
                                if (lockedDuringGeneration) abstain("locked", "the title was locked during generation");
                                if (request.signal.aborted) diagnostics?.record("cancelled", { sessionId, reason: "cancelled-during-backoff" });
                                throw delayError;
                            }
                        }
                    }
                }
                const totalElapsedMs = now() - started;
                diagnostics?.record("failed", { sessionId, reason: lastKind, route: routeText });
                if (lastKind === "timeout") {
                    diagnostics?.record("timed-out", { sessionId, reason: "timeout", route: routeText });
                }
                logger?.warn?.(sanitizeDiagnosticLine(`smart-session-title generation failed ${logFields({
                    sessionId,
                    outcome: "failed",
                    mode: settings.mode ?? "default",
                    routeSource: resolution.source,
                    rawBytes,
                    preparedBytes: prepared.preparedBytes,
                    route: routeText,
                    failureReason: lastFailure,
                    failureKind: lastKind,
                    elapsedMs: totalElapsedMs,
                    result: "fallback-retained"
                })}`));
                throw new TitleGenerationError(`no usable title after ${config.maxAttempts} attempt(s): ${lastFailure}`);
            } finally {
                unsubscribe();
            }
        }
    };
}
