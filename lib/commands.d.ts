/**
 * Slash commands contributed by `smart-session-title` — and the handler that
 * owns `/retitle`.
 *
 * Kept in its own module with no `@deepseek-ai/*` imports so the handler is
 * directly unit-testable.
 *
 * The handler owns no title logic: it delegates to the service's own
 * `refresh()` and reports the outcome. An optional explicit-only recovery seam
 * covers DSH Goal sessions whose messages are outside Core's title projection;
 * the host callback owns generation and commits through the official service.
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
        input?: { hint: string; attachments?: boolean };
        recordInput?: boolean;
        handler: (invocation: CommandInvocationLike) => CommandResultLike | Promise<CommandResultLike>;
    }): () => void;
}
/** A structured logger; `ctx.logger` satisfies it. */
export interface CommandLogger {
    info?(message: string): void;
    warn?(message: string): void;
}
/** Minimal event snapshot surface used by the explicit Goal recovery path. */
export interface GoalTitleSessionLike {
    readonly snapshotEvents?: (() => readonly unknown[]) | undefined;
}
/** One title source recovered from a Goal command or Goal round. */
export interface ExplicitGoalTitleMessage {
    readonly seq: number;
    readonly text: string;
}
/** Select the newest Goal objective that DSH's normal title projection ignores. */
export declare function selectExplicitGoalTitleMessages(session: GoalTitleSessionLike): ExplicitGoalTitleMessage[];
/** Match Core's ordinary user-source text input. */
export declare function selectOrdinaryTitleMessages(session: GoalTitleSessionLike): ExplicitGoalTitleMessage[];
/** Compare source/title event revisions and the current route without storing prompts. */
export declare function titleSessionRevision(session: GoalTitleSessionLike & { requestHeader?: () => { config?: { provider?: string; model?: string } } | undefined }, current?: RetitleRecoverySnapshot): string;
/** Minimal accepted-title shape returned by the official title service. */
export interface RetitleRecoverySnapshot {
    readonly title: string;
    readonly source: {
        readonly kind: string;
    };
}
/** Explicit-only recovery for title sources outside DSH's ordinary user-input projection. */
export type RetitleRecovery = (session: LiveSessionLike, signal?: AbortSignal | undefined) => Promise<RetitleRecoverySnapshot | undefined>;
/**
 * Build the `/retitle` handler.
 *
 * @param sessionTitle - the real title service.
 * @param tokens - one-shot explicit-regeneration tokens.
 * @param readSettings - the settings in force right now.
 * @param log - optional structured logger.
 * @param recover - optional explicit-only recovery for sessions whose title
 *   input contains no ordinary user message. Called before refresh; it must
 *   decline sessions with ordinary input even when they also contain Goal events.
 */
export declare function createRetitleHandler(sessionTitle: SessionTitleService, tokens: ExplicitRegenerationTokens, readSettings: () => TitleSettings, log?: CommandLogger | undefined, recover?: RetitleRecovery | undefined): (invocation: CommandInvocationLike) => Promise<CommandResultLike>;
