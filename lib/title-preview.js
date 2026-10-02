/** Read-only title generation and guarded application through the official title service. */
import { randomUUID } from "node:crypto";
import { selectOrdinaryTitleMessages, selectExplicitGoalTitleMessages, titleSessionRevision } from "./commands.js";
import { isAiTitleDisabled, isSessionTitleLocked } from "./settings.js";

export const PREVIEW_COMMAND = "title-preview";
export const APPLY_PREVIEW_COMMAND = "title-apply";
export const PREVIEW_TTL_MS = 60 * 60 * 1000;
export const PREVIEW_CACHE_LIMIT = 500;

function policyRevision(policy) {
    const { lockedSessionIds, showSessionId, ...settings } = policy.settings;
    return JSON.stringify([policy.config, settings]);
}
function allowed(policy, session) {
    if (isAiTitleDisabled(policy.settings)) throw new Error("AI title generation is disabled.");
    if (isSessionTitleLocked(policy.settings, session.id)) throw new Error("This session's title is locked. Unlock it first.");
    if (session.header?.parentSession !== undefined) throw new Error("Child sessions cannot preview titles.");
}

export function createTitlePreviewController(deps) {
    const now = deps.now ?? Date.now;
    const makeId = deps.makeId ?? randomUUID;
    const cache = new Map();
    const active = new Map();
    let disposed = false;
    const prune = () => {
        for (const [id, entry] of cache) if (entry.expiresAt <= now()) cache.delete(id);
        while (cache.size >= PREVIEW_CACHE_LIMIT) cache.delete(cache.keys().next().value);
    };
    return {
        async preview(session, upstreamSignal) {
            if (disposed) throw new Error("Title preview is unavailable.");
            upstreamSignal?.throwIfAborted();
            const policy = deps.getPolicy();
            allowed(policy, session);
            const ordinary = selectOrdinaryTitleMessages(session);
            const messages = ordinary.length > 0 ? ordinary : selectExplicitGoalTitleMessages(session);
            if (messages.length === 0) throw new Error("No usable title input in this session.");
            const previous = deps.sessionTitle.get(session);
            const revision = titleSessionRevision(session, previous);
            const settingsRevision = policyRevision(policy);
            const abort = new AbortController();
            active.set(abort, session.id);
            const signal = upstreamSignal === undefined ? abort.signal : AbortSignal.any([upstreamSignal, abort.signal]);
            try {
                const config = typeof session.requestHeader === "function" ? session.requestHeader()?.config : undefined;
                const result = await deps.generate({ session, messages, signal,
                    ...config === undefined ? {} : { route: { provider: config.provider, model: config.model } } });
                signal.throwIfAborted();
                const currentPolicy = deps.getPolicy();
                allowed(currentPolicy, session);
                if (disposed || revision !== titleSessionRevision(session, deps.sessionTitle.get(session)) || settingsRevision !== policyRevision(currentPolicy)) {
                    throw new Error("Session or settings changed during preview. Generate a new preview.");
                }
                prune();
                const previewId = makeId();
                const expiresAt = now() + PREVIEW_TTL_MS;
                const candidate = { kind: "title-preview", previewId, sessionId: session.id,
                    previousTitle: previous?.title ?? "", title: result.title, expiresAt };
                cache.set(previewId, { ...candidate, revision, settingsRevision });
                return candidate;
            } finally {
                active.delete(abort);
            }
        },
        apply(session, previewId, signal) {
            signal?.throwIfAborted();
            if (disposed) throw new Error("Title preview is unavailable.");
            const policy = deps.getPolicy();
            allowed(policy, session);
            const candidate = cache.get(previewId);
            if (!candidate || candidate.sessionId !== session.id || candidate.expiresAt <= now()) {
                if (candidate?.expiresAt <= now()) cache.delete(previewId);
                throw new Error("Title preview expired or is unavailable. Generate a new preview.");
            }
            if (candidate.revision !== titleSessionRevision(session, deps.sessionTitle.get(session)) || candidate.settingsRevision !== policyRevision(policy)) {
                cache.delete(previewId);
                throw new Error("Session or settings changed since preview. Generate a new preview.");
            }
            // No await between this revision check and the official synchronous
            // rename. The user chose this candidate, so it becomes a user title.
            const accepted = deps.sessionTitle.rename(session, candidate.title);
            cache.delete(previewId);
            return accepted;
        },
        cancelSession(sessionId) {
            for (const [abort, id] of active) if (id === sessionId) abort.abort();
            for (const [key, entry] of cache) if (entry.sessionId === sessionId) cache.delete(key);
        },
        dispose() {
            disposed = true;
            for (const abort of active.keys()) abort.abort();
            cache.clear();
        }
    };
}
