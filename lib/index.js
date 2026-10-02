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
import { PROVIDER_CADENCE, PROVIDER_ID, TitleAbstention, createSmartSessionTitleProvider } from "./provider.js";
import { createExplicitRegenerationTokens } from "./tokens.js";
import { SETTINGS_NAMESPACE, applySettingsToTitleConfig, isSessionTitleLocked, resolveTitleSettings, resolveTitleSettingsFromConfig } from "./settings.js";
import { assertTitleCapabilities } from "./capabilities.js";
import { createRetitleHandler, selectExplicitGoalTitleMessages, selectOrdinaryTitleMessages, titleSessionRevision, RETITLE_COMMAND, STATUS_COMMAND, STATUS_DESCRIPTION, RETITLE_DESCRIPTION } from "./commands.js";
import { createTitleDiagnostics, formatSnapshotLine } from "./observability.js";
import { createTitleSettingsFields } from "./settings-schema.js";
import { createTitlePreviewController, PREVIEW_COMMAND, APPLY_PREVIEW_COMMAND } from "./title-preview.js";
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
    // Core 0.2 stores user-editable settings in the plugin's volatile Config
    // and exposes them through configForms. Core 0.1 still uses the settings
    // namespace below; these fields let one release support both generations.
    ...createTitleSettingsFields(z, true)
});
/**
 * Settings schema for Core 0.1's `$DSH_HOME/settings.yaml` namespace.
 * Core 0.2 stores the same user preferences in this plugin's volatile Config.
 *
 * Deliberately no `.default()` calls: an absent field means "the user has never
 * chosen", which is what lets `mode` fall back to the deployment's composed
 * behaviour (Phase 1/2 compatibility) instead of being silently rewritten to a
 * schema default. Cross-field validation lives in `resolveTitleSettings`, which
 * the `validate` hook below runs on every resolved value.
 *
 * Unknown keys are NOT declared here. The schemastery schema merges extras
 * rather than rejecting them (`.strict()` is a zod feature), so the plugin
 * never writes one: its UI and write path only ever touch the fourteen fields
 * below, and a credential has no declared field to hide behind.
 */
/** @see resolveTitleSettings — typed as unknown because the settings service validates it at run time. */
export const SettingsSchema = z.object(createTitleSettingsFields(z));
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
    assertTitleCapabilities(ctx, config);
    const titleConfigKeys = [
        "targetWords",
        "targetCjkCharacters",
        "maxRawInputBytes",
        "targetPreparedInputBytes",
        "codeBlockKeepBytes",
        "maxOutputTokens",
        "timeoutMs",
        "maxAttempts",
        "provider",
        "model"
    ];
    const readConfigValue = (value) => value !== null && typeof value === "object" && typeof value.get === "function"
        ? value.get()
        : value;
    const pickConfigValues = (keys) => {
        if (config === undefined || config === null) return undefined;
        if (typeof config !== "object" || Array.isArray(config)) return config;
        const picked = {};
        for (const key of keys) {
            const value = readConfigValue(config[key]);
            if (value !== undefined) picked[key] = value;
        }
        return picked;
    };
    const rowConfig = resolveTitleConfig(pickConfigValues(titleConfigKeys));
    const diagnostics = createTitleDiagnostics();
    const tokens = createExplicitRegenerationTokens();
    const legacySettingsApi = typeof ctx.settings?.register === "function";
    // Core 0.1 resolves this cache through its official settings namespace;
    // Core 0.2 reads each Volatile Config reference when a request begins.
    let legacySettings = resolveTitleSettings({});
    const getSettings = () => legacySettingsApi
        ? legacySettings
        : resolveTitleSettingsFromConfig(config);
    const getPolicy = () => {
        const settings = getSettings();
        return {
            config: applySettingsToTitleConfig(rowConfig, settings),
            settings
        };
    };
    // Validate the Core 0.2 Config path before registering any provider, just
    // as the Core 0.1 settings service validates its loaded namespace below.
    if (!legacySettingsApi) getSettings();
    const settingsListeners = new Set();
    const notifySettings = () => {
        for (const listener of settingsListeners) {
            try { listener(); } catch { /* Generation's final policy check reports invalid config. */ }
        }
    };
    const providerDependencies = {
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
        consumeExplicitRegeneration: (sessionId) => tokens.take(sessionId),
        subscribeSettings: (listener) => {
            settingsListeners.add(listener);
            return () => settingsListeners.delete(listener);
        }
    };
    const provider = createSmartSessionTitleProvider(getPolicy, providerDependencies);
    // Preview has its own explicit intent and cannot spend another command's token.
    const previewProvider = createSmartSessionTitleProvider(getPolicy, {
        ...providerDependencies, consumeExplicitRegeneration: () => true
    });
    const previews = createTitlePreviewController({ getPolicy,
        generate: (request) => previewProvider.generate(request), sessionTitle: ctx.sessionTitle });
    const goalGenerations = new Map();
    ctx.effect(() => () => {
        previews.dispose();
        for (const abort of goalGenerations.values()) abort.abort();
    }, "smart-session-title: preview and Goal generation lifetime");
    if (typeof ctx.on === "function") {
        ctx.on("session/disposed", (session) => {
            previews.cancelSession(session.id);
            goalGenerations.get(session.id)?.abort();
        });
        if (!legacySettingsApi) ctx.on("settings/document-updated", (ns) => {
            if (ns === SETTINGS_NAMESPACE) notifySettings();
        });
    }
    /**
     * Explicit-only recovery for sessions whose meaningful input is a DSH Goal.
     *
     * Core's `SessionTitleService.refresh()` intentionally ignores Goal-source
     * messages and returns no new title (or the existing snapshot) without
     * invoking a registered provider.
     * Do not manufacture a `user/message` event: that would alter conversation
     * history. Instead, feed the latest Goal objective through this plugin's
     * existing provider and commit the accepted text through the official
     * `rename()` service API. This path is never used by automatic scheduling.
     */
    const recoverExplicitGoalTitle = async (session, upstreamSignal) => {
        upstreamSignal?.throwIfAborted();
        if (selectOrdinaryTitleMessages(session).length > 0) return undefined;
        const messages = selectExplicitGoalTitleMessages(session);
        if (messages.length === 0)
            return undefined;
        goalGenerations.get(session.id)?.abort();
        const abort = new AbortController();
        goalGenerations.set(session.id, abort);
        const signal = upstreamSignal === undefined ? abort.signal : AbortSignal.any([upstreamSignal, abort.signal]);
        const revision = titleSessionRevision(session, ctx.sessionTitle.get(session));
        const header = typeof session.requestHeader === "function" ? session.requestHeader() : undefined;
        const route = header?.config;
        try {
            const result = await provider.generate({
                session,
                messages,
                ...route === undefined ? {} : { route },
                signal
            });
            signal.throwIfAborted();
            if (isSessionTitleLocked(getSettings(), session.id)) throw new TitleAbstention("locked", "the title was locked during generation");
            if (revision !== titleSessionRevision(session, ctx.sessionTitle.get(session))) {
                throw new Error("Session changed during Goal title generation. Retry /retitle.");
            }
            return ctx.sessionTitle.rename(session, result.title);
        } finally {
            if (goalGenerations.get(session.id) === abort) goalGenerations.delete(session.id);
        }
    };
    // --- required: persistent user settings -------------------------------
    if (legacySettingsApi) {
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
        legacySettings = resolveTitleSettings(scope.get());
        const unsubscribe = scope.watch(() => {
            // Hot reload: the next generation reads the new policy.
            legacySettings = resolveTitleSettings(scope.get());
            notifySettings();
        });
        ctx.effect(() => unsubscribe, "smart-session-title settings watch");
        ctx.logger?.info?.(`smart-session-title settings registered ns=${SETTINGS_NAMESPACE} ` +
            `enabled=${legacySettings.enabled} mode=${legacySettings.mode ?? "default"}`);
    }
    else {
        // In Core 0.2 the plugin's Config is already the persistent settings
        // surface. Suppress the generic generated form because this package
        // provides its own bilingual settings card in the Web client.
        if (typeof ctx.settings?.configure === "function") {
            ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber), "smart-session-title settings presentation");
        }
        const settings = getSettings();
        ctx.logger?.info?.(`smart-session-title config settings active ` +
            `enabled=${settings.enabled} mode=${settings.mode ?? "default"}`);
    }
    const disposer = ctx.sessionTitle.register(provider);
    // The service binds its own registration effect to the service fiber, so an
    // unload of THIS plugin would otherwise leave the provider registered.
    // Owning the returned disposer here makes enable/disable/remove symmetrical.
    ctx.effect(() => disposer, "smart-session-title provider registration");
    // --- optional: commands ------------------------------------------------
    const retitle = createRetitleHandler(ctx.sessionTitle, tokens, getSettings, ctx.logger, recoverExplicitGoalTitle);
    ctx.inject(["commands"], (commandCtx) => {
        commandCtx.effect(() => commandCtx.commands.register({
            name: RETITLE_COMMAND,
            description: RETITLE_DESCRIPTION,
            handler: retitle
        }), "smart-session-title /retitle command");
        commandCtx.effect(() => commandCtx.commands.register({
            name: PREVIEW_COMMAND,
            description: "Preview a session title without changing it.",
            handler: async (invocation) => {
                if (invocation.rawInput.trim() !== "") return { kind: "error", text: "/title-preview takes no arguments." };
                try {
                    const candidate = await previews.preview(invocation.agent.session, invocation.signal);
                    return { kind: "success", text: JSON.stringify(candidate) };
                } catch (error) {
                    if (invocation.signal?.aborted) throw error;
                    return { kind: "error", text: describeError(error) };
                }
            }
        }), "smart-session-title /title-preview command");
        commandCtx.effect(() => commandCtx.commands.register({
            name: APPLY_PREVIEW_COMMAND,
            description: "Apply a previously generated title preview.",
            input: { hint: "Preview id" },
            recordInput: false,
            handler: (invocation) => {
                const previewId = invocation.rawInput.trim();
                if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(previewId)) return { kind: "error", text: "/title-apply requires a preview id." };
                try {
                    const accepted = previews.apply(invocation.agent.session, previewId, invocation.signal);
                    return { kind: "success", text: `Title applied: ${accepted.title}` };
                } catch (error) {
                    if (invocation.signal?.aborted) throw error;
                    return { kind: "error", text: describeError(error) };
                }
            }
        }), "smart-session-title /title-apply command");
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
        `maxAttempts=${rowConfig.maxAttempts} commands=/${RETITLE_COMMAND},/${PREVIEW_COMMAND},/${APPLY_PREVIEW_COMMAND},/${STATUS_COMMAND} ` +
        `route=${rowConfig.provider === undefined ? "session" : `${rowConfig.provider}/${rowConfig.model}`}`);
}
export { assertTitleCapabilities, findMissingCapabilities } from "./capabilities.js";
export { createRetitleHandler } from "./commands.js";
export { RETITLE_COMMAND, RETITLE_DESCRIPTION, STATUS_COMMAND, STATUS_DESCRIPTION } from "./commands.js";
export { SETTINGS_NAMESPACE };
export { PREVIEW_COMMAND, APPLY_PREVIEW_COMMAND };
export { createExplicitRegenerationTokens } from "./tokens.js";
