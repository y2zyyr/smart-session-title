/** Read-only preview, guarded application, schema bounds and real host wiring. */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createTitlePreviewController, PREVIEW_TTL_MS, PREVIEW_CACHE_LIMIT } from "../lib/title-preview.js";
import { resolveTitleSettings } from "../lib/settings.js";
import { resolveTitleConfig } from "../lib/config.js";
import { selectOrdinaryTitleMessages } from "../lib/commands.js";
import { createTitleSettingsFields } from "../lib/settings-schema.js";

let checks = 0;
const checked = name => { checks++; console.log("✓ " + name); };
const task = (seq = 1, text = "修复登录页面错误") => ({ type: "user/message", seq, data: { source: { kind: "user" }, content: [{ type: "text", text }] } });
const goal = (seq, args) => ({ type: "command/run", seq, data: { name: "goal", args } });
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(events = [task()]) {
  let settings = {}, clock = 100, serial = 0, generated = 0;
  let title = { title: "原来的人工标题", source: { kind: "user" } };
  let route = { provider: "p", model: "m" };
  const writes = [];
  const session = { id: "s1", header: {}, snapshotEvents: () => events, requestHeader: () => ({ config: route }) };
  const deps = {
    getPolicy: () => ({ config: resolveTitleConfig(), settings: resolveTitleSettings(settings) }),
    generate: async request => { generated++; assert(request.messages.length > 0); return { title: "修复登录错误" }; },
    sessionTitle: { get: () => title, rename: (s, value) => {
      writes.push(value); events.push({ type: "session/title", seq: events.length + 10 });
      return title = { title: value, source: { kind: "user" } };
    } },
    now: () => clock,
    makeId: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`
  };
  const controller = createTitlePreviewController(deps);
  return { controller, deps, session, events, writes, get generated() { return generated; },
    setSettings: value => { settings = value; }, setClock: value => { clock = value; },
    setRoute: value => { route = value; }, setTitle: value => { title = value; } };
}
{
  const f = fixture(); const p = await f.controller.preview(f.session);
  assert.equal(p.previousTitle, "原来的人工标题"); assert.equal(f.writes.length, 0);
  assert.equal(f.controller.apply(f.session, p.previewId).source.kind, "user");
  assert.equal(f.generated, 1); assert.deepEqual(f.writes, ["修复登录错误"]);
  assert.throws(() => f.controller.apply(f.session, p.previewId), /unavailable/);
  checked("preview makes no title writes; explicit application is one-shot and makes no model call");
}
for (const [label, mutate] of [
  ["new user input", f => f.events.push(task(2, "继续修复权限问题"))],
  ["Goal edit", f => f.events.push(goal(2, "edit 调整权限验证"))],
  ["manual rename", f => f.setTitle({ title: "用户刚改的标题", source: { kind: "user" } })],
  ["session route", f => f.setRoute({ provider: "p", model: "new" })],
  ["title preference", f => f.setSettings({ titleStyle: "short-name" })],
  ["exclusions", f => f.setSettings({ titleExclusions: ["登录"] })]
]) {
  const f = fixture(); const p = await f.controller.preview(f.session); mutate(f);
  assert.throws(() => f.controller.apply(f.session, p.previewId), /changed/);
  assert.equal(f.writes.length, 0);
  checked("stale preview rejected after " + label);
}
{
  const f = fixture(); const p = await f.controller.preview(f.session);
  f.setSettings({ lockedSessionIds: ["other"], showSessionId: false });
  assert.equal(f.controller.apply(f.session, p.previewId).title, p.title);
  checked("unrelated locks and SessionId display do not invalidate preview");
}
for (const settings of [{ lockedSessionIds: ["s1"] }, { enabled: false }, { mode: "disabled" }]) {
  const f = fixture(); const p = await f.controller.preview(f.session); f.setSettings(settings);
  assert.throws(() => f.controller.apply(f.session, p.previewId), /locked|disabled/);
  await assert.rejects(f.controller.preview(f.session), /locked|disabled/);
  assert.equal(f.writes.length, 0);
}
checked("both preview and application respect current lock and AI switch");
{
  const f = fixture(); const p = await f.controller.preview(f.session);
  assert.throws(() => f.controller.apply({ ...f.session, id: "other" }, p.previewId), /unavailable/);
  assert.equal(f.controller.apply(f.session, p.previewId).title, p.title);
  const expired = await f.controller.preview(f.session); f.setClock(100 + PREVIEW_TTL_MS);
  assert.throws(() => f.controller.apply(f.session, expired.previewId), /expired/);
  checked("preview tokens are session-bound and expire after one hour");
}
{
  const f = fixture(); const first = await f.controller.preview(f.session);
  for (let i = 0; i < PREVIEW_CACHE_LIMIT; i++) await f.controller.preview(f.session);
  assert.throws(() => f.controller.apply(f.session, first.previewId), /unavailable/);
  checked("preview cache evicts old entries at its 500-entry bound");
}
for (const mode of ["new-input", "manual-rename", "settings", "cancel", "session-disposed", "plugin-unload"]) {
  const f = fixture(), gate = defer(), began = defer();
  f.deps.generate = async request => { began.resolve(request); await gate.promise; request.signal.throwIfAborted(); return { title: "修复登录错误" }; };
  const abort = new AbortController();
  const result = f.controller.preview(f.session, abort.signal); const request = await began.promise;
  if (mode === "new-input") f.events.push(task(2));
  if (mode === "manual-rename") f.setTitle({ title: "手工标题", source: { kind: "user" } });
  if (mode === "settings") f.setSettings({ titleLanguage: "en" });
  if (mode === "cancel") abort.abort();
  if (mode === "session-disposed") f.controller.cancelSession(f.session.id);
  if (mode === "plugin-unload") f.controller.dispose();
  if (["cancel", "session-disposed", "plugin-unload"].includes(mode)) assert(request.signal.aborted);
  gate.resolve(); await assert.rejects(result); assert.equal(f.writes.length, 0);
  checked("in-flight preview rejected on " + mode);
}
{
  const f = fixture([goal(1, "修复登录配置问题")]);
  const p = await f.controller.preview(f.session); assert.equal(p.title, "修复登录错误");
  const noInput = fixture([]); await assert.rejects(noInput.controller.preview(noInput.session), /input/);
  const child = fixture(); child.session.header.parentSession = "parent";
  await assert.rejects(child.controller.preview(child.session), /Child/);
  assert.equal(child.generated, 0);
  checked("Goal-only preview works; empty and child sessions never call the model");
}

// An immutable schema double detects forgotten .volatile() return values; the
// deployed schemastery is exercised separately without adding an npm dependency.
function node(type, extra = {}) {
  const methods = {};
  for (const name of ["min", "max", "step", "pattern", "default", "volatile"]) methods[name] = function (value) {
    return node(type, { ...extra, [name]: name === "volatile" ? true : value });
  };
  return { type, meta: extra, ...methods };
}
const schema = {
  string: () => node("string"), number: () => node("number"), boolean: () => node("boolean"),
  union: values => node("union", { values }), array: inner => node("array", { inner }), object: dict => node("object", { dict })
};
for (const volatile of [false, true]) {
  const fields = createTitleSettingsFields(schema, volatile);
  assert.equal(fields.lockedSessionIds.meta.max, 500); assert.equal(fields.titleExclusions.meta.max, 50);
  const pattern = fields.lockedSessionIds.meta.inner.meta.pattern;
  assert(pattern.test("😀".repeat(64))); assert(!pattern.test("😀".repeat(65))); assert(!pattern.test("line\nbreak"));
  assert(Object.values(fields).every(x => !!x.meta.volatile === volatile));
  assert.equal(fields.maxTitleCharacters.meta.min, 8); assert.equal(fields.timeoutMs.meta.max, 120000);
}
checked("Core 0.1 and 0.2 share array, Unicode, numeric and volatile schema constraints");

// Load the actual host plugin, replacing only the two DSH runtime imports. No
// installed files, production config or sessions are accessed by these tests.
const assemblerSource = `export class BlockAssembler { chunks=[]; push(x){this.chunks.push(x);} blocks(){return this.chunks.flatMap(x=>x.blocks??[]);} get finish(){return this.chunks.at(-1)?.finish??{kind:'stop'};} }; export const createUserMessage=x=>x;`;
const schemaSource = `const node=${node.toString()}; const schema={string:()=>node('string'),number:()=>node('number'),boolean:()=>node('boolean'),union:x=>node('union',{values:x}),array:x=>node('array',{inner:x}),object:x=>node('object',{dict:x})}; export default schema;`;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@deepseek-ai/dsh-llm" || specifier === "@deepseek-ai/schemastery") return {
    shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(specifier.endsWith("schemastery") ? schemaSource : assemblerSource)
  };
  return next(specifier, context);
} });
const { apply } = await import("../lib/index.js");
let provider, current = { title: "旧目标标题", source: { kind: "user" } }, preferences = {}, watch;
let nextStream, calls = 0, refreshes = 0;
const commands = new Map(), disposers = [], events = [goal(1, "修复登录配置问题")];
const session = { id: "goal-session", header: { createdAt: Date.UTC(2026, 8, 13) }, snapshotEvents: () => events,
  requestHeader: () => ({ config: { provider: "p", model: "m" } }) };
const ctx = {
  settings: { register: () => ({ get: () => preferences, watch: fn => { watch = fn; return () => {}; } }) },
  sessionTitle: { register: p => { provider = p; return () => {}; }, get: () => current,
    refresh: async () => { refreshes++; return current; }, rename: (s, title) => {
      events.push({ type: "session/title", seq: events.length + 10 }); return current = { title, source: { kind: "user" } };
    } },
  llm: { stream(options) { calls++; return { async *[Symbol.asyncIterator]() {
    const text = nextStream ? await nextStream(options) : calls === 1 ? "修复登录配置" : "调整权限验证";
    yield { blocks: [{ type: "text", text }], finish: { kind: "stop" } };
  } }; } },
  effect: fn => { const cleanup = fn(); if (typeof cleanup === "function") disposers.push(cleanup); },
  on: () => {}, inject: (deps, fn) => fn(ctx),
  commands: { register: definition => { commands.set(definition.name, definition.handler); return () => {}; } }
};
apply(ctx, {});
const invoke = (name, rawInput = "", signal) => commands.get(name)({ rawInput, agent: { session }, signal });
assert.equal((await invoke("retitle")).kind, "success");
events.push(goal(20, "edit 调整权限验证流程"));
assert.equal((await invoke("retitle")).kind, "success");
assert.equal(current.title, "调整权限验证"); assert.equal(refreshes, 0); assert.equal(calls, 2);
checked("real /retitle wiring regenerates an edited Goal even when a title already exists");
{
  const before = current, candidate = JSON.parse((await invoke("title-preview")).text);
  assert.equal(current, before); const count = calls;
  assert.equal((await invoke("title-apply", candidate.previewId)).kind, "success"); assert.equal(calls, count);
  assert.equal((await invoke("title-apply", candidate.previewId)).kind, "error");
  checked("real preview commands remain read-only until confirmed application");
}
{
  const gate = defer(), began = defer();
  nextStream = async options => { began.resolve(options); await gate.promise; return "已过期的目标"; };
  const result = invoke("retitle"); await began.promise;
  ctx.sessionTitle.rename(session, "刚刚人工修改的标题"); gate.resolve();
  assert.equal((await result).kind, "error"); assert.equal(current.title, "刚刚人工修改的标题");
  checked("Goal recovery refuses stale model output after manual renaming");
}
{
  const first = defer(), began = defer(); let streamNo = 0;
  nextStream = async options => {
    if (++streamNo === 1) { began.resolve(options); await first.promise; return "旧的生成结果"; }
    return "新的生成结果";
  };
  const old = invoke("retitle"); const options = await began.promise;
  const latest = await invoke("retitle"); assert(options.signal.aborted); first.resolve();
  assert.equal(latest.kind, "success"); assert.equal((await old).kind, "error"); assert.equal(current.title, "新的生成结果");
  checked("a newer Goal retitle supersedes the previous generation");
}
{
  const began = defer();
  nextStream = options => { began.resolve(options); return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })); };
  const result = invoke("retitle"); const options = await began.promise;
  preferences = { lockedSessionIds: [session.id] }; watch();
  assert(options.signal.aborted); assert.equal((await result).kind, "error");
  checked("legacy host settings notifications abort a Goal stream when locked");
}
// Core 0.2 emits the verified settings/document-updated event instead of watch.
{
  const callbacks = new Map(), commands02 = new Map(), disposers02 = [];
  let locks = [], options;
  const began = defer();
  const ctx02 = {
    ...ctx, settings: { configure: () => () => {} },
    commands: { register: definition => { commands02.set(definition.name, definition.handler); return () => {}; } },
    effect: fn => { const dispose = fn(); if (typeof dispose === "function") disposers02.push(dispose); },
    inject(deps, fn) { return fn(this); }, on: (event, fn) => callbacks.set(event, fn),
    llm: { stream(value) { options = value; began.resolve(); return { async *[Symbol.asyncIterator]() {
      await new Promise((resolve, reject) => value.signal.addEventListener("abort", () => reject(value.signal.reason), { once: true }));
    } }; } }
  };
  apply(ctx02, { enabled: { get: () => true }, lockedSessionIds: { get: () => locks } });
  const result = commands02.get("retitle")({ rawInput: "", agent: { session } }); await began.promise;
  locks = [session.id]; callbacks.get("settings/document-updated")("smart-session-title", 2);
  assert(options.signal.aborted); assert.equal((await result).kind, "error");
  for (const dispose of disposers02.reverse()) dispose();
  checked("Core 0.2 settings events abort an in-flight stream on locking");
}
assert.equal(selectOrdinaryTitleMessages({ snapshotEvents: () => [task(-1)] }).length, 0);
for (const dispose of disposers.reverse()) dispose(); hooks.deregister();
console.log(`\n✅ ${checks} preview/schema/host integration checks passed`);
