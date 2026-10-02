/** Shared, serializable field constraints for both generations of DSH settings. */
import { SETTINGS_LIMITS, TITLE_MODES, TITLE_STYLES, TITLE_LANGUAGES } from "./settings.js";
import { AFFIX_POSITIONS, AFFIX_DATE_FORMATS } from "./title-affix.js";

export function createTitleSettingsFields(z, volatile = false) {
    // The unicode quantifier counts code points, unlike schemastery's string
    // .max(), which counts UTF-16 units and would reject 64 valid emoji.
    const singleLine = (max) => z.string().pattern(new RegExp(`^[^\\u0000-\\u001F\\u007F]{0,${max}}$`, "u"));
    const fields = {
        enabled: volatile ? z.boolean().default(true) : z.boolean(),
        showSessionId: volatile ? z.boolean().default(true) : z.boolean(),
        mode: z.union(TITLE_MODES),
        provider: z.string(),
        model: z.string(),
        timeoutMs: z.number().step(1).min(SETTINGS_LIMITS.timeoutMsMin).max(SETTINGS_LIMITS.timeoutMsMax),
        maxAttempts: z.number().step(1).min(SETTINGS_LIMITS.maxAttemptsMin).max(SETTINGS_LIMITS.maxAttemptsMax),
        maxTitleCharacters: z.number().step(1).min(SETTINGS_LIMITS.maxTitleCharactersMin).max(SETTINGS_LIMITS.maxTitleCharactersMax),
        titleDatePosition: z.union(AFFIX_POSITIONS),
        titleDateFormat: z.union(AFFIX_DATE_FORMATS),
        titleStyle: z.union(TITLE_STYLES),
        titleLanguage: z.union(TITLE_LANGUAGES),
        titleExclusions: z.array(singleLine(SETTINGS_LIMITS.maxTitleExclusionCharacters)).max(SETTINGS_LIMITS.maxTitleExclusions),
        lockedSessionIds: z.array(singleLine(SETTINGS_LIMITS.lockedSessionCharacters)).max(SETTINGS_LIMITS.maxLockedSessions)
    };
    for (const [key, field] of Object.entries(fields)) {
        // Older Core 0.1 hosts can supply schemastery without .volatile(); their
        // registered settings namespace owns live writes instead.
        if (volatile && typeof field.volatile === "function") fields[key] = field.volatile();
    }
    return fields;
}
