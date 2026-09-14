/**
 * Verify smart-session-title client.js behaviour:
 *  1. zh and en dicts have identical key sets (guarded here for the hand-written client).
 *  2. translatorOf echoes the key when `t` is absent.
 *  3. SettingsSection renders from the dictionaries in zh and en.
 *  4. slot `label` thunks resolve through ctx.locale.bind.
 *  5. configured-mode provider/model selectors are built from the DSH
 *     provider directory + the settings mirror (not free text).
 *  6. interpretOutcome / createRegenerationController / isAiDisabledSnapshot
 *     are unchanged.
 *  7. PLUGIN_VERSION equals package.json's `version`, and the settings footer
 *     renders it in both languages (also in the unavailable state).
 *  8. Title shape: the byte/character caps, the date affix (prefix or suffix)
 *     and the byte reservation, both as pure policy and through a real
 *     `generate()` call; plus the client controls that write them.
 *
 * Sections 1–7 and the shape controls run against the real client.js through a
 * stub `window.__ModuleLoader__`, with a minimal React that supports hook state
 * and (a)waitable effects. Sections 8's host assertions import the real
 * `lib/*.js` modules directly: they are plain ESM with no DSH imports.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

/** Repository root (this script lives in <root>/validation/). */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Node doesn't have window — provide a minimal global, plus the browser storage
// the batch fallback preference lives in (client.js treats its absence as "off").
globalThis.window = globalThis.window || {};
globalThis.window.localStorage = {
  store: new Map(),
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  },
  setItem(key, value) {
    this.store.set(key, String(value));
  },
  removeItem(key) {
    this.store.delete(key);
  }
};

// ---- stub module loader --------------------------------------------------
let capturedExport;
let capturedApply;
const slotRegistrations = [];

window.__ModuleLoader__ = {
  load({ id, factory }) {
    const fakeRequire = (name) => {
      if (name === "react") return fakeReact;
      if (name === "react/jsx-runtime") return fakeJsxRuntime;
      if (name === "@deepseek-ai/dsh-client-ui-primitives") return fakePrimitives;
      throw new Error(`unexpected require: ${name}`);
    };
    const mod = factory(fakeRequire);
    capturedExport = mod;
    capturedApply = mod.apply;
  }
};

// ---- fake React ----------------------------------------------------------
/**
 * Hook state is kept per COMPONENT FUNCTION, the way React keeps it per fiber.
 *
 * One shared array is not faithful: this fake never runs effect cleanups, so a
 * component's subscription stays live after the test moves on, and its `setState`
 * would then write into whatever component mounts NEXT at the same hook index.
 * That produced state no real React can produce — an earlier component's settings
 * snapshot turning up in a later component's unrelated state slot — so components
 * are isolated here instead.
 */
const componentState = new Map();
const componentRefs = new Map();
let state = [];
// Refs, like state, must survive re-renders (real React keeps them by hook
// order) — otherwise a component that guards on a previous value can never see
// the transition it guards on.
let refs = [];
let cursor = 0;
let pendingEffects = [];

const fakeReact = {
  useState(init) {
    const i = cursor++;
    // Capture THIS render's slot array, not the module-level binding: the binding
    // is re-pointed by every `renderPass`, so a setter that read it later would
    // write into whichever component happens to be rendering — or, for a stale
    // subscription (this fake never runs effect cleanups), into a LATER component's
    // same-numbered slot. A real React setter is bound to its own fiber.
    const slot = state;
    if (slot[i] === undefined) {
      slot[i] = typeof init === "function" ? init() : init;
    }
    return [slot[i], (v) => {
      slot[i] = typeof v === "function" ? v(slot[i]) : v;
    }];
  },
  useEffect(fn) {
    pendingEffects.push(fn);
  },
  useRef(init) {
    const i = cursor++;
    const slot = refs;
    if (slot[i] === undefined) slot[i] = { current: init };
    return slot[i];
  },
  useCallback(fn) {
    return fn;
  },
  createElement(type, props, ...children) {
    return { type, props: props || {}, children };
  },
  Fragment: Symbol("Fragment")
};

const fakeJsxRuntime = {
  jsx(type, config) {
    const { children, ...props } = config || {};
    return { type, props, children };
  },
  jsxs(type, config) {
    const { children, ...props } = config || {};
    return { type, props, children };
  }
};

const fakePrimitives = {};

// ---- render helpers ------------------------------------------------------
/** One synchronous render pass: hooks read from this component's own state. */
function renderPass(component, props) {
  cursor = 0;
  pendingEffects = [];
  if (!componentState.has(component)) componentState.set(component, []);
  if (!componentRefs.has(component)) componentRefs.set(component, []);
  state = componentState.get(component);
  refs = componentRefs.get(component);
  return component(props);
}

/**
 * Render a component and let its effects settle: run every queued effect,
 * await any promise it starts, and re-render while state actually changed.
 * Models the "mount → effect → setState → re-render" cycle of a real React.
 *
 * A fresh mount starts from EMPTY hook state for that component only; another
 * component's state is untouched (see `componentState`).
 */
async function settle(component, props) {
  state = [];
  refs = [];
  componentState.set(component, state);
  componentRefs.set(component, refs);
  const tree = renderPass(component, props);
  return flush(component, props, tree);
}

/**
 * Same as `settle`, but keeps the existing hook state, so a test can simulate a
 * click and then let the resulting render/effect cycle run.
 */
async function flush(component, props, tree) {
  for (let pass = 0; pass < 16; pass += 1) {
    // Re-render first: a click in the test changed state without queueing an
    // effect, so the new state is only visible through a render pass.
    tree = renderPass(component, props);
    const effects = pendingEffects;
    pendingEffects = [];
    const before = JSON.stringify(state);
    for (const effect of effects) {
      const result = effect();
      if (result && typeof result.then === "function") await result;
      // Flush the whole microtask queue: effect-started promise chains
      // (ensure → directory → setState) are several ticks deep.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (JSON.stringify(state) === before) break;
  }
  return tree;
}

/** Collect every text node in a rendered tree. */
function renderTree(node) {
  const texts = [];
  function walk(n) {
    if (typeof n === "string") { texts.push(n); return; }
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.props?.children) walk(n.props.children);
    if (n.children) walk(n.children);
  }
  walk(node);
  return texts;
}

/** Collect every `<select>` element with its `<option>` values. */
function collectSelects(node) {
  const found = [];
  function optionsOf(container) {
    const options = [];
    function walkOptions(c) {
      if (!c || typeof c !== "object") return;
      if (Array.isArray(c)) { c.forEach(walkOptions); return; }
      if (c.type === "option") options.push({ value: c.props?.value, text: renderTree(c).join("") });
      if (c.props?.children) walkOptions(c.props.children);
      if (c.children) walkOptions(c.children);
    }
    walkOptions(container);
    return options;
  }
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === "select") {
      found.push({ options: optionsOf(n.props?.children ?? n.children) });
      return;
    }
    if (n.props?.children) walk(n.props.children);
    if (n.children) walk(n.children);
  }
  walk(node);
  return found;
}

/** Collect every `<button>` with its flattened label text. */
function collectButtons(node) {
  const found = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === "button") {
      found.push({ text: renderTree(n).join(""), props: n.props || {} });
      return;
    }
    if (n.props?.children) walk(n.props.children);
    if (n.children) walk(n.children);
  }
  walk(node);
  return found;
}

/** Collect every `<input>` (checkbox/radio/text) in a rendered tree. */
function collectInputs(node, type) {
  const found = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === "input" && (type === undefined || n.props?.type === type)) {
      found.push({ props: n.props || {} });
      return;
    }
    if (n.props?.children) walk(n.props.children);
    if (n.children) walk(n.children);
  }
  walk(node);
  return found;
}

/** Option values of ONE `<select>` element (the collector above drops props). */
function optionValues(selectNode) {
  const values = [];
  function walk(c) {
    if (!c || typeof c !== "object") return;
    if (Array.isArray(c)) { c.forEach(walk); return; }
    if (c.type === "option") values.push(c.props?.value);
    if (c.props?.children) walk(c.props.children);
    if (c.children) walk(c.children);
  }
  walk(selectNode.props?.children ?? selectNode.children);
  return values;
}

/** The first element matching `predicate`, so tests can fire its handlers. */
function findFirstElement(node, predicate) {
  let found;
  function walk(n) {
    if (found !== undefined || !n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type !== undefined && predicate(n)) { found = n; return; }
    if (n.props?.children) walk(n.props.children);
    if (n.children) walk(n.children);
  }
  walk(node);
  return found;
}

// ---- fake DSH services ---------------------------------------------------
/** Every `mutate(ops)` batch the settings section performed. */
const scopeMutations = [];
/** Every field the plugin explicitly unset. */
const scopeUnsets = [];
/** Every `set(field, value)` the section or the fallback performed, in order. */
const scopeSets = [];
let fakeScopeSnapshot = {
  status: "ready",
  value: { enabled: true },
  user: {},
  writable: true
};

/** Settings mirror shaped like the real one, covering both document layouts. */
const fakeMirror = {
  view: {
    namespaces: [
      {
        ns: "llm-pi-ai",
        value: {
          providers: {
            scnet: { models: [{ name: "DeepSeek-V4-Flash" }, { name: "DeepSeek-V4" }] },
            "opencode-go": { models: [{ name: "GPT-5.1-Codex" }] }
          }
        }
      },
      { ns: "llm-deepseek", value: { models: [{ name: "DeepSeek-V3.1" }] } },
      { ns: "smart-session-title", value: { mode: "configured" } }
    ]
  }
};

const fakeRemote = {
  commands: { execute: () => Promise.resolve() },
  llm: {
    listProviders: () => Promise.resolve({
      ok: true,
      value: [
        { id: "scnet", name: "SCNet" },
        { id: "opencode-go", name: "OpenCode Go" },
        { id: "deepseek", name: "DeepSeek" }
      ]
    }),
    listConfigurableProviders: () => Promise.resolve({
      ok: true,
      value: [
        { provider: "scnet", displayName: "SCNet", settingsNs: "llm-pi-ai", settingsPath: ["providers", "scnet"] },
        { provider: "opencode-go", displayName: "OpenCode Go", settingsNs: "llm-pi-ai", settingsPath: ["providers", "opencode-go"] },
        { provider: "deepseek", displayName: "DeepSeek", settingsNs: "llm-deepseek", settingsPath: [] }
      ]
    })
  }
};

let registeredLocale;
/** Active UI language of the fake locale service; the settings shell re-reads
 *  label thunks on every locale revision, so tests must be able to switch it. */
let fakeLanguage = "zh";

const fakeCtx = {
  locale: {
    register(ns, dict) { registeredLocale = dict; return () => {}; },
    bind(ns) {
      // Mirror the real locale face: bound translator resolving through the
      // registered dictionaries for the *currently active* language.
      return (key) => (registeredLocale?.[fakeLanguage]?.[key] ?? key);
    }
  },
  remote: fakeRemote,
  slots: {
    inject(name, factory) {
      // apply() registers inside the inject callback — run it and capture meta.
      factory();
    },
    register(meta) {
      slotRegistrations.push({
        name: meta.name,
        id: meta.id,
        label: meta.label,
        locale: meta.locale,
        // The DSH shell calls this to build the component props; keeping it lets
        // tests exercise the real plugin-scope services it hands out.
        meta
      });
      return () => {};
    }
  },
  settingsScope: {
    bind() {
      // A real scope pushes a new revision after every write; the component only
      // sees its own writes again through `subscribe`.
      const listeners = new Set();
      const notify = () => {
        for (const listener of listeners) listener();
      };
      return {
        getSnapshot: () => fakeScopeSnapshot,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        set(field, value) {
          scopeSets.push([field, value]);
          fakeScopeSnapshot = {
            ...fakeScopeSnapshot,
            value: { ...fakeScopeSnapshot.value, [field]: value },
            user: { ...fakeScopeSnapshot.user, [field]: value }
          };
          notify();
        },
        unset(field) {
          scopeUnsets.push(field);
        },
        mutate(ops, expectedRevision) {
          if (expectedRevision !== undefined && expectedRevision !== fakeScopeSnapshot.revision) return;
          // Record every batch of ops, and apply `set`s the way the real scope
          // does (value + raw user section), so tests can assert both the write
          // itself and the state the component reads back afterwards.
          scopeMutations.push(ops);
          for (const op of ops) {
            const field = op.path[0];
            if (op.op === "unset") {
              scopeUnsets.push(field);
              const value = { ...fakeScopeSnapshot.value };
              const user = { ...fakeScopeSnapshot.user };
              delete value[field]; delete user[field];
              fakeScopeSnapshot = { ...fakeScopeSnapshot, value, user };
              continue;
            }
            // The real host re-resolves the section, so the value the component
            // reads back is a FRESH array, never the one it wrote. Copying here
            // keeps the write check honest: an identity comparison would fail a
            // list write that actually succeeded.
            const stored = Array.isArray(op.value) ? op.value.slice() : op.value;
            scopeSets.push([field, stored]);
            fakeScopeSnapshot = {
              ...fakeScopeSnapshot,
              value: { ...fakeScopeSnapshot.value, [field]: stored },
              user: { ...fakeScopeSnapshot.user, [field]: stored }
            };
          }
          fakeScopeSnapshot = { ...fakeScopeSnapshot, revision: (fakeScopeSnapshot.revision || 0) + 1 };
          notify();
        }
      };
    },
    describe() {
      return {
        getSnapshot: () => fakeMirror,
        subscribe: () => () => {},
        ensure: () => Promise.resolve()
      };
    }
  },
  effect(fn) { return fn(); }
};

// ---- load and apply ------------------------------------------------------
const source = readFileSync(join(ROOT, "client.js"), "utf-8");
eval(source);

// ---- verify exports ------------------------------------------------------
for (const name of [
  "apply", "createRegenerationController", "interpretOutcome",
  "RegenerateTitleAction", "isAiDisabledSnapshot", "SettingsSection"
]) {
  if (typeof capturedExport[name] !== "function") {
    throw new Error(`${name} not exported`);
  }
}
if (capturedExport.NS !== "smart-session-title")
  throw new Error(`NS mismatch: ${capturedExport.NS}`);
if (capturedExport.RETITLE_LINE !== "/retitle")
  throw new Error(`RETITLE_LINE mismatch: ${capturedExport.RETITLE_LINE}`);
// The client half is hand-written, so the version it shows cannot be injected
// at build time: this is the guard that keeps it equal to package.json.
const manifestVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")).version;
if (capturedExport.PLUGIN_VERSION !== manifestVersion) {
  throw new Error(
    `PLUGIN_VERSION drifts from package.json: client="${capturedExport.PLUGIN_VERSION}" manifest="${manifestVersion}"`
  );
}
console.log(`✓ PLUGIN_VERSION matches package.json (${manifestVersion})`);
console.log("✓ exports verified");

// The remote.llm namespace MUST be declared, or DSH never grants it and the
// configured-mode dropdowns silently degrade to manual entry on a real host.
const injectList = capturedExport.inject;
if (!Array.isArray(injectList) || !injectList.includes("remote.llm")) {
  throw new Error(`inject missing "remote.llm" (got ${JSON.stringify(injectList)})`);
}
console.log("✓ inject declares remote.llm");

capturedApply(fakeCtx);

if (!registeredLocale) throw new Error("no locale registered");
console.log("✓ apply() registered locale");

// ---- verify slot registrations and label thunks --------------------------
const settingsSection = slotRegistrations.find(
  (r) => r.name === "settings.section" && r.id === "smart-session-title"
);
if (!settingsSection) throw new Error("settings.section registration missing");
if (settingsSection.locale !== "smart-session-title")
  throw new Error(`settings.section locale: ${settingsSection.locale}`);
if (typeof settingsSection.label !== "function")
  throw new Error("settings.section label is not a thunk");
const labelValue = settingsSection.label();
if (labelValue !== registeredLocale.zh.nav)
  throw new Error(`settings.section label thunk resolved to: ${labelValue}`);
// The nav label MUST differ per language, otherwise the entry looks like it
// ignores the DSH UI language even though the thunk wiring is correct.
if (registeredLocale.zh.nav === registeredLocale.en.nav) {
  throw new Error(`nav label is not localized: both languages render '${registeredLocale.zh.nav}'`);
}
fakeLanguage = "en";
const labelValueEn = settingsSection.label();
if (labelValueEn !== registeredLocale.en.nav)
  throw new Error(`settings.section label thunk did not follow the language switch: ${labelValueEn}`);
fakeLanguage = "zh";
console.log(
  `✓ settings.section label thunk follows the language (zh="${labelValue}" en="${labelValueEn}")`
);

const headerAction = slotRegistrations.find((r) => r.id === "smart-session-title-regenerate");
if (!headerAction) throw new Error("header action registration missing");
if (headerAction.locale !== "smart-session-title")
  throw new Error(`header action locale: ${headerAction.locale}`);
console.log("✓ header action locale seat wired");

// ---- verify dictionary key parity ----------------------------------------
const zhKeys = Object.keys(registeredLocale.zh).sort();
const enKeys = Object.keys(registeredLocale.en).sort();
if (zhKeys.length !== enKeys.length) {
  throw new Error(`Key count mismatch: zh=${zhKeys.length} en=${enKeys.length}`);
}
for (let i = 0; i < zhKeys.length; i += 1) {
  if (zhKeys[i] !== enKeys[i]) {
    throw new Error(`Key mismatch at ${i}: zh="${zhKeys[i]}" en="${enKeys[i]}"`);
  }
}
console.log(`✓ dictionary key parity: ${zhKeys.length} keys`);

// ---- verify translatorOf -------------------------------------------------
const translatorOf = eval(
  `(function() { ${source.match(/function translatorOf[\s\S]*?\n    }/)?.[0] || ""} return translatorOf; })()`
);
if (typeof translatorOf !== "function") throw new Error("translatorOf not extractable");
if (translatorOf({})("hello") !== "hello")
  throw new Error("translatorOf fallback failed");
if (translatorOf({ t: (k) => k.toUpperCase() })("hello") !== "HELLO")
  throw new Error("translatorOf injection failed");
console.log("✓ translatorOf fallback + injection");

const tZh = (key) => (registeredLocale.zh[key] !== undefined ? registeredLocale.zh[key] : key);
const tEn = (key) => (registeredLocale.en[key] !== undefined ? registeredLocale.en[key] : key);
const scope = fakeCtx.settingsScope.bind();
const describeFace = fakeCtx.settingsScope.describe();

// ---- SettingsSection: zh render ------------------------------------------
fakeScopeSnapshot = { status: "ready", value: { enabled: true }, user: {}, writable: true };
const zhTree = await settle(capturedExport.SettingsSection, { scope, t: tZh, describe: describeFace, remote: fakeRemote });
const zhJoined = renderTree(zhTree).join(" ");
if (!zhJoined.includes("AI 标题生成"))
  throw new Error("zh render missing 'AI 标题生成'");
for (const phrase of [
  "Settings are unavailable in this browser.",
  "Title model",
  "Current session model",
  "Configured model",
  "Save configured model",
  "Timeout (ms)",
  "Max attempts"
]) {
  if (zhJoined.includes(phrase)) throw new Error(`zh render LEAK: contains '${phrase}'`);
}
if (!zhJoined.includes(`版本 v${manifestVersion}`))
  throw new Error(`zh render missing the version footer (${manifestVersion})`);
console.log("✓ SettingsSection zh render: no English leakage, zh present, version shown");

// ---- SettingsSection: en render ------------------------------------------
const enTree = await settle(capturedExport.SettingsSection, { scope, t: tEn, describe: describeFace, remote: fakeRemote });
const enJoined = renderTree(enTree).join(" ");
for (const phrase of ["Title model", "Current session model", "Configured model"]) {
  if (!enJoined.includes(phrase)) throw new Error(`en render missing '${phrase}'`);
}
if (!enJoined.includes(`Version v${manifestVersion}`))
  throw new Error(`en render missing the version footer (${manifestVersion})`);
// The footer must not be translated into the other language by accident.
if (enJoined.includes("版本")) throw new Error("en render leaked the zh version label");
console.log("✓ SettingsSection en render: English present, version shown");

// ---- version footer also shows when settings are unavailable -------------
fakeScopeSnapshot = { status: "unavailable" };
const unavailableTree = await settle(capturedExport.SettingsSection, {
  scope, t: tEn, describe: describeFace, remote: fakeRemote
});
const unavailableText = renderTree(unavailableTree).join(" ");
if (!unavailableText.includes("Settings are unavailable")) {
  throw new Error("unavailable render lost its notice");
}
if (!unavailableText.includes(`Version v${manifestVersion}`)) {
  throw new Error("unavailable render missing the version footer");
}
fakeScopeSnapshot = { status: "ready", value: { enabled: true }, user: {}, writable: true };
console.log("✓ version footer survives the settings-unavailable state");

// ---- configured mode: provider + model dropdowns -------------------------
fakeScopeSnapshot = {
  status: "ready",
  value: { enabled: true, mode: "configured", provider: "scnet", model: "DeepSeek-V4-Flash" },
  user: { mode: "configured", provider: "scnet", model: "DeepSeek-V4-Flash" },
  writable: true
};
const configuredTree = await settle(capturedExport.SettingsSection, {
  scope, t: tEn, describe: describeFace, remote: fakeRemote
});
const selects = collectSelects(configuredTree);
// The model fieldset renders first, so its provider/model pair stays at
// indexes 0 and 1; the always-on title-shape selects follow them.
if (selects.length < 2) {
  throw new Error(`expected at least the provider + model selects, got ${selects.length}`);
}
const [providerSelect, modelSelect] = selects;
const providerValues = providerSelect.options.map((o) => o.value);
for (const id of ["scnet", "opencode-go", "deepseek"]) {
  if (!providerValues.includes(id)) {
    throw new Error(`provider dropdown missing '${id}' (got ${providerValues.join(", ")})`);
  }
}
const modelValues = modelSelect.options.map((o) => o.value);
for (const model of ["DeepSeek-V4-Flash", "DeepSeek-V4"]) {
  if (!modelValues.includes(model)) {
    throw new Error(`model dropdown missing '${model}' (got ${modelValues.join(", ")})`);
  }
}
// The other provider's models must NOT leak into this provider's list.
if (modelValues.includes("DeepSeek-V3.1") || modelValues.includes("GPT-5.1-Codex")) {
  throw new Error(`model dropdown leaked another provider's models: ${modelValues.join(", ")}`);
}
console.log("✓ configured mode: provider + model dropdowns from DSH directory");

// ---- namespace-keyed document layout (llm-deepseek) ----------------------
fakeScopeSnapshot = {
  status: "ready",
  value: { enabled: true, mode: "configured", provider: "deepseek", model: "DeepSeek-V3.1" },
  user: { mode: "configured", provider: "deepseek", model: "DeepSeek-V3.1" },
  writable: true
};
const nsTree = await settle(capturedExport.SettingsSection, {
  scope, t: tEn, describe: describeFace, remote: fakeRemote
});
const nsSelects = collectSelects(nsTree);
const nsModelValues = nsSelects[1] ? nsSelects[1].options.map((o) => o.value) : [];
if (!nsModelValues.includes("DeepSeek-V3.1")) {
  throw new Error(`ns-keyed models not resolved via listConfigurableProviders: ${nsModelValues.join(", ")}`);
}
console.log("✓ namespace-keyed models resolved (llm-deepseek → deepseek)");

// ---- provider with no listed models falls back to text input -------------
fakeScopeSnapshot = {
  status: "ready",
  value: { enabled: true, mode: "configured", provider: "unlisted", model: "" },
  user: { mode: "configured", provider: "unlisted", model: "" },
  writable: true
};
const fallbackTree = await settle(capturedExport.SettingsSection, {
  scope, t: tEn, describe: describeFace, remote: fakeRemote
});
const fallbackText = renderTree(fallbackTree).join(" ");
if (!fallbackText.includes("This provider lists no models here")) {
  throw new Error("missing manual-model hint for a provider with no listed models");
}
console.log("✓ unknown provider falls back to manual model entry");

// ---- regression: missing remote.llm must be VISIBLE, not silent -----------
// This is the exact bug that made a correctly-installed update look like a
// failed install: no `remote.llm` grant meant an empty directory and a UI
// identical to the pre-dropdown build.
const remoteWithoutLlm = { commands: { execute: () => Promise.resolve() } };
fakeScopeSnapshot = {
  status: "ready",
  value: { enabled: true, mode: "configured" },
  user: { mode: "configured" },
  writable: true
};
const noLlmTree = await settle(capturedExport.SettingsSection, {
  scope, t: tEn, describe: describeFace, remote: remoteWithoutLlm
});
const noLlmText = renderTree(noLlmTree).join(" ");
if (!noLlmText.includes("Could not read the DSH model directory")) {
  throw new Error("missing directory-unavailable hint when remote.llm is absent");
}
// The title-shape selects are always rendered; what must NOT appear is a
// provider/model selector built from a directory we could not read.
const noLlmValues = collectSelects(noLlmTree).flatMap((select) => select.options.map((option) => option.value));
if (noLlmValues.some((value) => value === "scnet" || value === "opencode-go" || value === "deepseek")) {
  throw new Error("provider/model selects must not render without a provider directory");
}
console.log("✓ missing remote.llm degrades visibly (directory-unavailable hint)");

// ---- RegenerateTitleAction follows locale --------------------------------
fakeScopeSnapshot = { status: "ready", value: { enabled: true }, user: {}, writable: true };
const rtaZh = await settle(capturedExport.RegenerateTitleAction, {
  sessionId: "test-1",
  regenerate: () => Promise.resolve({ ok: true, value: { result: { kind: "success" } } }),
  t: tZh,
  scope
});
if (rtaZh.props["aria-label"] !== "重新生成标题")
  throw new Error(`RegenerateTitleAction aria-label not zh: ${rtaZh.props["aria-label"]}`);
if (rtaZh.props.title !== "重新生成标题")
  throw new Error(`RegenerateTitleAction title not zh: ${rtaZh.props.title}`);

const rtaEn = await settle(capturedExport.RegenerateTitleAction, {
  sessionId: "test-1",
  regenerate: () => Promise.resolve({ ok: true, value: { result: { kind: "success" } } }),
  t: tEn,
  scope
});
if (rtaEn.props["aria-label"] !== "Regenerate title")
  throw new Error(`RegenerateTitleAction aria-label not en: ${rtaEn.props["aria-label"]}`);
console.log("✓ RegenerateTitleAction follows locale (zh + en)");

// ---- verify interpretOutcome unchanged -----------------------------------
const io = capturedExport.interpretOutcome;
if (io({ ok: true, value: { result: { kind: "success" } } }).kind !== "success")
  throw new Error("interpretOutcome success failed");
if (io({ ok: false }).kind !== "error")
  throw new Error("interpretOutcome error failed");
if (io(undefined).kind !== "unavailable")
  throw new Error("interpretOutcome unavailable failed");
if (io({ ok: true }).kind !== "unavailable")
  throw new Error("interpretOutcome unwrapped-undefined failed");
// The host's own wording must survive: it is what makes a failure actionable.
if (io({ ok: true, value: { result: { kind: "error", text: "model error: upstream failure" } } }).text !== "model error: upstream failure")
  throw new Error("interpretOutcome dropped the host failure text");
if (io({ ok: true, value: { result: { kind: "success", text: "New title" } } }).text !== "New title")
  throw new Error("interpretOutcome dropped the generated title");
if (io({ ok: false, error: { message: "remote unavailable" } }).text !== "remote unavailable")
  throw new Error("interpretOutcome dropped the Remote error message");
if (io(undefined).text !== "") throw new Error("interpretOutcome must default text to ''");
console.log("✓ interpretOutcome unchanged");

// ---- verify createRegenerationController ---------------------------------
const ctrl = capturedExport.createRegenerationController(() => Promise.resolve("done"));
if (ctrl.isActive("s1") !== false) throw new Error("controller: new session not inactive");
const runPromise = ctrl.run("s1");
if (ctrl.isActive("s1") !== true) throw new Error("controller: running session is active");
await runPromise;
if (ctrl.isActive("s1") !== false) throw new Error("controller: completed session not inactive");
console.log("✓ createRegenerationController unchanged");

// ---- verify isAiDisabledSnapshot -----------------------------------------
const isAi = capturedExport.isAiDisabledSnapshot;
if (isAi({ status: "ready", value: { enabled: false } }) !== true)
  throw new Error("isAiDisabledSnapshot enabled=false");
if (isAi({ status: "ready", value: { mode: "disabled" } }) !== true)
  throw new Error("isAiDisabledSnapshot mode=disabled");
if (isAi({ status: "ready", value: { enabled: true, mode: "current-session" } }) !== false)
  throw new Error("isAiDisabledSnapshot enabled=true mode=current");
if (isAi(undefined) !== false) throw new Error("isAiDisabledSnapshot undefined");
if (isAi(null) !== false) throw new Error("isAiDisabledSnapshot null");
console.log("✓ isAiDisabledSnapshot unchanged");

// ---- batch: inject declares remote.session --------------------------------
if (!injectList.includes("remote.session")) {
  throw new Error(`inject missing "remote.session" (got ${JSON.stringify(injectList)})`);
}
console.log("✓ inject declares remote.session");

// ---- batch: candidate filtering ------------------------------------------
const batchRows = [
  { sessionId: "s1", updatedAt: 1700000000000, blank: false, cwd: "/proj/a", running: false, projections: { values: { title: "Old title one" } } },
  { sessionId: "s2", updatedAt: 1700000001000, blank: false, cwd: "/proj/b", running: false, projections: { values: { title: "Old title two" } } },
  { sessionId: "s3", blank: true },
  { sessionId: "s4", blank: false, origin: "subagent" },
  { sessionId: "s5", blank: false, parentSessionId: "s1" },
  { blank: false },
  { sessionId: "" }
];
const candidates = capturedExport.selectBatchCandidates(batchRows);
if (candidates.map((r) => r.sessionId).join(",") !== "s1,s2") {
  throw new Error(`selectBatchCandidates kept ${candidates.map((r) => r.sessionId).join(",")}`);
}
if (capturedExport.titleOfSessionRow(batchRows[0]) !== "Old title one") {
  throw new Error("titleOfSessionRow did not read projections.values.title");
}
if (capturedExport.titleOfSessionRow({ projections: { values: {} } }) !== "") {
  throw new Error("titleOfSessionRow must return '' for a row without a title");
}
if (capturedExport.selectBatchCandidates(undefined).length !== 0) {
  throw new Error("selectBatchCandidates must tolerate a missing list");
}
console.log("✓ batch candidates: subagent / child / blank / id-less rows are skipped");

// ---- batch: runner is sequential, dedups, and records failures ------------
const executed = [];
const runner = capturedExport.createBatchController((sessionId) => {
  executed.push(sessionId);
  // "b" models a real host failure: an error result carrying the reason text.
  return Promise.resolve(sessionId === "b"
    ? { ok: true, value: { result: { kind: "error", text: "model error: upstream failure" } } }
    : { ok: true, value: { result: { kind: "success" } } });
});
const statuses = [];
runner.subscribe((snapshot) => statuses.push(snapshot.status));
const finalSnapshot = await runner.start([
  { sessionId: "a" }, { sessionId: "b" }, { sessionId: "b" }, { sessionId: "c" }, { sessionId: "" }
]);
if (executed.join(",") !== "a,b,c") {
  throw new Error(`batch must run each session once, in order (got ${executed.join(",")})`);
}
if (finalSnapshot.status !== "done" || finalSnapshot.total !== 3) {
  throw new Error(`batch final snapshot wrong: ${JSON.stringify(finalSnapshot)}`);
}
if (finalSnapshot.succeeded !== 2 || finalSnapshot.failed !== 1) {
  throw new Error(`batch tallies wrong: ok=${finalSnapshot.succeeded} failed=${finalSnapshot.failed}`);
}
if (finalSnapshot.failures.length !== 1 || finalSnapshot.failures[0].sessionId !== "b" ||
    finalSnapshot.failures[0].kind !== "error" ||
    finalSnapshot.failures[0].reason !== "model error: upstream failure") {
  throw new Error(`batch failure record wrong: ${JSON.stringify(finalSnapshot.failures)}`);
}
if (!statuses.includes("running") || statuses[statuses.length - 1] !== "done") {
  throw new Error(`batch status transitions wrong: ${statuses.join(">")}`);
}
if (runner.isRunning() !== false) throw new Error("batch must not report running after it settles");
// A long reason is bounded so the list stays readable.
const longReason = capturedExport.createBatchController(
  () => Promise.resolve({ ok: true, value: { result: { kind: "error", text: "x".repeat(400) } } })
);
const longSnapshot = await longReason.start([{ sessionId: "long" }]);
if (longSnapshot.failures[0].reason.length > 201 || !longSnapshot.failures[0].reason.endsWith("…")) {
  throw new Error(`failure reason must be truncated (got ${longSnapshot.failures[0].reason.length} chars)`);
}
console.log("✓ batch runner: sequential, deduplicated, tallies success/failure + keeps the reason");

// ---- batch: Stop aborts the session in flight, immediately ---------------
// The Remote accepts a trailing AbortSignal for `commands/execute`, so Stop must
// actually cancel the running generation instead of waiting out its attempts.
const FALLBACK_HOOK = "runFallback";
let abortObserved = false;
const cancelCalls = [];
const signals = [];
const fallbackHookCalls = [];
const cancellable = capturedExport.createBatchController(
  (sessionId, signal) => {
    cancelCalls.push(sessionId);
    signals.push(signal);
    return new Promise((resolve, reject) => {
      // A real executor (the Remote call) settles when its signal aborts.
      if (signal === undefined) return;
      signal.addEventListener("abort", () => {
        abortObserved = true;
        reject(new Error("aborted"));
      }, { once: true });
    });
  },
  {
    runFallback: (failures) => {
      fallbackHookCalls.push(failures);
      return Promise.resolve();
    }
  }
);
cancellable.setAutoFallback(true);
const cancelledRun = cancellable.start([{ sessionId: "x" }, { sessionId: "y" }, { sessionId: "z" }]);
// Let the first step issue its call, then stop mid-flight.
await new Promise((resolve) => setTimeout(resolve, 0));
cancellable.cancel();
if (cancellable.getSnapshot().cancelRequested !== true) {
  throw new Error("cancel must surface a pending-cancel flag");
}
const cancelledSnapshot = await cancelledRun;
if (!abortObserved) {
  throw new Error("Stop must abort the in-flight Remote call (AbortSignal)");
}
if (signals.length === 0 || signals.some((signal) => signal === undefined)) {
  throw new Error("every batch step must receive an AbortSignal");
}
if (cancelCalls.join(",") !== "x") {
  throw new Error(`Stop must not start the next session (ran ${cancelCalls.join(",")})`);
}
if (cancelledSnapshot.status !== "cancelled") {
  throw new Error(`cancel snapshot wrong: ${JSON.stringify(cancelledSnapshot)}`);
}
if (cancelledSnapshot.completed !== 0 || cancelledSnapshot.failed !== 0 || cancelledSnapshot.failures.length !== 0) {
  throw new Error(`an interrupted session is neither success nor failure: ${JSON.stringify(cancelledSnapshot)}`);
}
if (fallbackHookCalls.length !== 0) {
  throw new Error("a cancelled run must never start the automatic fallback");
}
console.log("✓ batch runner: Stop aborts the in-flight session and stays stopped");

// ---- batch: a second start joins the run instead of doubling it -----------
let releaseJoin;
const joinGate = new Promise((resolve) => { releaseJoin = resolve; });
const joinCalls = [];
const joining = capturedExport.createBatchController((sessionId) => {
  joinCalls.push(sessionId);
  return joinGate.then(() => ({ ok: true, value: { result: { kind: "success" } } }));
});
const firstRun = joining.start([{ sessionId: "j1" }, { sessionId: "j2" }]);
const secondRun = joining.start([{ sessionId: "k1" }]);
if (firstRun !== secondRun) throw new Error("a second start must join the in-flight run");
releaseJoin();
await firstRun;
if (joinCalls.join(",") !== "j1,j2") {
  throw new Error(`joined run executed unexpected sessions: ${joinCalls.join(",")}`);
}
console.log("✓ batch runner: concurrent start joins instead of starting twice");

// ---- batch: settings UI lists, selects, and drives the run ---------------
const uiExecuted = [];
const uiBatch = capturedExport.createBatchController((sessionId) => {
  uiExecuted.push(sessionId);
  return Promise.resolve({ ok: true, value: { result: { kind: "success" } } });
});
let listCalls = 0;
const uiListSessions = () => {
  listCalls += 1;
  return Promise.resolve({ ok: true, value: { items: batchRows } });
};
const batchProps = { t: tZh, batch: uiBatch, listSessions: uiListSessions, disabled: false };
let uiTree = await settle(capturedExport.BatchTitleOptimizer, batchProps);
let uiText = renderTree(uiTree).join(" ");
if (!uiText.includes(tZh("batch.legend")) || !uiText.includes(tZh("batch.intro"))) {
  throw new Error("batch block did not render its legend/intro");
}
if (listCalls !== 1) throw new Error("batch workspace must load once on entry");
const loadButton = collectButtons(uiTree).find((b) => b.text === tZh("batch.reload"));
if (!loadButton) throw new Error("batch refresh button missing");
uiText = renderTree(uiTree).join(" ");
if (!uiText.includes("Old title one") || !uiText.includes("Old title two")) {
  throw new Error("loaded batch rows did not render their current titles");
}
if (uiText.includes("s3") || uiText.includes("s4")) {
  throw new Error("blank/subagent sessions must not be offered for batch retitle");
}
if (!uiText.includes(tZh("batch.count") + ": 2")) {
  throw new Error(`batch row count wrong: ${uiText}`);
}
let startButton = collectButtons(uiTree).find((b) => b.text.startsWith(tZh("batch.start")));
if (!startButton || startButton.props.disabled !== true) {
  throw new Error("start must stay disabled until something is selected");
}
const selectAllButton = collectButtons(uiTree).find((b) => b.text === tZh("batch.selectAll"));
if (!selectAllButton) throw new Error("select-all button missing");
selectAllButton.props.onClick();
uiTree = await flush(capturedExport.BatchTitleOptimizer, batchProps, uiTree);
uiText = renderTree(uiTree).join(" ");
if (!uiText.includes(tZh("batch.selectedCount") + ": 2")) {
  throw new Error(`selection count wrong: ${uiText}`);
}
startButton = collectButtons(uiTree).find((b) => b.text.startsWith(tZh("batch.start")));
if (startButton.props.disabled === true) throw new Error("start must enable once rows are selected");
startButton.props.onClick();
uiTree = await flush(capturedExport.BatchTitleOptimizer, batchProps, uiTree);
uiText = renderTree(uiTree).join(" ");
if (uiExecuted.join(",") !== "s1,s2") {
  throw new Error(`UI run executed ${uiExecuted.join(",")} instead of the selected rows`);
}
if (!uiText.includes(tZh("batch.done")) || !uiText.includes(tZh("batch.completedCount") + " 2 / 2")) {
  throw new Error(`progress/summary missing after the run: ${uiText}`);
}
// Finishing a run must reload the rows (titles changed on the host).
if (listCalls < 2) throw new Error(`batch list was not reloaded after the run (calls=${listCalls})`);
console.log("✓ batch UI: loads rows, selects, runs, and shows progress to completion");

// The runner lives in plugin scope: unmounting the page must not stop it.
const detachExecuted = [];
let releaseDetach;
const detachGate = new Promise((resolve) => { releaseDetach = resolve; });
const detachBatch = capturedExport.createBatchController((sessionId) => {
  detachExecuted.push(sessionId);
  return detachGate.then(() => ({ ok: true, value: { result: { kind: "success" } } }));
});
const detachProps = { t: tZh, batch: detachBatch, listSessions: uiListSessions, disabled: false };
let detachTree = await settle(capturedExport.BatchTitleOptimizer, detachProps);
collectButtons(detachTree).find((b) => b.text === tZh("batch.reload")).props.onClick();
detachTree = await flush(capturedExport.BatchTitleOptimizer, detachProps, detachTree);
collectButtons(detachTree).find((b) => b.text === tZh("batch.selectAll")).props.onClick();
detachTree = await flush(capturedExport.BatchTitleOptimizer, detachProps, detachTree);
collectButtons(detachTree).find((b) => b.text.startsWith(tZh("batch.start"))).props.onClick();
// Simulate closing the settings page: the component's unmount effect runs and
// its subscription is dropped, while the runner itself keeps going.
const pageRun = detachBatch.isRunning();
if (pageRun !== true) throw new Error("batch should be running after start");
// Closing the page unmounts it, so its own hook state goes away (this component
// only — the runner lives in plugin scope, which is the point of the test).
componentState.set(capturedExport.BatchTitleOptimizer, []);
state = [];
pendingEffects = [];
releaseDetach();
await new Promise((resolve) => setTimeout(resolve, 0));
const detachedSnapshot = await detachBatch.getSnapshot();
if (detachedSnapshot.status !== "running" && detachedSnapshot.status !== "done") {
  throw new Error(`runner lost its run after the page unmounted: ${JSON.stringify(detachedSnapshot)}`);
}
const settledDetached = await (async () => {
  for (let i = 0; i < 50 && detachBatch.isRunning(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return detachBatch.getSnapshot();
})();
if (settledDetached.status !== "done" || settledDetached.succeeded !== 2) {
  throw new Error(`runner did not finish after the page unmounted: ${JSON.stringify(settledDetached)}`);
}
console.log("✓ batch runner keeps running after the settings page unmounts");

// ---- batch UI: failure reason is shown, and failures can be retried -------
const attemptCount = {};
const retryRan = [];
const retryBatch = capturedExport.createBatchController((sessionId) => {
  attemptCount[sessionId] = (attemptCount[sessionId] ?? 0) + 1;
  retryRan.push(`${sessionId}#${attemptCount[sessionId]}`);
  // First attempt on s1 fails the way a dead historical route does; the retry
  // (against a fixed route) succeeds.
  return Promise.resolve(attemptCount[sessionId] === 1 && sessionId === "s1"
    ? { ok: true, value: { result: { kind: "error", text: "smart-session-title: model error: upstream failure" } } }
    : { ok: true, value: { result: { kind: "success", text: "New title" } } });
});
const retryProps = { t: tZh, batch: retryBatch, listSessions: uiListSessions, disabled: false };
let retryTree = await settle(capturedExport.BatchTitleOptimizer, retryProps);
if (!renderTree(retryTree).join(" ").includes(tZh("batch.routeHint"))) {
  throw new Error("batch block must explain the current-session route caveat");
}
collectButtons(retryTree).find((b) => b.text === tZh("batch.reload")).props.onClick();
retryTree = await flush(capturedExport.BatchTitleOptimizer, retryProps, retryTree);
collectButtons(retryTree).find((b) => b.text === tZh("batch.selectAll")).props.onClick();
retryTree = await flush(capturedExport.BatchTitleOptimizer, retryProps, retryTree);
collectButtons(retryTree).find((b) => b.text.startsWith(tZh("batch.start"))).props.onClick();
retryTree = await flush(capturedExport.BatchTitleOptimizer, retryProps, retryTree);
let retryText = renderTree(retryTree).join(" ");
if (!retryText.includes("model error: upstream failure")) {
  throw new Error(`failure reason was not surfaced in the UI: ${retryText}`);
}
if (!retryText.includes(tZh("batch.failedCount") + " 1")) {
  throw new Error(`failure tally wrong after the run: ${retryText}`);
}
const retryButton = collectButtons(retryTree).find(
  (b) => b.text === tZh("batch.retryFailed") + " (1)"
);
if (!retryButton) throw new Error("retry-failed button missing after a failed run");
retryButton.props.onClick();
retryTree = await flush(capturedExport.BatchTitleOptimizer, retryProps, retryTree);
if (retryRan.join(",") !== "s1#1,s2#1,s1#2") {
  throw new Error(`retry must re-run exactly the failed session (got ${retryRan.join(",")})`);
}
retryText = renderTree(retryTree).join(" ");
if (retryText.includes(tZh("batch.retryFailed"))) {
  throw new Error("retry button must disappear once there is nothing failed left");
}
console.log("✓ batch UI: surfaces the host failure reason and retries only the failed rows");

// ---- batch: AI-disabled state blocks starting ----------------------------
const offTree = await settle(capturedExport.BatchTitleOptimizer, {
  t: tZh, batch: capturedExport.createBatchController(() => Promise.resolve()), listSessions: uiListSessions, disabled: true
});
const offText = renderTree(offTree).join(" ");
if (!offText.includes(tZh("batch.disabled"))) {
  throw new Error("disabled batch block must explain why it is off");
}
collectButtons(offTree).find((b) => b.text === tZh("batch.reload")).props.onClick();
const offLoaded = await flush(capturedExport.BatchTitleOptimizer, {
  t: tZh, batch: capturedExport.createBatchController(() => Promise.resolve()), listSessions: uiListSessions, disabled: true
}, offTree);
const offStart = collectButtons(offLoaded).find((b) => b.text.startsWith(tZh("batch.start")));
if (!offStart || offStart.props.disabled !== true) {
  throw new Error("start must be disabled while AI titles are off");
}
console.log("✓ batch UI: AI-disabled state blocks starting");

// ---- batch: missing session remote degrades visibly ----------------------
const missingRemoteTree = await settle(capturedExport.BatchTitleOptimizer, {
  t: tZh, batch: undefined, listSessions: undefined, disabled: false
});
if (!renderTree(missingRemoteTree).join(" ").includes(tZh("batch.unavailable"))) {
  throw new Error("batch block must degrade visibly without the session remote");
}
console.log("✓ batch UI: missing session remote degrades visibly");

// ---- settings: "Configured model" is persisted, or flagged as unsaved -----
// Regression guard for a real trap: clicking the 指定模型 radio alone does NOT
// persist anything (provider+model+mode save atomically), so a batch kept
// running on each session's own — often long dead — model while the radio
// looked selected.
const settingsProps = () => ({ scope, t: tZh, describe: describeFace, remote: fakeRemote });

fakeScopeSnapshot = { status: "ready", value: { enabled: true }, user: {}, writable: true };
let settingsTree = await settle(capturedExport.SettingsSection, settingsProps());
scopeMutations.length = 0;
const configuredRadio = collectInputs(settingsTree, "radio").find((r) => r.props.value === "configured");
if (!configuredRadio) throw new Error("configured-mode radio missing");
configuredRadio.props.onChange();
settingsTree = await flush(capturedExport.SettingsSection, settingsProps(), settingsTree);
if (scopeMutations.some((ops) => ops.some((op) => op.path?.[0] === "mode" && op.value === "configured"))) {
  throw new Error("configured mode must not be persisted without a provider+model pair");
}
if (!renderTree(settingsTree).join(" ").includes(tZh("settings.configuredUnsaved"))) {
  throw new Error("an unsaved configured mode must say so explicitly");
}

// With a usable pair already saved, choosing the mode applies it immediately.
fakeScopeSnapshot = {
  status: "ready",
  value: { enabled: true, provider: "scnet", model: "DeepSeek-V4-Flash" },
  user: {},
  writable: true
};
settingsTree = await settle(capturedExport.SettingsSection, settingsProps());
scopeMutations.length = 0;
collectInputs(settingsTree, "radio").find((r) => r.props.value === "configured").props.onChange();
settingsTree = await flush(capturedExport.SettingsSection, settingsProps(), settingsTree);
const applied = scopeMutations.flat();
for (const [path, value] of [["mode", "configured"], ["provider", "scnet"], ["model", "DeepSeek-V4-Flash"]]) {
  if (!applied.some((op) => op.path?.[0] === path && op.value === value)) {
    throw new Error(`choosing configured mode did not persist ${path} (ops=${JSON.stringify(applied)})`);
  }
}
if (renderTree(settingsTree).join(" ").includes(tZh("settings.configuredUnsaved"))) {
  throw new Error("the unsaved hint must clear once the mode is applied");
}
console.log("✓ settings: configured mode is saved atomically, or flagged as not yet effective");

// ---- batch: dead-route pre-flight ----------------------------------------
// The observed failure mode: a stored session logs a model DSH no longer serves,
// so "Current session model" can only fail for it. That must be visible in the
// list BEFORE the run, from the modelSelection projection every row carries.
const routeRow = {
  sessionId: "r1",
  projections: { values: { modelSelection: { lastUsed: { provider: "opencode-go-2", model: "deepseek-v4-flash" }, next: null } } }
};
const routeRowNext = {
  sessionId: "r2",
  projections: { values: { modelSelection: { lastUsed: null, next: { provider: "scnet", model: "DeepSeek-V4-Flash" } } } }
};
const parsedRoute = capturedExport.routeOfSessionRow(routeRow);
if (parsedRoute.provider !== "opencode-go-2" || parsedRoute.model !== "deepseek-v4-flash") {
  throw new Error(`routeOfSessionRow misread lastUsed: ${JSON.stringify(parsedRoute)}`);
}
if (capturedExport.routeOfSessionRow(routeRowNext).provider !== "scnet") {
  throw new Error("routeOfSessionRow must fall back to the queued selection");
}
if (capturedExport.routeOfSessionRow({ sessionId: "r3" }) !== undefined) {
  throw new Error("routeOfSessionRow must return undefined without a selection");
}
const deadCatalog = {
  providers: [{ id: "opencode-go", name: "OpenCode Go" }],
  byProvider: { "opencode-go": ["deepseek-v4-flash"] },
  byNs: {}
};
if (capturedExport.classifySessionRoute({ provider: "opencode-go-2", model: "x" }, deadCatalog) !== "provider-missing")
  throw new Error("a provider missing from the directory must be flagged");
if (capturedExport.classifySessionRoute({ provider: "opencode-go", model: "gone" }, deadCatalog) !== "model-missing")
  throw new Error("a model missing from a known provider must be flagged");
if (capturedExport.classifySessionRoute({ provider: "opencode-go", model: "deepseek-v4-flash" }, deadCatalog) !== "ok")
  throw new Error("a known provider+model must pass");
if (capturedExport.classifySessionRoute({ provider: "opencode-go", model: "x" }, undefined) !== "unknown")
  throw new Error("without a directory the verdict must be unknown, never a false alarm");
console.log("✓ batch: dead logged routes are detected before the run");

// ...and the list says so, instead of 13 identical failures afterwards.
const deadRowTree = await settle(capturedExport.BatchTitleOptimizer, {
  t: tZh,
  batch: capturedExport.createBatchController(() => Promise.resolve()),
  listSessions: () => Promise.resolve({
    ok: true,
    value: {
      items: [
        { ...routeRow, blank: false, cwd: "/proj/a", updatedAt: 1700000000000 },
        { ...routeRowNext, blank: false, cwd: "/proj/b", updatedAt: 1700000001000 }
      ]
    }
  }),
  disabled: false,
  catalog: { providers: [{ id: "scnet", name: "SCNet" }], byProvider: { scnet: ["DeepSeek-V4-Flash"] }, byNs: {} }
});
collectButtons(deadRowTree).find((b) => b.text === tZh("batch.reload")).props.onClick();
const deadRowLoaded = await flush(capturedExport.BatchTitleOptimizer, {
  t: tZh,
  batch: capturedExport.createBatchController(() => Promise.resolve()),
  listSessions: () => Promise.resolve({ ok: true, value: { items: [] } }),
  disabled: false,
  catalog: { providers: [{ id: "scnet", name: "SCNet" }], byProvider: { scnet: ["DeepSeek-V4-Flash"] }, byNs: {} }
}, deadRowTree);
const deadRowText = renderTree(deadRowLoaded).join(" ");
if (!deadRowText.includes("opencode-go-2/deepseek-v4-flash")) {
  throw new Error(`the row must name the session's logged model: ${deadRowText}`);
}
if (!deadRowText.includes(tZh("batch.routeDead"))) {
  throw new Error(`a dead logged route must be flagged in the row: ${deadRowText}`);
}
if (!deadRowText.includes(tZh("batch.routeDeadSummary") + ": 1 / 2")) {
  throw new Error(`the dead-route summary must count 1 of 2: ${deadRowText}`);
}
console.log("✓ batch UI: warns about unavailable logged models before running");

// ---- batch UI: shows which title route the run will actually use ----------
const routeCurrent = await settle(capturedExport.BatchTitleOptimizer, {
  t: tZh, batch: capturedExport.createBatchController(() => Promise.resolve()),
  listSessions: uiListSessions, disabled: false,
  route: { mode: "current-session", provider: "", model: "" }
});
const routeCurrentText = renderTree(routeCurrent).join(" ");
if (!routeCurrentText.includes(tZh("batch.routeInUse") + ": " + tZh("settings.modeCurrent"))) {
  throw new Error(`session-route banner wrong: ${routeCurrentText}`);
}
const routeConfigured = await settle(capturedExport.BatchTitleOptimizer, {
  t: tZh, batch: capturedExport.createBatchController(() => Promise.resolve()),
  listSessions: uiListSessions, disabled: false,
  route: { mode: "configured", provider: "opencode-go", model: "deepseek-v4-flash" }
});
const routeConfiguredText = renderTree(routeConfigured).join(" ");
if (!routeConfiguredText.includes("opencode-go / deepseek-v4-flash")) {
  throw new Error(`configured-route banner wrong: ${routeConfiguredText}`);
}
console.log("✓ batch UI: states the title route the run will use");

// ---- automatic fallback through the REAL plugin wiring --------------------
// Exercises the controller created in apply(): it must switch the title route to
// the saved configured pair, run exactly the failed sessions through the same
// `/retitle` Remote, and put the previous mode back.
const settingsMeta = slotRegistrations.find(
  (r) => r.name === "settings.section" && r.id === "smart-session-title"
).meta;
const face = settingsMeta.inject();
if (typeof face.batch?.start !== "function" || typeof face.listSessions !== "function") {
  throw new Error("settings.section inject face is missing batch/listSessions");
}
const originalExecute = fakeRemote.commands.execute;

fakeScopeSnapshot = {
  status: "ready",
  value: { enabled: true, mode: "current-session", provider: "scnet", model: "DeepSeek-V4-Flash" },
  user: { mode: "current-session", provider: "scnet", model: "DeepSeek-V4-Flash" },
  writable: true
};
const fallbackCalls = [];
let fallbackAttempt = 0;
fakeRemote.commands.execute = (sessionId) => {
  fallbackAttempt += 1;
  fallbackCalls.push(sessionId);
  // First pass: the dead historical route. Second pass (on the configured
  // route): success — exactly the situation this feature exists for.
  return Promise.resolve(fallbackAttempt === 1
    ? { ok: true, value: { result: { kind: "error", text: "model error: upstream failure" } } }
    : { ok: true, value: { result: { kind: "success", text: "Fallback title" } } });
};
scopeSets.length = 0;
face.batch.setAutoFallback(true);
const fallbackSnapshot = await face.batch.start([{ sessionId: "s1" }]);
if (fallbackCalls.join(",") !== "s1,s1") {
  throw new Error(`fallback must run the failed session exactly once more (got ${fallbackCalls.join(",")})`);
}
if (fallbackSnapshot.fallback !== "done") {
  throw new Error(`fallback status must be done: ${JSON.stringify(fallbackSnapshot)}`);
}
if (fallbackSnapshot.failed !== 0 || fallbackSnapshot.succeeded !== 1) {
  throw new Error(`the retry pass must replace the tallies: ${JSON.stringify(fallbackSnapshot)}`);
}
const modeWrites = scopeSets.filter(([field]) => field === "mode").map(([, value]) => value);
if (modeWrites[0] !== "configured" || modeWrites[modeWrites.length - 1] !== "current-session") {
  throw new Error(`title route must switch for the retry and be restored (writes=${JSON.stringify(modeWrites)})`);
}
if (fakeScopeSnapshot.value.mode !== "current-session") {
  throw new Error("the previous title mode must be restored after the fallback");
}

// Without a saved configured pair there is nothing to fall back to: the pass is
// reported as failed instead of silently pretending it ran.
fakeScopeSnapshot = { status: "ready", value: { enabled: true, mode: "current-session" }, user: {}, writable: true };
fallbackAttempt = 0;
fallbackCalls.length = 0;
face.batch.setAutoFallback(true);
const noRouteSnapshot = await face.batch.start([{ sessionId: "s2" }]);
if (fallbackCalls.join(",") !== "s2") {
  throw new Error(`no fallback route: the failed session must not be retried (got ${fallbackCalls.join(",")})`);
}
if (noRouteSnapshot.fallback !== "failed") {
  throw new Error(`missing configured route must surface as fallback failed: ${JSON.stringify(noRouteSnapshot)}`);
}

// Disabled (the default) means one pass only, whatever the failures.
fakeScopeSnapshot = {
  status: "ready",
  value: { enabled: true, mode: "current-session", provider: "scnet", model: "DeepSeek-V4-Flash" },
  user: {},
  writable: true
};
fallbackAttempt = 0;
fallbackCalls.length = 0;
face.batch.setAutoFallback(false);
await face.batch.start([{ sessionId: "s3" }]);
if (fallbackCalls.join(",") !== "s3") {
  throw new Error(`fallback must stay off unless enabled (got ${fallbackCalls.join(",")})`);
}
fakeRemote.commands.execute = originalExecute;
console.log("✓ batch fallback: switches the route, retries only failures, restores the mode");

// ---- the fallback preference is a browser-local UI setting ---------------
const FALLBACK_KEY = "smart-session-title.batch.autoFallback";
window.localStorage.setItem(FALLBACK_KEY, "1");
const rememberedBatch = capturedExport.createBatchController(() => Promise.resolve());
const rememberedFlags = [];
const originalSetAuto = rememberedBatch.setAutoFallback;
rememberedBatch.setAutoFallback = (enabled) => {
  rememberedFlags.push(enabled);
  originalSetAuto(enabled);
};
const rememberedTree = await settle(capturedExport.BatchTitleOptimizer, {
  t: tZh,
  batch: rememberedBatch,
  listSessions: uiListSessions,
  disabled: false,
  route: { mode: "current-session", provider: "scnet", model: "DeepSeek-V4-Flash" }
});
const fallbackBox = collectInputs(rememberedTree, "checkbox")[0];
if (!fallbackBox) throw new Error("fallback checkbox missing");
if (fallbackBox.props.checked !== true) {
  throw new Error("a remembered fallback preference must come back checked");
}
if (rememberedFlags[rememberedFlags.length - 1] !== true) {
  throw new Error("the remembered preference must be pushed into the runner");
}
fallbackBox.props.onChange({ target: { checked: false } });
const toggledTree = await flush(capturedExport.BatchTitleOptimizer, {
  t: tZh,
  batch: rememberedBatch,
  listSessions: uiListSessions,
  disabled: false,
  route: { mode: "current-session", provider: "scnet", model: "DeepSeek-V4-Flash" }
}, rememberedTree);
if (window.localStorage.getItem(FALLBACK_KEY) !== "0") {
  throw new Error("toggling the fallback must be remembered in browser storage");
}
if (collectInputs(toggledTree, "checkbox")[0].props.checked !== false) {
  throw new Error("the checkbox must follow the toggle");
}
console.log("✓ batch fallback: preference round-trips through browser storage");

// With no saved configured route the option cannot work, and says why.
const noRouteTree = await settle(capturedExport.BatchTitleOptimizer, {
  t: tZh,
  batch: capturedExport.createBatchController(() => Promise.resolve()),
  listSessions: uiListSessions,
  disabled: false,
  route: { mode: "current-session", provider: "", model: "" }
});
const noRouteText = renderTree(noRouteTree).join(" ");
if (!noRouteText.includes(tZh("batch.fallbackNeedsRoute"))) {
  throw new Error("without a configured route the fallback must explain itself");
}
if (collectInputs(noRouteTree, "checkbox")[0].props.disabled !== true) {
  throw new Error("without a configured route the fallback must be disabled");
}
console.log("✓ batch fallback: needs a saved configured route, and says so");
window.localStorage.removeItem(FALLBACK_KEY);

// ---- global overlay: progress and Stop outside the settings page ----------
// The runner lives in plugin scope, so a closed settings page must not be the
// only place a run can be stopped.
const overlayReg = slotRegistrations.find(
  (r) => r.name === "shell.overlay" && r.id === "smart-session-title-batch"
);
if (!overlayReg) throw new Error("shell.overlay registration missing");
if (overlayReg.locale !== "smart-session-title") {
  throw new Error(`shell.overlay locale seat wrong: ${overlayReg.locale}`);
}
const overlayFace = overlayReg.meta.inject();
if (typeof overlayFace.batch?.cancel !== "function") {
  throw new Error("shell.overlay inject face is missing the batch runner");
}

// Idle: the overlay must not add anything to the app frame.
const idleOverlay = await settle(capturedExport.BatchOverlayAction, { t: tZh, batch: overlayFace.batch });
if (idleOverlay !== null) {
  throw new Error(`the overlay must render nothing while idle (got ${JSON.stringify(idleOverlay)})`);
}

// Running: progress + a working Stop, reachable from anywhere.
let overlayAborted = false;
const overlayCalls = [];
const gated = capturedExport.createBatchController((sessionId, signal) => {
  overlayCalls.push(sessionId);
  return new Promise((resolve, reject) => {
    if (signal === undefined) return;
    signal.addEventListener("abort", () => {
      overlayAborted = true;
      reject(new Error("aborted by overlay stop"));
    }, { once: true });
  });
});
const overlayProps = { t: tZh, batch: gated };
const gatedRun = gated.start([{ sessionId: "o1" }, { sessionId: "o2" }]);
await new Promise((resolve) => setTimeout(resolve, 0));
const runningOverlay = await flush(capturedExport.BatchOverlayAction, overlayProps, idleOverlay);
const runningOverlayText = renderTree(runningOverlay).join(" ");
if (!runningOverlayText.includes(tZh("overlay.running") + " 0 / 2")) {
  throw new Error(`overlay progress missing: ${runningOverlayText}`);
}
const overlayStop = collectButtons(runningOverlay).find((b) => b.text === tZh("overlay.stop"));
if (!overlayStop) throw new Error("overlay Stop button missing while a run is in flight");
overlayStop.props.onClick();
if (gated.getSnapshot().cancelRequested !== true) {
  throw new Error("overlay Stop must request cancellation");
}
const overlaySnapshot = await gatedRun;
if (!overlayAborted || overlaySnapshot.status !== "cancelled") {
  throw new Error(`overlay Stop must cancel the run: ${JSON.stringify(overlaySnapshot)}`);
}
// Cancelled: the overlay disappears again.
const afterOverlay = await flush(capturedExport.BatchOverlayAction, overlayProps, runningOverlay);
if (afterOverlay !== null) throw new Error("the overlay must disappear once the run is over");
console.log("✓ overlay: shows progress anywhere and stops the run immediately");

// ---- the same Stop is reachable inside the settings page ------------------
let pageAborted = false;
const pageGated = capturedExport.createBatchController((sessionId, signal) => {
  return new Promise((resolve, reject) => {
    if (signal === undefined) return;
    signal.addEventListener("abort", () => {
      pageAborted = true;
      reject(new Error("aborted"));
    }, { once: true });
  });
});
const pageProps = { t: tZh, batch: pageGated, listSessions: uiListSessions, disabled: false };
let pageTree = await settle(capturedExport.BatchTitleOptimizer, pageProps);
collectButtons(pageTree).find((b) => b.text === tZh("batch.reload")).props.onClick();
pageTree = await flush(capturedExport.BatchTitleOptimizer, pageProps, pageTree);
collectButtons(pageTree).find((b) => b.text === tZh("batch.selectAll")).props.onClick();
pageTree = await flush(capturedExport.BatchTitleOptimizer, pageProps, pageTree);
collectButtons(pageTree).find((b) => b.text.startsWith(tZh("batch.start"))).props.onClick();
pageTree = await flush(capturedExport.BatchTitleOptimizer, pageProps, pageTree);
const pageStop = collectButtons(pageTree).find((b) => b.text === tZh("batch.cancel"));
if (!pageStop) throw new Error("the settings page must offer Stop while a run is in flight");
pageStop.props.onClick();
const pageSnapshot = await pageGated.start([]);
await new Promise((resolve) => setTimeout(resolve, 0));
if (!pageAborted) throw new Error("the in-page Stop must abort the running generation");
console.log("✓ settings page: Stop is available while a run is in flight");

// ---- host: title shape — character cap + date affix ----------------------
// The host half is plain ESM with no DSH imports, so the real policy modules
// are loaded here rather than re-implemented: a second implementation would
// pass its own tests while the shipped one drifted.
const affixModule = await import(join(ROOT, "lib/title-affix.js"));
const policyModule = await import(join(ROOT, "lib/title-policy.js"));
const settingsModule = await import(join(ROOT, "lib/settings.js"));

/** Session creation time used across the shape assertions (UTC, fixed). */
const CREATED_AT = Date.UTC(2026, 8, 13, 4, 0, 0);
const { buildTitleAffix, bodyBudgetBytes, composeTitle } = affixModule;

if (buildTitleAffix({ position: "prefix", format: "ymd", createdAt: CREATED_AT, timeZone: "UTC" }) !== "2026-09-13 ") {
  throw new Error("ymd prefix affix must be '2026-09-13 '");
}
if (buildTitleAffix({ position: "suffix", format: "md", createdAt: CREATED_AT, timeZone: "UTC" }) !== " · 09-13") {
  throw new Error("md suffix affix must be ' · 09-13'");
}
// "no affix" paths: unset position, an unusable timestamp, an unknown zone.
for (const [label, options] of [
  ["unset position", { position: undefined, createdAt: CREATED_AT }],
  ["unknown position", { position: "middle", createdAt: CREATED_AT }],
  ["missing createdAt", { position: "prefix" }],
  ["unknown time zone", { position: "prefix", createdAt: CREATED_AT, timeZone: "Not/AZone" }]
]) {
  if (buildTitleAffix(options) !== "") {
    throw new Error(`affix must be empty for ${label}`);
  }
}
console.log("✓ host: date affix formats, and degrades to no affix on bad input");

/**
 * Mirror of the service's own `normalizeSessionTitle` (leading-byte truncation).
 * Kept local because the real one lives in the DSH install, not in this repo.
 */
function normalizeLikeService(input, maxBytes) {
  const cleaned = input.replace(/\s+/gu, " ").trim();
  let used = 0;
  let out = "";
  for (const character of cleaned) {
    const size = Buffer.byteLength(character, "utf8");
    if (used + size > maxBytes) break;
    out += character;
    used += size;
  }
  return out.trimEnd();
}
const CJK_PROMPT_TITLE = "修复认证中间件的会话刷新竞态条件并保持公开 API 不变";
const suffixAffix = buildTitleAffix({ position: "suffix", format: "ymd", createdAt: CREATED_AT, timeZone: "UTC" });
// Reserved: the body is shortened first, so the suffix survives the service's
// leading-byte truncation.
const reservedBody = policyModule.validateGeneratedTitle(
  CJK_PROMPT_TITLE, bodyBudgetBytes(80, suffixAffix), undefined
);
if (reservedBody.ok !== true) throw new Error("reserved body must validate");
const reservedTitle = composeTitle(reservedBody.title, suffixAffix, "suffix");
if (normalizeLikeService(reservedTitle, 80) !== reservedTitle) {
  throw new Error(`a reserved suffix must survive normalization: ${reservedTitle}`);
}
if (!reservedTitle.endsWith("2026-09-13")) {
  throw new Error("the reserved suffix must still be the last thing in the title");
}
// Unreserved (the bug the reservation exists to prevent): the suffix is cut.
const unreservedBody = policyModule.validateGeneratedTitle(CJK_PROMPT_TITLE, 80, undefined);
const unreservedTitle = composeTitle(unreservedBody.title, suffixAffix, "suffix");
if (normalizeLikeService(unreservedTitle, 80).endsWith("2026-09-13")) {
  throw new Error("the negative control must show an unreserved suffix being cut");
}
console.log("✓ host: affix bytes are reserved, so a suffix date survives the 80-byte cap");

// The code-point cap is what a human means by "字数"; an absent cap keeps the
// pre-existing byte-only behaviour (backward compatibility).
const capDefault = policyModule.validateGeneratedTitle("Fix the authentication middleware session refresh race", 80);
if (capDefault.ok !== true || capDefault.title.length > 80) {
  throw new Error(`byte-only validation regressed: ${JSON.stringify(capDefault)}`);
}
const capped = policyModule.validateGeneratedTitle("Fix the authentication middleware session refresh race", 80, 20);
if (capped.ok !== true || Array.from(capped.title).length > 20) {
  throw new Error(`character cap not applied: ${JSON.stringify(capped)}`);
}
if (policyModule.truncateTitleCharacters("修复认证中间件", 4) !== "修复认证") {
  throw new Error("truncateTitleCharacters must cut on code points");
}
console.log("✓ host: character cap applies on top of the byte cap");

// Settings: the three new keys are accepted, bounded, and still fail loudly.
const shapeSettings = settingsModule.resolveTitleSettings({
  enabled: true, maxTitleCharacters: 20, titleDatePosition: "suffix", titleDateFormat: "md"
});
if (shapeSettings.maxTitleCharacters !== 20 || shapeSettings.titleDatePosition !== "suffix" || shapeSettings.titleDateFormat !== "md") {
  throw new Error(`shape settings did not round-trip: ${JSON.stringify(shapeSettings)}`);
}
if (settingsModule.resolveTitleSettings({ enabled: true }).titleDatePosition !== undefined) {
  throw new Error("an absent date position must stay undefined (= no affix)");
}
for (const [label, raw] of [
  ["out-of-range cap", { maxTitleCharacters: 4 }],
  ["non-integer cap", { maxTitleCharacters: 12.5 }],
  ["unknown position", { titleDatePosition: "middle" }],
  ["unknown format", { titleDateFormat: "iso" }],
  ["undocumented key", { titlePrefix: "01 " }]
]) {
  let threw = false;
  try { settingsModule.resolveTitleSettings(raw); } catch { threw = true; }
  if (!threw) throw new Error(`settings must reject ${label}`);
}
// The shape fields are deliberately NOT merged into the composition config.
const mergedConfig = settingsModule.applySettingsToTitleConfig(
  { targetWords: 6, targetCjkCharacters: 12, maxRawInputBytes: 65536, targetPreparedInputBytes: 12000, codeBlockKeepBytes: 400, maxOutputTokens: 96, timeoutMs: 15000, maxAttempts: 2 },
  shapeSettings
);
if ("maxTitleCharacters" in mergedConfig || "titleDatePosition" in mergedConfig) {
  throw new Error("shape fields must stay in the settings half of the policy");
}
console.log("✓ host: title-shape settings validate, bounded, and stay out of the row config");

// ---- client: the title-shape controls ------------------------------------
// `save()` runs the write in a promise microtask, so every assertion below
// flushes the queue first instead of reading a still-empty mutation log.
const flushWrites = () => new Promise((resolve) => setTimeout(resolve, 0));

fakeScopeSnapshot = { status: "ready", value: { enabled: true }, user: {}, writable: true };
let shapeTree = await settle(capturedExport.SettingsSection, { scope, t: tZh, describe: describeFace, remote: fakeRemote });
const shapeText = renderTree(shapeTree).join(" ");
for (const key of ["settings.shapeLegend", "settings.maxCharacters", "settings.dateAffix", "settings.dateFormat"]) {
  if (!shapeText.includes(tZh(key))) throw new Error(`zh shape block missing ${key}`);
}
for (const phrase of ["Title shape", "Maximum title characters", "Date position"]) {
  if (shapeText.includes(phrase)) throw new Error(`zh shape block LEAK: '${phrase}'`);
}
const shapeSelects = collectSelects(shapeTree);
const positionSelect = shapeSelects.find((s) => s.options.some((o) => o.value === "prefix"));
const formatSelect = shapeSelects.find((s) => s.options.some((o) => o.value === "md"));
if (!positionSelect || !formatSelect) throw new Error("date position/format selects missing");
for (const value of ["", "prefix", "suffix"]) {
  if (!positionSelect.options.some((o) => o.value === value)) {
    throw new Error(`date position select is missing option '${value}'`);
  }
}
const capInput = collectInputs(shapeTree, "number").find((i) => i.props.min === 8 && i.props.max === 120);
if (!capInput) throw new Error("character-cap number input missing");

scopeSets.length = 0;
scopeUnsets.length = 0;
capInput.props.onChange({ target: { value: "20" } });
await flushWrites();
if (!scopeSets.some(([field, value]) => field === "maxTitleCharacters" && value === 20)) {
  throw new Error(`the character cap must be written as a number (writes=${JSON.stringify(scopeSets)})`);
}
capInput.props.onChange({ target: { value: "" } });
await flushWrites();
if (!scopeUnsets.includes("maxTitleCharacters")) {
  throw new Error("an empty character cap must unset the field, not write 0");
}

// Position and format are enums: choosing a value writes it, choosing "None"
// (the empty option) unsets it, so the host never needs an "off" sentinel.
const positionElement = findFirstElement(shapeTree, (n) => n.type === "select" && optionValues(n).includes("prefix"));
const formatElement = findFirstElement(shapeTree, (n) => n.type === "select" && optionValues(n).includes("md"));
if (!positionElement || !formatElement) throw new Error("date position/format select elements unreachable");
scopeSets.length = 0;
scopeUnsets.length = 0;
positionElement.props.onChange({ target: { value: "suffix" } });
await flushWrites();
if (!scopeSets.some(([field, value]) => field === "titleDatePosition" && value === "suffix")) {
  throw new Error(`choosing a suffix must write titleDatePosition (writes=${JSON.stringify(scopeSets)})`);
}
positionElement.props.onChange({ target: { value: "" } });
await flushWrites();
if (!scopeUnsets.includes("titleDatePosition")) {
  throw new Error("choosing 'None' must unset titleDatePosition");
}
scopeSets.length = 0;
formatElement.props.onChange({ target: { value: "md" } });
await flushWrites();
if (!scopeSets.some(([field, value]) => field === "titleDateFormat" && value === "md")) {
  throw new Error(`choosing a date format must write titleDateFormat (writes=${JSON.stringify(scopeSets)})`);
}
// What the UI can write, the host must accept: a full round trip through the
// real validator closes the "UI writes a key the host rejects" trap.
const acceptedUi = settingsModule.resolveTitleSettings({
  enabled: true, maxTitleCharacters: 20, titleDatePosition: "suffix", titleDateFormat: "md"
});
if (acceptedUi.maxTitleCharacters !== 20 || acceptedUi.titleDatePosition !== "suffix") {
  throw new Error("the UI's own writes must be accepted by resolveTitleSettings");
}
console.log("✓ client: title-shape controls render, write the right values, and pass host validation");

// ---- client: style / language / exclusions -------------------------------
fakeScopeSnapshot = {
  status: "ready",
  value: { enabled: true, titleStyle: "short-name", titleLanguage: "en", titleExclusions: ["客户甲", "Acme"] },
  user: { titleStyle: "short-name", titleLanguage: "en", titleExclusions: ["客户甲", "Acme"] },
  writable: true
};
const contentTree = await settle(capturedExport.SettingsSection, { scope, t: tZh, describe: describeFace, remote: fakeRemote });
const contentText = renderTree(contentTree).join(" ");
for (const key of ["settings.style", "settings.language", "settings.exclusions", "settings.contentHint", "settings.exclusionsHint"]) {
  if (!contentText.includes(tZh(key))) throw new Error(`zh content block missing ${key}`);
}
for (const phrase of ["Title exclusions", "Short task name", "Exclusions", "One per line"]) {
  if (contentText.includes(phrase)) throw new Error(`zh content block LEAK: '${phrase}'`);
}
const contentSelects = collectSelects(contentTree);
const styleSelect = contentSelects.find((s) => s.options.some((o) => o.value === "short-name"));
const languageSelect = contentSelects.find((s) => s.options.some((o) => o.value === "en"));
if (!styleSelect || !languageSelect) throw new Error("style/language selects missing");
// The empty option is the unset: "Default" follows the plugin policy and "Auto"
// follows the message, so the host needs no sentinel value.
for (const value of ["", "short-name", "action-object"]) {
  if (!styleSelect.options.some((o) => o.value === value)) throw new Error(`style select is missing option '${value}'`);
}
for (const value of ["", "zh", "en"]) {
  if (!languageSelect.options.some((o) => o.value === value)) throw new Error(`language select is missing option '${value}'`);
}
const exclusionsBox = findFirstElement(contentTree, (n) => n.type === "textarea");
if (!exclusionsBox) throw new Error("exclusions textarea missing");
if (exclusionsBox.props.value !== "客户甲\nAcme") {
  throw new Error(`the textarea must show one saved term per line, got ${JSON.stringify(exclusionsBox.props.value)}`);
}

const styleElement = findFirstElement(contentTree, (n) => n.type === "select" && optionValues(n).includes("short-name"));
const languageElement = findFirstElement(contentTree, (n) => n.type === "select" && optionValues(n).includes("zh"));
if (!styleElement || !languageElement) throw new Error("style/language select elements unreachable");
scopeSets.length = 0;
scopeUnsets.length = 0;
styleElement.props.onChange({ target: { value: "action-object" } });
await flushWrites();
if (!scopeSets.some(([field, value]) => field === "titleStyle" && value === "action-object")) {
  throw new Error(`choosing a style must write titleStyle (writes=${JSON.stringify(scopeSets)})`);
}
styleElement.props.onChange({ target: { value: "" } });
await flushWrites();
if (!scopeUnsets.includes("titleStyle")) throw new Error("choosing 'Default' must unset titleStyle, not write a sentinel");
scopeSets.length = 0;
scopeUnsets.length = 0;
languageElement.props.onChange({ target: { value: "zh" } });
await flushWrites();
if (!scopeSets.some(([field, value]) => field === "titleLanguage" && value === "zh")) {
  throw new Error(`choosing a language must write titleLanguage (writes=${JSON.stringify(scopeSets)})`);
}
languageElement.props.onChange({ target: { value: "" } });
await flushWrites();
if (!scopeUnsets.includes("titleLanguage")) throw new Error("choosing 'Auto' must unset titleLanguage");

// The textarea writes a LIST: blanks and duplicates are dropped client-side so the
// write is already in the shape the host stores.
scopeSets.length = 0;
scopeUnsets.length = 0;
exclusionsBox.props.onChange({ target: { value: "  客户甲  \n\nAcme\n客户甲\n" } });
await flushWrites();
const exclusionWrite = scopeSets.find(([field]) => field === "titleExclusions");
if (!exclusionWrite) throw new Error(`the textarea must write titleExclusions (writes=${JSON.stringify(scopeSets)})`);
if (JSON.stringify(exclusionWrite[1]) !== JSON.stringify(["客户甲", "Acme"])) {
  throw new Error(`the textarea must trim, drop blanks and dedupe, got ${JSON.stringify(exclusionWrite[1])}`);
}
// An emptied box is an unset, never an empty array.
exclusionsBox.props.onChange({ target: { value: "\n   \n" } });
await flushWrites();
if (!scopeUnsets.includes("titleExclusions")) throw new Error("clearing the textarea must unset titleExclusions");
// What the UI can write, the host must accept — including the round trip through
// the settings-write check, which sees a fresh array from the host, not ours.
const acceptedContentUi = settingsModule.resolveTitleSettings({
  enabled: true, titleStyle: "short-name", titleLanguage: "en", titleExclusions: ["客户甲", "Acme"]
});
if (acceptedContentUi.titleStyle !== "short-name" || acceptedContentUi.titleLanguage !== "en") {
  throw new Error("the UI's own style/language writes must be accepted by resolveTitleSettings");
}
if (JSON.stringify(acceptedContentUi.titleExclusions) !== JSON.stringify(["客户甲", "Acme"])) {
  throw new Error("the UI's own exclusion write must survive host validation unchanged");
}
console.log("✓ client: style/language/exclusion controls render, write the right values, and pass host validation");

// An over-long line must be refused with its own message rather than surfacing as
// the generic "settings could not be saved" the rejected write would produce.
scopeSets.length = 0;
scopeUnsets.length = 0;
const overlongProps = { scope, t: tZh, describe: describeFace, remote: fakeRemote };
let overlongTree = await settle(capturedExport.SettingsSection, overlongProps);
const overlongBox = findFirstElement(overlongTree, (n) => n.type === "textarea");
overlongBox.props.onChange({ target: { value: "x".repeat(65) } });
await flushWrites();
// The error lives in component state, so the tree must be re-rendered to see it.
overlongTree = await flush(capturedExport.SettingsSection, overlongProps, overlongTree);
if (scopeSets.some(([field]) => field === "titleExclusions") || scopeUnsets.includes("titleExclusions")) {
  throw new Error("an over-long exclusion must not be written at all");
}
if (!renderTree(overlongTree).join(" ").includes(tZh("settings.invalidExclusions"))) {
  throw new Error("an over-long exclusion must be reported with its own message");
}
console.log("✓ client: an over-long exclusion is refused with a named message");

// ---- client: the title lock and its two entry points ----------------------
if (typeof capturedExport.LockTitleAction !== "function") throw new Error("LockTitleAction not exported");
if (typeof capturedExport.isLockedIn !== "function") throw new Error("isLockedIn not exported");

// The lock-set reader is the shared decision point: absent, empty, non-list and
// a missing snapshot all mean "nothing locked", never a crash or a false lock.
for (const [label, snapshot, sessionId, expected] of [
  ["a locked id", { user: { lockedSessionIds: ["a"] } }, "a", true],
  ["another id", { user: { lockedSessionIds: ["a"] } }, "b", false],
  ["an absent list", { user: {} }, "a", false],
  ["no user section", {}, "a", false],
  ["an empty list", { user: { lockedSessionIds: [] } }, "a", false],
  ["no snapshot", undefined, "a", false],
  ["an empty id", { user: { lockedSessionIds: [""] } }, "", false]
]) {
  if (capturedExport.isLockedIn(snapshot, sessionId) !== expected) {
    throw new Error(`isLockedIn must be ${expected} for ${label}`);
  }
}
if (capturedExport.lockedIdsOf({ user: { lockedSessionIds: "not-a-list" } }).length !== 0) {
  throw new Error("a non-list lock value must read as nothing locked");
}

// Unlocked: the click records exactly this session id in the settings namespace.
fakeScopeSnapshot = { status: "ready", value: { enabled: true }, user: {}, writable: true, revision: 0 };
scopeSets.length = 0;
scopeUnsets.length = 0;
const lockProps = { sessionId: "s-lock", t: tZh, scope };
let lockTree = await settle(capturedExport.LockTitleAction, lockProps);
if (lockTree.props["aria-label"] !== tZh("lock.lock")) {
  throw new Error(`an unlocked session must offer "lock", got ${lockTree.props["aria-label"]}`);
}
if (lockTree.props["aria-pressed"] !== "false") throw new Error("an unlocked button must not report pressed");
lockTree.props.onClick();
await flushWrites();
const lockWrite = scopeSets.find(([field]) => field === "lockedSessionIds");
if (!lockWrite) throw new Error(`locking must write lockedSessionIds (writes=${JSON.stringify(scopeSets)})`);
if (JSON.stringify(lockWrite[1]) !== JSON.stringify(["s-lock"])) {
  throw new Error(`a lock must add exactly this session id, got ${JSON.stringify(lockWrite[1])}`);
}
// The button must show the NEW state without a reload, and offer the inverse action.
lockTree = await flush(capturedExport.LockTitleAction, lockProps, lockTree);
if (lockTree.props["aria-pressed"] !== "true") {
  throw new Error("the lock button must reflect the state it just wrote");
}
if (lockTree.props["aria-label"] !== tZh("lock.unlock")) {
  throw new Error(`a locked session must offer "unlock", got ${lockTree.props["aria-label"]}`);
}
// The second click re-reads the list at click time, so unlocking removes the id and
// an empty list becomes an unset rather than an empty array in settings.yaml.
scopeSets.length = 0;
scopeUnsets.length = 0;
lockTree.props.onClick();
await flushWrites();
if (!scopeUnsets.includes("lockedSessionIds")) {
  throw new Error("removing the last lock must unset the field, not store an empty list");
}
console.log("✓ client: the lock toggle writes, un-writes and reports the session state");

// Locked: the regenerate button beside it refuses locally, WITH the reason —
// the host's own refusal only surfaces as a generic failure.
fakeScopeSnapshot = { status: "ready", value: { enabled: true }, user: { lockedSessionIds: ["s-lock"] }, writable: true, revision: 1 };
const lockedRta = await settle(capturedExport.RegenerateTitleAction, {
  sessionId: "s-lock",
  regenerate: () => Promise.resolve({ ok: true, value: { result: { kind: "success" } } }),
  t: tZh,
  scope
});
if (lockedRta.props.disabled !== true) throw new Error("a locked session must disable the regenerate button");
if (lockedRta.props["aria-label"] !== tZh("action.locked")) {
  throw new Error(`a locked session must name the lock, got ${lockedRta.props["aria-label"]}`);
}
if (lockedRta.props.title !== tZh("action.locked")) {
  throw new Error("the lock reason must be the button's tooltip, not the generic failure text");
}
const lockedRtaEn = await settle(capturedExport.RegenerateTitleAction, {
  sessionId: "s-lock",
  regenerate: () => Promise.resolve({ ok: true, value: { result: { kind: "success" } } }),
  t: tEn,
  scope
});
if (lockedRtaEn.props["aria-label"] !== tEn("action.locked")) {
  throw new Error(`RegenerateTitleAction lock label not en: ${lockedRtaEn.props["aria-label"]}`);
}
// ...and an UNLOCKED session keeps the button enabled: the gate is the lock only.
const openRta = await settle(capturedExport.RegenerateTitleAction, {
  sessionId: "s-open",
  regenerate: () => Promise.resolve({ ok: true, value: { result: { kind: "success" } } }),
  t: tZh,
  scope
});
if (openRta.props.disabled !== false) throw new Error("an unlocked session must keep regeneration enabled");
console.log("✓ client: a locked session disables regeneration locally and says why");

// The batch list drops locked sessions, reports how many, and cannot select them.
const lockBatchRows = [
  { sessionId: "lock-me", blank: false, cwd: "/proj/a", updatedAt: 1700000000000 },
  { sessionId: "keep-me", blank: false, cwd: "/proj/a", updatedAt: 1700000001000 }
];
const lockBatchProps = {
  t: tZh,
  batch: capturedExport.createBatchController(() => Promise.resolve()),
  listSessions: () => Promise.resolve({ ok: true, value: { items: lockBatchRows } }),
  disabled: false,
  lockedSessionIds: ["lock-me"]
};
let lockBatchTree = await settle(capturedExport.BatchTitleOptimizer, lockBatchProps);
collectButtons(lockBatchTree).find((b) => b.text === tZh("batch.reload")).props.onClick();
lockBatchTree = await flush(capturedExport.BatchTitleOptimizer, lockBatchProps, lockBatchTree);
const lockBatchText = renderTree(lockBatchTree).join(" ");
if (!lockBatchText.includes(tZh("batch.count") + ": 1")) {
  throw new Error(`the batch list must count only unlocked sessions: ${lockBatchText}`);
}
if (!lockBatchText.includes(tZh("batch.skippedLocked") + ": 1")) {
  throw new Error(`the batch list must report the locked session it skipped: ${lockBatchText}`);
}
// Select-all is the strongest check that the row is really gone: a locked session
// that were merely hidden could still be swept into the run here.
collectButtons(lockBatchTree).find((b) => b.text === tZh("batch.selectAll")).props.onClick();
lockBatchTree = await flush(capturedExport.BatchTitleOptimizer, lockBatchProps, lockBatchTree);
if (!renderTree(lockBatchTree).join(" ").includes(tZh("batch.selectedCount") + ": 1")) {
  throw new Error("select-all must not be able to select a locked session");
}
console.log("✓ client: the batch list excludes locked sessions and reports the count");

// ---- host: the provider end to end (affix + cap on a real generate) ------
// The shape logic is only worth anything if `generate()` passes the session's
// creation time and the user's cap through to the accepted title, so the real
// provider is driven here with a fake LLM stream.
const providerModule = await import(join(ROOT, "lib/provider.js"));
const configModule = await import(join(ROOT, "lib/config.js"));
const baseConfig = configModule.resolveTitleConfig(undefined);
const MODEL_TEXT = "修复认证中间件的会话刷新竞态条件并保持公开 API 不变";

/** Minimal BlockAssembler: the provider only pushes, reads `finish`, then blocks. */
class FakeAssembler {
  constructor() {
    this.finish = { kind: "stop" };
  }
  push() {}
  blocks() {
    return [{ type: "text", text: MODEL_TEXT }];
  }
}

/** Build a provider whose model always returns `MODEL_TEXT`. */
function buildProvider(settings, createdAt) {
  const provider = providerModule.createSmartSessionTitleProvider(
    () => ({ config: baseConfig, settings: settingsModule.resolveTitleSettings(settings) }),
    {
      llm: { stream: async function* () { yield { type: "text" }; } },
      createUserMessage: (message) => message,
      BlockAssembler: FakeAssembler,
      now: () => CREATED_AT,
      readTitle: () => undefined,
      consumeExplicitRegeneration: () => false
    }
  );
  const request = {
    session: { id: "shape-session", header: { createdAt } },
    route: { provider: "scnet", model: "DeepSeek-V4-Flash" },
    messages: [{ seq: 1, text: "帮我修复认证中间件的会话刷新竞态条件，不要修改公开 API" }],
    signal: new AbortController().signal
  };
  return provider.generate(request);
}

const suffixYmd = await buildProvider({ titleDatePosition: "suffix", titleDateFormat: "ymd" }, CREATED_AT);
const expectedSuffix = buildTitleAffix({ position: "suffix", format: "ymd", createdAt: CREATED_AT });
if (!suffixYmd.title.endsWith(expectedSuffix)) {
  throw new Error(`generate() must append the session-date suffix: ${suffixYmd.title}`);
}
// Moving the CREATION time (not the clock) must move the affix: `deps.now` is
// pinned to CREATED_AT above, so a "now"-based implementation cannot pass this.
const laterCreation = await buildProvider(
  { titleDatePosition: "suffix", titleDateFormat: "ymd" },
  CREATED_AT + 10 * 24 * 3600 * 1000
);
if (laterCreation.title === suffixYmd.title) {
  throw new Error("the affix must follow session.header.createdAt, not the wall clock");
}
const prefixMd = await buildProvider(
  { titleDatePosition: "prefix", titleDateFormat: "md" },
  CREATED_AT
);
if (!prefixMd.title.startsWith(buildTitleAffix({ position: "prefix", format: "md", createdAt: CREATED_AT }))) {
  throw new Error(`generate() must prepend the date prefix: ${prefixMd.title}`);
}
console.log("✓ host: generate() applies the date affix from the session's creation time");

// The cap and the reservation must both hold on the FINAL title.
const cappedAffixed = await buildProvider(
  { maxTitleCharacters: 12, titleDatePosition: "suffix", titleDateFormat: "ymd" },
  CREATED_AT
);
const cappedBody = cappedAffixed.title.slice(0, -expectedSuffix.length);
if (Array.from(cappedBody).length > 12) {
  throw new Error(`the character cap must bound the body only: ${cappedAffixed.title}`);
}
if (!cappedAffixed.title.endsWith(expectedSuffix)) {
  throw new Error("the cap must not eat the reserved suffix");
}
if (policyModule.byteLength(cappedAffixed.title) > 80) {
  throw new Error(`the final title must stay inside the 80-byte budget: ${cappedAffixed.title}`);
}
// No shape settings at all = the pre-existing behaviour, byte for byte.
const plain = await buildProvider({}, CREATED_AT);
const plainExpected = policyModule.validateGeneratedTitle(MODEL_TEXT, 80, undefined);
if (plain.title !== plainExpected.title) {
  throw new Error("an unconfigured provider must produce exactly the old title");
}
console.log("✓ host: generate() keeps the 80-byte budget and the no-affix default");

// ---- host: exclusions end to end (redact → retry → mask) ------------------
// The two-layer treatment is only worth anything if the REAL provider redacts
// before the call and never abstains in a way that hands the session back to
// DSH's fallback title (which is derived from the raw prompt and would put the
// excluded word straight back onto the sidebar).
const EXCLUDED = "客户甲";

/** Drive the real provider with a chosen model output and a chosen message. */
function exclusionRun(settings, modelText, message) {
  const streams = [];
  class TextAssembler {
    constructor() { this.finish = { kind: "stop" }; }
    push() {}
    blocks() { return [{ type: "text", text: modelText }]; }
  }
  const provider = providerModule.createSmartSessionTitleProvider(
    () => ({ config: baseConfig, settings: settingsModule.resolveTitleSettings(settings) }),
    {
      llm: { stream: async function* (options) { streams.push(options); yield { type: "text" }; } },
      createUserMessage: (m) => m,
      BlockAssembler: TextAssembler,
      now: () => CREATED_AT,
      readTitle: () => undefined,
      consumeExplicitRegeneration: () => false
    }
  );
  const run = provider.generate({
    session: { id: "exclusion-session", header: { createdAt: CREATED_AT } },
    route: { provider: "scnet", model: "DeepSeek-V4-Flash" },
    messages: [{ seq: 1, text: message }],
    signal: new AbortController().signal
  });
  return { run, streams };
}
const promptTextOf = (options) => options.messages[0].content[0].text;

// A compliant model: the term is gone before the call, in both halves of the prompt.
const compliant = exclusionRun({ titleExclusions: [EXCLUDED] }, "修复订单导出错误", `修复${EXCLUDED}的订单导出错误，不要改公开 API`);
const compliantResult = await compliant.run;
if (compliantResult.title !== "修复订单导出错误") {
  throw new Error(`a compliant title must be accepted as-is: ${compliantResult.title}`);
}
if (compliant.streams.length !== 1) throw new Error("a clean title must need exactly one call");
for (const options of compliant.streams) {
  if (promptTextOf(options).includes(EXCLUDED)) throw new Error("the term must be removed from the message the model receives");
  if (options.system.includes(EXCLUDED)) throw new Error("the term must never appear in the system prompt");
  if (!options.system.includes("removed from the message on purpose")) {
    throw new Error("a configured exclusion list must tell the model that names were removed");
  }
}
console.log("✓ host: exclusions are deleted before the model call and never sent");

// A model that ignores the removal: exactly one retry, then a deterministic mask.
const stubborn = exclusionRun({ titleExclusions: [EXCLUDED] }, `修复${EXCLUDED}的订单导出错误`, `修复${EXCLUDED}的订单导出错误`);
const stubbornResult = await stubborn.run;
if (stubborn.streams.length !== 2) {
  throw new Error(`a surviving term must be retried exactly once (calls=${stubborn.streams.length})`);
}
if (stubbornResult.title !== "修复的订单导出错误") {
  throw new Error(`masking must delete the term in place: ${stubbornResult.title}`);
}
if (!promptTextOf(stubborn.streams[1]).includes("Never restore a name that was removed")) {
  throw new Error("the retry must forbid restoring a removed name");
}
console.log("✓ host: a surviving term is retried once, then deleted from the title");

// A term the model keeps returning AND that cannot be masked away: fail loudly.
// The service's fallback is the documented (and unavoidable) limit here.
let unmaskableError;
try {
  await exclusionRun({ titleExclusions: [EXCLUDED] }, EXCLUDED, `修复${EXCLUDED}的订单导出错误`).run;
} catch (error) {
  unmaskableError = error;
}
if (!(unmaskableError instanceof Error) || !/after masking/.test(unmaskableError.message)) {
  throw new Error(`an unmaskable title must fail loudly, got ${String(unmaskableError)}`);
}
console.log("✓ host: an unmaskable title fails loudly instead of storing an empty one");

// A prompt that was nothing but excluded terms: decline before spending a call.
const wholeTaskIsExcluded = "帮我修复登录接口的超时问题";
const emptyRun = exclusionRun({ titleExclusions: [wholeTaskIsExcluded] }, "unused", wholeTaskIsExcluded);
let abstainedError;
try {
  await emptyRun.run;
} catch (error) {
  abstainedError = error;
}
if (!(abstainedError instanceof providerModule.TitleAbstention) || abstainedError.abstentionReason !== "empty-after-redaction") {
  throw new Error(`an all-excluded prompt must abstain, got ${String(abstainedError)}`);
}
if (emptyRun.streams.length !== 0) {
  throw new Error("an all-excluded prompt must not reach the model at all");
}
console.log("✓ host: an all-excluded prompt abstains without a model call");

// Case-insensitivity, end to end: a Latin term is matched the way the UI promises.
const latinRun = exclusionRun({ titleExclusions: ["Acme"] }, "Fix ACME login timeout", "Fix Acme login timeout");
const latinResult = await latinRun.run;
if (latinResult.title.includes("ACME") || latinResult.title.includes("Acme")) {
  throw new Error(`a Latin exclusion must match case-insensitively: ${latinResult.title}`);
}
console.log("✓ host: a Latin exclusion matches case-insensitively end to end");

// The style and language preferences must reach the model, not just the settings page.
const shaped = exclusionRun({ titleStyle: "short-name", titleLanguage: "en" }, "Login endpoint timeout", "帮我修复登录接口的超时问题");
await shaped.run;
const shapedStream = shaped.streams[0];
if (!shapedStream.system.includes("compact noun phrase")) {
  throw new Error("the chosen style must reach the system prompt");
}
if (!shapedStream.system.includes("Write the title in English")) {
  throw new Error("the chosen language must reach the system prompt");
}
console.log("✓ host: style and language reach the model on a real generate()");

// ---- host: the lock gates the provider, and must not spend the permission ----
// `/retitle` refuses a locked session in its own handler (covered by the host
// policy suite). This is the OTHER entry point: an automatic schedule, or a token
// that was granted before the lock was set. Both must abstain, and neither may
// consume the explicit marker — a spent permission would be inherited by the next
// automatic schedule and rewrite the very title the lock protects.
let lockTokensConsumed = 0;
const lockStreams = [];
class LockAssembler {
  constructor() { this.finish = { kind: "stop" }; }
  push() {}
  blocks() { return [{ type: "text", text: "修复登录接口超时" }]; }
}
const lockedProvider = providerModule.createSmartSessionTitleProvider(
  () => ({ config: baseConfig, settings: settingsModule.resolveTitleSettings({ lockedSessionIds: ["locked-session"] }) }),
  {
    llm: { stream: async function* (options) { lockStreams.push(options); yield { type: "text" }; } },
    createUserMessage: (m) => m,
    BlockAssembler: LockAssembler,
    now: () => CREATED_AT,
    readTitle: () => undefined,
    consumeExplicitRegeneration: () => { lockTokensConsumed += 1; return true; }
  }
);
let lockedError;
try {
  await lockedProvider.generate({
    session: { id: "locked-session", header: { createdAt: CREATED_AT } },
    route: { provider: "scnet", model: "DeepSeek-V4-Flash" },
    messages: [{ seq: 1, text: "帮我修复登录接口的超时问题" }],
    signal: new AbortController().signal
  });
} catch (error) {
  lockedError = error;
}
if (!(lockedError instanceof providerModule.TitleAbstention) || lockedError.abstentionReason !== "locked") {
  throw new Error(`a locked session must abstain with reason "locked", got ${String(lockedError)}`);
}
if (lockTokensConsumed !== 0) {
  throw new Error("a locked session must NOT consume the explicit-regeneration token");
}
if (lockStreams.length !== 0) {
  throw new Error("a locked session must not reach the model at all");
}
// The same session, unlocked, still generates — the gate is the lock, not the id.
const unlockedProvider = providerModule.createSmartSessionTitleProvider(
  () => ({ config: baseConfig, settings: settingsModule.resolveTitleSettings({ lockedSessionIds: ["other-session"] }) }),
  {
    llm: { stream: async function* () { yield { type: "text" }; } },
    createUserMessage: (m) => m,
    BlockAssembler: LockAssembler,
    now: () => CREATED_AT,
    readTitle: () => undefined,
    consumeExplicitRegeneration: () => false
  }
);
const unlockedResult = await unlockedProvider.generate({
  session: { id: "locked-session", header: { createdAt: CREATED_AT } },
  route: { provider: "scnet", model: "DeepSeek-V4-Flash" },
  messages: [{ seq: 1, text: "帮我修复登录接口的超时问题" }],
  signal: new AbortController().signal
});
if (unlockedResult.title === "") throw new Error("a session that is not in the lock list must still generate");
// The lock outranks the content gates, so the diagnostic names the user's own
// decision rather than a generic "nothing to title yet".
let emptyLockedError;
try {
  await lockedProvider.generate({
    session: { id: "locked-session", header: { createdAt: CREATED_AT } },
    route: { provider: "scnet", model: "DeepSeek-V4-Flash" },
    messages: [],
    signal: new AbortController().signal
  });
} catch (error) {
  emptyLockedError = error;
}
if (!(emptyLockedError instanceof providerModule.TitleAbstention) || emptyLockedError.abstentionReason !== "locked") {
  throw new Error(`a locked session with no messages must still report "locked", got ${String(emptyLockedError)}`);
}
// ...and the same empty input WITHOUT the lock reports the generic reason, which is
// what makes the assertion above about ordering rather than about empty input.
let emptyOpenError;
try {
  await providerModule.createSmartSessionTitleProvider(
    () => ({ config: baseConfig, settings: settingsModule.resolveTitleSettings({}) }),
    {
      llm: { stream: async function* () { yield { type: "text" }; } },
      createUserMessage: (m) => m,
      BlockAssembler: LockAssembler,
      now: () => CREATED_AT,
      readTitle: () => undefined,
      consumeExplicitRegeneration: () => false
    }
  ).generate({
    session: { id: "locked-session", header: { createdAt: CREATED_AT } },
    route: { provider: "scnet", model: "DeepSeek-V4-Flash" },
    messages: [],
    signal: new AbortController().signal
  });
} catch (error) {
  emptyOpenError = error;
}
if (!(emptyOpenError instanceof providerModule.TitleAbstention) || emptyOpenError.abstentionReason !== "no-source-message") {
  throw new Error(`an unlocked session with no messages must report no-source-message, got ${String(emptyOpenError)}`);
}
console.log("✓ host: the lock abstains without a model call and without spending the /retitle permission");



// ---- audit regressions: malformed results, fallback totals and cancellation ----
const assert = (condition, message) => { if (!condition) throw new Error(message); };
for (const outcome of [null, { ok: true, value: null }, { result: null }, 7, {}]) {
  assert(capturedExport.interpretOutcome(outcome).kind !== "success", "malformed result must not succeed");
}
const malformedBatch = capturedExport.createBatchController(() => Promise.resolve({ ok: true, value: null }));
assert((await malformedBatch.start([{ sessionId: "constructor" }])).failed === 1, "malformed result must settle as a failure");
assert(!malformedBatch.isRunning(), "malformed result must release the batch");
const brokenOutcome = capturedExport.createBatchController(() => Promise.resolve({ get result() { throw new Error("bad result"); } }));
assert((await brokenOutcome.start([{ sessionId: "bad" }])).status === "error", "unexpected errors must settle into a visible error state");
assert(!brokenOutcome.isRunning(), "unexpected errors must release the runner");
console.log("✓ audit: malformed Remote results and unexpected errors settle without rejection");

const successOutcome = { ok: true, value: { result: { kind: "success" } } };
const failureOutcome = { ok: true, value: { result: { kind: "error", text: "original failure" } } };
const attempts = new Map();
const totalsBatch = capturedExport.createBatchController(id => {
  const attempt = (attempts.get(id) || 0) + 1; attempts.set(id, attempt);
  return Promise.resolve(Number(id) < 4 || (attempt > 1 && Number(id) < 8) ? successOutcome : failureOutcome);
}, { runFallback: (rows, retry) => retry(rows) });
totalsBatch.setAutoFallback(true);
const totals = await totalsBatch.start(Array.from({ length: 10 }, (_, i) => ({ sessionId: String(i) })));
assert(totals.total === 10 && totals.completed === 10 && totals.succeeded === 8 && totals.failed === 2, "fallback must preserve overall 10/10 and 8 success / 2 failures");
assert(totals.retryTotal === 6 && totals.retryCompleted === 6, "fallback must track separate 6/6 retry progress");
console.log("✓ audit: fallback keeps overall totals and separate retry progress");

let retryStarted;
const retryReady = new Promise(resolve => { retryStarted = resolve; });
let stopCalls = 0;
const stopBatch = capturedExport.createBatchController((id, signal) => {
  stopCalls += 1;
  if (stopCalls <= 2) return Promise.resolve(failureOutcome);
  retryStarted();
  return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true }));
}, { runFallback: (rows, retry) => retry(rows) });
stopBatch.setAutoFallback(true);
const stopTask = stopBatch.start([{ sessionId: "a" }, { sessionId: "b" }]);
await retryReady; stopBatch.cancel();
const stopped = await stopTask;
assert(stopped.status === "cancelled" && stopped.fallback === "cancelled", "stopped fallback must not say done");
assert(stopCalls === 3 && stopped.failed === 2 && stopped.retryCompleted === 0, "interrupted retry preserves original failures and does not start another call");
console.log("✓ audit: stopping fallback keeps original failures and reports cancellation");

// Real apply wiring: writes rejected by recovery, user mode edits, and restore failure.
const routeSnapshot = () => ({ status: "ready", writable: true, value: { enabled: true, mode: "current-session", provider: "scnet", model: "m" }, user: { mode: "current-session", provider: "scnet", model: "m" } });
fakeScopeSnapshot = routeSnapshot();
let liveAttempt = 0;
fakeRemote.commands.execute = () => {
  if (++liveAttempt === 1) return Promise.resolve(failureOutcome);
  return face.scope.mutate([{ op: "set", path: ["mode"], value: "disabled" }]) || Promise.resolve(successOutcome);
};
// The injected settings scope is named scope in the actual settings slot.
assert(face.scope, "settings scope injection missing");
face.batch.setAutoFallback(true);
await face.batch.start([{ sessionId: "changed-mode" }]);
assert(fakeScopeSnapshot.value.mode === "disabled", "fallback must preserve a user mode change");

fakeScopeSnapshot = routeSnapshot();
liveAttempt = 0;
fakeRemote.commands.execute = () => {
  if (++liveAttempt === 1) return Promise.resolve(failureOutcome);
  face.scope.mutate([{ op: "set", path: ["mode"], value: "disabled" }]);
  face.scope.mutate([{ op: "set", path: ["mode"], value: "configured" }]);
  return Promise.resolve(successOutcome);
};
await face.batch.start([{ sessionId: "changed-back" }]);
assert(fakeScopeSnapshot.value.mode === "configured", "observed change away and back must not be restored over");
console.log("✓ audit: fallback preserves mode changes, including changes away and back");

const realMutate = face.scope.mutate;
fakeScopeSnapshot = routeSnapshot();
face.scope.mutate = () => Promise.resolve(); // DSH failure path recovers then resolves.
liveAttempt = 0;
fakeRemote.commands.execute = () => { liveAttempt++; return Promise.resolve(failureOutcome); };
const rejectedSwitch = await face.batch.start([{ sessionId: "rejected-switch" }]);
assert(liveAttempt === 1 && rejectedSwitch.fallback === "failed", "a rejected route switch must not run the retry");
face.scope.mutate = realMutate;

fakeScopeSnapshot = routeSnapshot();
liveAttempt = 0;
fakeRemote.commands.execute = () => {
  if (++liveAttempt === 1) return Promise.resolve(failureOutcome);
  face.scope.mutate = () => Promise.resolve();
  return Promise.resolve(successOutcome);
};
const rejectedRestore = await face.batch.start([{ sessionId: "rejected-restore" }]);
assert(rejectedRestore.fallback === "failed" && rejectedRestore.succeeded === 1, "restore failure must be visible without losing successful retry");
face.scope.mutate = realMutate;
fakeRemote.commands.execute = originalExecute;
console.log("✓ audit: failed mode switching and restoration are detected");

for (const translate of [tZh, tEn]) {
  fakeScopeSnapshot = { status: "ready", writable: true, value: { enabled: true }, user: {} };
  const props = { scope, t: translate };
  let tree = await settle(capturedExport.SettingsSection, props);
  for (const raw of ["5", "121", "12.5", "20oops"]) {
    const input = collectInputs(tree, "number").find(i => i.props.min === 8);
    const before = scopeMutations.length;
    input.props.onChange({ target: { value: raw } });
    await flushWrites(); tree = await flush(capturedExport.SettingsSection, props, tree);
    assert(scopeMutations.length === before, "invalid numeric input must not reach the host");
    assert(renderTree(tree).join(" ").includes(translate("settings.invalidNumber")), "invalid numeric input must have a localized explanation");
  }
  const originalMutate = scope.mutate;
  scope.mutate = () => Promise.resolve();
  collectInputs(tree, "number").find(i => i.props.min === 8).props.onChange({ target: { value: "20" } });
  await flushWrites(); tree = await flush(capturedExport.SettingsSection, props, tree);
  assert(renderTree(tree).join(" ").includes(translate("settings.saveFailed")), "silently rejected write must show a localized error");
  scope.mutate = originalMutate;
  collectInputs(tree, "number").find(i => i.props.min === 8).props.onChange({ target: { value: "20" } });
  await flushWrites(); tree = await flush(capturedExport.SettingsSection, props, tree);
  assert(!renderTree(tree).join(" ").includes(translate("settings.saveFailed")), "a successful retry must clear the error");
  collectInputs(tree, "number").find(i => i.props.min === 8).props.onChange({ target: { value: "20" } });
  await flushWrites(); tree = await flush(capturedExport.SettingsSection, props, tree);
  assert(!renderTree(tree).join(" ").includes(translate("settings.saveFailed")), "saving an unchanged value must succeed");
}
console.log("✓ audit: numeric validation, silent write rejection, recovery and same-value saves in zh/en");
// A concurrent update after the restore snapshot must defeat its fixed revision.
fakeScopeSnapshot = { ...routeSnapshot(), revision: 100 };
liveAttempt = 0;
fakeRemote.commands.execute = () => {
  if (++liveAttempt === 1) return Promise.resolve(failureOutcome);
  face.scope.mutate = (ops, revision) => {
    fakeScopeSnapshot = { ...fakeScopeSnapshot, revision: fakeScopeSnapshot.revision + 1,
      value: { ...fakeScopeSnapshot.value, mode: "disabled" },
      user: { ...fakeScopeSnapshot.user, mode: "disabled" } };
    return realMutate(ops, revision);
  };
  return Promise.resolve(successOutcome);
};
const racedRestore = await face.batch.start([{ sessionId: "revision-race" }]);
assert(fakeScopeSnapshot.value.mode === "disabled", "stale restoration must not overwrite a concurrent update");
assert(racedRestore.fallback === "failed", "revision-conflicted restore must be visible");
face.scope.mutate = realMutate;
fakeRemote.commands.execute = originalExecute;
console.log("✓ audit: fixed revision prevents a concurrent restore overwrite");
// Workspace navigation and persisted route semantics in both locales.
const workspaceBatch = capturedExport.createBatchController(() => Promise.resolve(successOutcome));
for (const translate of [tZh, tEn]) {
  fakeScopeSnapshot = { status: "ready", writable: true,
    value: { enabled: true, mode: "configured", provider: "scnet", model: "m", maxTitleCharacters: 25 },
    user: { mode: "configured", provider: "scnet", model: "m", maxTitleCharacters: 25 } };
  const props = { scope, t: translate, batch: workspaceBatch, listSessions: uiListSessions };
  let tree = await settle(capturedExport.SettingsSection, props);
  assert(!findFirstElement(tree, n => n.type === capturedExport.BatchTitleOptimizer), "batch workspace must not mount in settings");
  assert(collectInputs(tree, "radio").length === 2, "model picker has two choices");
  assert(renderTree(tree).join(" ").includes("scnet / m"), "heading shows saved model");
  assert(findFirstElement(tree, n => n.props?.hidden === true && findFirstElement(n, c => c.props?.id === "sst-dateFormat")), "date format hidden without date affix");
  collectButtons(tree).find(b => b.text === translate("batch.open")).props.onClick();
  tree = await flush(capturedExport.SettingsSection, props, tree);
  const batchNode = findFirstElement(tree, n => n.type === capturedExport.BatchTitleOptimizer);
  assert(batchNode && batchNode.props.route.model === "m", "workspace uses saved route");
  collectButtons(tree).find(b => b.text === translate("batch.back")).props.onClick();
  tree = await flush(capturedExport.SettingsSection, props, tree);
  assert(!findFirstElement(tree, n => n.type === capturedExport.BatchTitleOptimizer), "back returns to settings");
}
let workspaceTree = await settle(capturedExport.BatchTitleOptimizer, {
  t: tZh, batch: workspaceBatch, listSessions: uiListSessions,
  route: { mode: "configured", provider: "scnet", model: "m" }
});
assert(workspaceTree.type === "section", "batch is a standalone workspace");
assert(!renderTree(workspaceTree).includes(tZh("batch.fallback")), "fixed model hides redundant fallback");
assert(!workspaceBatch.isAutoFallback(), "fixed model disables automatic fallback");
const search = collectInputs(workspaceTree, "search")[0];
search.props.onChange({ target: { value: "Old title one" } });
workspaceTree = await flush(capturedExport.BatchTitleOptimizer, { t: tZh, batch: workspaceBatch, listSessions: uiListSessions }, workspaceTree);
assert(renderTree(workspaceTree).join(" ").includes("Old title one") && !renderTree(workspaceTree).join(" ").includes("Old title two"), "search filters titles");
const runningFace = { ...workspaceBatch, getSnapshot: () => ({ ...workspaceBatch.getSnapshot(), status: "running", total: 2, completed: 1 }) };
workspaceTree = await settle(capturedExport.BatchTitleOptimizer, { t: tZh, batch: runningFace, listSessions: uiListSessions });
assert(findFirstElement(workspaceTree, n => n.type === "button" && renderTree(n).join("").includes(tZh("batch.cancel"))), "workspace retains Stop");
console.log("✓ redesign: navigation, saved route, conditional date, model choices, search and Stop");
console.log("\n✅ ALL TESTS PASSED");
