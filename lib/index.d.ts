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
import type { SessionTitleService } from "@deepseek-ai/dsh-session-title";
import type { LlmStreamService, ProviderLogger } from "./provider.js";
import { SETTINGS_NAMESPACE } from "./settings.js";
import type { CommandsService } from "./commands.js";
/** Cordis plugin name; also the loader row id used in `cordis.patch.yml`. */
export declare const name = "smart-session-title";
/**
 * Required host services. Settings must validate before the provider is
 * registered. Commands use a child injection for the existing headless seam.
 */
export declare const inject: string[];
/**
 * Loader schema for the composition config. Every field is optional;
 * `resolveTitleConfig` applies documented defaults and strict validation, so a
 * malformed value fails loudly at load instead of degrading a title at run time.
 */
/** @see resolveTitleConfig — typed as unknown because the loader validates it at run time. */
export declare const Config: unknown;
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
 * never writes one: its UI and write path only ever touch the six fields
 * below, and a credential has no declared field to hide behind.
 */
/** @see resolveTitleSettings — typed as unknown because the settings service validates it at run time. */
/** Includes the UI-only boolean showSessionId preference. */
export declare const SettingsSchema: unknown;
/** Composition base for the settings namespace: the switch starts on. */
export declare const SETTINGS_BASE: Readonly<{
    enabled: true;
}>;
/** One namespace scope handed back by `settings.register`. */
export interface SettingsScope {
    get(): unknown;
    watch(callback: () => void): () => void;
    update(patch: Record<string, unknown>): Promise<unknown>;
}
/** The settings service surface this plugin uses. */
export interface SettingsService {
    register(ns: string, schema: unknown, options?: {
        base?: Record<string, unknown>;
        validate?: (value: unknown) => void;
    }): SettingsScope;
}
/** The slice of the Cordis context this plugin uses. */
export interface SmartSessionTitleContext {
    readonly sessionTitle: SessionTitleService;
    readonly llm: LlmStreamService;
    readonly settings: SettingsService;
    readonly logger?: ProviderLogger | undefined;
    effect(execute: () => unknown, label?: string): unknown;
    /** Optional child injection: runs only if the named services appear. */
    inject(deps: readonly string[], callback: (ctx: SmartSessionTitleContext & {
        readonly commands: CommandsService;
        readonly settings: SettingsService;
    }) => void): unknown;
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
export declare function apply(ctx: SmartSessionTitleContext, config: unknown): void;
export { assertTitleCapabilities, findMissingCapabilities } from "./capabilities.js";
export { createRetitleHandler } from "./commands.js";
export type { CommandInvocationLike, CommandResultLike, CommandsService } from "./commands.js";
export { RETITLE_COMMAND, RETITLE_DESCRIPTION, STATUS_COMMAND, STATUS_DESCRIPTION } from "./commands.js";
export { SETTINGS_NAMESPACE };
export { createExplicitRegenerationTokens } from "./tokens.js";
export type { ExplicitRegenerationTokens } from "./tokens.js";
export type { TitleSettings } from "./settings.js";
export type { TitleConfig } from "./config.js";
