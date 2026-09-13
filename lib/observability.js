/**
 * Local, structured title diagnostics.
 *
 * A local logger plus process-local counters:
 *
 *  1. **`ctx.logger`** — persisted by the DSH Desktop host into
 *     `<userData>/logs/host/dsh-<date>.log` (warn/error are additionally
 *     mirrored into `dsh-<date>.error.log`). The host's threshold comes from
 *     `dsh-desktop.logLevel`, default `info`, so both `info` and `warn` lines
 *     survive. This closes the Phase 0 P1-4 gap: a title failure is no longer
 *     invisible.
 *  2. **In-process counters** — the six outcomes in §17, readable on demand so
 *     an operator can see the shape of what has been happening without
 *     grepping.
 *
 * Nothing here is networked or written to the session event log. The generic
 * formatter allows only declared scalar keys. Provider logs are assembled from
 * internal metadata; adapter error text is replaced before it reaches logging.
 * The DSH Desktop sink also applies its own masking policy.
 */
/** Fields a diagnostic line may carry. Anything else is dropped. */
const ALLOWED_FIELDS = new Set([
    "sessionId",
    "result",
    "reason",
    "route",
    "routeSource",
    "mode",
    "attempt",
    "maxAttempts",
    "elapsedMs",
    "rawBytes",
    "preparedBytes",
    "strategy",
    "omittedCodeBlocks",
    "weakSkipped",
    "titleBytes",
    "explicit",
    "counters"
]);
/** Collapse a value to one printable, bounded token. */
function renderValue(value) {
    const text = String(value).replace(/[\r\n\t]+/gu, " ").trim();
    return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}
/**
 * Render one structured diagnostic line.
 *
 * @param outcome - the outcome being recorded.
 * @param fields - candidate fields; keys outside the allowlist are dropped.
 * @returns one line, e.g.
 *   `smart-session-title generation result=generated route=a/b attempt=1 elapsedMs=320`.
 */
export function formatDiagnosticLine(outcome, fields = {}) {
    const pairs = [`result=${outcome}`];
    for (const [key, value] of Object.entries(fields)) {
        if (!ALLOWED_FIELDS.has(key) || value === undefined)
            continue;
        pairs.push(`${key}=${renderValue(value)}`);
    }
    return `smart-session-title generation ${pairs.join(" ")}`;
}
/**
 * Mask anything that looks like a credential.
 *
 * Defence in depth for §O6: this module never receives a credential, and the
 * plugin stores none, but a future field must not be able to leak one into a
 * persisted log line by accident.
 */
export function sanitizeDiagnosticLine(line) {
    return line
        .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/gu, "***")
        .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/giu, "Bearer ***")
        .replace(/\b(api[_-]?key|apikey|token|secret|password|authorization)\b\s*[=:]\s*\S+/giu, "$1=***");
}
/** Which level one outcome is reported at. */
export function levelFor(outcome) {
    return outcome === "generated" || outcome === "abstained" || outcome === "retried"
        ? "info"
        : "warn";
}
/**
 * Create the recorder.
 *
 * @param now - injectable clock, for deterministic tests.
 */
export function createTitleDiagnostics(now = () => Date.now()) {
    const counters = {
        generated: 0,
        abstained: 0,
        failed: 0,
        "timed-out": 0,
        retried: 0,
        cancelled: 0
    };
    let last;
    return {
        record(outcome, fields = {}) {
            counters[outcome] += 1;
            const reason = fields.reason === undefined ? undefined : String(fields.reason);
            const route = fields.route === undefined ? undefined : String(fields.route);
            const elapsedMs = typeof fields.elapsedMs === "number" ? fields.elapsedMs : undefined;
            last = { outcome, reason, route, elapsedMs, at: now() };
            // Logging stays with the caller: the provider owns the phrasing of every
            // line (already covered by Phase 1/2 tests), so recording here must not
            // emit a second line for the same event.
        },
        snapshot() {
            return { counters: Object.freeze({ ...counters }), last };
        }
    };
}
/** One line summarising the counters, for the on-demand status command. */
export function formatSnapshotLine(snapshot) {
    const counters = snapshot.counters;
    const countersText = Object.keys(counters)
        .map((key) => `${key}=${counters[key]}`)
        .join(" ");
    const last = snapshot.last;
    const lastText = last === undefined
        ? "last=none"
        : `last=${last.outcome} lastReason=${last.reason ?? "-"} lastRoute=${last.route ?? "-"} lastElapsedMs=${last.elapsedMs ?? "-"}`;
    return `smart-session-title diagnostics ${countersText} ${lastText}`;
}
