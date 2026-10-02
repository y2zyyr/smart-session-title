/**
 * Slash commands contributed by `smart-session-title` — and the handler that
 * owns `/retitle`.
 *
 * Kept in its own module with no `@deepseek-ai/*` imports so the handler is
 * directly unit-testable.
 *
 * The handler owns no title logic: it gates on the master switch and the
 * per-session lock, then delegates to the service's own `refresh()` and reports
 * the outcome. A host-supplied explicit recovery seam is used only when DSH's
 * title-input projection has no ordinary user message (for example, a session
 * driven entirely by `/goal`); the host still owns provider generation and
 * commits through the official title service.
 */
import { isAiTitleDisabled, isSessionTitleLocked } from "./settings.js";
/** Slash command that regenerates the current session title. */
export const RETITLE_COMMAND = "retitle";
/** Command description, as shown by the command surface. */
export const RETITLE_DESCRIPTION = "Regenerate the current session title.";
/** Slash command that reports local title diagnostics. */
export const STATUS_COMMAND = "title-status";
/** Command description for the diagnostics command. */
export const STATUS_DESCRIPTION = "Show smart-session-title diagnostics for this process.";
function describeError(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * Extract visible text from one logged user-message event.
 *
 * DSH's title service deliberately accepts only `source.kind === "user"`.
 * Goal rounds are real `user/message` events, but their source is `goal`, so
 * they are invisible to `SessionTitleService.refresh()`. This helper is kept
 * deliberately narrow: it only accepts goal-originated messages and is used
 * by the explicit recovery path below.
 */
function textOfGoalMessage(event) {
    if (event?.type !== "user/message" || event.data?.source?.kind !== "goal")
        return undefined;
    const blocks = Array.isArray(event.data.content) ? event.data.content : [];
    const text = blocks
        .filter((block) => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim();
    if (text.length === 0 || !Number.isSafeInteger(event.seq) || event.seq < 0)
        return undefined;
    // Goal rounds retain the objective inside a wrapper. Strip only that
    // wrapper so the title model sees the user's objective, not orchestration
    // instructions such as "continue working" or the round number.
    const match = text.match(/<goal_round>\s*Objective:\s*(.+?)\s*\nRound:/su);
    if (match !== null) {
        const encoded = match[1].trim();
        try {
            const decoded = JSON.parse(encoded);
            if (typeof decoded === "string" && decoded.trim().length > 0)
                return { seq: event.seq, text: decoded.trim() };
        }
        catch {
            // A malformed wrapper is still useful as plain text; the provider
            // will apply its ordinary compression and quality gates.
        }
        if (encoded.length > 0)
            return { seq: event.seq, text: encoded };
    }
    return { seq: event.seq, text };
}
/**
 * Select the newest explicit title source that DSH's normal title projection
 * cannot see. The newest goal round carries the current objective after a
 * `/goal edit`; if no round has started yet, fall back to the newest `/goal`
 * command's objective argument.
 *
 * This is intentionally not part of automatic title scheduling. It exists only
 * for a human who explicitly invoked `/retitle`.
 */
export function selectExplicitGoalTitleMessages(session) {
    const events = typeof session?.snapshotEvents === "function"
        ? session.snapshotEvents()
        : [];
    if (!Array.isArray(events))
        return [];
    let newest;
    let clearedAt = -1;
    for (const event of events) {
        const message = textOfGoalMessage(event);
        if (message !== undefined && (newest === undefined || message.seq > newest.seq))
            newest = message;
        if (event?.type !== "command/run" || event.data?.name !== "goal")
            continue;
        if (!Number.isSafeInteger(event.seq) || event.seq < 0)
            continue;
        const raw = typeof event.data.args === "string" ? event.data.args.trim() : "";
        if (/^clear$/iu.test(raw)) {
            clearedAt = Math.max(clearedAt, event.seq);
            continue;
        }
        if (raw.length === 0 || /^(?:pause|resume)$/iu.test(raw))
            continue;
        const objective = raw.replace(/^edit(?=\s|$)\s*/iu, "").trim();
        if (objective.length > 0 && (newest === undefined || event.seq > newest.seq))
            newest = { seq: event.seq, text: objective };
    }
    return newest !== undefined && clearedAt < newest.seq ? [newest] : [];
}
/** Match Core's ordinary user-source title input without touching its projection. */
export function selectOrdinaryTitleMessages(session) {
    const events = typeof session?.snapshotEvents === "function" ? session.snapshotEvents() : [];
    if (!Array.isArray(events)) return [];
    return events.flatMap((event) => {
        if (event?.type !== "user/message" || event.data?.source?.kind !== "user" || (!Number.isSafeInteger(event.seq) || event.seq < 0)) return [];
        const text = (Array.isArray(event.data.content) ? event.data.content : [])
            .filter((block) => block?.type === "text" && typeof block.text === "string")
            .map((block) => block.text).join("\n").trim();
        return text === "" ? [] : [{ seq: event.seq, text }];
    });
}
/** Append-only source/title event revisions plus the current route, with no prompt text. */
export function titleSessionRevision(session, current) {
    const events = typeof session?.snapshotEvents === "function" ? session.snapshotEvents() : [];
    const seqs = Array.isArray(events) ? events.filter((event) => event?.type === "session/title" ||
        event?.type === "user/message" && ["user", "goal"].includes(event.data?.source?.kind) ||
        event?.type === "command/run" && event.data?.name === "goal").map((event) => event.seq) : [];
    const config = typeof session?.requestHeader === "function" ? session.requestHeader()?.config : undefined;
    return JSON.stringify([seqs, current?.title, current?.source?.kind, config?.provider, config?.model]);
}
/**
 * Build the `/retitle` handler.
 *
 * @param sessionTitle - the real title service.
 * @param tokens - one-shot explicit-regeneration tokens.
 * @param readSettings - the settings in force right now.
 * @param log - optional structured logger.
 * @param recover - optional explicit-only recovery for sessions whose title
 *   input contains no ordinary user message. It must perform generation and
 *   commit through the host's official title service.
 */
export function createRetitleHandler(sessionTitle, tokens, readSettings, log, recover) {
    return async function retitle(invocation) {
        const session = invocation.agent.session;
        const sessionId = session.id;
        if (invocation.rawInput.trim() !== "") {
            return { kind: "error", text: `/${RETITLE_COMMAND} takes no arguments.` };
        }
        // Disabled mode must not touch the service at all: no refresh, no model
        // call, and an explicit message rather than a silent no-op.
        if (isAiTitleDisabled(readSettings())) {
            log?.info?.(`smart-session-title retitle refused sessionId=${sessionId} reason=disabled`);
            return { kind: "error", text: "AI title generation is disabled." };
        }
        // The lock is checked BEFORE the explicit-regeneration token is granted, so
        // a refused `/retitle` cannot leave a permission behind that a later
        // automatic schedule would spend. The client refuses locally too (it knows
        // the lock set); this half is what makes the guarantee hold for a stale
        // client, a hand-typed `/retitle`, and the batch run alike.
        if (isSessionTitleLocked(readSettings(), sessionId)) {
            log?.info?.(`smart-session-title retitle refused sessionId=${sessionId} reason=locked`);
            return { kind: "error", text: "This session's title is locked. Unlock it first." };
        }
        // Consumed by the provider; released again below so a refresh that never
        // reaches the provider cannot leave a stale permission behind.
        tokens.grant(sessionId);
        try {
            // Core returns the CURRENT snapshot for Goal-only sessions once a
            // title exists. Try the narrow recovery seam before refresh, so a
            // later /goal edit can regenerate instead of reporting the old title.
            const recovered = await recover?.(session, invocation.signal);
            if (recovered !== undefined) {
                log?.info?.(`smart-session-title retitle succeeded sessionId=${sessionId} source=${recovered.source.kind}`);
                return { kind: "success", text: `Title regenerated: ${recovered.title}` };
            }
            const accepted = await sessionTitle.refresh(session, invocation.signal);
            const snapshot = accepted ?? sessionTitle.get(session);
            if (snapshot === undefined) {
                return {
                    kind: "error",
                    text: "No title to regenerate yet: this session has no usable user message."
                };
            }
            log?.info?.(`smart-session-title retitle succeeded sessionId=${sessionId} source=${snapshot.source.kind}`);
            return { kind: "success", text: `Title regenerated: ${snapshot.title}` };
        }
        catch (error) {
            // Cancellation is not a command failure: propagate it so the caller's
            // signal semantics survive, and never retry here.
            if (invocation.signal?.aborted === true)
                throw error;
            log?.warn?.(`smart-session-title retitle failed sessionId=${sessionId} reason=${describeError(error)}`);
            return { kind: "error", text: `Title regeneration failed: ${describeError(error)}` };
        }
        finally {
            // No-op when the provider already spent the token.
            tokens.take(sessionId);
        }
    };
}
