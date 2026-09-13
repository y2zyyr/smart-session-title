/**
 * User-facing settings for `smart-session-title`.
 *
 * Pure module: no Cordis, no schemastery import. The loader schema lives in
 * `index.ts` (which already imports the settings schema builder); everything
 * decision-shaped — defaults, validation, and the relationship between the
 * settings and the deployment's composition config — lives here so it is
 * directly unit-testable.
 *
 * The settings document is `$DSH_HOME/settings.yaml`, written through the
 * harness' own settings service (`ctx.settings.register`). This plugin stores
 * only provider and model IDENTIFIERS; credentials stay with DSH.
 */
/** Settings namespace; also the top-level key in `settings.yaml`. */
export const SETTINGS_NAMESPACE = "smart-session-title";
/** Every supported mode, in UI order. */
export const TITLE_MODES = ["current-session", "configured", "disabled"];
/** Values the schema/bundle layer supplies when the user has chosen nothing. */
export const SETTINGS_BASE = Object.freeze({
    enabled: true
});
/** Every key this plugin's settings may carry. Anything else is refused. */
export const KNOWN_SETTINGS_KEYS = new Set([
    "enabled",
    "mode",
    "provider",
    "model",
    "timeoutMs",
    "maxAttempts"
]);
/** Bounds that keep a hand-edited `settings.yaml` from producing nonsense. */
export const SETTINGS_LIMITS = Object.freeze({
    timeoutMsMin: 1000,
    timeoutMsMax: 120000,
    maxAttemptsMin: 1,
    maxAttemptsMax: 3
});
const isMode = (value) => typeof value === "string" && TITLE_MODES.includes(value);
function optionalString(name, value) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "string") {
        throw new TypeError(`smart-session-title: settings.${name} must be a string`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        throw new TypeError(`smart-session-title: settings.${name} must not be empty`);
    }
    return trimmed;
}
function optionalInteger(name, value, min, max) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new TypeError(`smart-session-title: settings.${name} must be an integer`);
    }
    if (value < min || value > max) {
        throw new TypeError(`smart-session-title: settings.${name} must be between ${min} and ${max}`);
    }
    return value;
}
/**
 * Validate one resolved settings value.
 *
 * This is the `validate` hook the settings service calls on every resolved
 * value — including a value loaded from disk at registration time — so a
 * malformed section fails loudly at the earliest possible point rather than
 * degrading a title at run time.
 *
 * @param raw - the resolved settings section.
 * @returns a detached, immutable settings value.
 * @throws {TypeError} on any out-of-range or inconsistent field.
 */
export function resolveTitleSettings(raw) {
    if (raw === undefined || raw === null) {
        return Object.freeze({
            enabled: true,
            mode: undefined,
            provider: undefined,
            model: undefined,
            timeoutMs: undefined,
            maxAttempts: undefined
        });
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new TypeError("smart-session-title: settings must be an object");
    }
    const value = raw;
    // schemastery merges unknown keys into the resolved value rather than
    // rejecting them (`.strict()` is a zod feature), so the unknown-key check
    // lives HERE, in the `validate` hook the settings service runs on every
    // resolved value. A credential-shaped or typo'd key is refused at write
    // time and never reaches the document.
    for (const key of Object.keys(value)) {
        if (!KNOWN_SETTINGS_KEYS.has(key)) {
            throw new TypeError(`smart-session-title: settings has an unexpected key "${key}"`);
        }
    }
    if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
        throw new TypeError("smart-session-title: settings.enabled must be a boolean");
    }
    if (value.mode !== undefined && value.mode !== null && !isMode(value.mode)) {
        throw new TypeError(`smart-session-title: settings.mode must be one of ${TITLE_MODES.join(", ")}`);
    }
    const mode = isMode(value.mode) ? value.mode : undefined;
    const provider = optionalString("provider", value.provider);
    const model = optionalString("model", value.model);
    const timeoutMs = optionalInteger("timeoutMs", value.timeoutMs, SETTINGS_LIMITS.timeoutMsMin, SETTINGS_LIMITS.timeoutMsMax);
    const maxAttempts = optionalInteger("maxAttempts", value.maxAttempts, SETTINGS_LIMITS.maxAttemptsMin, SETTINGS_LIMITS.maxAttemptsMax);
    // A configured route must be whole — both halves present, and present at all
    // when the user has actually chosen `configured`. Refusing here is what keeps
    // the UI from saving "provider set, model empty", keeps a hand-edited
    // settings.yaml from booting into a half-configured state, and stops the
    // provider from silently falling back to some other route.
    if (provider !== undefined && model === undefined) {
        throw new TypeError("smart-session-title: settings.provider and settings.model must be supplied together");
    }
    if (model !== undefined && provider === undefined) {
        throw new TypeError("smart-session-title: settings.provider and settings.model must be supplied together");
    }
    if (mode === "configured" && (provider === undefined || model === undefined)) {
        throw new TypeError('smart-session-title: settings.mode is "configured" but no provider and model are set; ' +
            "choose both, or use current-session");
    }
    return Object.freeze({
        enabled: value.enabled === undefined ? true : value.enabled,
        mode,
        provider,
        model,
        timeoutMs,
        maxAttempts
    });
}
/**
 * Whether AI titles are off.
 *
 * Both the master switch and the `disabled` mode turn AI off. They are separate
 * controls because the requested UI exposes both; this is the single place that
 * decides what they mean together.
 */
export function isAiTitleDisabled(settings) {
    return settings.enabled === false || settings.mode === "disabled";
}
/**
 * Layer settings over the composition config.
 *
 * Settings win for the two numbers the UI exposes; everything else — and in
 * particular the route — keeps coming from the row config. Route selection is
 * `resolveTitleRoute`'s single responsibility, so it is deliberately NOT
 * touched here.
 */
export function applySettingsToTitleConfig(base, settings) {
    return Object.freeze({
        ...base,
        timeoutMs: settings.timeoutMs ?? base.timeoutMs,
        maxAttempts: settings.maxAttempts ?? base.maxAttempts
    });
}
