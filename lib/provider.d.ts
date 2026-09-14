/**
 * The `smart-session-title` session-title provider.
 *
 * Responsibilities, and deliberately nothing else:
 *  - gate out first prompts that carry no task,
 *  - compress an oversized prompt instead of failing,
 *  - make exactly one auxiliary `ctx.llm.stream()` call (plus at most one
 *    retry), and
 *  - hand a validated title back to the service.
 *
 * It never calls `session.append()`. Persistence, revision tracking,
 * cancellation, stale-result rejection, manual-title protection, normalization
 * and projection all belong to `@deepseek-ai/dsh-session-title`, and routing
 * around it would forfeit every one of those guarantees.
 *
 * It also never builds an HTTP request: the model call goes through the shared
 * `llm` service, so the deployment's adapters, credentials and provider
 * registry stay the single source of truth.
 */
import type { ContentBlock, FinishReason, GenerateOptions, Message, StreamChunk } from "@deepseek-ai/dsh-llm";
import type { SessionTitleProvider } from "@deepseek-ai/dsh-session-title";
import type { TitleConfig } from "./config.js";
import type { TitleSettings } from "./settings.js";
import type { TitleDiagnostics } from "./observability.js";
import type { TitleRejectReason } from "./title-policy.js";
/** Stable provider id recorded on every accepted `session/title` event. */
export declare const PROVIDER_ID = "smart-session-title";
/**
 * Title-source cadence registered with the service.
 *
 * Phase 1 used `first-prompt`, which asks the service to schedule exactly one
 * generation for the session's first eligible message. That is precisely why a
 * session opened with "你好" could never recover: the single opportunity was
 * spent on a greeting, and `count === 1` never holds again.
 *
 * Phase 2 registers `all-prompts`, so the service schedules on every eligible
 * human message and owns the scheduling, revision, cancellation and persistence
 * semantics. Whether a given schedule actually becomes a model call is decided
 * by this provider's eligibility policy, which abstains without I/O in every
 * case except the first real task.
 */
export declare const PROVIDER_CADENCE = "all-prompts";
/** Why the provider declined to generate for one schedule. */
export type AbstentionReason = "no-source-message" | "child-session" | "no-meaningful-prompt" | "already-provider-titled" | "manual-title-protected"
/** AI titles are switched off (master switch or `disabled` mode). */
 | "disabled"
/** The user locked this session's title, so no entry point may rewrite it. */
 | "locked"
/** Every meaningful word of the prompt was a configured exclusion term. */
 | "empty-after-redaction"
/** Mode is `configured` but no complete provider+model pair exists. */
 | "configured-incomplete"
/** Mode is `current-session` but the session never logged a route. */
 | "no-session-route";
/**
 * Where the current title came from, as much as the policy needs to know.
 * Mirrors the `SessionTitleSource` union of `@deepseek-ai/dsh-session-title`.
 */
export interface CurrentTitleSnapshot {
    readonly source: {
        readonly kind: string;
    };
}
/**
 * Byte budget used for our own title shortening.
 *
 * Matches the shipped `dsh-base` row (`maxTitleBytes: 80`). The service
 * re-normalizes against its own configured cap afterwards, so a deployment
 * lowering the cap still wins; this value only ensures *we* cut at a sane
 * boundary instead of leaving the service to slice mid-word.
 */
export declare const TITLE_BYTE_BUDGET = 80;
/** Minimal surface this provider needs from the Cordis `llm` service. */
export interface LlmStreamService {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/** Minimal structured logger surface (Cordis `ctx.logger`). */
export interface ProviderLogger {
    info?(message: string): void;
    warn?(message: string): void;
}
/**
 * The chunk assembler contract (`@deepseek-ai/dsh-llm` `BlockAssembler`).
 * Injected rather than imported so this module keeps zero runtime dependency on
 * the DSH installation and stays unit-testable in isolation.
 */
export interface BlockAssemblerLike {
    push(chunk: StreamChunk): void;
    blocks(): ContentBlock[];
    readonly finish: FinishReason;
}
export interface BlockAssemblerConstructor {
    new (): BlockAssemblerLike;
}
/** The `createUserMessage` contract from `@deepseek-ai/dsh-llm`. */
export interface CreateUserMessageFn {
    (input: {
        content: readonly {
            type: "text";
            text: string;
        }[];
        source: {
            kind: "plugin";
            plugin: string;
        };
    }): Message;
}
export interface ProviderDependencies {
    readonly llm: LlmStreamService;
    readonly createUserMessage: CreateUserMessageFn;
    readonly BlockAssembler: BlockAssemblerConstructor;
    readonly logger?: ProviderLogger | undefined;
    /** Injectable clock for deterministic tests. */
    readonly now?: (() => number) | undefined;
    /**
     * Read the session's current title through `ctx.sessionTitle.get`.
     *
     * Used only to avoid automatic churn: once a title exists, later automatic
     * schedules must not rewrite it. This reads the service's own folded state —
     * it never writes anything.
     */
    readonly readTitle?: ((session: {
        readonly id: string;
    }) => CurrentTitleSnapshot | undefined) | undefined;
    /**
     * Consume a one-shot "the human explicitly asked for regeneration" marker.
     *
     * `/retitle` (and the header action that invokes it) sets this immediately
     * before calling `ctx.sessionTitle.refresh()`. `refresh()` accepts no options
     * and the provider receives no trigger discriminator — the derived
     * `AbortSignal` has no back-reference to the caller — so this transient,
     * session-keyed flag is the minimum seam that lets an explicit request
     * override the automatic churn guard. It carries no scheduling authority and
     * is consumed once.
     */
    readonly consumeExplicitRegeneration?: ((sessionId: string) => boolean) | undefined;
    /** Local outcome counters, if the plugin is collecting them. */
    readonly diagnostics?: TitleDiagnostics | undefined;
}
/**
 * The configuration in force for one generation.
 *
 * Read through a function rather than captured at construction: a settings
 * change must take effect on the NEXT generation without a restart.
 */
export interface TitlePolicy {
    readonly config: TitleConfig;
    readonly settings: TitleSettings;
}
/** Supplies the live policy. Evaluated once per `generate()`. */
export type TitlePolicySource = () => TitlePolicy;
/** Why one attempt produced no usable title. */
export type AttemptFailure = {
    readonly kind: "finish";
    readonly detail: string;
    readonly retryable: boolean;
} | {
    readonly kind: "rejected";
    readonly reason: TitleRejectReason;
} | {
    readonly kind: "threw";
    readonly detail: string;
};
/**
 * Structural class of a generation failure.
 *
 * Used to classify the diagnostics outcome (`timeout` -> `timed-out`) without
 * matching on message text.
 */
export type TitleFailureKind = "timeout" | "cancelled" | "model" | "protocol" | "output" | "excluded";
/** A provider failure that the service will log and swallow (fallback stays). */
export declare class TitleGenerationError extends Error {
    readonly reason: string;
    readonly retryable: boolean;
    /** Structural class of the failure, for diagnostics classification. */
    readonly kind: TitleFailureKind;
    constructor(reason: string, retryable?: boolean, kind?: TitleFailureKind);
}
/**
 * Thrown for an abstention: a deliberate non-generation that the service logs
 * and swallows, leaving the current title in place.
 *
 * Extends {@link TitleGenerationError} so it keeps the Phase 1 contract — a
 * non-retryable generation failure — while callers that care can single it out
 * with `instanceof TitleAbstention` and read `reason`.
 */
export declare class TitleAbstention extends TitleGenerationError {
    /** Why generation was declined (the base class's `reason` is the message). */
    readonly abstentionReason: AbstentionReason;
    constructor(reason: AbstentionReason, detail: string);
}
/**
 * Build the provider object handed to `ctx.sessionTitle.register()`.
 *
 * @param getPolicy - reads the configuration in force right now, so a settings
 *   change applies to the next generation without a restart.
 * @param deps - the `llm` service plus optional logger/clock/diagnostics.
 */
export declare function createSmartSessionTitleProvider(getPolicy: TitlePolicySource, deps: ProviderDependencies): SessionTitleProvider;
