/**
 * Prompt construction for the title model.
 *
 * Pure module: builds strings only. The system prompt is derived from the
 * first-party `@deepseek-ai/dsh-session-title-llm` instruction (same framing,
 * same plain-text-only and language rules) and extended with the guidance the
 * shipped prompt lacks: "task index, not conversation summary", action +
 * object, anti-generic rules, and an explicit ban on copying the opening
 * words of the prompt.
 */
/** Plugin identity recorded on the LLM user message source. */
export const PLUGIN_NAME = "smart-session-title";
/**
 * Sent as a second user turn when the first attempt produced unusable text.
 * Deterministic and bounded so a retry cannot drift into a new task.
 */
export const RETRY_DIRECTIVE = [
    "The previous attempt did not produce a usable title.",
    "Return exactly one concise task title in the language of the message:",
    "action plus object, no quotes, no Markdown, no explanation, no code."
].join(" ");
/** Soft length guidance derived from the configured targets. */
function lengthGuidance(config) {
    return [
        `Aim for roughly ${config.targetWords} words in a non-CJK language`,
        `or about ${config.targetCjkCharacters} CJK characters.`,
        "Shorter is better than longer; never pad the title to reach the target."
    ].join(" ");
}
/**
 * Build the system instruction.
 *
 * The rule set is intentionally short. It encodes exactly the properties Phase 0
 * identified as missing: task-index framing, action + object, identifier
 * preservation, an explicit generic-title blacklist, and "do not copy the
 * beginning of the prompt".
 */
export function buildSystemPrompt(config) {
    return [
        "Create a concise title for an AI coding or work session, using the human message supplied below.",
        "The title is a task index for a sidebar — it must name the task, not summarise the conversation.",
        "Prefer action + object: a verb naming what is being done, then the thing it is done to.",
        "Preserve meaningful proper nouns exactly: project, product, repository, library and technology names, and error or symbol identifiers.",
        "Do not copy the opening words of the message; compress the underlying task instead.",
        "Never return a generic phrase. Especially avoid:",
        '"help with", "question about", "user asks", "user request", "discussion about", "new session", "untitled",',
        '"帮助用户", "用户请求", "讨论代码", "看看这个", "新的会话", "关于项目的问题".',
        "Use the language primarily used by the human message; keep proper nouns in their original form.",
        "Return exactly one plain-text title on a single line.",
        "No quotes, no Markdown, no prefix such as \"Title:\", no explanation, no code, no trailing punctuation.",
        lengthGuidance(config),
        "Examples (input -> title):",
        ...SYSTEM_EXAMPLES.map((example) => `- ${example}`)
    ].join("\n");
}
/** A few anchors only — enough to fix the shape without biasing the language. */
export const SYSTEM_EXAMPLES = [
    "审计目前 Open Gambit 的 translation pipeline，重点检查西班牙语 TRANSLATION_SCHEMA_INVALID 的根因，不允许修改 production。 -> 审计 Open Gambit 西语翻译",
    "Audit the authentication middleware and fix the session refresh race condition without changing the public API. -> Fix Auth Session Race",
    "帮我检查整个项目当前 TypeScript 报错，并修复可以安全修复的问题，不修改业务逻辑。 -> 修复 TypeScript 错误"
];
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
/** Full user message body for one attempt. */
export function buildUserInput(preparedText, retry) {
    if (!retry)
        return frameTitleInput(preparedText);
    return `${frameTitleInput(preparedText)}\n\n${RETRY_DIRECTIVE}`;
}
