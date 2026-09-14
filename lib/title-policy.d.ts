/**
 * Pure title policy: prompt assessment, input compression, title validation.
 *
 * This module is deliberately free of Cordis, sessions, `ctx`, filesystem and
 * network access so every rule is directly unit-testable. The provider layer
 * owns orchestration; all decisions live here.
 *
 * Design intent (Phase 1): the built-in provider threw as soon as the framed
 * first prompt exceeded 4096 bytes, which meant *no model call at all* and a
 * permanently truncated fallback title. Compression — never rejection — is the
 * fix, plus refusing to invent a title for prompts that carry no task.
 */
import type { TitleConfig } from "./config.js";
/** UTF-8 byte length, matching the unit the session-title service caps in. */
export declare function byteLength(input: string): number;
/**
 * Strip control sequences and produce one trimmed, whitespace-normalized line.
 * Mirrors the sanitization the session-title service applies to every accepted
 * title, so our own checks see the same text the sidebar eventually will.
 */
export declare function cleanTitleText(input: string): string;
/**
 * Longest leading code-point prefix within a UTF-8 byte budget.
 * Never splits a code point.
 */
export declare function truncateTitleUtf8(input: string, maxBytes: number): string;
/**
 * Shorten a title to a byte budget, preferring a nearby separator over a
 * mid-word cut. Falls back to a hard code-point-safe cut when no separator
 * leaves enough of the title intact.
 */
export declare function truncateSemantically(input: string, maxBytes: number): string;
/**
 * Shorten a title to a code-point budget, preferring a nearby separator.
 *
 * The byte cap is the service's hard limit; this one is what a human means by
 * "字数" (26 CJK characters and 80 Latin characters are both 80 bytes). It is
 * applied AFTER the byte cap, so a title never exceeds either limit.
 */
export declare function truncateTitleCharacters(input: string, maxCharacters: number): string;
export interface CodeBlockStripResult {
    readonly text: string;
    readonly omitted: number;
    readonly omittedBytes: number;
}
/**
 * Replace large fenced code blocks with a short placeholder.
 *
 * Small blocks are kept: a two-line snippet can carry the task ("修复这个函数"
 * plus three lines) while an 8 KB dump cannot. An unterminated fence is treated
 * as running to the end of the input.
 */
export declare function stripLargeFencedCodeBlocks(input: string, keepBytes: number): CodeBlockStripResult;
/**
 * Delete every fenced code block outright.
 *
 * Used by prompt assessment, where the question is "is there any natural
 * language left?" — a placeholder would answer that question wrongly.
 */
export declare function removeFencedCodeBlocks(input: string): CodeBlockStripResult;
export type WeakPromptReason = "empty" | "code-only" | "url-only" | "path-only" | "punctuation-only" | "greeting" | "demonstrative" | "too-short-no-signal";
export interface PromptAssessment {
    readonly weak: boolean;
    readonly reason?: WeakPromptReason;
    /** Text with code fences and URL noise removed; used for the signal checks. */
    readonly signal: string;
}
/** Bare URLs and nothing else. */
export declare function isUrlOnly(input: string): boolean;
/** A single local filesystem path and nothing else. */
export declare function isPathOnly(input: string): boolean;
/**
 * Decide whether a first prompt carries an actionable task.
 *
 * Deliberately conservative: every list check is an exact match, and the
 * short-prompt rule requires the *absence* of an action verb, latin text and
 * any technical signal. "修复登录 bug" is a real task; "看看这个" is not.
 */
export declare function assessPrompt(input: string): PromptAssessment;
export type PreparationStrategy = "verbatim" | "code-stripped" | "windowed" | "structured" | "head-tail";
export interface PreparedTitleInput {
    /** The compressed prompt text handed to the title model. */
    readonly text: string;
    readonly rawBytes: number;
    readonly preparedBytes: number;
    readonly strategy: PreparationStrategy;
    readonly omittedCodeBlocks: number;
    readonly omittedCodeBytes: number;
    /** True when `maxRawInputBytes` forced a head+tail window before compression. */
    readonly rawWindowed: boolean;
    /** How many exclusion-term occurrences were deleted before sending. */
    readonly excludedTerms: number;
}
/**
 * One compiled exclusion term.
 *
 * Matching is literal: a term containing ASCII letters is matched
 * case-insensitively, every other term exactly. No stemming, aliases or
 * translation — each variant is a separate entry.
 */
export interface CompiledTitleExclusion {
    readonly term: string;
    readonly source: string;
    readonly flags: string;
}
/**
 * Compile the configured exclusion list, dropping anything unusable.
 *
 * @param exclusions - the raw list, possibly undefined.
 * @returns one entry per usable term, in the user's order.
 */
export declare function compileTitleExclusions(exclusions: readonly string[] | undefined): readonly CompiledTitleExclusion[];
/**
 * The first configured term that still occurs in `text`, or undefined.
 *
 * Run on the exact string about to be stored, so a term cannot slip through by
 * appearing only after shortening, and a term cut in half is not falsely hit.
 *
 * @param text - the candidate title (post-validation, post-truncation).
 * @param compiled - output of {@link compileTitleExclusions}.
 * @returns the offending term.
 */
export declare function findExcludedTerm(text: string, compiled: readonly CompiledTitleExclusion[]): string | undefined;
/**
 * Delete every configured term from `text`.
 *
 * Used before generation (the model never sees the term) and as the
 * deterministic last resort when one survives into the model's output. Line
 * structure is preserved; only the whitespace left on an affected line is
 * repaired.
 *
 * @param text - the text to redact.
 * @param compiled - output of {@link compileTitleExclusions}.
 * @returns the redacted text and how many occurrences were removed.
 */
export declare function redactExcludedTerms(text: string, compiled: readonly CompiledTitleExclusion[]): {
    readonly text: string;
    readonly removed: number;
};
/**
 * Keep the parts of a long task specification that actually name the task:
 * the opening lines, every section heading with its lead sentence, and the
 * closing lines (which usually carry the deliverable and the prohibitions).
 */
export declare function extractSalientRegions(input: string): string;
/**
 * Compress one first prompt into a title-model input that fits the budget.
 *
 * Order of operations: redact the exclusion terms, window the raw text if it is
 * absurdly large, drop large code blocks, then fall back to structural
 * extraction, then to head+tail. The function never rejects an input on size
 * alone, and redaction runs first so nothing downstream can reintroduce a term.
 *
 * @param input - the raw human message.
 * @param config - resolved composition config.
 * @param exclusions - the raw `titleExclusions` setting (undefined = none).
 */
export declare function prepareTitleInput(input: string, config: Pick<TitleConfig, "maxRawInputBytes" | "targetPreparedInputBytes" | "codeBlockKeepBytes">, exclusions?: readonly string[] | undefined): PreparedTitleInput;
/** One eligible human message as the service hands it to a provider. */
export interface HumanMessage {
    readonly seq: number;
    readonly text: string;
}
export interface TaskTargetSelection {
    /** The first message that actually names a task, if any. */
    readonly target: HumanMessage | undefined;
    /** How many of the supplied messages carry a task. */
    readonly meaningfulCount: number;
    /** How many were rejected as weak. */
    readonly weakCount: number;
    /** Why each weak message was rejected, in order (for diagnostics). */
    readonly weakReasons: readonly WeakPromptReason[];
}
/**
 * Pick the message that defines the session's task.
 *
 * Recovery hinges on this: a session opened with "你好" must still be titled
 * from the first *later* message that names real work, and the target must not
 * drift to whatever the user typed last — `/retitle` is the explicit tool for
 * re-naming an evolved session.
 *
 * Deliberately the FIRST meaningful message rather than the newest: after
 * `你好 / 看看这个 / 这个 zip 是项目源码，帮我修复构建错误`, the third message is
 * the task, and an automatic re-title on every later turn is out of scope.
 */
export declare function selectTaskTarget(messages: readonly HumanMessage[]): TaskTargetSelection;
export type TitleRejectReason = "empty" | "placeholder" | "generic" | "url" | "path" | "code" | "too-long" | "no-letters";
export type TitleValidation = {
    readonly ok: true;
    readonly title: string;
} | {
    readonly ok: false;
    readonly reason: TitleRejectReason;
};
/**
 * Quality gate applied on top of the service's own normalization.
 *
 * Accepts short-but-real titles ("修复 Bug", "修复 TRANSLATION_SCHEMA_INVALID")
 * and only rejects output that is empty, a placeholder, a generic phrase, a
 * bare URL/path, letterless, or a whole paragraph.
 *
 * @param raw - the model's raw text output.
 * @param maxTitleBytes - the byte budget the caller will also enforce.
 * @param maxTitleCharacters - optional code-point cap ("字数"), applied after
 *   the byte cap so the title honours whichever limit is tighter.
 */
export declare function validateGeneratedTitle(raw: string, maxTitleBytes: number, maxTitleCharacters?: number): TitleValidation;
