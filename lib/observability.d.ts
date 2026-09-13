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
/** The outcomes an operator needs to be able to distinguish. */
export type TitleOutcome = "generated" | "abstained" | "failed" | "timed-out" | "retried" | "cancelled";
/** Log levels this module uses. */
export interface DiagnosticLogger {
    info?(message: string): void;
    warn?(message: string): void;
}
/** `key=value` pairs for one diagnostic line; scalars only, single line. */
export type DiagnosticFields = Record<string, string | number | boolean | undefined>;
/**
 * Render one structured diagnostic line.
 *
 * @param outcome - the outcome being recorded.
 * @param fields - candidate fields; keys outside the allowlist are dropped.
 * @returns one line, e.g.
 *   `smart-session-title generation result=generated route=a/b attempt=1 elapsedMs=320`.
 */
export declare function formatDiagnosticLine(outcome: TitleOutcome, fields?: DiagnosticFields): string;
/**
 * Mask anything that looks like a credential.
 *
 * Defence in depth for §O6: this module never receives a credential, and the
 * plugin stores none, but a future field must not be able to leak one into a
 * persisted log line by accident.
 */
export declare function sanitizeDiagnosticLine(line: string): string;
/** Which level one outcome is reported at. */
export declare function levelFor(outcome: TitleOutcome): "info" | "warn";
/** A point-in-time view of what this process has seen. */
export interface TitleDiagnosticsSnapshot {
    readonly counters: Readonly<Record<TitleOutcome, number>>;
    readonly last: {
        readonly outcome: TitleOutcome;
        readonly reason: string | undefined;
        readonly route: string | undefined;
        readonly elapsedMs: number | undefined;
        readonly at: number;
    } | undefined;
}
export interface TitleDiagnostics {
    /** Record one outcome: bumps its counter and emits one log line. */
    record(outcome: TitleOutcome, fields?: DiagnosticFields): void;
    /** Current counters and the most recent outcome. */
    snapshot(): TitleDiagnosticsSnapshot;
}
/**
 * Create the recorder.
 *
 * @param now - injectable clock, for deterministic tests.
 */
export declare function createTitleDiagnostics(now?: () => number): TitleDiagnostics;
/** One line summarising the counters, for the on-demand status command. */
export declare function formatSnapshotLine(snapshot: TitleDiagnosticsSnapshot): string;
