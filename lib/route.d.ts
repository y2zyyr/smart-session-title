/**
 * Title route selection — the single place that decides which model generates a
 * title, and why.
 *
 * Pure module: no Cordis, no session, no provider import. Keeping it here means
 * `provider.ts` contains no scattered route branches, and every combination of
 * mode / pinned route / session route is directly unit-testable.
 *
 * Three modes:
 *
 *  - `current-session` — the route the session is actually using, taken from the
 *    logged `request/header`. Identical to Phase 1/2 behaviour, and never a
 *    silent fall back to some default agent model.
 *  - `configured` — an explicit provider+model pair. Both halves must exist.
 *  - `disabled` — no model call at all.
 */
import type { TitleMode } from "./settings.js";
/** A provider/model pair. */
export interface ModelRoute {
    readonly provider: string;
    readonly model: string;
}
/** Why a route could not be produced. */
export type RouteAbstentionReason = "disabled" | "configured-incomplete" | "no-session-route";
/** The route decision, or the reason there is none. */
export type TitleRouteResolution = {
    readonly kind: "route";
    readonly provider: string;
    readonly model: string;
    /** Which input produced the route, for diagnostics. */
    readonly source: "session" | "configured" | "pinned";
} | {
    readonly kind: "abstain";
    readonly reason: RouteAbstentionReason;
    readonly detail: string;
};
export interface TitleRouteInput {
    /** Master switch. */
    readonly enabled: boolean;
    /** The user's chosen mode, or undefined when never chosen. */
    readonly mode: TitleMode | undefined;
    /** Provider/model from the deployment's composition config, if it pinned one. */
    readonly pinned: Partial<ModelRoute> | undefined;
    /** Provider/model from user settings. */
    readonly configured: Partial<ModelRoute> | undefined;
    /** The route the session itself logged, if any. */
    readonly session: ModelRoute | undefined;
}
/**
 * Resolve the title model route.
 *
 * @param input - the master switch, the chosen mode, the pinned/configured
 *   routes and the session's own logged route.
 * @returns either a concrete route with its provenance, or an abstention reason.
 */
export declare function resolveTitleRoute(input: TitleRouteInput): TitleRouteResolution;
