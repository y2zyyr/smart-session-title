/**
 * The `smart-session-title` session-title provider.
 *
 * Responsibilities, and deliberately nothing else:
 *  - gate out first prompts that carry no task,
 *  - compress an oversized prompt instead of failing,
 *  - make exactly one auxiliary `ctx.llm.stream()` call (plus at most one
 *    retry), and
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
import { isAiTitleDisabled } from "./settings.js";
import { resolveTitleRoute } from "./route.js";
import { sanitizeDiagnosticLine } from "./observability.js";
import { byteLength, prepareTitleInput, selectTaskTarget, validateGeneratedTitle } from "./title-policy.js";
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
 */
export const TITLE_BYTE_BUDGET = 80;
/** A provider failure that the service will log and swallow (fallback stays). */
export class TitleGenerationError extends Error {
    reason;
    retryable;
    /** Structural class of the failure, for diagnostics classification. */
    kind;
    constructor(reason, retryable = false, kind = "model") {
        super(`smart-session-title: ${reason}`);
        this.name = "TitleGenerationError";
        this.reason = reason;
        this.retryable = retryable;
        this.kind = kind;
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
    async function callOnce(request, config, route, preparedText, retry, attempt, rawBytes, preparedBytes) {
        const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
        const signal = AbortSignal.any([request.signal, timeoutSignal]);
        const options = {
            provider: route.provider,
            model: route.model,
            messages: [
                deps.createUserMessage({
                    content: [{ type: "text", text: buildUserInput(preparedText, retry) }],
                    source: { kind: "plugin", plugin: PLUGIN_NAME }
                })
            ],
            system: buildSystemPrompt(config),
            maxTokens: config.maxOutputTokens,
            sessionId: request.session.id,
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
            retry
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
            throw new TitleGenerationError("model stream failed", true, "model");
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
            const message = failure === undefined ? "unknown model error" : "upstream failure";
            throw new TitleGenerationError(`model error: ${message}`, failure !== undefined, "model");
        }
        if (finish.kind === "max-tokens") {
            throw new TitleGenerationError("title output reached maxOutputTokens", false, "protocol");
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
        const validation = validateGeneratedTitle(text, TITLE_BYTE_BUDGET);
        if (!validation.ok) {
            // Every rejection reason is a malformed-output reason, so one retry is
            // worth making; the service keeps the fallback if the retry also fails.
            throw new TitleGenerationError(`model returned an unusable title (${validation.reason})`, true, "output");
        }
        return validation.title;
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
            if (messages.length === 0) {
                abstain("no-source-message", "no eligible human message was supplied");
            }
            // Delegated child sessions never receive an automatic model title. The
            // service enforces this for `first-prompt`; under `all-prompts` it does
            // not, so the policy keeps the Phase 1 invariant here.
            if (request.session.header?.parentSession !== undefined) {
                abstain("child-session", "child sessions do not receive automatic titles");
            }
            // An explicit /retitle consumes its marker before any abstention test.
            const explicit = deps.consumeExplicitRegeneration?.(sessionId) === true;
            const selection = selectTaskTarget(messages);
            const target = selection.target;
            if (target === undefined) {
                // Phrasing keeps the Phase 1 diagnostic ("carries no task") while adding
                // the recovery-specific reason for the first weak message.
                abstain("no-meaningful-prompt", `no user message in this session carries a task yet: first prompt carries no task (${selection.weakReasons[0] ?? "unknown"})`, { weakPrompts: selection.weakCount });
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
            const prepared = prepareTitleInput(target.text, config);
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
            let lastFailure = "unknown";
            let lastKind = "model";
            for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
                request.signal.throwIfAborted();
                try {
                    const title = await callOnce(request, config, route, prepared.text, attempt > 1, attempt, rawBytes, prepared.preparedBytes);
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
                        rawBytes,
                        preparedBytes: prepared.preparedBytes,
                        strategy: prepared.strategy,
                        omittedCodeBlocks: prepared.omittedCodeBlocks,
                        route: routeText,
                        titleBytes: byteLength(title),
                        elapsedMs,
                        result: "accepted"
                    })}`));
                    return { title, messageSeqs: [target.seq], model: route };
                }
                catch (error) {
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
        }
    };
}
