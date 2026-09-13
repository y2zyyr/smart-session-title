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
import type { LiveSessionLike, SessionTitleService } from "@deepseek-ai/dsh-session-title";
import type { TitleSettings } from "./settings.js";
import type { ExplicitRegenerationTokens } from "./tokens.js";
/** Slash command that regenerates the current session title. */
export declare const RETITLE_COMMAND = "retitle";
/** Command description, as shown by the command surface. */
export declare const RETITLE_DESCRIPTION = "Regenerate the current session title.";
/** Slash command that reports local title diagnostics. */
export declare const STATUS_COMMAND = "title-status";
/** Command description for the diagnostics command. */
export declare const STATUS_DESCRIPTION = "Show smart-session-title diagnostics for this process.";
/** One command invocation, as the command registry defines it. */
export interface CommandInvocationLike {
    readonly agent: {
        readonly session: LiveSessionLike;
    };
    readonly rawInput: string;
    readonly signal?: AbortSignal | undefined;
}
/** A command outcome; the registry validates this shape at its boundary. */
export type CommandResultLike = {
    readonly kind: "success";
    readonly text?: string;
} | {
    readonly kind: "error";
    readonly text: string;
};
/** The command registry surface this plugin uses. */
export interface CommandsService {
    register(definition: {
        name: string;
        description: string;
        handler: (invocation: CommandInvocationLike) => CommandResultLike | Promise<CommandResultLike>;
    }): () => void;
}
/** A structured logger; `ctx.logger` satisfies it. */
export interface CommandLogger {
    info?(message: string): void;
    warn?(message: string): void;
}
/**
 * Build the `/retitle` handler.
 *
 * @param sessionTitle - the real title service.
 * @param tokens - one-shot explicit-regeneration tokens.
 * @param readSettings - the settings in force right now.
 * @param log - optional structured logger.
 */
export declare function createRetitleHandler(sessionTitle: SessionTitleService, tokens: ExplicitRegenerationTokens, readSettings: () => TitleSettings, log?: CommandLogger | undefined): (invocation: CommandInvocationLike) => Promise<CommandResultLike>;
