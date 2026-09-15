/**
 * `smart-session-title` — a replacement session-title provider for the
 * DeepSeek Harness, its explicit `/retitle` regeneration command, and the
 * Settings / diagnostics surfaces around them.
 *
 * Exports mirror the first-party provider plugin
 * (`@deepseek-ai/dsh-session-title-first-prompt-llm`): `name`, `inject`,
 * `Config`, `apply`. The Cordis loader consumes exactly this shape.
 *
 * The bundled `cordis.patch.yml` disables the built-in `session-title-llm` row
 * before inserting this plugin, because
 * `SessionTitleService.register()` rejects a second provider with
 * `session-title provider "<id>" is already registered`.
 */
import z from "@deepseek-ai/schemastery";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
import { resolveTitleConfig } from "./config.js";
import { PROVIDER_CADENCE, PROVIDER_ID, createSmartSessionTitleProvider } from "./provider.js";
import { createExplicitRegenerationTokens } from "./tokens.js";
import { SETTINGS_NAMESPACE, applySettingsToTitleConfig, resolveTitleSettings } from "./settings.js";
import { assertTitleCapabilities } from "./capabilities.js";
import { createRetitleHandler, RETITLE_COMMAND, STATUS_COMMAND, STATUS_DESCRIPTION, RETITLE_DESCRIPTION } from "./commands.js";
import { createTitleDiagnostics, formatSnapshotLine } from "./observability.js";
/** Cordis plugin name; also the loader row id used in `cordis.patch.yml`. */
export const name = "smart-session-title";
/**
 * Required host services. Settings must validate before the provider is
 * registered. Commands use a child injection for the existing headless seam.
 */
export const inject = ["sessionTitle", "llm", "settings"];
/**
 * Loader schema for the composition config. Every field is optional;
 * `resolveTitleConfig` applies documented defaults and strict validation, so a
 * malformed value fails loudly at load instead of degrading a title at run time.
 */
/** @see resolveTitleConfig — typed as unknown because the loader validates it at run time. */
export const Config = z.object({
    targetWords: z.number(),
    targetCjkCharacters: z.number(),
    maxRawInputBytes: z.number(),
    targetPreparedInputBytes: z.number(),
    codeBlockKeepBytes: z.number(),
    maxOutputTokens: z.number(),
    timeoutMs: z.number(),
    maxAttempts: z.number(),
    provider: z.string(),
    model: z.string()
});
/**
 * Settings schema for `$DSH_HOME/settings.yaml`.
 *
 * Deliberately no `.default()` calls: an absent field means "the user has never
 * chosen", which is what lets `mode` fall back to the deployment's composed
 * behaviour (Phase 1/2 compatibility) instead of being silently rewritten to a
 * schema default. Cross-field validation lives in `resolveTitleSettings`, which
 * the `validate` hook below runs on every resolved value.
 *
 * Unknown keys are NOT declared here. The schemastery schema merges extras
 * rather than rejecting them (`.strict()` is a zod feature), so the plugin
 * never writes one: its UI and write path only ever touch the twelve fields
 * below, and a credential has no declared field to hide behind.
 */
/** @see resolveTitleSettings — typed as unknown because the settings service validates it at run time. */
export const SettingsSchema = z.object({
    enabled: z.boolean(),
    showSessionId: z.boolean(),
    mode: z.union(["current-session", "configured", "disabled"]),
    provider: z.string(),
    model: z.string(),
    timeoutMs: z.number().step(1).min(1000).max(120000),
    maxAttempts: z.number().step(1).min(1).max(3),
    // Title shape: a code-point cap and an optional date affix. Both are
    // optional on purpose — an absent value means "inherit" / "no affix", and
    // the union members mirror the AFFIX_* constants the policy validates with.
    maxTitleCharacters: z.number().step(1).min(8).max(120),
    titleDatePosition: z.union(["prefix", "suffix"]),
    titleDateFormat: z.union(["ymd", "md"]),
    // Title content: phrasing, language, and the exclusion words. The list is
    // accepted here as plain strings; `resolveTitleSettings` is what trims,
    // dedupes, bounds, and collapses an empty list to "never configured".
    //
    // Verified against the shipped schemastery 3.18.2: an absent `z.array(...)`
    // resolves to `[]`, whereas an absent `z.number()` / `z.union(...)` stays
    // `undefined`. So `[]` here means BOTH "never set" and "explicitly emptied",
    // and only `resolveTitleSettings` can tell them apart from the raw user
    // section. That is why the array never reaches the provider unnormalized.
    titleStyle: z.union(["action-object", "short-name"]),
    titleLanguage: z.union(["zh", "en"]),
    titleExclusions: z.array(z.string()),
    // Locked sessions. Same `[]` materialization as `titleExclusions` above; the
    // ids are opaque strings to the schema and normalized by `resolveTitleSettings`.
    lockedSessionIds: z.array(z.string())
});
/** Composition base for the settings namespace: the switch starts on. */
export const SETTINGS_BASE = Object.freeze({ enabled: true });
function describeError(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * Register the provider, the settings namespace, and the commands.
 *
 * @param ctx - Cordis context carrying the title service, the LLM service and
 *   the logger.
 * @param config - untrusted loader configuration.
 * @throws {TypeError} when the configuration is malformed.
 * @throws {Error} when a required core API is missing, or when another provider
 *   is already registered — never caught here, because swallowing either would
 *   leave the deployment in a state it does not expect.
 */
export function apply(ctx, config) {
    assertTitleCapabilities(ctx);
    const rowConfig = resolveTitleConfig(config);
    const diagnostics = createTitleDiagnostics();
    const tokens = createExplicitRegenerationTokens();
    // Resolved from the official settings scope before registration.
    let settings = resolveTitleSettings({});
    const getPolicy = () => ({
        config: applySettingsToTitleConfig(rowConfig, settings),
        settings
    });
    const provider = createSmartSessionTitleProvider(getPolicy, {
        llm: ctx.llm,
        logger: ctx.logger,
        diagnostics,
        // Both come from the installation's own `@deepseek-ai/dsh-llm` instance:
        // sharing that module instance is what keeps title calls recognisable to
        // the service's `llm/stream` interception.
        createUserMessage,
        BlockAssembler,
        // Reads the service's own folded state; never writes.
        readTitle: (session) => ctx.sessionTitle.get(session),
        consumeExplicitRegeneration: (sessionId) => tokens.take(sessionId)
    });
    // --- required: persistent user settings -------------------------------
    {
        const scope = ctx.settings.register(SETTINGS_NAMESPACE, SettingsSchema, {
            base: SETTINGS_BASE,
            // Runs on every resolved value, including the one loaded from disk at
            // registration time, so a hand-edited settings.yaml fails loudly here.
            validate: (value) => {
                resolveTitleSettings(value);
            }
        });
        for (const method of ["get", "watch"]) {
            if (typeof scope?.[method] !== "function")
                throw new Error(`smart-session-title: missing settings scope.${method}`);
        }
        settings = resolveTitleSettings(scope.get());
        const unsubscribe = scope.watch(() => {
            // Hot reload: the next generation reads the new policy.
            settings = resolveTitleSettings(scope.get());
        });
        ctx.effect(() => unsubscribe, "smart-session-title settings watch");
        ctx.logger?.info?.(`smart-session-title settings registered ns=${SETTINGS_NAMESPACE} ` +
            `enabled=${settings.enabled} mode=${settings.mode ?? "default"}`);
    }
    const disposer = ctx.sessionTitle.register(provider);
    // The service binds its own registration effect to the service fiber, so an
    // unload of THIS plugin would otherwise leave the provider registered.
    // Owning the returned disposer here makes enable/disable/remove symmetrical.
    ctx.effect(() => disposer, "smart-session-title provider registration");
    // --- optional: commands ------------------------------------------------
    const retitle = createRetitleHandler(ctx.sessionTitle, tokens, () => settings, ctx.logger);
    ctx.inject(["commands"], (commandCtx) => {
        commandCtx.effect(() => commandCtx.commands.register({
            name: RETITLE_COMMAND,
            description: RETITLE_DESCRIPTION,
            handler: retitle
        }), "smart-session-title /retitle command");
        commandCtx.effect(() => commandCtx.commands.register({
            name: STATUS_COMMAND,
            description: STATUS_DESCRIPTION,
            handler: (invocation) => {
                if (invocation.rawInput.trim() !== "") {
                    return { kind: "error", text: `/${STATUS_COMMAND} takes no arguments.` };
                }
                const line = formatSnapshotLine(diagnostics.snapshot());
                commandCtx.logger?.info?.(line);
                return { kind: "success", text: line };
            }
        }), "smart-session-title /title-status command");
    });
    ctx.logger?.info?.(`smart-session-title provider registered id=${PROVIDER_ID} automatic=${PROVIDER_CADENCE} ` +
        `maxRawInputBytes=${rowConfig.maxRawInputBytes} ` +
        `targetPreparedInputBytes=${rowConfig.targetPreparedInputBytes} ` +
        `maxOutputTokens=${rowConfig.maxOutputTokens} timeoutMs=${rowConfig.timeoutMs} ` +
        `maxAttempts=${rowConfig.maxAttempts} commands=/${RETITLE_COMMAND},/${STATUS_COMMAND} ` +
        `route=${rowConfig.provider === undefined ? "session" : `${rowConfig.provider}/${rowConfig.model}`}`);
}
export { assertTitleCapabilities, findMissingCapabilities } from "./capabilities.js";
export { createRetitleHandler } from "./commands.js";
export { RETITLE_COMMAND, RETITLE_DESCRIPTION, STATUS_COMMAND, STATUS_DESCRIPTION } from "./commands.js";
export { SETTINGS_NAMESPACE };
export { createExplicitRegenerationTokens } from "./tokens.js";
