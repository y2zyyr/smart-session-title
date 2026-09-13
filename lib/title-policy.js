/**
 * Pure title policy: prompt assessment, input compression, title validation.
 *
 * This module is deliberately free of Cordis, sessions, `ctx`, filesystem and
 * network access so every rule is directly unit-testable. The provider layer
 * owns orchestration; all decisions live here.
 *
 * Design intent (Phase 1): the built-in provider threw as soon as the framed
 * first prompt exceeded 4096 bytes, which meant *no model call at all* and a
 * permanently truncated fallback title. Compression — never rejection — is the
 * fix, plus refusing to invent a title for prompts that carry no task.
 */
const encoder = new TextEncoder();
/* ------------------------------------------------------------------ *
 * Text primitives
 * ------------------------------------------------------------------ */
/** UTF-8 byte length, matching the unit the session-title service caps in. */
export function byteLength(input) {
    return encoder.encode(input).length;
}
/** Operating-system-command escape sequences, including unterminated tails. */
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu;
/** Control-sequence-introducer escapes such as SGR colour codes. */
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu;
/** Remaining two-byte ESC control sequences. */
const ESC_SEQUENCE = /\u001B[@-_]/gu;
/** Non-whitespace C0/C1 control characters. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
/** Directional and invisible controls that can make a displayed title deceptive. */
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu;
/**
 * Strip control sequences and produce one trimmed, whitespace-normalized line.
 * Mirrors the sanitization the session-title service applies to every accepted
 * title, so our own checks see the same text the sidebar eventually will.
 */
export function cleanTitleText(input) {
    return input
        .replace(OSC_SEQUENCE, "")
        .replace(CSI_SEQUENCE, "")
        .replace(ESC_SEQUENCE, "")
        .replace(CONTROL_CHARACTER, "")
        .replace(DIRECTIONAL_CONTROL, "")
        .replace(/\s+/gu, " ")
        .trim();
}
/**
 * Longest leading code-point prefix within a UTF-8 byte budget.
 * Never splits a code point.
 */
export function truncateTitleUtf8(input, maxBytes) {
    if (maxBytes <= 0)
        return "";
    if (byteLength(input) <= maxBytes)
        return input;
    let used = 0;
    let out = "";
    for (const character of input) {
        const size = byteLength(character);
        if (used + size > maxBytes)
            break;
        out += character;
        used += size;
    }
    return out;
}
/** Longest trailing code-point suffix within a UTF-8 byte budget. */
function tailTitleUtf8(input, maxBytes) {
    if (maxBytes <= 0)
        return "";
    if (byteLength(input) <= maxBytes)
        return input;
    const characters = Array.from(input);
    let used = 0;
    let out = "";
    for (let index = characters.length - 1; index >= 0; index -= 1) {
        const character = characters[index];
        const size = byteLength(character);
        if (used + size > maxBytes)
            break;
        out = character + out;
        used += size;
    }
    return out;
}
/** Punctuation that marks a natural cut point when shortening a title. */
const TITLE_SEPARATORS = [" ", "，", "。", "、", "；", "：", ",", ".", ";", ":", "|", "/", "）", ")", "]", "】", "—", "-", "_"];
/** Trailing punctuation that carries no meaning in a title. */
const TRAILING_TITLE_PUNCTUATION = /[\s.。,，;；:：、!！?？~～\-—_|/\\]+$/u;
/**
 * Shorten a title to a byte budget, preferring a nearby separator over a
 * mid-word cut. Falls back to a hard code-point-safe cut when no separator
 * leaves enough of the title intact.
 */
export function truncateSemantically(input, maxBytes) {
    const cleaned = cleanTitleText(input);
    if (byteLength(cleaned) <= maxBytes) {
        return cleaned.replace(TRAILING_TITLE_PUNCTUATION, "").trim();
    }
    const window = truncateTitleUtf8(cleaned, maxBytes);
    let bestCut = -1;
    for (const separator of TITLE_SEPARATORS) {
        const at = window.lastIndexOf(separator);
        if (at > bestCut)
            bestCut = at;
    }
    // Only honour a separator that keeps most of the budget useful.
    const candidate = bestCut > 0 && byteLength(window.slice(0, bestCut)) >= maxBytes * 0.6
        ? window.slice(0, bestCut)
        : window;
    return candidate.replace(TRAILING_TITLE_PUNCTUATION, "").trim();
}
/**
 * Shorten a title to a code-point budget, preferring a nearby separator.
 *
 * The byte cap is the service's hard limit; this one is what a human means by
 * "字数" (26 CJK characters and 80 Latin characters are both 80 bytes). It is
 * applied AFTER the byte cap, so a title never exceeds either limit, and it
 * uses the same 0.6 separator rule so both shortenings cut in the same place.
 */
export function truncateTitleCharacters(input, maxCharacters) {
    const cleaned = cleanTitleText(input);
    if (!Number.isInteger(maxCharacters) || maxCharacters <= 0)
        return cleaned;
    const characters = Array.from(cleaned);
    if (characters.length <= maxCharacters) {
        return cleaned.replace(TRAILING_TITLE_PUNCTUATION, "").trim();
    }
    const window = characters.slice(0, maxCharacters).join("");
    let bestCut = -1;
    for (const separator of TITLE_SEPARATORS) {
        const at = window.lastIndexOf(separator);
        if (at > bestCut)
            bestCut = at;
    }
    const candidate = bestCut > 0 && bestCut >= maxCharacters * 0.6 ? window.slice(0, bestCut) : window;
    return candidate.replace(TRAILING_TITLE_PUNCTUATION, "").trim();
}
/* ------------------------------------------------------------------ *
 * Fenced code blocks
 * ------------------------------------------------------------------ */
/** Opening or closing fence line: three or more backticks or tildes. */
const FENCE_LINE = /^\s*(`{3,}|~{3,})\s*([^\s`~]*)\s*$/;
/**
 * Replace large fenced code blocks with a short placeholder.
 *
 * Small blocks are kept: a two-line snippet can carry the task ("修复这个函数"
 * plus three lines) while an 8 KB dump cannot. An unterminated fence is treated
 * as running to the end of the input.
 */
export function stripLargeFencedCodeBlocks(input, keepBytes) {
    return mapFencedCodeBlocks(input, keepBytes, "placeholder");
}
/**
 * Delete every fenced code block outright.
 *
 * Used by prompt assessment, where the question is "is there any natural
 * language left?" — a placeholder would answer that question wrongly.
 */
export function removeFencedCodeBlocks(input) {
    return mapFencedCodeBlocks(input, -1, "remove");
}
function mapFencedCodeBlocks(input, keepBytes, mode) {
    const lines = input.split("\n");
    const out = [];
    let omitted = 0;
    let omittedBytes = 0;
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        const opening = FENCE_LINE.exec(line);
        if (opening === null) {
            out.push(line);
            index += 1;
            continue;
        }
        const marker = opening[1][0];
        const language = opening[2] || "code";
        const body = [];
        let cursor = index + 1;
        let closed = false;
        while (cursor < lines.length) {
            const candidate = lines[cursor];
            const fence = FENCE_LINE.exec(candidate);
            if (fence !== null && fence[1][0] === marker) {
                closed = true;
                break;
            }
            body.push(candidate);
            cursor += 1;
        }
        const bodyText = body.join("\n");
        const bodyBytes = byteLength(bodyText);
        if (mode === "remove" || bodyBytes > keepBytes) {
            omitted += 1;
            omittedBytes += bodyBytes;
            if (mode === "placeholder") {
                out.push("```text");
                out.push(`[large ${language} code omitted: ${bodyBytes} bytes]`);
                out.push("```");
            }
        }
        else {
            out.push(line);
            out.push(...body);
            if (closed)
                out.push(lines[cursor]);
        }
        index = closed ? cursor + 1 : cursor;
    }
    return { text: out.join("\n"), omitted, omittedBytes };
}
/** Greetings and acknowledgements that carry no task. Exact match only. */
const GREETINGS = new Set([
    "你好", "您好", "哈喽", "嗨", "在吗", "早上好", "下午好", "晚上好", "早安", "晚安",
    "hi", "hello", "hey", "yo", "sup", "morning",
    "test", "testing", "测试", "测试一下", "试一下",
    "谢谢", "多谢", "thanks", "thank you", "thx",
    "好的", "好", "嗯", "哦", "ok", "okay", "got it"
]);
/** Bare deixis: the user is pointing at something we cannot see. */
const DEMONSTRATIVES = new Set([
    "看看这个", "看看", "看一下", "看下", "帮我看看", "帮我看", "帮我", "帮忙",
    "这个呢", "这个", "那个", "这儿", "这里", "这", "那",
    "你看看", "你看", "瞧一瞧", "瞅瞅",
    "what about this", "look at this", "check this", "this", "this one", "that"
]);
/** Action verbs that make even a very short prompt a real task. */
const ACTION_VERBS = [
    "帮我", "修复", "修一下", "审计", "实现", "设计", "优化", "迁移", "重构", "排查", "调查",
    "分析", "检查", "检查一下", "添加", "新增", "删除", "移除", "升级", "降级", "部署", "配置",
    "编写", "生成", "整理", "调研", "评估", "创建", "构建", "测试", "验证", "清理", "替换",
    "更新", "解释", "说明", "总结", "翻译", "对比", "复现", "定位", "回归", "接入", "改造",
    "fix", "audit", "implement", "design", "optimize", "optimise", "migrate", "refactor",
    "investigate", "analyse", "analyze", "check", "add", "remove", "upgrade", "downgrade",
    "deploy", "configure", "write", "generate", "review", "test", "verify", "clean", "replace",
    "update", "explain", "summarise", "summarize", "translate", "compare", "reproduce", "debug",
    "profile", "benchmark", "port", "document", "implement"
];
/** Signal that a short prompt still names a concrete technical object. */
const TECHNICAL_SIGNAL = /[`$]|\/[A-Za-z]|\.[A-Za-z]{1,5}\b|_[A-Z]|[A-Z]{2,}|\d/u;
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/giu;
const PATH_TOKEN = /^(?:~\/|\/|\.{1,2}\/|[A-Za-z]:[\\/]|\\\\)\S*$/u;
const PUNCTUATION_ONLY = /^[\p{P}\p{S}\s]*$/u;
function collapse(input) {
    return input.replace(/\s+/gu, " ").trim();
}
function normalizeKey(input) {
    return collapse(input)
        .toLowerCase()
        .replace(/^[\s"'`*#>\-—–[\](){}【】「」]+/u, "")
        .replace(/[\s"'`*#<\-—–[\](){}【】「」.!！?？~～,，。;；:：、]+$/u, "")
        .trim();
}
/** Bare URLs and nothing else. */
export function isUrlOnly(input) {
    const text = collapse(input);
    if (!/https?:\/\//iu.test(text))
        return false;
    return PUNCTUATION_ONLY.test(text.replace(URL_PATTERN, " "));
}
/** A single local filesystem path and nothing else. */
export function isPathOnly(input) {
    const tokens = collapse(input).split(" ").filter((token) => token.length > 0);
    if (tokens.length === 0 || tokens.length > 2)
        return false;
    return tokens.every((token) => {
        const bare = token.replace(/^["'`]+/u, "").replace(/["'`]+$/u, "");
        return PATH_TOKEN.test(bare);
    });
}
function startsWithAny(input, values) {
    return values.some((value) => input.includes(value));
}
/**
 * Decide whether a first prompt carries an actionable task.
 *
 * Deliberately conservative: every list check is an exact match, and the
 * short-prompt rule requires the *absence* of an action verb, latin text and
 * any technical signal. "修复登录 bug" is a real task; "看看这个" is not.
 */
export function assessPrompt(input) {
    const raw = collapse(input);
    if (raw.length === 0)
        return { weak: true, reason: "empty", signal: "" };
    // Strip fences from the ORIGINAL text, before whitespace collapsing destroys
    // the line structure the fence scanner depends on.
    const withoutCode = collapse(removeFencedCodeBlocks(input).text);
    if (withoutCode.length === 0) {
        return { weak: true, reason: "code-only", signal: "" };
    }
    const signal = collapse(withoutCode.replace(URL_PATTERN, " "));
    if (isUrlOnly(withoutCode))
        return { weak: true, reason: "url-only", signal };
    if (isPathOnly(withoutCode))
        return { weak: true, reason: "path-only", signal };
    if (PUNCTUATION_ONLY.test(withoutCode)) {
        return { weak: true, reason: "punctuation-only", signal };
    }
    const key = normalizeKey(withoutCode);
    if (GREETINGS.has(key))
        return { weak: true, reason: "greeting", signal };
    // Bound the fuzzy greeting case to short inputs so "你好，帮我审计这个项目"
    // (a real task) is never classified as a greeting.
    const codePoints = Array.from(key).length;
    if (codePoints <= 6) {
        const fuzzyGreeting = ["你好", "您好", "嗨", "哈喽", "hello", "hi", "在吗"].some((greeting) => key.startsWith(greeting));
        if (fuzzyGreeting &&
            !startsWithAny(key, ACTION_VERBS) &&
            !/[a-z0-9]/u.test(key) &&
            !TECHNICAL_SIGNAL.test(key)) {
            return { weak: true, reason: "greeting", signal };
        }
    }
    if (DEMONSTRATIVES.has(key))
        return { weak: true, reason: "demonstrative", signal };
    if (codePoints <= 8) {
        const hasVerb = startsWithAny(key, ACTION_VERBS);
        const hasLatin = /[a-z0-9]/u.test(key);
        const hasTechnical = TECHNICAL_SIGNAL.test(key);
        if (!hasVerb && !hasLatin && !hasTechnical) {
            return { weak: true, reason: "too-short-no-signal", signal };
        }
    }
    return { weak: false, signal };
}
/* ------------------------------------------------------------------ *
 * Input compression
 * ------------------------------------------------------------------ */
/** Markdown ATX heading. */
const ATX_HEADING = /^ {0,3}#{1,6}\s+\S/u;
/** A line that is just a bold label. */
const BOLD_LABEL = /^ {0,3}\*\*[^*\n]+\*\*\s*[:：]?\s*$/u;
/** Chinese section labels that front a task specification. */
const CJK_SECTION = /^\s{0,3}(?:目标|任务|要求|需求|交付|产出|产物|约束|范围|测试|背景|项目|验收|步骤|计划|现状|问题|禁止|必须|注意|说明|输出|交付物|验收标准)\s*[:：]?/u;
/** English section labels that front a task specification. */
const EN_SECTION = /^\s{0,3}(?:goals?|objectives?|requirements?|deliverables?|scope|tasks?|tests?|output|context|background|acceptance|constraints?|plan|summary|notes?|instructions?|overview)\b\s*[:：]?/iu;
/** Lines kept verbatim from the head of a compressed prompt. */
const HEAD_LINES = 12;
/** Lines kept verbatim from the tail (final deliverable instructions). */
const TAIL_LINES = 8;
/** Non-empty lines kept after each heading as that section's lead. */
const SECTION_LEAD_LINES = 3;
function isHeading(line) {
    return ATX_HEADING.test(line) || BOLD_LABEL.test(line) || CJK_SECTION.test(line) || EN_SECTION.test(line);
}
/**
 * Keep the parts of a long task specification that actually name the task:
 * the opening lines, every section heading with its lead sentence, and the
 * closing lines (which usually carry the deliverable and the prohibitions).
 */
export function extractSalientRegions(input) {
    const lines = input.split("\n");
    const keep = new Set();
    const nonEmpty = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].trim().length > 0)
            nonEmpty.push(index);
    }
    for (const index of nonEmpty.slice(0, HEAD_LINES))
        keep.add(index);
    for (const index of nonEmpty.slice(Math.max(0, nonEmpty.length - TAIL_LINES)))
        keep.add(index);
    for (let index = 0; index < lines.length; index += 1) {
        if (!isHeading(lines[index]))
            continue;
        keep.add(index);
        let taken = 0;
        for (let cursor = index + 1; cursor < lines.length && taken < SECTION_LEAD_LINES; cursor += 1) {
            if (lines[cursor].trim().length === 0)
                continue;
            keep.add(cursor);
            taken += 1;
        }
    }
    const ordered = [...keep].sort((a, b) => a - b);
    const groups = [];
    let current = [];
    let previous = -2;
    for (const index of ordered) {
        if (index !== previous + 1 && current.length > 0) {
            groups.push(current);
            current = [];
        }
        current.push(lines[index]);
        previous = index;
    }
    if (current.length > 0)
        groups.push(current);
    return groups.map((group) => group.join("\n")).join("\n...\n");
}
/** Head + tail trim used when even the salient regions exceed the budget. */
function headTailTrim(input, budget) {
    if (byteLength(input) <= budget)
        return input;
    const marker = "\n...\n";
    const markerBytes = byteLength(marker);
    const headBudget = Math.max(1, Math.floor((budget - markerBytes) * 0.6));
    const tailBudget = Math.max(1, budget - markerBytes - headBudget);
    const head = truncateTitleUtf8(input, headBudget);
    const tail = tailTitleUtf8(input, tailBudget);
    return `${head}${marker}${tail}`;
}
/**
 * Compress one first prompt into a title-model input that fits the budget.
 *
 * Order of operations: window the raw text if it is absurdly large, drop large
 * code blocks, then fall back to structural extraction, then to head+tail.
 * The function never rejects an input on size alone.
 */
export function prepareTitleInput(input, config) {
    const rawBytes = byteLength(input);
    const budget = config.targetPreparedInputBytes;
    let work = input;
    let rawWindowed = false;
    if (rawBytes > config.maxRawInputBytes) {
        work = headTailTrim(input, config.maxRawInputBytes);
        rawWindowed = true;
    }
    const stripped = stripLargeFencedCodeBlocks(work, config.codeBlockKeepBytes);
    const strippedBytes = byteLength(stripped.text);
    const base = {
        rawBytes,
        omittedCodeBlocks: stripped.omitted,
        omittedCodeBytes: stripped.omittedBytes,
        rawWindowed
    };
    if (strippedBytes <= budget) {
        return {
            ...base,
            text: stripped.text,
            preparedBytes: strippedBytes,
            strategy: stripped.omitted > 0 ? "code-stripped" : rawWindowed ? "windowed" : "verbatim"
        };
    }
    const salient = extractSalientRegions(stripped.text);
    if (byteLength(salient) <= budget) {
        return { ...base, text: salient, preparedBytes: byteLength(salient), strategy: "structured" };
    }
    const trimmed = headTailTrim(salient, budget);
    return { ...base, text: trimmed, preparedBytes: byteLength(trimmed), strategy: "head-tail" };
}
/**
 * Pick the message that defines the session's task.
 *
 * Recovery hinges on this: a session opened with "你好" must still be titled
 * from the first *later* message that names real work, and the target must not
 * drift to whatever the user typed last — `/retitle` is the explicit tool for
 * re-naming an evolved session.
 *
 * Deliberately the FIRST meaningful message rather than the newest: after
 * `你好 / 看看这个 / 这个 zip 是项目源码，帮我修复构建错误`, the third message is
 * the task, and an automatic re-title on every later turn is out of scope.
 */
export function selectTaskTarget(messages) {
    const weakReasons = [];
    let target;
    let meaningfulCount = 0;
    for (const message of messages) {
        const assessment = assessPrompt(message.text);
        if (assessment.weak) {
            weakReasons.push(assessment.reason ?? "too-short-no-signal");
            continue;
        }
        meaningfulCount += 1;
        target ??= message;
    }
    return { target, meaningfulCount, weakCount: weakReasons.length, weakReasons };
}
/** Titles a model must never be allowed to pin onto the sidebar. */
const GENERIC_TITLES = new Set([
    // Chinese
    "帮助用户", "用户请求帮助", "用户请求", "用户提问", "用户咨询", "用户的问题",
    "帮助", "求助", "问题", "讨论", "讨论代码", "代码讨论", "帮助检查项目",
    "关于项目", "关于项目的问题", "关于某项目的问题", "看看这个", "看看",
    "新会话", "新的会话", "新对话", "未命名", "无标题", "会话标题", "对话标题", "聊天标题",
    // English
    "help", "help with code", "question", "question about project", "user request",
    "user asks", "user question", "discussion", "discussion about code", "code discussion",
    "new chat", "new session", "new conversation", "untitled", "title", "session title",
    "chat title", "conversation title", "code", "conversation", "chat", "summary"
]);
/** Structurally unambiguous generic-title shapes. */
const GENERIC_PATTERNS = [
    /^(?:the\s+)?(?:user|human)(?:'s)?\s+(?:request|question|ask|query)\b/iu,
    /^(?:question|discussion|help|request)\s+(?:about|with|regarding|on|for)\b/iu,
    /^(?:new|untitled)\b/iu,
    /^(?:关于|有关).{0,12}(?:的问题|的讨论|的咨询|咨询|讨论)$/u,
    /^(?:讨论|介绍|说明)(?:一下)?(?:代码|项目|代码库)$/u,
    /^(?:会话|对话|聊天)(?:标题|主题)?$/u,
    /^(?:conversation|session|chat)\s+(?:summary|title)$/iu
];
/** Leading label a model sometimes prefixes a title with. */
const TITLE_PREFIX = /^\s*(?:title|标题|会话标题|话题)\s*[:：]\s*/iu;
/** Wrapping quotes and stray markdown emphasis. */
const WRAPPING = /^[\s"'`*_#>\-—–【】「」\[\]]+|[\s"'`*_#<\-—–【】「」\[\]]+$/gu;
/** Placeholder text we ourselves insert, or a model echoing instructions. */
const PLACEHOLDER = /^(?:\[.*?omitted.*?\]|code block omitted|untitled|n\/?a|none|null|-\s*|\.\.\.?)$/iu;
/** Hard ceiling on title length before we treat the output as a paragraph. */
const MAX_TITLE_CODE_POINTS = 120;
/**
 * Quality gate applied on top of the service's own normalization.
 *
 * Accepts short-but-real titles ("修复 Bug", "修复 TRANSLATION_SCHEMA_INVALID")
 * and only rejects output that is empty, a placeholder, a generic phrase, a
 * bare URL/path, letterless, or a whole paragraph.
 *
 * @param raw - the model's raw text output.
 * @param maxTitleBytes - the byte budget the caller will also enforce.
 * @param maxTitleCharacters - optional code-point cap ("字数"), applied after
 *   the byte cap so the title honours whichever limit is tighter.
 */
export function validateGeneratedTitle(raw, maxTitleBytes, maxTitleCharacters) {
    const stripped = cleanTitleText(raw).replace(TITLE_PREFIX, "").trim();
    // Check the placeholder shape before unwrapping brackets: our own compression
    // marker is "[large <lang> code omitted: N bytes]", which the wrapping strip
    // would otherwise turn into a plausible-looking phrase.
    if (PLACEHOLDER.test(stripped))
        return { ok: false, reason: "placeholder" };
    // A fenced code block is never a title, and stripping the wrapping backticks
    // first would turn one into a plausible-looking phrase.
    if (FENCE_LINE.test(stripped) || /```|~~~/u.test(stripped)) {
        return { ok: false, reason: "code" };
    }
    const cleaned = stripped.replace(WRAPPING, "").trim();
    if (cleaned.length === 0)
        return { ok: false, reason: "empty" };
    if (PLACEHOLDER.test(cleaned))
        return { ok: false, reason: "placeholder" };
    if (PUNCTUATION_ONLY.test(cleaned))
        return { ok: false, reason: "placeholder" };
    if (!/[\p{L}\p{N}]/u.test(cleaned))
        return { ok: false, reason: "no-letters" };
    if (isUrlOnly(cleaned))
        return { ok: false, reason: "url" };
    if (isPathOnly(cleaned))
        return { ok: false, reason: "path" };
    const key = normalizeKey(cleaned);
    if (GENERIC_TITLES.has(key))
        return { ok: false, reason: "generic" };
    for (const pattern of GENERIC_PATTERNS) {
        if (pattern.test(cleaned))
            return { ok: false, reason: "generic" };
    }
    if (Array.from(cleaned).length > MAX_TITLE_CODE_POINTS) {
        return { ok: false, reason: "too-long" };
    }
    const byteCapped = truncateSemantically(cleaned, maxTitleBytes);
    const title = maxTitleCharacters === undefined
        ? byteCapped
        : truncateTitleCharacters(byteCapped, maxTitleCharacters);
    // A cap tighter than the title's first code point must fail rather than
    // hand the service an empty title (it would reject that as a provider error).
    if (title.length === 0) {
        return { ok: false, reason: "empty" };
    }
    return { ok: true, title };
}
