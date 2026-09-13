/**
 * Optional title affixes: the date prefix/suffix a user can pin onto every
 * generated title, and the byte reservation that keeps it from being cut off.
 *
 * Pure module: no Cordis, no session, no filesystem, no network. It formats a
 * date from the session's own creation timestamp and reports how much of the
 * title budget the affix consumes, so the caller can shorten the model's text
 * BEFORE the affix is joined to it.
 *
 * WHY THE RESERVATION IS LOAD-BEARING: the title service normalizes every
 * accepted title with `normalizeSessionTitle(title, maxTitleBytes)`, which
 * truncates the LEADING bytes of the string (verified against the shipped
 * `dsh-session-title/lib/types/normalize.js`; `dsh-base` configures
 * `maxTitleBytes: 80`). A prefix therefore survives and eats into the title,
 * while a suffix survives only if the body was shortened first — reserving the
 * affix bytes makes both positions behave identically.
 *
 * The affix is joined AFTER `validateGeneratedTitle()`: its wrapping-strip
 * regex removes leading decoration (`-`, `【】`, `[]`, `#`, …), which would
 * silently eat a decorated affix applied any earlier.
 */
import { byteLength } from "./title-policy.js";
/** Where the affix goes. An absent/unknown position means "no affix". */
export const AFFIX_POSITIONS = ["prefix", "suffix"];
/** Supported date shapes; `ymd` is the default once a position is chosen. */
export const AFFIX_DATE_FORMATS = ["ymd", "md"];
/** Separator between a prefix date and the title. */
export const PREFIX_SEPARATOR = " ";
/** Separator between the title and a suffix date. */
export const SUFFIX_SEPARATOR = " · ";
/**
 * Smallest body budget handed to the truncator.
 *
 * Only reachable when an affix is almost as large as the whole budget; it keeps
 * the model's text from being reduced to nothing by the reservation.
 */
const MIN_BODY_BYTES = 8;
/**
 * Format one timestamp as a date string.
 *
 * Local time is the default because a sidebar date is read next to wall-clock
 * events; tests pass an explicit zone so the result never depends on the host.
 *
 * @param epochMs - session creation time (`session.header.createdAt`), in ms.
 * @param format - `ymd` (`2026-09-13`) or `md` (`09-13`).
 * @param timeZone - optional IANA zone; absent means the host's local zone.
 * @returns the date text, or "" when no date can be derived.
 */
export function formatTitleDate(epochMs, format, timeZone) {
    if (!Number.isSafeInteger(epochMs) || epochMs < 0)
        return "";
    if (!AFFIX_DATE_FORMATS.includes(format))
        return "";
    let parts;
    try {
        parts = new Intl.DateTimeFormat("en-US", {
            ...(timeZone === undefined ? {} : { timeZone }),
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(new Date(epochMs));
    }
    catch {
        // An unknown zone must never break title generation: no affix instead.
        return "";
    }
    const part = (type) => parts.find((entry) => entry.type === type)?.value ?? "";
    const year = part("year");
    const month = part("month");
    const day = part("day");
    if (year === "" || month === "" || day === "")
        return "";
    return format === "md" ? `${month}-${day}` : `${year}-${month}-${day}`;
}
/**
 * Build the affix string — date plus its separator — for one title.
 *
 * @param options.position - `prefix` / `suffix`; anything else yields no affix.
 * @param options.format - date shape; absent means `ymd`.
 * @param options.createdAt - session creation time; absent yields no affix.
 * @param options.timeZone - optional IANA zone override (tests).
 * @returns the affix, or "" when it is not configured or not derivable.
 */
export function buildTitleAffix(options) {
    if (!AFFIX_POSITIONS.includes(options.position))
        return "";
    const date = formatTitleDate(options.createdAt, options.format ?? "ymd", options.timeZone);
    if (date === "")
        return "";
    return options.position === "prefix" ? `${date}${PREFIX_SEPARATOR}` : `${SUFFIX_SEPARATOR}${date}`;
}
/**
 * Byte budget left for the model's own text once the affix is reserved.
 *
 * @param maxBytes - the full title budget (matches the service's own cap).
 * @param affix - the affix string, possibly empty.
 */
export function bodyBudgetBytes(maxBytes, affix) {
    return Math.max(MIN_BODY_BYTES, maxBytes - byteLength(affix));
}
/**
 * Join a shortened body and its affix in the configured position.
 *
 * @param body - the validated, already-shortened title text.
 * @param affix - the affix string, possibly empty.
 * @param position - `prefix` / `suffix`.
 */
export function composeTitle(body, affix, position) {
    if (affix === "")
        return body;
    return position === "prefix" ? `${affix}${body}` : `${body}${affix}`;
}
