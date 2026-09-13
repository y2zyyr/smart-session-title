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
  messages: [{ text, seq: 7 }], route: { provider: "p", model: "m" }, signal: over.signal ?? new AbortController().signal });

// A. happy path
{
  const calls = [];
  const p = createSmartSessionTitleProvider(policyFor(), mkDeps([[{ blocks: [{ type: "text", text: "修复登录" }], finish: { kind: "stop" } }]], calls));
  const out = await p.generate(req("修复登录 bug"));
  t("A happy path title", out.title, "修复登录");
  t("A messageSeqs", out.messageSeqs, [7]);
  t("A model echo", out.model, { provider: "p", model: "m" });
  t("A one call", calls.length, 1);
  t("A purpose forwarded", [calls[0].purpose, calls[0].maxTokens, calls[0].sessionId], ["session-title", 96, "s1"]);
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
// G. protocol finishes are terminal (no retry)
for (const kind of ["max-tokens", "tool-calls"]) {
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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
