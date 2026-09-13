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
const isComplete = (route) => route !== undefined &&
    typeof route.provider === "string" &&
    route.provider.length > 0 &&
    typeof route.model === "string" &&
    route.model.length > 0;
/**
 * Resolve the title model route.
 *
 * @param input - the master switch, the chosen mode, the pinned/configured
 *   routes and the session's own logged route.
 * @returns either a concrete route with its provenance, or an abstention reason.
 */
export function resolveTitleRoute(input) {
    if (!input.enabled) {
        return { kind: "abstain", reason: "disabled", detail: "AI title generation is disabled" };
    }
    if (input.mode === "disabled") {
        return { kind: "abstain", reason: "disabled", detail: "AI title generation is disabled" };
    }
    // Never chosen: keep whatever the deployment composed. A pinned pair means
    // this deployment deliberately fixed a route (Phase 1/2 behaviour); without
    // one the session's own route is used, which is also the Phase 1/2 default.
    const effectiveMode = input.mode ?? (isComplete(input.pinned) ? "configured" : "current-session");
    if (effectiveMode === "configured") {
        if (isComplete(input.configured)) {
            return {
                kind: "route",
                provider: input.configured.provider,
                model: input.configured.model,
                source: "configured"
            };
        }
        if (isComplete(input.pinned)) {
            return {
                kind: "route",
                provider: input.pinned.provider,
                model: input.pinned.model,
                source: "pinned"
            };
        }
        return {
            kind: "abstain",
            reason: "configured-incomplete",
            detail: "title model mode is \"configured\" but no provider and model are set; " +
                "choose both in Settings or the deployment must pin both"
        };
    }
    if (isComplete(input.session)) {
        return {
            kind: "route",
            provider: input.session.provider,
            model: input.session.model,
            source: "session"
        };
    }
    return {
        kind: "abstain",
        reason: "no-session-route",
        detail: "no model route: this session has not logged a request route yet"
    };
}
