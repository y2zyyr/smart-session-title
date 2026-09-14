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
import { AFFIX_DATE_FORMATS, AFFIX_POSITIONS } from "./title-affix.js";
/** Settings namespace; also the top-level key in `settings.yaml`. */
export const SETTINGS_NAMESPACE = "smart-session-title";
/** Every supported mode, in UI order. */
export const TITLE_MODES = ["current-session", "configured", "disabled"];
/**
 * How the title is phrased.
 *
 * Only the EXPLICIT styles are enumerated: the empty selection ("Default") is an
 * unset, and an unset style means "follow the plugin's own default", which today
 * happens to be action + object. Keeping that mapping out of this list is what
 * lets the default policy evolve without silently rewriting a user's choice.
 */
export const TITLE_STYLES = ["action-object", "short-name"];
/**
 * Language the title is written in.
 *
 * Again only the explicit choices: an unset language means "follow the language
 * of the message", which is the pre-existing behaviour.
 */
export const TITLE_LANGUAGES = ["zh", "en"];
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
    "maxAttempts",
    // Title shape: a code-point cap and an optional date affix. Absent means
    // "inherit the deployment config" / "no affix", never a silent default.
    "maxTitleCharacters",
    "titleDatePosition",
    "titleDateFormat",
    // Title content: phrasing, language, and the words that must not appear in a
    // generated title. Absent means "no preference" / "no exclusions".
    "titleStyle",
    "titleLanguage",
    "titleExclusions",
    // Sessions whose title the user has locked. Absent means "nothing locked".
    "lockedSessionIds"
]);
/** Bounds that keep a hand-edited `settings.yaml` from producing nonsense. */
export const SETTINGS_LIMITS = Object.freeze({
    timeoutMsMin: 1000,
    timeoutMsMax: 120000,
    maxAttemptsMin: 1,
    maxAttemptsMax: 3,
    // Below 8 characters a title stops naming anything; 120 is the policy's own
    // paragraph ceiling (MAX_TITLE_CODE_POINTS), so a larger cap would be a lie.
    maxTitleCharactersMin: 8,
    maxTitleCharactersMax: 120,
    // An exclusion list is a hand-maintained denylist, not a corpus: 50 terms is
    // already far more than anyone curates, and an unbounded list would make every
    // generation scan it. 64 code points comfortably covers a company or project
    // name while keeping one entry from swallowing a whole sentence.
    maxTitleExclusions: 50,
    maxTitleExclusionCharacters: 64,
    // Session ids are UUIDs (44 characters at most with a `session-` prefix), so
    // 64 is generous headroom. 500 locks is far beyond a curated set and keeps the
    // list from growing without bound in a config file.
    maxLockedSessions: 500,
    lockedSessionCharacters: 64
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
 * Validate one enumerated settings value.
 *
 * Membership is checked against the same constant the running policy uses, so
 * a value the UI can write and a value the host accepts can never drift apart.
 */
function optionalEnum(name, value, allowed) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "string" || !allowed.includes(value)) {
        throw new TypeError(`smart-session-title: settings.${name} must be one of ${allowed.join(", ")}`);
    }
    return value;
}
/**
 * Validate one list-of-strings setting (the exclusion words).
 *
 * The UI is a textarea, so the normalization a human expects is applied HERE
 * rather than in the component: blank lines are dropped, entries are trimmed,
 * duplicates collapse to their first occurrence, and an all-blank list becomes
 * `undefined` (the same "never chosen" value an unset field has) instead of an
 * empty array the two halves would have to special-case.
 *
 * A non-string entry, a control character, or an over-long entry is refused
 * rather than silently repaired: those can only come from a hand-edited
 * `settings.yaml`, and quietly dropping one would leave the user believing a
 * term is hidden when it is not.
 */
function optionalStringList(name, value, maxItems, maxCharacters) {
    if (value === undefined || value === null)
        return undefined;
    if (!Array.isArray(value)) {
        throw new TypeError(`smart-session-title: settings.${name} must be a list of strings`);
    }
    const seen = new Set();
    const out = [];
    for (const item of value) {
        if (typeof item !== "string") {
            throw new TypeError(`smart-session-title: settings.${name} entries must be strings`);
        }
        const trimmed = item.trim();
        if (trimmed.length === 0)
            continue;
        if (/[\u0000-\u001F\u007F]/u.test(trimmed)) {
            throw new TypeError(`smart-session-title: settings.${name} entries must be single-line text`);
        }
        if (Array.from(trimmed).length > maxCharacters) {
            throw new TypeError(`smart-session-title: settings.${name} entries must be at most ${maxCharacters} characters`);
        }
        if (seen.has(trimmed))
            continue;
        seen.add(trimmed);
        out.push(trimmed);
    }
    if (out.length > maxItems) {
        throw new TypeError(`smart-session-title: settings.${name} must hold at most ${maxItems} entries`);
    }
    return out.length === 0 ? undefined : Object.freeze(out);
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
            maxAttempts: undefined,
            maxTitleCharacters: undefined,
            titleDatePosition: undefined,
            titleDateFormat: undefined,
            titleStyle: undefined,
            titleLanguage: undefined,
            titleExclusions: undefined,
            lockedSessionIds: undefined
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
    // Title shape. An unset date position means "no affix", so there is no
    // redundant `off` member to keep in sync with the UI; an unset format falls
    // back to `ymd` at the point of use.
    const maxTitleCharacters = optionalInteger("maxTitleCharacters", value.maxTitleCharacters, SETTINGS_LIMITS.maxTitleCharactersMin, SETTINGS_LIMITS.maxTitleCharactersMax);
    const titleDatePosition = optionalEnum("titleDatePosition", value.titleDatePosition, AFFIX_POSITIONS);
    const titleDateFormat = optionalEnum("titleDateFormat", value.titleDateFormat, AFFIX_DATE_FORMATS);
    // Title content. Same "absent means inherit" contract as the shape above: an
    // unset style keeps the plugin default, an unset language follows the message.
    const titleStyle = optionalEnum("titleStyle", value.titleStyle, TITLE_STYLES);
    const titleLanguage = optionalEnum("titleLanguage", value.titleLanguage, TITLE_LANGUAGES);
    const titleExclusions = optionalStringList("titleExclusions", value.titleExclusions, SETTINGS_LIMITS.maxTitleExclusions, SETTINGS_LIMITS.maxTitleExclusionCharacters);
    // Locked sessions use the same list normalization as the exclusion words:
    // trim, drop blanks, dedupe, collapse an empty result to "nothing locked".
    // A session id is an opaque string here — this half never parses one.
    const lockedSessionIds = optionalStringList("lockedSessionIds", value.lockedSessionIds, SETTINGS_LIMITS.maxLockedSessions, SETTINGS_LIMITS.lockedSessionCharacters);
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
        maxAttempts,
        maxTitleCharacters,
        titleDatePosition,
        titleDateFormat,
        titleStyle,
        titleLanguage,
        titleExclusions,
        lockedSessionIds
    });
}
/**
 * Whether one session's title is locked.
 *
 * A lock is the user saying "no entry point may rewrite this title" — including
 * the two DELIBERATE paths that otherwise override a hand-written title
 * (`/retitle` and its batch run). It is deliberately weaker than nothing and
 * stronger than a manual title: it does not stop DSH Core from setting a
 * fallback on a session that has no title yet, and it does not stop the user
 * renaming a title by hand. That boundary is documented in both READMEs.
 *
 * @param settings - the settings in force right now.
 * @param sessionId - the session to test.
 * @returns whether this session is locked.
 */
export function isSessionTitleLocked(settings, sessionId) {
    if (typeof sessionId !== "string" || sessionId.length === 0)
        return false;
    const locked = settings.lockedSessionIds;
    return locked !== undefined && locked.includes(sessionId);
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
 *
 * The title-shape fields (`maxTitleCharacters`, `titleDatePosition`,
 * `titleDateFormat`) and the title-content fields (`titleStyle`,
 * `titleLanguage`, `titleExclusions`) are deliberately NOT merged: they have no
 * composition equivalent, and the provider reads them from the settings half of
 * the policy so an absent value keeps meaning "no cap" / "no affix" / "no
 * preference" / "no exclusions".
 */
export function applySettingsToTitleConfig(base, settings) {
    return Object.freeze({
        ...base,
        timeoutMs: settings.timeoutMs ?? base.timeoutMs,
        maxAttempts: settings.maxAttempts ?? base.maxAttempts
    });
}
