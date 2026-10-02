import type { SessionTitleProvider, SessionTitleService, LiveSessionLike } from "@deepseek-ai/dsh-session-title";
import type { TitlePolicySource } from "./provider.js";
export declare const PREVIEW_COMMAND = "title-preview";
export declare const APPLY_PREVIEW_COMMAND = "title-apply";
export declare const PREVIEW_TTL_MS: number;
export declare const PREVIEW_CACHE_LIMIT = 500;
export interface TitlePreview {
    readonly kind: "title-preview";
    readonly previewId: string;
    readonly sessionId: string;
    readonly previousTitle: string;
    readonly title: string;
    readonly expiresAt: number;
}
export interface TitlePreviewController {
    preview(session: LiveSessionLike, signal?: AbortSignal): Promise<TitlePreview>;
    apply(session: LiveSessionLike, previewId: string, signal?: AbortSignal): ReturnType<SessionTitleService["rename"]>;
    cancelSession(sessionId: string): void;
    dispose(): void;
}
export declare function createTitlePreviewController(deps: {
    getPolicy: TitlePolicySource;
    generate: SessionTitleProvider["generate"];
    sessionTitle: Pick<SessionTitleService, "get" | "rename">;
    now?: () => number;
    makeId?: () => string;
}): TitlePreviewController;
