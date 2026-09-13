/**
 * Optional title affixes: the date prefix/suffix a user can pin onto every
 * generated title, and the byte reservation that keeps it from being cut off.
 *
 * Pure module: no Cordis, no session, no filesystem, no network. It formats a
 * date from the session's own creation timestamp and reports how much of the
 * title budget the affix consumes, so the caller can shorten the model's text
 * BEFORE the affix is joined to it.
 *
 * The affix is joined AFTER `validateGeneratedTitle()`: its wrapping-strip
 * regex removes leading decoration (`-`, `【】`, `[]`, `#`, …), which would
 * silently eat a decorated affix applied any earlier.
 */
/** Where the affix goes. An absent/unknown position means "no affix". */
export declare const AFFIX_POSITIONS: readonly ["prefix", "suffix"];
/** Supported date shapes; `ymd` is the default once a position is chosen. */
export declare const AFFIX_DATE_FORMATS: readonly ["ymd", "md"];
/** Separator between a prefix date and the title. */
export declare const PREFIX_SEPARATOR = " ";
/** Separator between the title and a suffix date. */
export declare const SUFFIX_SEPARATOR = " \u00B7 ";
export type AffixPosition = (typeof AFFIX_POSITIONS)[number];
export type AffixDateFormat = (typeof AFFIX_DATE_FORMATS)[number];
/**
 * Format one timestamp as a date string.
 *
 * @param epochMs - session creation time (`session.header.createdAt`), in ms.
 * @param format - `ymd` (`2026-09-13`) or `md` (`09-13`).
 * @param timeZone - optional IANA zone; absent means the host's local zone.
 * @returns the date text, or "" when no date can be derived.
 */
export declare function formatTitleDate(epochMs: unknown, format: string | undefined, timeZone?: string): string;
export interface TitleAffixOptions {
    readonly position: string | undefined;
    readonly format?: string;
    readonly createdAt?: number;
    readonly timeZone?: string;
}
/**
 * Build the affix string — date plus its separator — for one title.
 *
 * @returns the affix, or "" when it is not configured or not derivable.
 */
export declare function buildTitleAffix(options: TitleAffixOptions): string;
/**
 * Byte budget left for the model's own text once the affix is reserved.
 *
 * @param maxBytes - the full title budget (matches the service's own cap).
 * @param affix - the affix string, possibly empty.
 */
export declare function bodyBudgetBytes(maxBytes: number, affix: string): number;
/**
 * Join a shortened body and its affix in the configured position.
 */
export declare function composeTitle(body: string, affix: string, position: string | undefined): string;
