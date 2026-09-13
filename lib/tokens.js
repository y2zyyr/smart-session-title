/**
 * Explicit-regeneration tokens.
 *
 * Kept in its own module with no `@deepseek-ai/*` imports so the counting and
 * leak semantics — the seam that lets an explicit request override the
 * automatic churn guard, and the one thing that must never leak — are directly
 * unit-testable.
 */
/**
 * Create an empty token depot.
 *
 * `/retitle` grants one token immediately before `refresh()`; the provider
 * consumes one when it starts generating. Counting (rather than a boolean or a
 * set) makes overlapping commands correct: three rapid `/retitle` presses grant
 * three tokens, and the one generation the service actually accepts spends one.
 * The trailing `take` in the command's `finally` is a no-op when the provider
 * already spent the token, so a refresh that never reaches the provider cannot
 * leak permission into a later automatic schedule.
 *
 * `grant` runs synchronously in the command handler and `refresh()`
 * synchronously supersedes any active automatic generation before scheduling its
 * own, so a token can only be spent by the generation the human asked for: an
 * automatic schedule either read its (absent) token before the grant, or is
 * superseded before it can start.
 */
export function createExplicitRegenerationTokens() {
    const counts = new Map();
    const take = (sessionId) => {
        const remaining = counts.get(sessionId) ?? 0;
        if (remaining === 0)
            return false;
        if (remaining === 1)
            counts.delete(sessionId);
        else
            counts.set(sessionId, remaining - 1);
        return true;
    };
    return {
        grant(sessionId) {
            counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
        },
        take,
        outstanding(sessionId) {
            return counts.get(sessionId) ?? 0;
        }
    };
}
