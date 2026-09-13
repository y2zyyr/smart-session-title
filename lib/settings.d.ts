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
/** Settings namespace; also the top-level key in `settings.yaml`. */
export declare const SETTINGS_NAMESPACE = "smart-session-title";
/** How the title model route is chosen. */
export type TitleMode = "current-session" | "configured" | "disabled";
/** Every supported mode, in UI order. */
export declare const TITLE_MODES: readonly TitleMode[];
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
 * Layer settings over the composition config.
 *
 * Settings win for the two numbers the UI exposes; everything else — and in
 * particular the route — keeps coming from the row config. Route selection is
 * `resolveTitleRoute`'s single responsibility, so it is deliberately NOT
 * touched here.
 */
export declare function applySettingsToTitleConfig(base: TitleConfig, settings: TitleSettings): TitleConfig;
