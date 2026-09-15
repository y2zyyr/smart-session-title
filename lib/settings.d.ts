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
import type { TitleConfig } from "./config.js";
import type { AffixDateFormat, AffixPosition } from "./title-affix.js";
/** Settings namespace; also the top-level key in `settings.yaml`. */
export declare const SETTINGS_NAMESPACE = "smart-session-title";
/** How the title model route is chosen. */
export type TitleMode = "current-session" | "configured" | "disabled";
/** How the title is phrased; unset means the plugin's own default. */
export type TitleStyle = "action-object" | "short-name";
/** Language the title is written in; unset means "follow the message". */
export type TitleLanguage = "zh" | "en";
/** Every supported mode, in UI order. */
export declare const TITLE_MODES: readonly TitleMode[];
/**
 * Every EXPLICIT phrasing, in UI order. The empty selection ("Default") is an
 * unset, not a member: an unset style follows the plugin's default policy, which
 * today is action + object.
 */
export declare const TITLE_STYLES: readonly TitleStyle[];
/**
 * Every EXPLICIT title language, in UI order. An unset language follows the
 * language primarily used by the human message (the pre-existing behaviour).
 */
export declare const TITLE_LANGUAGES: readonly TitleLanguage[];
/**
 * The user-writable slice of this plugin's configuration.
 *
 * `mode` and the optional numbers are deliberately `undefined`-able: an absent
 * value means "the user has never chosen", which lets a deployment that pinned
 * a route in its composition config keep its Phase 1/2 behaviour instead of
 * being silently switched to another route by a schema default.
 */
export interface TitleSettings {
    /** Master switch; `false` disables AI titles outright. */
    readonly enabled: boolean;
    /** Route strategy, or undefined when the user has never chosen one. */
    readonly mode: TitleMode | undefined;
    /** Configured provider id (mode `configured` only). */
    readonly provider: string | undefined;
    /** Configured model id (mode `configured` only). */
    readonly model: string | undefined;
    /** Per-attempt timeout override, or undefined to inherit the row config. */
    readonly timeoutMs: number | undefined;
    /** Attempt budget override, or undefined to inherit the row config. */
    readonly maxAttempts: number | undefined;
    /** Code-point cap on the generated title, or undefined for the byte default. */
    readonly maxTitleCharacters: number | undefined;
    /** Where the creation date goes, or undefined for "no affix". */
    readonly titleDatePosition: AffixPosition | undefined;
    /** Date shape; undefined means `ymd` wherever a position is set. */
    readonly titleDateFormat: AffixDateFormat | undefined;
    /** Explicit phrasing, or undefined to follow the plugin default. */
    readonly titleStyle: TitleStyle | undefined;
    /** Explicit title language, or undefined to follow the message. */
    readonly titleLanguage: TitleLanguage | undefined;
    /**
     * Words that must not appear in a title this plugin generates.
     *
     * `undefined` (never configured) and an empty list are the same state. Each
     * entry is matched literally — case-insensitively for entries containing
     * ASCII letters, exactly otherwise. Deleting a term from the message is the
     * pre-generation treatment; the same deletion is the deterministic last
     * resort when one survives into the model's output.
     */
    readonly titleExclusions: readonly string[] | undefined;
    /** Show the clickable session ID in the header; defaults to true. UI-only. */
    readonly showSessionId: boolean;
    /**
     * Sessions whose title is locked.
     *
     * `undefined` (never locked anything) and an empty list are the same state.
     * A lock blocks every path this plugin owns that would rewrite the title,
     * including the deliberate `/retitle` route and its batch run. It cannot
     * block DSH Core's own fallback for a session that still has no title, nor a
     * manual rename performed in DSH's UI.
     */
    readonly lockedSessionIds: readonly string[] | undefined;
}
/** Values the schema/bundle layer supplies when the user has chosen nothing. */
export declare const SETTINGS_BASE: {
    readonly enabled: boolean;
};
/** Every key this plugin's settings may carry. Anything else is refused. */
export declare const KNOWN_SETTINGS_KEYS: ReadonlySet<string>;
/** Bounds that keep a hand-edited `settings.yaml` from producing nonsense. */
export declare const SETTINGS_LIMITS: Readonly<{
    timeoutMsMin: 1000;
    timeoutMsMax: 120000;
    maxAttemptsMin: 1;
    maxAttemptsMax: 3;
    maxTitleCharactersMin: 8;
    maxTitleCharactersMax: 120;
    maxTitleExclusions: 50;
    maxTitleExclusionCharacters: 64;
    maxLockedSessions: 500;
    lockedSessionCharacters: 64;
}>;
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
export declare function resolveTitleSettings(raw: unknown): TitleSettings;
/**
 * Whether AI titles are off.
 *
 * Both the master switch and the `disabled` mode turn AI off. They are separate
 * controls because the requested UI exposes both; this is the single place that
 * decides what they mean together.
 */
export declare function isAiTitleDisabled(settings: TitleSettings): boolean;
/**
 * Whether one session's title is locked.
 *
 * A lock blocks every path this plugin owns that would rewrite the title,
 * including the deliberate `/retitle` route and its batch run. It does not block
 * DSH Core's fallback for a session with no title yet, nor a manual rename.
 *
 * @param settings - the settings in force right now.
 * @param sessionId - the session to test.
 * @returns whether this session is locked.
 */
export declare function isSessionTitleLocked(settings: TitleSettings, sessionId: string): boolean;
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
export declare function applySettingsToTitleConfig(base: TitleConfig, settings: TitleSettings): TitleConfig;
