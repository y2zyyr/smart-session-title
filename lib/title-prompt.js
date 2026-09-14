/**
 * Prompt construction for the title model.
 *
 * Pure module: builds strings only. The system prompt is derived from the
 * first-party `@deepseek-ai/dsh-session-title-llm` instruction (same framing,
 * same plain-text-only and language rules) and extended with the guidance the
 * shipped prompt lacks: "task index, not conversation summary", action +
 * object, anti-generic rules, and an explicit ban on copying the opening
 * words of the prompt.
 *
 * Two user preferences are applied here, and nowhere else:
 *  - phrasing (`titleStyle`) and language (`titleLanguage`) REPLACE the
 *    corresponding default rules rather than being appended next to them. Two
 *    contradictory instructions ("prefer action + object" *and* "omit the verb")
 *    degrade both, so each preference swaps its line out.
 *  - a configured exclusion list is NEVER sent to the model. The terms are
 *    deleted from the message before framing (see `title-policy`), and the model
 *    is only told that some names were removed on purpose — telling it which
 *    names to avoid would hand it exactly what the user wants hidden.
 */
/** Plugin identity recorded on the LLM user message source. */
export const PLUGIN_NAME = "smart-session-title";
/**
 * Phrasing directives, keyed by `TitleStyle`.
 *
 * `action-object` is also the mapping used when the user has chosen nothing, so
 * the plugin's default and an explicit "action + object" choice produce the same
 * prompt. That is deliberate: the default IS action + object today.
 */
const STYLE_DIRECTIVES = {
    "action-object": "Prefer action + object: a verb naming what is being done, then the thing it is done to.",
    "short-name": "Prefer a short task name: a compact noun phrase naming what the task is about. " +
        "Omit the verb when the noun phrase alone identifies the task."
};
/**
 * Explicit language directives, keyed by `TitleLanguage`.
 *
 * Both are written to survive a message in the OTHER language, which is the only
 * case where the preference changes anything — and both keep the identifier rule
 * so forcing English cannot mangle `React`, `API` or an error symbol.
 */
const LANGUAGE_DIRECTIVES = {
    zh: "Write the title in Simplified Chinese even when the message is in another language. " +
        "Keep proper nouns, product and repository names, and code, symbol or error identifiers in their original form (for example React, API).",
    en: "Write the title in English even when the message is in another language. " +
        "Keep proper nouns, product and repository names, and code, symbol or error identifiers in their original form (for example React, API)."
};
/** The pre-existing rule: follow the message. Kept as the unset default. */
const AUTO_LANGUAGE_DIRECTIVE = "Use the language primarily used by the human message; keep proper nouns in their original form.";
/**
 * Words are deleted from the message before it is sent, so the model must be told
 * that a gap is intentional rather than something to reconstruct.
 */
const EXCLUSION_DIRECTIVE = "Some names were removed from the message on purpose. " +
    'If a subject is needed, refer to it generically (for example "the client" or "该客户"). ' +
    "Never guess or restore a removed name.";
/**
 * Sent as a second user turn when the first attempt produced unusable text.
 *
 * Deterministic and bounded so a retry cannot drift into a new task, and derived
 * from the SAME preferences as the system prompt: a retry that silently fell back
 * to the default phrasing would make the user's setting look intermittent.
 *
 * @param options - phrasing, language and whether names were removed.
 */
export function buildRetryDirective(options = {}) {
    const language = options.language === "zh"
        ? "in Simplified Chinese"
        : options.language === "en"
            ? "in English"
            : "in the language of the message";
    const shape = options.style === "short-name"
        ? "a short task name (a compact noun phrase)"
        : "action plus object";
    return [
        "The previous attempt did not produce a usable title.",
        `Return exactly one concise task title ${language}:`,
        `${shape}, no quotes, no Markdown, no explanation, no code.`,
        ...(options.hasExclusions === true ? ["Never restore a name that was removed from the message."] : [])
    ].join(" ");
}
/** The default retry directive: no style, no language, no exclusions. */
export const RETRY_DIRECTIVE = buildRetryDirective({});
/** Soft length guidance derived from the configured targets. */
function lengthGuidance(config) {
    return [
        `Aim for roughly ${config.targetWords} words in a non-CJK language`,
        `or about ${config.targetCjkCharacters} CJK characters.`,
        "Shorter is better than longer; never pad the title to reach the target."
    ].join(" ");
}
/** One extra anchor when the user asks for a bare task name. */
const SHORT_NAME_EXAMPLES = {
    zh: "帮我修复登录接口的超时问题 -> 登录接口超时",
    en: "Fix the timeout in the login endpoint -> Login endpoint timeout"
};
/**
 * Anchors used when the language is left on automatic.
 *
 * Mixed on purpose: the model should read the language off the message, so the
 * examples must not suggest that everything is translated into one language.
 */
export const SYSTEM_EXAMPLES = [
    "审计目前 Open Gambit 的 translation pipeline，重点检查西班牙语 TRANSLATION_SCHEMA_INVALID 的根因，不允许修改 production。 -> 审计 Open Gambit 西语翻译",
    "Audit the authentication middleware and fix the session refresh race condition without changing the public API. -> Fix Auth Session Refresh Race",
    "帮我检查整个项目当前 TypeScript 报错，并修复可以安全修复的问题，不修改业务逻辑。 -> 修复 TypeScript 错误"
];
/**
 * Anchors used when the language is pinned.
 *
 * The English set deliberately pairs a Chinese message with an English title:
 * that is the case the setting exists for, and an all-English example set would
 * leave the model free to treat a Chinese message as a reason to answer in
 * Chinese.
 */
const LANGUAGE_EXAMPLES = {
    zh: [
        "审计目前 Open Gambit 的 translation pipeline，重点检查西班牙语 TRANSLATION_SCHEMA_INVALID 的根因，不允许修改 production。 -> 审计 Open Gambit 西语翻译",
        "Audit the authentication middleware and fix the session refresh race condition without changing the public API. -> 修复认证中间件的会话刷新竞态条件"
    ],
    en: [
        "Audit the authentication middleware and fix the session refresh race condition without changing the public API. -> Fix Auth Session Refresh Race",
        "帮我修复登录接口的超时问题，API 名称不要改。 -> Fix login API timeout"
    ]
};
/** The anchor set for one (language, style) pair. */
function examplesFor(options) {
    const base = LANGUAGE_EXAMPLES[options.language] ?? SYSTEM_EXAMPLES;
    if (options.style !== "short-name")
        return [...base];
    // A bare task name needs its own anchor: every default example is action +
    // object, and without a counter-example the model keeps that shape no matter
    // what the rule above says. With an automatic language there is no single
    // anchor language, so both are supplied.
    const anchors = options.language === undefined
        ? [SHORT_NAME_EXAMPLES.zh, SHORT_NAME_EXAMPLES.en]
        : [SHORT_NAME_EXAMPLES[options.language]].filter((anchor) => anchor !== undefined);
    return [...base, ...anchors];
}
/**
 * Build the system instruction.
 *
 * The rule set is intentionally short. It encodes exactly the properties Phase 0
 * identified as missing: task-index framing, action + object, identifier
 * preservation, an explicit generic-title blacklist, and "do not copy the
 * beginning of the prompt".
 *
 * @param config - the resolved composition config (length guidance only).
 * @param options - `titleStyle` / `titleLanguage` as the user set them, plus
 *   `hasExclusions`. All optional; every default reproduces the pre-existing
 *   prompt byte for byte.
 */
export function buildSystemPrompt(config, options = {}) {
    return [
        "Create a concise title for an AI coding or work session, using the human message supplied below.",
        "The title is a task index for a sidebar — it must name the task, not summarise the conversation.",
        STYLE_DIRECTIVES[options.style] ?? STYLE_DIRECTIVES["action-object"],
        "Preserve meaningful proper nouns exactly: project, product, repository, library and technology names, and error or symbol identifiers.",
        "Do not copy the opening words of the message; compress the underlying task instead.",
        "Never return a generic phrase. Especially avoid:",
        '"help with", "question about", "user asks", "user request", "discussion about", "new session", "untitled",',
        '"帮助用户", "用户请求", "讨论代码", "看看这个", "新的会话", "关于项目的问题".',
        LANGUAGE_DIRECTIVES[options.language] ?? AUTO_LANGUAGE_DIRECTIVE,
        ...(options.hasExclusions === true ? [EXCLUSION_DIRECTIVE] : []),
        "Return exactly one plain-text title on a single line.",
        "No quotes, no Markdown, no prefix such as \"Title:\", no explanation, no code, no trailing punctuation.",
        lengthGuidance(config),
        "Examples (input -> title):",
        ...examplesFor(options).map((example) => `- ${example}`)
    ].join("\n");
}
/**
 * Frame the prepared message so user text cannot break structural delimiters.
 *
 * JSON-encoding is the same defence the first-party provider uses: newlines and
 * quotes in the prompt become escapes, so no prompt content can forge a new
 * instruction section.
 */
export function frameTitleInput(preparedText) {
    return `Generate the session title from this JSON-encoded human message:\n${JSON.stringify(preparedText)}`;
}
/**
 * Full user message body for one attempt.
 *
 * @param preparedText - the (already redacted and compressed) human message.
 * @param retry - whether this is a second attempt.
 * @param options - the same preferences the system prompt was built from, so the
 *   retry directive cannot contradict it.
 */
export function buildUserInput(preparedText, retry, options = {}) {
    if (!retry)
        return frameTitleInput(preparedText);
    return `${frameTitleInput(preparedText)}\n\n${buildRetryDirective(options)}`;
}
