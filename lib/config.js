/**
 * Configuration resolution for the `smart-session-title` provider.
 *
 * Pure module: no Cordis, no session, no filesystem, no network. Every value
 * is validated here so that a malformed plugin config fails loudly at load
 * (the same fail-fast posture as `@deepseek-ai/dsh-session-title`'s own
 * constructor) instead of degrading silently at title time.
 */
/** Documented defaults, mirroring the bundle patch in `cordis.patch.yml`. */
export const DEFAULT_TITLE_CONFIG = Object.freeze({
    targetWords: 6,
    targetCjkCharacters: 12,
    maxRawInputBytes: 65536,
    targetPreparedInputBytes: 12000,
    codeBlockKeepBytes: 400,
    maxOutputTokens: 96,
    timeoutMs: 15000,
    maxAttempts: 2
});
/** Largest `timeoutMs` accepted by a 32-bit timer. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;
/** Keys this provider understands; anything else is a configuration error. */
const KNOWN_KEYS = new Set([
    "targetWords",
    "targetCjkCharacters",
    "maxRawInputBytes",
    "targetPreparedInputBytes",
    "codeBlockKeepBytes",
    "maxOutputTokens",
    "timeoutMs",
    "maxAttempts",
    "provider",
    "model"
]);
function assertPositiveInteger(name, value) {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new TypeError(`smart-session-title: config.${name} must be a positive integer`);
    }
}
/**
 * Validate and freeze one plugin configuration object.
 *
 * @param raw - untrusted plugin config as delivered by the Cordis loader.
 * @returns an immutable, fully populated policy.
 * @throws {TypeError} on an unknown key or any out-of-range value.
 */
export function resolveTitleConfig(raw) {
    // An absent config is a valid config: the loader omits the key when the row
    // carries no `config` block, and every field has a documented default.
    if (raw === undefined || raw === null)
        return DEFAULT_TITLE_CONFIG;
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new TypeError("smart-session-title: config must be an object");
    }
    const value = raw;
    for (const key of Object.keys(value)) {
        if (!KNOWN_KEYS.has(key)) {
            throw new TypeError(`smart-session-title: unknown config key "${key}"`);
        }
    }
    // Start from defaults, then apply every supplied key.
    const merged = { ...DEFAULT_TITLE_CONFIG };
    for (const [key, supplied] of Object.entries(value)) {
        if (supplied !== undefined)
            merged[key] = supplied;
    }
    for (const name of [
        "targetWords",
        "targetCjkCharacters",
        "maxRawInputBytes",
        "targetPreparedInputBytes",
        "codeBlockKeepBytes",
        "maxOutputTokens",
        "timeoutMs",
        "maxAttempts"
    ]) {
        assertPositiveInteger(name, merged[name]);
    }
    const targetWords = merged.targetWords;
    const targetCjkCharacters = merged.targetCjkCharacters;
    const maxRawInputBytes = merged.maxRawInputBytes;
    const targetPreparedInputBytes = merged.targetPreparedInputBytes;
    const codeBlockKeepBytes = merged.codeBlockKeepBytes;
    const maxOutputTokens = merged.maxOutputTokens;
    const timeoutMs = merged.timeoutMs;
    const maxAttempts = merged.maxAttempts;
    if (targetPreparedInputBytes > maxRawInputBytes) {
        throw new TypeError("smart-session-title: config.targetPreparedInputBytes must not exceed config.maxRawInputBytes");
    }
    if (maxAttempts > 3) {
        throw new TypeError("smart-session-title: config.maxAttempts must be 1, 2, or 3");
    }
    if (timeoutMs > MAX_TIMER_DELAY_MS) {
        throw new TypeError(`smart-session-title: config.timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`);
    }
    const hasProvider = merged.provider !== undefined;
    const hasModel = merged.model !== undefined;
    if (hasProvider !== hasModel) {
        throw new TypeError("smart-session-title: config.provider and config.model must be supplied together");
    }
    if (hasProvider && (typeof merged.provider !== "string" || merged.provider.length === 0)) {
        throw new TypeError("smart-session-title: config.provider must be a non-empty string");
    }
    if (hasModel && (typeof merged.model !== "string" || merged.model.length === 0)) {
        throw new TypeError("smart-session-title: config.model must be a non-empty string");
    }
    const resolved = {
        targetWords,
        targetCjkCharacters,
        maxRawInputBytes,
        targetPreparedInputBytes,
        codeBlockKeepBytes,
        maxOutputTokens,
        timeoutMs,
        maxAttempts
    };
    if (hasProvider && hasModel) {
        return Object.freeze({
            ...resolved,
            provider: merged.provider,
            model: merged.model
        });
    }
    return Object.freeze(resolved);
}
