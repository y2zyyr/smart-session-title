/** Pure host-policy regressions. No network, credentials, or production data. */
const B = new URL("../lib/", import.meta.url).href;
const policy = await import(B + "title-policy.js");
const route = await import(B + "route.js");
const caps = await import(B + "capabilities.js");
const tokens = await import(B + "tokens.js");
const obs = await import(B + "observability.js");
const affix = await import(B + "title-affix.js");
const conf = await import(B + "config.js");
const settings = await import(B + "settings.js");
const commands = await import(B + "commands.js");

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `\n   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

// --- prompt assessment
t("assess 你好 -> greeting", policy.assessPrompt("你好").reason, "greeting");
t("assess hello -> greeting", policy.assessPrompt("hello").reason, "greeting");
t("assess 看看这个 -> demonstrative", policy.assessPrompt("看看这个").reason, "demonstrative");
t("assess empty -> empty", policy.assessPrompt("   ").reason, "empty");
t("assess url-only", policy.assessPrompt("https://example.com/a/b").reason, "url-only");
t("assess path-only", policy.assessPrompt("/workspace/example/x").reason, "path-only");
t("assess code-only", policy.assessPrompt("```js\nconst a=1;\n```").reason, "code-only");
t("assess 修复登录 bug is a task", policy.assessPrompt("修复登录 bug").weak, false);
t("assess 你好，帮我审计这个项目 is a task", policy.assessPrompt("你好，帮我审计这个项目").weak, false);
t("assess 测试 -> greeting", policy.assessPrompt("测试").reason, "greeting");
t("assess 谢谢 -> greeting", policy.assessPrompt("谢谢").reason, "greeting");

// --- compression: the load-bearing Phase 1 claim
const big = ("帮我重构这个模块\n" + "x".repeat(20000) + "\n## 要求\n不要改 API\n");
const cfg = conf.resolveTitleConfig({});
const prep = policy.prepareTitleInput(big, cfg);
t("prepare huge input never throws", typeof prep.text, "string");
t("prepare stays within budget", policy.byteLength(prep.text) <= cfg.targetPreparedInputBytes, true);
console.log("   strategy=" + prep.strategy + " rawBytes=" + prep.rawBytes + " preparedBytes=" + prep.preparedBytes);
const bigCode = "修复构建\n```js\n" + "y".repeat(5000) + "\n```\n";
const prep2 = policy.prepareTitleInput(bigCode, cfg);
t("large fence -> code-stripped", prep2.strategy, "code-stripped");
t("large fence placeholder present", prep2.text.includes("omitted"), true);
const manyHeadings = Array.from({length: 200}, (_, i) => `## 章节${i}\n内容${i} `.repeat(20)).join("\n");
const prep3 = policy.prepareTitleInput(manyHeadings, cfg);
t("structured/head-tail fits budget", policy.byteLength(prep3.text) <= cfg.targetPreparedInputBytes, true);
console.log("   strategy=" + prep3.strategy);

// --- target selection recovery
const sel = policy.selectTaskTarget([{text:"你好",seq:1},{text:"看看这个",seq:2},{text:"这个 zip 是项目源码，帮我修复构建错误",seq:3}]);
t("target is first meaningful", sel.target.seq, 3);
t("weakCount", sel.weakCount, 2);

// --- route table
t("enabled=false -> abstain disabled", route.resolveTitleRoute({enabled:false}).reason, "disabled");
t("mode=disabled -> abstain disabled", route.resolveTitleRoute({enabled:true,mode:"disabled"}).reason, "disabled");
t("configured complete", route.resolveTitleRoute({enabled:true,mode:"configured",configured:{provider:"p",model:"m"}}).source, "configured");
t("configured incomplete -> abstain", route.resolveTitleRoute({enabled:true,mode:"configured"}).reason, "configured-incomplete");
t("pinned fallback", route.resolveTitleRoute({enabled:true,mode:"configured",pinned:{provider:"p2",model:"m2"}}).source, "pinned");
t("no mode + pin -> pinned(source)", route.resolveTitleRoute({enabled:true,pinned:{provider:"p",model:"m"}}).source, "pinned");
t("session route", route.resolveTitleRoute({enabled:true,session:{provider:"s",model:"sm"}}).source, "session");
t("no route -> abstain", route.resolveTitleRoute({enabled:true}).reason, "no-session-route");
t("half-configured settings ignored", route.resolveTitleRoute({enabled:true,mode:"current-session",configured:{provider:"p"},session:{provider:"s",model:"m"}}).source, "session");

// --- capabilities
t("caps ok", caps.findMissingCapabilities({sessionTitle:{register(){},refresh(){},get(){},rename(){}},llm:{stream(){}},settings:{register(){}}}), []);
t("caps missing", caps.findMissingCapabilities({}).length, 6);
let threw = false; try { caps.assertTitleCapabilities({}); } catch { threw = true; }
t("caps assert throws", threw, true);

// --- tokens
const tk = tokens.createExplicitRegenerationTokens();
tk.grant("s"); tk.grant("s");
t("two grants -> two takes", [tk.take("s"), tk.take("s"), tk.take("s")], [true,true,false]);
t("outstanding after drain", tk.outstanding("s"), 0);

// --- logging hygiene
const line = obs.sanitizeDiagnosticLine("smart-session-title generation apiKey=sk-abcdefghijklmnop route=a/b Authorization: Bearer abcdefghijklmnop");
t("sk- masked", line.includes("sk-abcdefghijklmnop"), false);
t("apiKey masked", /apiKey=\*\*\*/.test(line), true);
t("bearer secret masked", /abcdefghijklmnop/.test(line), false);
const d = obs.createTitleDiagnostics(() => 0);
d.record("generated", {sessionId:"s", route:"a/b", elapsedMs: 5, secretField:"leak"});
t("allowlist drops unknown field", obs.formatDiagnosticLine("generated", {sessionId:"s", evil:"x"}).includes("evil"), false);
t("snapshot counters", d.snapshot().counters.generated, 1);

// --- title validation
t("generic rejected", policy.validateGeneratedTitle("帮助用户", 80).reason, "generic");
t("placeholder rejected", policy.validateGeneratedTitle("[large js code omitted: 100 bytes]", 80).reason, "placeholder");
t("code fence rejected", policy.validateGeneratedTitle("```js\nx\n```", 80).reason, "code");
t("title prefix stripped", policy.validateGeneratedTitle("Title: 修复登录", 80).title, "修复登录");
t("wrapping stripped", policy.validateGeneratedTitle('"修复登录"', 80).title, "修复登录");
t("paragraph rejected", policy.validateGeneratedTitle("a".repeat(200), 80).reason, "too-long");
t("byte cap enforced", policy.byteLength(policy.validateGeneratedTitle("修复登录会话标题的超长文本内容测试缓存问题", 40).title) <= 40, true);
t("char cap on top of byte cap", Array.from(policy.validateGeneratedTitle("修复登录会话标题的超长文本内容测试缓存问题", 80, 8).title).length <= 8, true);
t("real title accepted", policy.validateGeneratedTitle("修复 TRANSLATION_SCHEMA_INVALID", 80).ok, true);

// --- affix / byte reservation
t("prefix affix", affix.buildTitleAffix({position:"prefix", format:"ymd", createdAt: Date.UTC(2026,8,13,4), timeZone:"UTC"}), "2026-09-13 ");
t("suffix affix", affix.buildTitleAffix({position:"suffix", format:"md", createdAt: Date.UTC(2026,8,13,4), timeZone:"UTC"}), " · 09-13");
t("no position -> no affix", affix.buildTitleAffix({position:undefined, format:"ymd", createdAt: Date.now()}), "");
t("bad createdAt -> no affix", affix.buildTitleAffix({position:"prefix", format:"ymd", createdAt: "nope"}), "");
t("bad zone -> no affix", affix.buildTitleAffix({position:"prefix", format:"ymd", createdAt: Date.now(), timeZone:"Not/AZone"}), "");
const suf = affix.buildTitleAffix({position:"suffix", format:"ymd", createdAt: Date.UTC(2026,8,13,4), timeZone:"UTC"});
const budget = affix.bodyBudgetBytes(80, suf);
const body = policy.truncateSemantically("修复登录会话标题的超长文本内容测试缓存问题以及更多内容", budget);
const composed = affix.composeTitle(body, suf, "suffix");
t("suffix survives 80-byte cap", policy.byteLength(composed) <= 80 && composed.endsWith(suf), true);

// --- settings validation
t("unknown key refused", (() => { try { settings.resolveTitleSettings({apiKey:"x"}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("half route refused", (() => { try { settings.resolveTitleSettings({provider:"p"}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("configured without pair refused", (() => { try { settings.resolveTitleSettings({mode:"configured"}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("empty object -> enabled true, mode undefined", [settings.resolveTitleSettings({}).enabled, settings.resolveTitleSettings({}).mode], [true, undefined]);
t("timeoutMs out of range refused", (() => { try { settings.resolveTitleSettings({timeoutMs: 500}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("maxTitleCharacters 121 refused", (() => { try { settings.resolveTitleSettings({maxTitleCharacters: 121}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("title shape stays out of row config", "maxTitleCharacters" in settings.applySettingsToTitleConfig(conf.resolveTitleConfig({}), settings.resolveTitleSettings({maxTitleCharacters: 10})), false);

// --- title content settings (style / language / exclusions)
const prompt = await import(B + "title-prompt.js");
t("style accepted", settings.resolveTitleSettings({titleStyle: "short-name"}).titleStyle, "short-name");
t("language accepted", settings.resolveTitleSettings({titleLanguage: "en"}).titleLanguage, "en");
t("absent style stays undefined", settings.resolveTitleSettings({enabled: true}).titleStyle, undefined);
t("unknown style refused", (() => { try { settings.resolveTitleSettings({titleStyle: "terse"}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("unknown language refused", (() => { try { settings.resolveTitleSettings({titleLanguage: "fr"}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("exclusions trim, drop blanks and dedupe", settings.resolveTitleSettings({titleExclusions: ["  客户甲 ", "", "客户甲", "Acme"]}).titleExclusions, ["客户甲", "Acme"]);
t("all-blank exclusions -> undefined", settings.resolveTitleSettings({titleExclusions: ["  ", ""]}).titleExclusions, undefined);
t("exclusions accepted as empty list", settings.resolveTitleSettings({titleExclusions: []}).titleExclusions, undefined);
t("non-list exclusions refused", (() => { try { settings.resolveTitleSettings({titleExclusions: "客户甲"}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("non-string exclusion refused", (() => { try { settings.resolveTitleSettings({titleExclusions: [7]}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("over-long exclusion refused", (() => { try { settings.resolveTitleSettings({titleExclusions: ["x".repeat(65)]}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("over-count exclusions refused", (() => { try { settings.resolveTitleSettings({titleExclusions: Array.from({length: 51}, (_, i) => `term${i}`)}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("multi-line exclusion refused", (() => { try { settings.resolveTitleSettings({titleExclusions: ["客户\n甲"]}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("content fields stay out of row config", ["titleStyle", "titleLanguage", "titleExclusions"].some((key) => key in settings.applySettingsToTitleConfig(conf.resolveTitleConfig({}), settings.resolveTitleSettings({titleStyle: "short-name", titleLanguage: "en", titleExclusions: ["x"]}))), false);

// --- exclusions in the policy: redact before sending, detect after
const exclusions = settings.resolveTitleSettings({titleExclusions: ["客户甲", "Acme"]}).titleExclusions;
const compiled = policy.compileTitleExclusions(exclusions);
const taskWithNames = "修复客户甲的订单导出错误，Acme 的 API 也要改";
const redacted = policy.prepareTitleInput(taskWithNames, cfg, exclusions);
t("CJK term removed before sending", redacted.text.includes("客户甲"), false);
t("latin term removed case-insensitively", /acme/iu.test(redacted.text), false);
t("redaction counted", redacted.excludedTerms, 2);
t("redacted text stays readable", redacted.text.startsWith("修复的订单导出错误"), true);
t("surrounding text is kept", redacted.text.includes("订单导出错误"), true);
t("byte counts still describe the original", redacted.rawBytes, policy.byteLength(taskWithNames));
const unconfigured = policy.prepareTitleInput(taskWithNames, cfg);
t("no exclusions -> text untouched", unconfigured.text.includes("客户甲"), true);
t("no exclusions -> zero count", unconfigured.excludedTerms, 0);
t("no exclusions -> identical to the old result", unconfigured.text, policy.prepareTitleInput(taskWithNames, cfg, undefined).text);
t("line structure survives redaction", policy.prepareTitleInput("第一行客户甲\n\n第二行 Acme", cfg, exclusions).text, "第一行\n\n第二行");
t("empty result is detectable", policy.prepareTitleInput("客户甲", cfg, exclusions).text.length, 0);
// Literal matching: a term is text, never a pattern.
t("a dot in a term is not a wildcard", policy.redactExcludedTerms("abc", policy.compileTitleExclusions(["a.c"])).removed, 0);
t("a dot in a term matches literally", policy.redactExcludedTerms("a.c", policy.compileTitleExclusions(["a.c"])).removed, 1);
t("an empty term is ignored", policy.compileTitleExclusions(["", "客户甲"]).length, 1);
t("non-array exclusions compile to nothing", policy.compileTitleExclusions(undefined).length, 0);
t("a term occurring twice is counted twice", policy.redactExcludedTerms("Acme 和 ACME", compiled).removed, 2);
// The post-check runs on the string that would be stored.
t("findExcludedTerm finds a CJK term", policy.findExcludedTerm("修复客户甲的订单", compiled), "客户甲");
t("findExcludedTerm ignores ASCII case", policy.findExcludedTerm("Fix ACME login", compiled), "Acme");
t("findExcludedTerm passes a clean title", policy.findExcludedTerm("修复订单导出", compiled), undefined);
t("findExcludedTerm with no list", policy.findExcludedTerm("客户甲", []), undefined);

// --- prompt: preferences REPLACE the defaults instead of stacking
const promptConfig = conf.resolveTitleConfig({});
const ACTION_RULE = "Prefer action + object";
const AUTO_LANGUAGE_RULE = "Use the language primarily used by the human message";
const defaultPrompt = prompt.buildSystemPrompt(promptConfig, {});
t("default prompt keeps action + object", defaultPrompt.includes(ACTION_RULE), true);
t("default prompt keeps the auto language rule", defaultPrompt.includes(AUTO_LANGUAGE_RULE), true);
t("explicit action-object == default", prompt.buildSystemPrompt(promptConfig, {style: "action-object"}), defaultPrompt);
const shortPrompt = prompt.buildSystemPrompt(promptConfig, {style: "short-name"});
t("short-name drops the action + object rule", shortPrompt.includes(ACTION_RULE), false);
t("short-name states its own rule", shortPrompt.includes("compact noun phrase"), true);
t("short-name adds its own anchor", shortPrompt.includes("登录接口超时"), true);
t("short-name with auto language anchors both languages", [shortPrompt.includes("登录接口超时"), shortPrompt.includes("Login endpoint timeout")], [true, true]);
t("short-name with a pinned language anchors only that one", prompt.buildSystemPrompt(promptConfig, {style: "short-name", language: "en"}).includes("登录接口超时"), false);
t("default prompt has no short-name anchor", defaultPrompt.includes("登录接口超时"), false);
const zhPrompt = prompt.buildSystemPrompt(promptConfig, {language: "zh"});
t("zh drops the auto language rule", zhPrompt.includes(AUTO_LANGUAGE_RULE), false);
t("zh names the language", zhPrompt.includes("Simplified Chinese"), true);
const enPrompt = prompt.buildSystemPrompt(promptConfig, {language: "en"});
t("en drops the auto language rule", enPrompt.includes(AUTO_LANGUAGE_RULE), false);
t("en keeps the identifier rule", enPrompt.includes("React, API"), true);
t("en anchors a Chinese message to an English title", enPrompt.includes("Fix login API timeout"), true);
t("auto keeps the mixed anchor set", defaultPrompt.includes("Fix Auth Session Refresh Race"), true);
// The terms themselves must never reach the model.
t("exclusion directive appears only when configured", [prompt.buildSystemPrompt(promptConfig, {hasExclusions: true}).includes("removed from the message on purpose"), defaultPrompt.includes("removed from the message on purpose")], [true, false]);
t("the terms are never sent to the model", prompt.buildSystemPrompt(promptConfig, {hasExclusions: true}).includes("客户甲"), false);
// The retry must follow the same preferences, or the setting looks intermittent.
t("default retry is byte-identical to the legacy text", prompt.RETRY_DIRECTIVE, "The previous attempt did not produce a usable title. Return exactly one concise task title in the language of the message: action plus object, no quotes, no Markdown, no explanation, no code.");
t("default retry equals buildRetryDirective({})", prompt.buildRetryDirective({}), prompt.RETRY_DIRECTIVE);
t("retry follows a pinned language", prompt.buildRetryDirective({language: "en"}).includes("in English"), true);
t("retry follows a pinned Chinese", prompt.buildRetryDirective({language: "zh"}).includes("in Simplified Chinese"), true);
t("retry follows the style", prompt.buildRetryDirective({style: "short-name"}).includes("compact noun phrase"), true);
t("retry forbids restoring removed names", prompt.buildRetryDirective({hasExclusions: true}).includes("Never restore"), true);
t("retry without exclusions omits that line", prompt.buildRetryDirective({}).includes("Never restore"), false);
t("first input carries no directive", prompt.buildUserInput("x", false, {language: "en"}).includes("in English"), false);
t("retry input carries the directive", prompt.buildUserInput("x", true, {language: "en"}).includes("in English"), true);

// --- title lock: the settings half, and the /retitle gate
const lockSettings = settings.resolveTitleSettings({lockedSessionIds: ["locked-1"]});
t("a locked session is recognized", settings.isSessionTitleLocked(lockSettings, "locked-1"), true);
t("another session is not locked", settings.isSessionTitleLocked(lockSettings, "other"), false);
t("nothing locked -> never locked", settings.isSessionTitleLocked(settings.resolveTitleSettings({}), "locked-1"), false);
t("an empty id is never locked", settings.isSessionTitleLocked(settings.resolveTitleSettings({lockedSessionIds: [""]}), ""), false);
t("an empty list is never locked", settings.isSessionTitleLocked(settings.resolveTitleSettings({lockedSessionIds: []}), "x"), false);
t("locks trim and dedupe", settings.resolveTitleSettings({lockedSessionIds: [" a ", "a", "b"]}).lockedSessionIds, ["a", "b"]);
t("all-blank locks -> undefined", settings.resolveTitleSettings({lockedSessionIds: [" ", ""]}).lockedSessionIds, undefined);
t("non-list locks refused", (() => { try { settings.resolveTitleSettings({lockedSessionIds: "s"}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("over-long lock id refused", (() => { try { settings.resolveTitleSettings({lockedSessionIds: ["x".repeat(65)]}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("over-count locks refused", (() => { try { settings.resolveTitleSettings({lockedSessionIds: Array.from({length: 501}, (_, i) => `s${i}`)}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("500 locks accepted", settings.resolveTitleSettings({lockedSessionIds: Array.from({length: 500}, (_, i) => `s${i}`)}).lockedSessionIds.length, 500);
t("locks stay out of row config", "lockedSessionIds" in settings.applySettingsToTitleConfig(conf.resolveTitleConfig({}), lockSettings), false);

// The `/retitle` handler is the single funnel for the two deliberate paths
// (the header button and the batch run), so the lock is enforced HERE first.
let refreshCalls = 0;
const fakeSessionTitle = {
  refresh: () => { refreshCalls += 1; return Promise.resolve({ title: "T", source: { kind: "provider" } }); },
  get: () => ({ title: "T", source: { kind: "provider" } })
};
const lockedTokens = tokens.createExplicitRegenerationTokens();
const lockedOutcome = await commands.createRetitleHandler(fakeSessionTitle, lockedTokens, () => lockSettings, undefined)({
  agent: { session: { id: "locked-1" } }, rawInput: "", signal: undefined
});
t("locked /retitle refuses", [lockedOutcome.kind, refreshCalls], ["error", 0]);
// The refusal must not leave a permission behind: a granted-but-unspent token
// would be inherited by the next automatic schedule and rewrite the locked title.
t("locked /retitle grants no token", lockedTokens.outstanding("locked-1"), 0);
t("locked /retitle names the lock", /locked/i.test(lockedOutcome.text), true);
const openTokens = tokens.createExplicitRegenerationTokens();
const openOutcome = await commands.createRetitleHandler(fakeSessionTitle, openTokens, () => settings.resolveTitleSettings({}), undefined)({
  agent: { session: { id: "open-1" } }, rawInput: "", signal: undefined
});
t("unlocked /retitle still regenerates", [openOutcome.kind, refreshCalls], ["success", 1]);
t("unlocked /retitle leaves no token behind", openTokens.outstanding("open-1"), 0);
const disabledOutcome = await commands.createRetitleHandler(fakeSessionTitle, tokens.createExplicitRegenerationTokens(), () => settings.resolveTitleSettings({ enabled: false }), undefined)({
  agent: { session: { id: "locked-1" } }, rawInput: "", signal: undefined
});
t("disabled is refused before the lock", [disabledOutcome.kind, refreshCalls], ["error", 1]);
t("a locked session is refused by the lock, not the switch", disabledOutcome.text === lockedOutcome.text, false);

// --- config validation
t("unknown config key throws", (() => { try { conf.resolveTitleConfig({nope:1}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("prepared > raw throws", (() => { try { conf.resolveTitleConfig({targetPreparedInputBytes: 99999}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("maxAttempts 4 throws", (() => { try { conf.resolveTitleConfig({maxAttempts:4}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("default timeout is 15000", conf.resolveTitleConfig({}).timeoutMs, 15000);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
