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

// --- config validation
t("unknown config key throws", (() => { try { conf.resolveTitleConfig({nope:1}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("prepared > raw throws", (() => { try { conf.resolveTitleConfig({targetPreparedInputBytes: 99999}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("maxAttempts 4 throws", (() => { try { conf.resolveTitleConfig({maxAttempts:4}); return "no-throw"; } catch { return "throw"; } })(), "throw");
t("default timeout is 15000", conf.resolveTitleConfig({}).timeoutMs, 15000);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
