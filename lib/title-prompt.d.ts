/**
 * Prompt construction for the title model.
 *
 * Pure module: builds strings only. The system prompt is derived from the
 * first-party `@deepseek-ai/dsh-session-title-llm` instruction (same framing,
 * same plain-text-only and language rules) and extended with the guidance the
 * shipped prompt lacks: "task index, not conversation summary", action +
 * object, anti-generic rules, and an explicit ban on copying the opening
 * words of the prompt.
 *
 * The user's phrasing and language preferences REPLACE the corresponding default
 * rules instead of being appended beside them, and a configured exclusion list is
 * never sent to the model — only the fact that names were removed.
 */
import type { TitleConfig } from "./config.js";
import type { TitleLanguage, TitleStyle } from "./settings.js";
/** Plugin identity recorded on the LLM user message source. */
export declare const PLUGIN_NAME = "smart-session-title";
/**
 * The title preferences that shape a prompt.
 *
 * Every member is optional, and "absent" always means the pre-existing
 * behaviour: the plugin's default phrasing, the message's own language, and no
 * removed names.
 */
export interface TitlePromptOptions {
    /** Explicit phrasing, or undefined for the plugin default (action + object). */
    readonly style?: TitleStyle | undefined;
    /** Explicit title language, or undefined to follow the message. */
    readonly language?: TitleLanguage | undefined;
    /** Whether the exclusion list deleted anything from the message. */
    readonly hasExclusions?: boolean | undefined;
}
/**
 * Sent as a second user turn when the first attempt produced unusable text.
 *
 * Deterministic and bounded so a retry cannot drift into a new task, and derived
 * from the same preferences as the system prompt.
 *
 * @param options - phrasing, language and whether names were removed.
 */
export declare function buildRetryDirective(options?: TitlePromptOptions): string;
/** The default retry directive: no style, no language, no exclusions. */
export declare const RETRY_DIRECTIVE: string;
/**
 * Build the system instruction.
 *
 * The rule set is intentionally short. It encodes exactly the properties Phase 0
 * identified as missing: task-index framing, action + object, identifier
 * preservation, an explicit generic-title blacklist, and "do not copy the
 * beginning of the prompt".
 *
 * @param config - the resolved composition config (length guidance only).
 * @param options - the user's phrasing/language preferences; defaults reproduce
 *   the pre-existing prompt.
 */
export declare function buildSystemPrompt(config: Pick<TitleConfig, "targetWords" | "targetCjkCharacters">, options?: TitlePromptOptions): string;
/**
 * Anchors used when the language is left on automatic.
 *
 * Mixed on purpose: the model should read the language off the message.
 */
export declare const SYSTEM_EXAMPLES: readonly string[];
/**
 * Frame the prepared message so user text cannot break structural delimiters.
 *
 * JSON-encoding is the same defence the first-party provider uses: newlines and
 * quotes in the prompt become escapes, so no prompt content can forge a new
 * instruction section.
 */
export declare function frameTitleInput(preparedText: string): string;
/**
 * Full user message body for one attempt.
 *
 * @param preparedText - the (already redacted and compressed) human message.
 * @param retry - whether this is a second attempt.
 * @param options - the same preferences the system prompt was built from.
 */
export declare function buildUserInput(preparedText: string, retry: boolean, options?: TitlePromptOptions): string;
