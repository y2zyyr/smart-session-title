/**
 * Prompt construction for the title model.
 *
 * Pure module: builds strings only. The system prompt is derived from the
 * first-party `@deepseek-ai/dsh-session-title-llm` instruction (same framing,
 * same plain-text-only and language rules) and extended with the guidance the
 * shipped prompt lacks: "task index, not conversation summary", action +
 * object, anti-generic rules, and an explicit ban on copying the opening
 * words of the prompt.
 */
import type { TitleConfig } from "./config.js";
/** Plugin identity recorded on the LLM user message source. */
export declare const PLUGIN_NAME = "smart-session-title";
/**
 * Sent as a second user turn when the first attempt produced unusable text.
 * Deterministic and bounded so a retry cannot drift into a new task.
 */
export declare const RETRY_DIRECTIVE: string;
/**
 * Build the system instruction.
 *
 * The rule set is intentionally short. It encodes exactly the properties Phase 0
 * identified as missing: task-index framing, action + object, identifier
 * preservation, an explicit generic-title blacklist, and "do not copy the
 * beginning of the prompt".
 */
export declare function buildSystemPrompt(config: Pick<TitleConfig, "targetWords" | "targetCjkCharacters">): string;
/** A few anchors only — enough to fix the shape without biasing the language. */
export declare const SYSTEM_EXAMPLES: readonly string[];
/**
 * Frame the prepared message so user text cannot break structural delimiters.
 *
 * JSON-encoding is the same defence the first-party provider uses: newlines and
 * quotes in the prompt become escapes, so no prompt content can forge a new
 * instruction section.
 */
export declare function frameTitleInput(preparedText: string): string;
/** Full user message body for one attempt. */
export declare function buildUserInput(preparedText: string, retry: boolean): string;
