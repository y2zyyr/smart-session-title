/** Provider behavior regressions, using injected dependencies and no DSH runtime. */
const B = new URL("../lib/", import.meta.url).href;
const { createSmartSessionTitleProvider, TitleAbstention, TitleGenerationError } = await import(B + "provider.js");
const conf = await import(B + "config.js");
const settings = await import(B + "settings.js");

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` -> got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

class FakeAssembler {
  constructor() { this.chunks = []; }
  push(c) { this.chunks.push(c); }
  blocks() { return this.chunks.flatMap(c => c.blocks ?? []); }
  get finish() { return this.chunks.at(-1)?.finish ?? { kind: "stop" }; }
}
const mkDeps = (scripted, calls) => ({
  llm: { stream(options) {
      calls.push(options);
      const step = scripted[Math.min(calls.length - 1, scripted.length - 1)];
      return { async *[Symbol.asyncIterator]() { for (const c of step) yield c; } };
  } },
  logger: { info() {}, warn() {} },
  diagnostics: { record() {} },
  createUserMessage: (m) => m,
  BlockAssembler: FakeAssembler,
  readTitle: () => undefined,
  now: () => 0
});
const policyFor = (over = {}) => {
  const s = settings.resolveTitleSettings(over.settings ?? {});
  return () => ({ config: settings.applySettingsToTitleConfig(conf.resolveTitleConfig(over.config ?? {}), s), settings: s });
};
const req = (text, over = {}) => ({ session: { id: "s1", header: { createdAt: Date.UTC(2026, 8, 13, 4), ...(over.header ?? {}) } },
  messages: over.messages ?? [{ text, seq: 7 }], route: { provider: "p", model: "m" }, signal: over.signal ?? new AbortController().signal });

// A. happy path
{
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor(), mkDeps([[{ blocks: [{ type: "text", text: "修复登录" }], finish: { kind: "stop" } }]], calls));
  const out = await p.generate(req("修复登录 bug"));
  t("A happy path title", out.title, "修复登录");
  t("A messageSeqs", out.messageSeqs, [7]);
  t("A model echo", out.model, { provider: "p", model: "m" });
  t("A one call", calls.length, 1);
  t("A purpose forwarded", [calls[0].purpose, calls[0].maxTokens, calls[0].sessionId], ["session-title", 1024, undefined]);
  t("A signal present", typeof calls[0].signal?.aborted, "boolean");
  t("A provider passthrough is plugin-only (no HTTP client)", "fetch" in calls[0], false);
}
// B. retryable failure then success
{
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor(), mkDeps([
    [{ blocks: [], finish: { kind: "error", failure: {} } }],
    [{ blocks: [{ type: "text", text: "修复构建" }], finish: { kind: "stop" } }]], calls));
  const out = await p.generate(req("修复构建错误"));
  t("B retried once then succeeded", [out.title, calls.length], ["修复构建", 2]);
}
// B2. retryable exhaustion
{
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor(), mkDeps([[{ blocks: [], finish: { kind: "error", failure: {} } }]], calls));
  let err; try { await p.generate(req("修复构建错误")); } catch (e) { err = e; }
  t("B2 attempts == maxAttempts", calls.length, 2);
  t("B2 throws TitleGenerationError", err?.name, "TitleGenerationError");
  t("B2 message mentions attempts", /no usable title after 2 attempt/.test(err.message), true);
}
// B3. an adapter failure snapshot must name its taxonomy, not just "upstream"
// Live gap: `commandcode` had its display NAME saved where DSH expects the model
// ID, so the adapter failed locally in ~8ms with `UNKNOWN_MODEL` — yet the UI and
// the log both read only "model error: upstream failure", indistinguishable from
// a real provider outage, and the 1s/8ms timing difference was the only clue.
{
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor({ settings: { maxAttempts: 3 } }), mkDeps([
    [{ blocks: [], finish: { kind: "error", failure: { message: "provider body text", code: "UNKNOWN_MODEL", status: 404 } } }]], calls));
  let err; try { await p.generate(req("修复构建错误")); } catch (e) { err = e; }
  t("B3 code and status reach the message",
    err.message, "smart-session-title: model error: upstream failure (code=UNKNOWN_MODEL, status=404)");
  t("B3 provider text is never replayed", /provider body text/.test(err.message), false);
  t("B3 one call", calls.length, 1);
}
// B3b. a malformed snapshot (no code) still fails, with a bare message.
{
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor({ settings: { maxAttempts: 1 } }), mkDeps([
    [{ blocks: [], finish: { kind: "error", failure: {} } }]], calls));
  let err; try { await p.generate(req("修复构建错误")); } catch (e) { err = e; }
  t("B3b a code-less snapshot adds no parenthetical",
    err.message, "smart-session-title: no usable title after 1 attempt(s): smart-session-title: model error: upstream failure");
  // A missing snapshot is a structural violation: non-retryable, so it surfaces
  // on the first attempt instead of being wrapped by the exhaustion message.
  err = undefined;
  const absentCalls = [];
  const p2 = createSmartSessionTitleProvider(policyFor(), mkDeps([[{ blocks: [], finish: { kind: "error" } }]], absentCalls));
  try { await p2.generate(req("修复构建错误")); } catch (e) { err = e; }
  t("B3b absent snapshot stays non-retryable",
    [err.message, absentCalls.length],
    ["smart-session-title: model error: unknown model error", 1]);
}
// B4. Session extensions must never participate, even with one allowed attempt.
{
  const success = { blocks: [{ type: "text", text: "修复构建" }], finish: { kind: "stop" } };
  const failure = { finish: { kind: "error", failure: {
    code: "REQUEST_EXTENSION", message: "private extension details"
  } } };
  for (const maxAttempts of [1, 2, 3]) {
    const calls = [];
    const deps = mkDeps([[success]], calls);
    deps.llm.stream = async function* (options) {
      calls.push(options);
      // Model the shipped extension: session association activates delivery.
      yield Object.hasOwn(options, "sessionId") ? failure : success;
    };
    const provider = createSmartSessionTitleProvider(policyFor({ settings: { maxAttempts } }), deps);
    const result = await provider.generate(req("修复构建错误"));
    t(`B4 first attempt succeeds ${maxAttempts}`, [result.title, calls.length], ["修复构建", 1]);
    t(`B4 attribution retained ${maxAttempts}`, [result.messageSeqs, result.model], [[7], { provider: "p", model: "m" }]);
    t(`B4 route purpose budget ${maxAttempts}`, [calls[0].provider, calls[0].model, calls[0].purpose, calls[0].maxTokens], ["p", "m", "session-title", 1024]);
    const failedCalls = [];
    let error;
    try { await createSmartSessionTitleProvider(policyFor({ settings: { maxAttempts } }), mkDeps([[failure]], failedCalls)).generate(req("修复构建错误")); }
    catch (e) { error = e; }
    t(`B4 global extension terminal ${maxAttempts}`, [failedCalls.length, error?.kind], [1, "extension"]);
    t(`B4 no private details ${maxAttempts}`, error.message.includes("private extension details"), false);
  }
  const calls = [];
  await createSmartSessionTitleProvider(policyFor(), mkDeps([
    [{ finish: { kind: "error", failure: { code: "NETWORK" } } }], [success]
  ], calls)).generate(req("修复构建错误"));
  t("B4 network retries stay isolated", calls.map(c => Object.hasOwn(c, "sessionId")), [false, false]);
}
// C. cancellation mid-stream must not retry
{
  const calls = []; const ac = new AbortController();
  const deps = mkDeps([[{ blocks: [{ type: "text", text: "x" }], finish: { kind: "stop" } }]], calls);
  const base = deps.llm.stream;
  deps.llm.stream = (o) => { ac.abort(); return base(o); };
  const p = createSmartSessionTitleProvider(policyFor(), deps);
  let err; try { await p.generate(req("修复构建错误", { signal: ac.signal })); } catch (e) { err = e; }
  t("C cancelled surfaces", err?.kind, "cancelled");
  t("C never retried", calls.length, 1);
}
// C2. abort before start
{
  const calls = []; const ac = new AbortController(); ac.abort();
  const p = createSmartSessionTitleProvider(policyFor(), mkDeps([[{ blocks: [], finish: { kind: "stop" } }]], calls));
  let err; try { await p.generate(req("修复构建错误", { signal: ac.signal })); } catch (e) { err = e; }
  t("C2 pre-aborted does not call the model", calls.length, 0);
  t("C2 pre-aborted throws", err !== undefined, true);
}
// D. weak prompt abstains without I/O
{
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor(), mkDeps([[{ blocks: [], finish: { kind: "stop" } }]], calls));
  let err; try { await p.generate(req("你好")); } catch (e) { err = e; }
  t("D weak prompt abstains", err?.name, "TitleAbstention");
  t("D no model call", calls.length, 0);
  t("D reason", err.abstentionReason, "no-meaningful-prompt");
}
// E. manual title protection + explicit override
{
  const calls = []; const deps = mkDeps([[{ blocks: [{ type: "text", text: "修复登录" }], finish: { kind: "stop" } }]], calls);
  deps.readTitle = () => ({ source: { kind: "user" }, title: "我自己的标题" });
  const p = createSmartSessionTitleProvider(policyFor(), deps);
  let err; try { await p.generate(req("修复登录 bug")); } catch (e) { err = e; }
  t("E user title protected", [err?.abstentionReason, calls.length], ["manual-title-protected", 0]);

  const calls2 = []; const deps2 = mkDeps([[{ blocks: [{ type: "text", text: "修复登录" }], finish: { kind: "stop" } }]], calls2);
  deps2.readTitle = () => ({ source: { kind: "user" } });
  deps2.consumeExplicitRegeneration = () => true;
  const p2 = createSmartSessionTitleProvider(policyFor(), deps2);
  t("E explicit /retitle overrides", (await p2.generate(req("修复登录 bug"))).title, "修复登录");
}
// F. provider-titled session abstains
{
  const calls = []; const deps = mkDeps([[{ blocks: [], finish: { kind: "stop" } }]], calls);
  deps.readTitle = () => ({ source: { kind: "provider" } });
  const p = createSmartSessionTitleProvider(policyFor(), deps);
  let err; try { await p.generate(req("修复登录 bug")); } catch (e) { err = e; }
  t("F already-provider-titled abstains", [err?.abstentionReason, calls.length], ["already-provider-titled", 0]);
}
// G. output-budget finishes: no text is a budget problem (retried once), text is disobedience
{
  // G1: a reasoning model that spent the whole budget on thinking produced NO
  // text block — worth the single retry, then a normal failure.
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor(), mkDeps([[{ blocks: [], finish: { kind: "max-tokens" } }]], calls));
  let err; try { await p.generate(req("修复构建错误")); } catch (e) { err = e; }
  t("G1 max-tokens without text retries", calls.length, 2);
  t("G1 the retry keeps the configured budget", calls.map((c) => c.maxTokens), [1024, 1024]);
  t("G1 finally fails with the real reason", [err?.name, /maxOutputTokens/.test(err?.message ?? "")], ["TitleGenerationError", true]);
}
{
  // G2: text WAS produced, so the model ignored the one-line instruction. That is
  // a protocol violation and stays terminal — a paragraph is never salvaged.
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor(), mkDeps([[{ blocks: [{ type: "text", text: "这是一个很长的解释" }], finish: { kind: "max-tokens" } }]], calls));
  let err; try { await p.generate(req("修复构建错误")); } catch (e) { err = e; }
  t("G2 max-tokens with text is terminal protocol", [err?.kind, err?.message, calls.length], ["protocol", "smart-session-title: title output reached maxOutputTokens", 1]);
}
for (const kind of ["tool-calls"]) {
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor(), mkDeps([[{ blocks: [], finish: { kind } }]], calls));
  let err; try { await p.generate(req("修复构建错误")); } catch (e) { err = e; }
  t(`G ${kind} no retry`, [err?.kind, calls.length], ["protocol", 1]);
}
// H. child session / disabled switch never call the model
{
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor(), mkDeps([[{ blocks: [], finish: { kind: "stop" } }]], calls));
  let err; try { await p.generate(req("修复登录 bug", { header: { parentSession: "parent" } })); } catch (e) { err = e; }
  t("H child session abstains", [err?.abstentionReason, calls.length], ["child-session", 0]);

  const calls2 = [];
  const p2 = createSmartSessionTitleProvider(policyFor({ settings: { mode: "disabled" } }), mkDeps([[{ blocks: [], finish: { kind: "stop" } }]], calls2));
  let err2; try { await p2.generate(req("修复登录 bug")); } catch (e) { err2 = e; }
  t("H disabled mode abstains", [err2?.abstentionReason, calls2.length], ["disabled", 0]);
}
// I. suffix affix from session createdAt + 80-byte survival
{
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor({ settings: { titleDatePosition: "suffix", titleDateFormat: "ymd" } }),
    mkDeps([[{ blocks: [{ type: "text", text: "修复登录会话标题的超长文本内容测试缓存问题以及更多内容" }], finish: { kind: "stop" } }]], calls));
  const out = await p.generate(req("修复登录会话标题的超长文本内容测试缓存问题以及更多内容"));
  t("I suffix affix uses session date", out.title.endsWith("2026-09-13"), true);
  t("I stays within 80 bytes", new TextEncoder().encode(out.title).length <= 80, true);
}
// J. settings timeouts/attempts are hot-applied over row config
{
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor({ settings: { maxAttempts: 1 } }), mkDeps([[{ blocks: [], finish: { kind: "error", failure: {} } }]], calls));
  try { await p.generate(req("修复构建错误")); } catch {}
  t("J settings maxAttempts wins over row config", calls.length, 1);
}
// K. explicit /retitle tolerates a session of terse commands (只有「继续写」「发布」的会话)
const SHORT_CMDS = [{ text: "继续写", seq: 1 }, { text: "发布", seq: 2 }, { text: "继续写", seq: 3 }];
{
  // K1: the AUTOMATIC schedule keeps abstaining — the weak filter is unchanged there.
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor(), mkDeps([[{ blocks: [{ type: "text", text: "续写" }], finish: { kind: "stop" } }]], calls));
  let err; try { await p.generate(req("", { messages: SHORT_CMDS })); } catch (e) { err = e; }
  t("K1 automatic schedule on short commands abstains", [err?.name, err?.abstentionReason, calls.length], ["TitleAbstention", "no-meaningful-prompt", 0]);
}
{
  // K2: `/retitle` generates from the NEWEST short command instead of failing.
  const calls = [];
  const deps = mkDeps([[{ blocks: [{ type: "text", text: "续写章节" }], finish: { kind: "stop" } }]], calls);
  deps.consumeExplicitRegeneration = () => true;
  const p = createSmartSessionTitleProvider(policyFor(), deps);
  const out = await p.generate(req("", { messages: SHORT_CMDS }));
  const sent = calls[0]?.messages?.[0]?.content?.[0]?.text ?? "";
  t("K2 explicit /retitle generates", out.title, "续写章节");
  t("K2 newest short command is the source", out.messageSeqs, [3]);
  t("K2 model saw the newest text only", [sent.includes("继续写"), sent.includes("发布")], [true, false]);
  t("K2 exactly one model call", calls.length, 1);
}
{
  // K3: a session made of greetings/urls/code stays refused even for `/retitle`.
  const calls = [];
  const deps = mkDeps([[{ blocks: [{ type: "text", text: "问候" }], finish: { kind: "stop" } }]], calls);
  deps.consumeExplicitRegeneration = () => true;
  const p = createSmartSessionTitleProvider(policyFor(), deps);
  let err; try { await p.generate(req("", { messages: [{ text: "你好", seq: 1 }, { text: "看看这个", seq: 2 }] })); } catch (e) { err = e; }
  t("K3 noise-only session still abstains for /retitle", [err?.abstentionReason, calls.length], ["no-meaningful-prompt", 0]);
}
{
  // K4: the fallback is resolved before the explicit-only title gates, so
  // `/retitle` still overrides a hand-set title on a command-only session.
  const calls = [];
  const deps = mkDeps([[{ blocks: [{ type: "text", text: "续写章节" }], finish: { kind: "stop" } }]], calls);
  deps.consumeExplicitRegeneration = () => true;
  deps.readTitle = () => ({ source: { kind: "user" }, title: "我自己的标题" });
  const p = createSmartSessionTitleProvider(policyFor(), deps);
  const out = await p.generate(req("", { messages: SHORT_CMDS }));
  t("K4 fallback still overrides a manual title on /retitle", out.title, "续写章节");
}

// L. Exclusions must stay absent after compression, deletion and prompt assembly.
{
  const calls = [], logs = [];
  const deps = mkDeps([[{ blocks: [{ type: "text", text: "修复客户内部甲登录错误" }], finish: { kind: "stop" } }]], calls);
  deps.logger = { info: x => logs.push(x), warn: x => logs.push(x) };
  const p = createSmartSessionTitleProvider(policyFor({ settings: { titleExclusions: ["客户甲", "内部", "React"], titleLanguage: "zh" } }), deps);
  const out = await p.generate(req("修复客户内部甲 React 页面登录问题"));
  const sent = calls.map(x => JSON.stringify([x.system, x.messages])).join("\n");
  t("L reconstructed name, fixed system examples and output are filtered", [sent.includes("客户甲"), /react/i.test(sent), out.title.includes("客户甲"), calls.length], [false, false, false, 2]);
  t("L exclusions never enter logs", logs.some(x => /客户甲|内部|React/i.test(x)), false);
}
// L2. Compression's placeholders are checked too, not just the original input.
{
  const { prepareTitleInput, compileTitleExclusions, findExcludedTerm } = await import(B + "title-policy.js");
  const limits = conf.resolveTitleConfig({ maxRawInputBytes: 200, targetPreparedInputBytes: 160 });
  const result = prepareTitleInput("修复登录问题\n```js\n" + "const x = 1;\n".repeat(100) + "```\n补充配置", limits, ["code", "omitted"]);
  t("L2 compressed prompt contains no excluded placeholder words", findExcludedTerm(result.text, compileTitleExclusions(["code", "omitted"])), undefined);
}
// M. The final title, including its date, obeys both budgets and exclusions.
for (const [name, prefs, check] of [
  ["date excluded", { titleDatePosition: "suffix", titleExclusions: ["2026"] }, out => !out.title.includes("2026")],
  ["8 character cap omits oversized date", { titleDatePosition: "suffix", maxTitleCharacters: 8 }, out => Array.from(out.title).length <= 8 && !out.title.includes("2026")],
  ["20 character cap includes date", { titleDatePosition: "suffix", maxTitleCharacters: 20 }, out => Array.from(out.title).length <= 20 && out.title.endsWith("2026-09-13")],
  ["body/date boundary exclusion", { titleDatePosition: "suffix", titleExclusions: ["问题 · 2026"] }, out => !out.title.includes("2026")]
]) {
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor({ settings: prefs }), mkDeps([[{ blocks: [{ type: "text", text: "修复登录配置页面问题" }], finish: { kind: "stop" } }]], calls));
  const out = await p.generate(req("修复登录配置页面问题"));
  t("M " + name, check(out), true);
  t("M " + name + " byte cap", Buffer.byteLength(out.title) <= 80, true);
}
// N. Retry only transient failures, wait within a bounded window, and cancel waits.
for (const [code, status, expected] of [["AUTH", 401, 1], ["INVALID_CREDENTIAL", 403, 1], ["NO_ADAPTER", undefined, 1], ["QUOTA", 429, 1], ["BAD_REQUEST", 400, 1], ["RATE_LIMIT", 429, 2], ["UPSTREAM", 503, 2]]) {
  const calls = [], delays = [];
  const deps = mkDeps([[{ blocks: [], finish: { kind: "error", failure: { code, status, providerRetryAfterMs: 600, message: "private provider text" } } }], [{ blocks: [{ type: "text", text: "修复构建问题" }], finish: { kind: "stop" } }]], calls);
  deps.waitForRetry = async (ms) => { delays.push(ms); };
  const p = createSmartSessionTitleProvider(policyFor({ settings: { maxAttempts: 3 } }), deps);
  try { await p.generate(req("修复构建问题")); } catch {}
  t("N " + code + " call count", calls.length, expected);
  t("N " + code + " delay", delays, expected === 2 ? [600] : []);
}
{
  const calls = [], delays = [];
  const deps = mkDeps([[{ blocks: [], finish: { kind: "error", failure: { code: "RATE_LIMIT", status: 429, providerRetryAfterMs: 30000 } } }]], calls);
  deps.waitForRetry = async ms => delays.push(ms);
  try { await createSmartSessionTitleProvider(policyFor(), deps).generate(req("修复构建问题")); } catch {}
  t("N long Retry-After is terminal, never shortened", [calls.length, delays.length], [1, 0]);
}
{
  const abort = new AbortController(), calls = [];
  let waiting;
  const started = new Promise(resolve => { waiting = resolve; });
  const deps = mkDeps([[{ blocks: [], finish: { kind: "error", failure: { code: "RATE_LIMIT", status: 429, providerRetryAfterMs: 1000 } } }]], calls);
  deps.waitForRetry = (ms, signal) => new Promise((resolve, reject) => { waiting(); signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
  const result = createSmartSessionTitleProvider(policyFor(), deps).generate(req("修复构建问题", { signal: abort.signal })).catch(x => x);
  await started; abort.abort(); await result;
  t("N stopping during backoff never starts another call", calls.length, 1);
}
// O. A live lock aborts the stream; even without notifications the final gate holds.
{
  const calls = []; let listener, unlocked = true, unsubscribed = 0, streamStarted;
  const started = new Promise(resolve => { streamStarted = resolve; });
  const deps = mkDeps([], calls);
  deps.subscribeSettings = callback => { listener = callback; return () => { unsubscribed++; }; };
  deps.llm.stream = options => ({ async *[Symbol.asyncIterator]() {
    calls.push(options); streamStarted();
    await new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  } });
  const config = conf.resolveTitleConfig();
  const getPolicy = () => ({ config, settings: settings.resolveTitleSettings(unlocked ? {} : { lockedSessionIds: ["s1"] }) });
  const result = createSmartSessionTitleProvider(getPolicy, deps).generate(req("修复登录错误")).catch(x => x);
  await started; unlocked = false; listener();
  const error = await result;
  t("O locking during a stream immediately aborts", [calls[0].signal.aborted, error.abstentionReason, unsubscribed, calls.length], [true, "locked", 1, 1]);
}
{
  const calls = []; let locked = false;
  const deps = mkDeps([], calls);
  deps.llm.stream = options => ({ async *[Symbol.asyncIterator]() { calls.push(options); locked = true; yield { blocks: [{ type: "text", text: "修复登录错误" }], finish: { kind: "stop" } }; } });
  const getPolicy = () => ({ config: conf.resolveTitleConfig(), settings: settings.resolveTitleSettings(locked ? { lockedSessionIds: ["s1"] } : {}) });
  const error = await createSmartSessionTitleProvider(getPolicy, deps).generate(req("修复登录错误")).catch(x => x);
  t("O final live recheck refuses a result even without notifications", error.abstentionReason, "locked");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
