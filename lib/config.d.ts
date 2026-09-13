/**
 * Configuration resolution for the `smart-session-title` provider.
 *
 * Pure module: no Cordis, no session, no filesystem, no network. Every value
 * is validated here so that a malformed plugin config fails loudly at load
 * (the same fail-fast posture as `@deepseek-ai/dsh-session-title`'s own
 * constructor) instead of degrading silently at title time.
 */
/** Fully resolved, immutable provider policy. */
export interface TitleConfig {
    /** Soft target for the number of words in a non-CJK title. */
    readonly targetWords: number;
    /** Soft target for the number of characters in a CJK title. */
    readonly targetCjkCharacters: number;
    /**
     * Largest raw first-prompt byte count we are willing to *inspect*. Inputs
     * above this are windowed (head + tail) before compression; they are never
     * rejected — refusing was the built-in provider's fatal flaw.
     */
    readonly maxRawInputBytes: number;
    /** Byte budget for the compressed prompt text sent to the title model. */
    readonly targetPreparedInputBytes: number;
    /** A fenced code block larger than this is replaced by a placeholder. */
    readonly codeBlockKeepBytes: number;
    readonly maxOutputTokens: number;
    readonly timeoutMs: number;
    /** Total attempts = 1 initial + (maxAttempts - 1) retries. */
    readonly maxAttempts: number;
    /** Explicit route override; both fields appear together or neither does. */
    readonly provider?: string;
    readonly model?: string;
}
/** Documented defaults, mirroring the bundle patch in `cordis.patch.yml`. */
export declare const DEFAULT_TITLE_CONFIG: TitleConfig;
/**
 * Validate and freeze one plugin configuration object.
 *
 * @param raw - untrusted plugin config as delivered by the Cordis loader.
 * @returns an immutable, fully populated policy.
 * @throws {TypeError} on an unknown key or any out-of-range value.
 */
export declare function resolveTitleConfig(raw: unknown): TitleConfig;
