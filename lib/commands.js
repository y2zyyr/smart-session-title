/**
 * Slash commands contributed by `smart-session-title` — and the handler that
 * owns `/retitle`.
 *
 * Kept in its own module with no `@deepseek-ai/*` imports so the handler is
 * directly unit-testable.
 *
 * The handler owns no title logic: it delegates to the service's own
 * `refresh()` and reports the outcome. It never calls the provider directly,
 * never appends a `session/title` event, and never touches the projection.
 */
import { isAiTitleDisabled } from "./settings.js";
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
 * Build the `/retitle` handler.
 *
 * @param sessionTitle - the real title service.
 * @param tokens - one-shot explicit-regeneration tokens.
 * @param readSettings - the settings in force right now.
 * @param log - optional structured logger.
 */
export function createRetitleHandler(sessionTitle, tokens, readSettings, log) {
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
        // Consumed by the provider; released again below so a refresh that never
        // reaches the provider cannot leave a stale permission behind.
        tokens.grant(sessionId);
        try {
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
