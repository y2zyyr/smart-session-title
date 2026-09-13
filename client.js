/**
 * `smart-session-title` — browser half.
 *
 * Contributes ONE lightweight action to the official Session-header slot
 * `conversation.session.header.actions` (kind `list`, scope `session`,
 * `replaceRisk: "none"`, documented as "Title-adjacent Session actions in
 * ascending order").
 *
 * The action does not implement regeneration. It invokes the host command
 * `/retitle` through the SAME public Remote the shipped clients use
 * (`ctx.remote.commands.execute(sessionId, line, [])`, cf.
 * `dsh-client-ui-plan`), so the host runs the real command handler, which calls
 * the real `SessionTitleService.refresh()`. No HTTP server, no DOM patching, no
 * Electron IPC, no React-owner-chain patching.
 *
 * Why hand-written instead of built: a client half is a browser module loaded
 * through `window.__ModuleLoader__.load`, and the packages it needs (`react`,
 * the primitives) are supplied by the runtime's `require`, not by node_modules.
 * Bundling would add a toolchain for no benefit, so this file is written
 * directly against that contract — the same shape shipped client plugins use.
 *
 * Styling follows the shipped header-action affordance (a 28px round,
 * transparent, icon-only button) using the design-token custom properties the
 * shipped CSS uses (`--dsw-alias-*`). No official stylesheet is modified and no
 * icon library is added.
 */

window.__ModuleLoader__.load({
  id: "smart-session-title",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");
    var jsxRuntime = require("react/jsx-runtime");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    /** Locale namespace for this plugin's strings. */
    var NS = "smart-session-title";

    /** The command line the host understands. */
    var RETITLE_LINE = "/retitle";

    /**
     * This plugin's version, shown in the settings page footer.
     *
     * This half is hand-written (see the file header), so no build step can
     * inject the value from package.json the way a bundled client half does.
     * The two are kept in sync deliberately: `validation/verify-i18n.mjs`
     * fails when this string and package.json's `version` drift apart.
     */
    var PLUGIN_VERSION = "0.2.0-rc.3";

    /** Simplified Chinese dictionary (the key-set source of truth). */
    var zh = {
      // Header action ----------------------------------------------
      "action.regenerate": "重新生成标题",
      "action.regenerating": "正在重新生成标题…",
      "action.disabled": "AI 标题已关闭",
      "action.unavailable": "重新生成标题：命令不可用",
      "action.failed": "重新生成标题失败",
      // Settings nav label -----------------------------------------
      "nav": "智能会话标题",
      // Settings page ----------------------------------------------
      "settings.unavailable": "当前浏览器中无法使用此设置。",
      "settings.loading": "正在加载…",
      "settings.enabled": "AI 标题生成",
      "settings.modelLegend": "标题模型",
      "settings.modeCurrent": "跟随当前会话模型",
      "settings.modeConfigured": "指定模型",
      "settings.modeDisabled": "已禁用",
      "settings.provider": "Provider",
      "settings.providerPlaceholder": "Provider ID",
      "settings.model": "模型",
      "settings.modelPlaceholder": "模型 ID",
      "settings.selectProvider": "选择 Provider…",
      "settings.selectModel": "选择模型…",
      "settings.manualModelHint": "该 Provider 未在此列出模型，请直接填写模型 ID。",
      "settings.directoryUnavailable": "无法读取 DSH 的模型目录，请手动填写 Provider 与模型 ID。",
      "settings.configuredNotice": "标题将由该 provider 生成：压缩后的首条提示会发送给它，可能与你的会话 provider 不同。",
      "settings.saveRoute": "保存指定模型",
      "settings.saveFailed": "设置保存失败。请检查填写内容与 DSH 日志。",
      "settings.disabledNote": "AI 标题已关闭。DSH 仍会根据首条提示设置 fallback 标题，人工重命名不受影响。",
      "settings.advanced": "高级",
      "settings.timeout": "超时（毫秒）",
      "settings.maxAttempts": "最大尝试次数",
      "settings.advancedHint": "留空表示继承部署的 composition 配置。改动作用于下一次标题生成；凭据仍由 DSH 管理。",
      "settings.version": "版本"
    };

    /** English dictionary, key-identical to the Chinese source of truth. */
    var en = {
      // Header action ----------------------------------------------
      "action.regenerate": "Regenerate title",
      "action.regenerating": "Regenerating title…",
      "action.disabled": "AI title generation is disabled",
      "action.unavailable": "Regenerate title: command unavailable",
      "action.failed": "Regenerate title failed",
      // Settings nav label -----------------------------------------
      "nav": "Smart Session Title",
      // Settings page ----------------------------------------------
      "settings.unavailable": "Settings are unavailable in this browser.",
      "settings.loading": "Loading…",
      "settings.enabled": "AI title generation",
      "settings.modelLegend": "Title model",
      "settings.modeCurrent": "Current session model",
      "settings.modeConfigured": "Configured model",
      "settings.modeDisabled": "Disabled",
      "settings.provider": "Provider",
      "settings.providerPlaceholder": "Provider ID",
      "settings.model": "Model",
      "settings.modelPlaceholder": "Model ID",
      "settings.selectProvider": "Select a provider…",
      "settings.selectModel": "Select a model…",
      "settings.manualModelHint": "This provider lists no models here; enter the model ID directly.",
      "settings.directoryUnavailable": "Could not read the DSH model directory; enter the provider and model IDs manually.",
      "settings.configuredNotice": "Titles will be generated by this provider: the compressed first prompt is sent to it, which may differ from your session provider.",
      "settings.saveRoute": "Save configured model",
      "settings.saveFailed": "Settings could not be saved. Check the values and DSH logs.",
      "settings.disabledNote": "AI titles are off. DSH still sets a fallback title from your first prompt, and manual renames are unaffected.",
      "settings.advanced": "Advanced",
      "settings.timeout": "Timeout (ms)",
      "settings.maxAttempts": "Max attempts",
      "settings.advancedHint": "An empty field inherits the deployment's composition config. Changes apply to the next title generation; credentials stay managed by DSH.",
      "settings.version": "Version"
    };

    /**
     * In-flight guard: at most ONE regeneration per session.
     *
     * A second click while a regeneration is running joins the existing promise
     * instead of issuing another command, so double-clicking cannot start two
     * operations. The host would supersede the older one anyway (verified in the
     * R4 test), but not issuing it is cheaper and keeps the first click's result.
     *
     * @param execute - `(sessionId, line) => Promise<outcome>`.
     */
    function createRegenerationController(execute) {
      var active = new Map();
      return {
        isActive: function (sessionId) {
          return active.has(sessionId);
        },
        /** Run (or join) one regeneration. Resolves to the outcome, or rejects. */
        run: function (sessionId) {
          var existing = active.get(sessionId);
          if (existing !== undefined) return existing;
          var run = Promise.resolve()
            .then(function () {
              return execute(sessionId, RETITLE_LINE);
            })
            .then(
              function (outcome) {
                active.delete(sessionId);
                return outcome;
              },
              function (error) {
                active.delete(sessionId);
                throw error;
              }
            );
          active.set(sessionId, run);
          return run;
        }
      };
    }

    /**
     * Interpret one `commands.execute` outcome.
     *
     * The Remote wraps the host outcome in `{ ok, value }`; the host returns
     * `{ commandId, result }`, or `undefined` when no
     * command matched. The command's own text is already rendered by DSH as a
     * command flow node; this only decides the button's transient state.
     */
    function interpretOutcome(outcome) {
      if (outcome && typeof outcome.ok === "boolean") {
        if (!outcome.ok) return { kind: "error" };
        outcome = outcome.value;
      }
      if (outcome === undefined) return { kind: "unavailable" };
      var result = outcome.result;
      if (result !== undefined && result.kind === "success") return { kind: "success" };
      return { kind: "error" };
    }

    /** Icon-only action button, matching the shipped header-action affordance. */
    /**
     * Resolve the framework-injected translator for a slot component.
     *
     * The slot registration's `locale` option is what wires the `t` seat into
     * the component props; this helper only guards against a future shell that
     * stops injecting it, echoing the key instead of crashing the section.
     */
    function translatorOf(props) {
      var t = props.t;
      return typeof t === "function" ? t : function (key) { return key; };
    }

    /** Whether the live settings say AI titles are off. */
    function isAiDisabledSnapshot(settingsSnapshot) {
      if (settingsSnapshot === undefined || settingsSnapshot === null) return false;
      if (settingsSnapshot.status !== "ready") return false;
      var value = settingsSnapshot.value;
      if (value === undefined || value === null) return false;
      return value.enabled === false || value.mode === "disabled";
    }

    /**
     * Read the cross-namespace settings mirror into a provider -> model-name
     * map, so the configured-mode selectors can offer the models the user has
     * already registered in DSH's Models page instead of free-text IDs.
     *
     * Two document shapes are covered (both seen in real DSH deployments):
     *   1. `<ns>.providers.<providerId>.models = [{ name, ... }]`  (llm-pi-ai)
     *   2. `<ns>.models = [{ name, ... }]`                          (llm-deepseek)
     * Form 2's provider id is resolved later through `listConfigurableProviders`
     * (settingsNs -> provider), so it is stored under a synthetic `ns:` key.
     */
    function readProviderModels(describeSnapshot) {
      var byProvider = {};
      var view = describeSnapshot && describeSnapshot.view;
      var namespaces = view && Array.isArray(view.namespaces) ? view.namespaces : [];
      for (var index = 0; index < namespaces.length; index += 1) {
        var entry = namespaces[index];
        var ns = entry && entry.ns;
        var value = entry && entry.value;
        if (ns === undefined || value === undefined || typeof value !== "object") continue;
        var providers = value.providers;
        if (providers !== undefined && typeof providers === "object" && !Array.isArray(providers)) {
          for (var providerId of Object.keys(providers)) {
            var config = providers[providerId];
            var models = config && Array.isArray(config.models) ? config.models : [];
            byProvider[providerId] = collectModelNames(models);
          }
        }
        if (Array.isArray(value.models)) {
          byProvider["ns:" + ns] = collectModelNames(value.models);
        }
      }
      return byProvider;
    }

    /** Pull `name` strings out of a DSH model record list. */
    function collectModelNames(models) {
      var out = [];
      for (var index = 0; index < models.length; index += 1) {
        var model = models[index];
        if (model !== null && typeof model === "object" &&
            typeof model.name === "string" && model.name.length > 0) {
          out.push(model.name);
        }
      }
      return out;
    }

    /**
     * Build the dropdown catalog: the provider directory plus, per provider,
     * the model names already configured in DSH.
     *
     * @param remote - `ctx.remote` (llm directory methods).
     * @param describe - `ctx.settingsScope.describe()` mirror face.
     * @returns a promise of `{ providers, byProvider, byNs }` where `providers`
     *   is `[{ id, name }]`, `byProvider` maps provider id -> model names, and
     *   `byNs` maps settings namespace -> provider id.
     */
    function loadModelCatalog(remote, describe) {
      var byProvider = readProviderModels(describe.getSnapshot());
      var llm = remote !== undefined && remote !== null ? remote.llm : undefined;
      if (llm === undefined ||
          typeof llm.listProviders !== "function" ||
          typeof llm.listConfigurableProviders !== "function") {
        // `remote.llm` was not granted (missing inject declaration) or this
        // host exposes a different surface: degrade to manual entry, and let
        // the caller surface the empty directory so the user knows why.
        return Promise.resolve({ providers: [], byProvider: byProvider, byNs: {} });
      }
      return Promise.all([
        Promise.resolve(llm.listProviders()),
        Promise.resolve(llm.listConfigurableProviders())
      ]).then(function (responses) {
        var providers = [];
        var byNs = {};
        var directory = responses[0];
        if (directory !== undefined && directory !== null && directory.ok === true &&
            Array.isArray(directory.value)) {
          providers = directory.value.map(function (provider) {
            return {
              id: provider.id,
              name: typeof provider.name === "string" && provider.name.length > 0 ? provider.name : provider.id
            };
          });
        }
        var declared = responses[1];
        if (declared !== undefined && declared !== null && declared.ok === true &&
            Array.isArray(declared.value)) {
          for (var index = 0; index < declared.value.length; index += 1) {
            var configurable = declared.value[index];
            if (configurable !== null && typeof configurable === "object" &&
                typeof configurable.provider === "string" &&
                typeof configurable.settingsNs === "string") {
              byNs[configurable.settingsNs] = configurable.provider;
            }
          }
        }
        return { providers: providers, byProvider: byProvider, byNs: byNs };
      }).catch(function () {
        // Directory unavailable: keep the mirror-derived map; the section
        // still works through the manual-entry fallback.
        return { providers: [], byProvider: byProvider, byNs: {} };
      });
    }

    /**
     * Resolve the model names available for one provider id.
     *
     * Direct `providers.<id>.models` entries win; namespace-keyed (`ns:`)
     * entries are matched through the settingsNs -> provider id map returned by
     * `listConfigurableProviders`.
     */
    function modelsForProvider(catalog, providerId) {
      if (catalog === undefined || catalog === null || providerId === undefined || providerId === "") return [];
      var direct = catalog.byProvider[providerId];
      if (direct !== undefined) return direct;
      var byNs = catalog.byNs || {};
      for (var key of Object.keys(catalog.byProvider || {})) {
        if (key.indexOf("ns:") !== 0) continue;
        var ns = key.slice(3);
        if (byNs[ns] === providerId) return catalog.byProvider[key];
      }
      return [];
    }

    /** Shared select styling, matching the text inputs' `fieldStyle`. */
    function selectStyle(fieldStyle) {
      return Object.assign({ width: "100%" }, fieldStyle);
    }

    /**
     * Version footer — rendered at the end of the settings page, and also under
     * the "settings unavailable" notice, where knowing which build is loaded
     * matters most for a bug report.
     *
     * @param t - the slot's translator (see `translatorOf`).
     */
    function versionFooter(t) {
      return react.createElement(
        "p",
        {
          key: "version",
          style: {
            marginTop: 16,
            marginBottom: 0,
            paddingTop: 8,
            borderTop: "1px solid var(--dsw-alias-border-l4)",
            fontSize: 12,
            color: "var(--dsw-alias-label-tertiary)"
          }
        },
        t("settings.version") + " v" + PLUGIN_VERSION
      );
    }

    function RegenerateTitleAction(props) {
      var sessionId = props.sessionId;
      var regenerate = props.regenerate;
      var t = props.t;
      var scope = props.scope;

      var statePair = react.useState("idle");
      var state = statePair[0];
      var setState = statePair[1];
      var hoverPair = react.useState(false);
      var hovered = hoverPair[0];
      var setHovered = hoverPair[1];
      var settingsPair = react.useState(function () {
        return scope === undefined ? undefined : scope.getSnapshot();
      });
      var settingsSnapshot = settingsPair[0];
      var setSettingsSnapshot = settingsPair[1];

      var mounted = react.useRef(true);
      react.useEffect(function () {
        return function () {
          mounted.current = false;
        };
      }, []);

      react.useEffect(
        function () {
          if (scope === undefined) return undefined;
          return scope.subscribe(function () {
            if (mounted.current) setSettingsSnapshot(scope.getSnapshot());
          });
        },
        [scope]
      );

      var aiDisabled = isAiDisabledSnapshot(settingsSnapshot);
      var busy = state === "loading" || aiDisabled;
      var label = aiDisabled
        ? t("action.disabled")
        : t(state === "loading" ? "action.regenerating" : "action.regenerate");

      var onClick = react.useCallback(
        function () {
          if (busy) return;
          setState("loading");
          Promise.resolve(regenerate()).then(
            function (outcome) {
              if (!mounted.current) return;
              var verdict = interpretOutcome(outcome);
              setState(verdict.kind === "success" ? "idle" : "error");
            },
            function () {
              if (!mounted.current) return;
              setState("error");
            }
          );
        },
        [busy, regenerate]
      );

      // The shipped affordance: 28px round, transparent, tertiary label colour,
      // hover background, 0.45 opacity while disabled.
      var style = {
        width: 28,
        height: 28,
        padding: 0,
        border: "none",
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        flex: "none",
        background: hovered && !busy ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
        color: "var(--dsw-alias-label-tertiary)",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.45 : 1
      };

      return jsxRuntime.jsx("button", {
        type: "button",
        style: style,
        disabled: busy,
        "aria-busy": busy ? "true" : undefined,
        "aria-label": label,
        title: state === "error" ? t("action.failed") : label,
        onClick: onClick,
        onMouseEnter: function () {
          setHovered(true);
        },
        onMouseLeave: function () {
          setHovered(false);
        },
        children: jsxRuntime.jsx(primitives.IconRefreshOutline16, {})
      });
    }

    /** Client services this plugin needs. */
    var inject = ["slots", "remote", "remote.commands", "remote.llm", "locale", "settingsScope"];

    /**
     * Client plugin body: register dictionaries and the header action.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(
        function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        },
        "smart-session-title: dictionaries"
      );

      var controller = createRegenerationController(function (sessionId, line) {
        return ctx.remote.commands.execute(sessionId, line, []);
      });

      // The settings page binds this plugin's own namespace scope through the
      // settings domain's base service — the documented route for a feature that
      // owns a preference.
      var settingsScope = ctx.settingsScope.bind({ namespace: NS });
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register(
          {
            name: "settings.section",
            id: "smart-session-title",
            order: 30,
            // Locale-following nav label: the settings shell resolves label
            // thunks through `resolveSlotLabel` and re-renders them when the
            // active language (locale revision) changes.
            label: function () {
              return ctx.locale.bind(NS)("nav");
            },
            locale: NS,
            inject: function () {
              return {
                scope: settingsScope,
                // Cross-namespace settings mirror — provides read access to
                // every provider's model configuration for the configured-mode
                // dropdown selectors.  The same shared mirror the Models page
                // uses; subscribe to react to changes.
                describe: ctx.settingsScope.describe(),
                // Host remote — used to list registered LLM providers for the
                // provider dropdown.
                remote: ctx.remote
              };
            }
          },
          SettingsSection
        );
      });

      ctx.slots.inject("conversation.session.header.actions", function () {
        return ctx.slots.register(
          {
            name: "conversation.session.header.actions",
            id: "smart-session-title-regenerate",
            // Ascending order; the shipped occupants sit at 10 (agent preset)
            // and 20 (jobs), so 30 places this action beside them.
            order: 30,
            // Plain string: this slot's owner renders no projected label, and the
            // visible text comes from the namespaced `t` the `locale` option
            // injects into the component.
            label: "Regenerate title",
            locale: NS,
            inject: function (sessionId) {
              return {
                regenerate: function () {
                  return controller.run(sessionId);
                },
                // Lets the button follow the AI on/off setting without a reload.
                scope: settingsScope
              };
            }
          },
          RegenerateTitleAction
        );
      });
    }

    exports.name = "smart-session-title-client";
    exports.inject = inject;
    exports.apply = apply;
    exports.NS = NS;
    exports.RETITLE_LINE = RETITLE_LINE;
    exports.PLUGIN_VERSION = PLUGIN_VERSION;
    // Testable seams: the transports and the in-flight guard are exercised by
    // tests/client.test.mjs against a stub module loader.
    exports.createRegenerationController = createRegenerationController;
    exports.interpretOutcome = interpretOutcome;
    exports.RegenerateTitleAction = RegenerateTitleAction;
    exports.isAiDisabledSnapshot = isAiDisabledSnapshot;
    /**
     * Settings section component — the `settings.section` page.
     *
     * Receives `scope` through the slot's `inject` face: a bound
     * `SettingsScopeController` exposing `getSnapshot()`, `set(field, value)`
     * and `subscribe(listener)`. Every write goes through that public Remote;
     * the component never talks to a host API of its own.
     */
    function SettingsSection(props) {
      var scope = props.scope;
      // Cross-namespace settings mirror + host remote, injected by the slot:
      // together they feed the configured-mode dropdowns with the providers and
      // models the user already registered in DSH.
      var describe = props.describe;
      var remote = props.remote;
      // Framework-injected translator for this slot (see `locale: NS` on the
      // registration). Every visible string below goes through it, so the page
      // follows the DSH UI language and re-renders when that language changes.
      var t = translatorOf(props);

      // Hooks run unconditionally at the top: React requires a stable order, so
      // no early return may precede them.
      var snapPair = react.useState(function () {
        return scope.getSnapshot();
      });
      var snap = snapPair[0];
      var setSnap = snapPair[1];
      var advPair = react.useState(false);
      var advancedOpen = advPair[0];
      var setAdvancedOpen = advPair[1];
      var draftPair = react.useState({});
      var draft = draftPair[0];
      var setDraft = draftPair[1];
      var errorPair = react.useState("");
      var error = errorPair[0];
      var setError = errorPair[1];
      // Provider directory + configured models. `undefined` until the first
      // load resolves; the selectors fall back to manual entry meanwhile.
      var catalogPair = react.useState(undefined);
      var catalog = catalogPair[0];
      var setCatalog = catalogPair[1];
      function save(operation) {
        setError("");
        return Promise.resolve().then(operation).catch(function () {
          setError(t("settings.saveFailed"));
        });
      }


      react.useEffect(
        function () {
          return scope.subscribe(function () {
            setSnap(scope.getSnapshot());
          });
        },
        [scope]
      );

      // Load the provider/model catalog, then keep it in step with the settings
      // mirror: adding a model in DSH's Models page updates these dropdowns
      // without a reload. Reads only — the plugin never writes another
      // namespace.
      react.useEffect(
        function () {
          if (describe === undefined || remote === undefined) return undefined;
          var alive = true;
          function refresh() {
            loadModelCatalog(remote, describe).then(function (next) {
              if (alive) setCatalog(next);
            });
          }
          var unsubscribe = typeof describe.subscribe === "function"
            ? describe.subscribe(refresh)
            : undefined;
          // Prime the shared mirror on cold start (`ensure`), then read it;
          // later changes arrive through `subscribe`.
          var primed = typeof describe.ensure === "function"
            ? Promise.resolve(describe.ensure())
            : Promise.resolve();
          primed.then(function () {
            if (alive) refresh();
          });
          return function () {
            alive = false;
            if (typeof unsubscribe === "function") unsubscribe();
          };
        },
        [describe, remote]
      );

      if (snap.status === "unavailable") {
        return react.createElement("div", {}, [
          react.createElement(
            "p",
            {
              key: "unavailable",
              style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)" }
            },
            t("settings.unavailable")
          ),
          versionFooter(t)
        ]);
      }
      if (snap.status !== "ready") {
        return jsxRuntime.jsx("p", {
          style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)" },
          children: t("settings.loading")
        });
      }

      var value = snap.value || {};
      var user = snap.user || {};
      var busy = !snap.writable;

      // The resolved value carries the composition base; the raw user section
      // tells us what the human actually chose. `mode === undefined` means they
      // never chose, and the effective behaviour is the session route.
      var enabled = value.enabled !== false;
      var chosenMode = typeof user.mode === "string" ? user.mode : undefined;
      var effectiveMode = draft.mode || chosenMode || value.mode || "current-session";

      var fieldStyle = {
        boxSizing: "border-box",
        padding: "4px 8px",
        borderRadius: 6,
        border: "1px solid var(--dsw-alias-border-l4)",
        background: busy ? "transparent" : "var(--dsw-alias-bg-base)",
        color: "inherit",
        fontSize: 13
      };
      var labelStyle = { display: "block", marginBottom: 2, fontSize: 13 };
      var hintStyle = {
        fontSize: 12,
        color: "var(--dsw-alias-label-tertiary)",
        margin: 0,
        lineHeight: 1.4
      };

      function writeField(field, raw) {
        if (field === "timeoutMs" || field === "maxAttempts") {
          // Empty means "inherit the row config", which is an unset, not a 0.
          if (raw === "") save(function () { return scope.unset(field); });
          else {
            var parsed = Number.parseInt(raw, 10);
            if (Number.isFinite(parsed)) save(function () { return scope.set(field, parsed); });
          }
          return;
        }
        if (raw === "") save(function () { return scope.unset(field); });
        else save(function () { return scope.set(field, raw); });
      }

      var children = [];

      children.push(
        react.createElement(
          "label",
          {
            key: "enabled",
            style: {
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
              cursor: busy ? "default" : "pointer"
            }
          },
          react.createElement("input", {
            type: "checkbox",
            checked: enabled,
            disabled: busy,
            onChange: function (event) {
              writeField("enabled", event.target.checked);
            }
          }),
          t("settings.enabled")
        )
      );

      children.push(
        react.createElement(
          "fieldset",
          {
            key: "mode",
            style: { border: "none", padding: 0, margin: "0 0 12px 0" }
          },
          react.createElement(
            "legend",
            { style: { fontWeight: 500, marginBottom: 4, padding: 0, fontSize: 13 } },
            t("settings.modelLegend")
          ),
          ["current-session", "configured", "disabled"].map(function (mode) {
            return react.createElement(
              "label",
              {
                key: mode,
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "2px 0",
                  fontSize: 13,
                  cursor: busy ? "default" : "pointer"
                }
              },
              react.createElement("input", {
                type: "radio",
                name: "smart-session-title-mode",
                value: mode,
                checked: effectiveMode === mode,
                disabled: busy,
                onChange: function () {
                  setDraft(Object.assign({}, draft, { mode: mode }));
                  if (mode !== "configured") writeField("mode", mode);
                }
              }),
              mode === "current-session"
                ? t("settings.modeCurrent")
                : mode === "configured"
                  ? t("settings.modeConfigured")
                  : t("settings.modeDisabled")
            );
          })
        )
      );

      if (effectiveMode === "configured") {
        // The route the user is editing right now (draft wins over saved value).
        var selectedProvider = draft.provider !== undefined ? draft.provider : (value.provider || "");
        var selectedModel = draft.model !== undefined ? draft.model : (value.model || "");
        var providerOptions = catalog !== undefined && catalog !== null ? catalog.providers : [];
        var availableModels = modelsForProvider(catalog, selectedProvider);
        // A saved route may predate the directory (or name a provider DSH no
        // longer lists): keep it selectable so opening the page never silently
        // drops the current configuration.
        var providerKnown = providerOptions.some(function (option) { return option.id === selectedProvider; });
        var modelKnown = availableModels.indexOf(selectedModel) !== -1;

        var providerChildren = [
          react.createElement(
            "option",
            { key: "__empty", value: "" },
            t("settings.selectProvider")
          )
        ];
        providerOptions.forEach(function (option) {
          providerChildren.push(
            react.createElement("option", { key: option.id, value: option.id }, option.name)
          );
        });
        if (selectedProvider !== "" && !providerKnown) {
          providerChildren.push(
            react.createElement("option", { key: "__current", value: selectedProvider }, selectedProvider)
          );
        }

        children.push(
          react.createElement(
            "div",
            { key: "provider", style: { marginBottom: 8 } },
            react.createElement("label", { style: labelStyle }, t("settings.provider")),
            providerOptions.length > 0
              ? react.createElement(
                  "select",
                  {
                    value: selectedProvider,
                    disabled: busy,
                    style: selectStyle(fieldStyle),
                    onChange: function (event) {
                      // Switching provider invalidates the model half of the route.
                      setDraft(Object.assign({}, draft, {
                        provider: event.target.value,
                        model: undefined
                      }));
                    }
                  },
                  providerChildren
                )
              : react.createElement("input", {
                  type: "text",
                  value: selectedProvider,
                  disabled: busy,
                  placeholder: t("settings.providerPlaceholder"),
                  style: Object.assign({ width: "100%" }, fieldStyle),
                  onChange: function (event) {
                    setDraft(Object.assign({}, draft, { provider: event.target.value }));
                  }
                })
          )
        );
        // The provider directory returned empty (or `remote.llm` was never
        // granted): make the degraded state visible instead of silently
        // looking like the pre-dropdown UI.
        if (providerOptions.length === 0) {
          children.push(
            react.createElement(
              "p",
              { key: "directory-unavailable", style: Object.assign({ marginTop: 0, marginBottom: 12 }, hintStyle) },
              t("settings.directoryUnavailable")
            )
          );
        }

        var modelChildren = [
          react.createElement(
            "option",
            { key: "__empty", value: "" },
            t("settings.selectModel")
          )
        ];
        availableModels.forEach(function (model) {
          modelChildren.push(react.createElement("option", { key: model, value: model }, model));
        });
        if (selectedModel !== "" && !modelKnown) {
          modelChildren.push(
            react.createElement("option", { key: "__current", value: selectedModel }, selectedModel)
          );
        }

        children.push(
          react.createElement(
            "div",
            { key: "model", style: { marginBottom: 12 } },
            react.createElement("label", { style: labelStyle }, t("settings.model")),
            availableModels.length > 0
              ? react.createElement(
                  "select",
                  {
                    value: selectedModel,
                    disabled: busy,
                    style: selectStyle(fieldStyle),
                    onChange: function (event) {
                      setDraft(Object.assign({}, draft, { model: event.target.value }));
                    }
                  },
                  modelChildren
                )
              : react.createElement("input", {
                  type: "text",
                  value: selectedModel,
                  disabled: busy,
                  placeholder: t("settings.modelPlaceholder"),
                  style: Object.assign({ width: "100%" }, fieldStyle),
                  onChange: function (event) {
                    setDraft(Object.assign({}, draft, { model: event.target.value }));
                  }
                })
          )
        );
        if (selectedProvider !== "" && availableModels.length === 0) {
          children.push(
            react.createElement(
              "p",
              { key: "manual-model", style: Object.assign({ marginTop: 0, marginBottom: 12 }, hintStyle) },
              t("settings.manualModelHint")
            )
          );
        }
        children.push(
          react.createElement(
            "p",
            { key: "privacy", style: Object.assign({ marginTop: 0, marginBottom: 12 }, hintStyle) },
            t("settings.configuredNotice")
          )
        );
      }


      if (effectiveMode === "configured") {
        var providerId = (draft.provider !== undefined ? draft.provider : (value.provider || "")).trim();
        var modelId = (draft.model !== undefined ? draft.model : (value.model || "")).trim();
        children.push(react.createElement("button", {
          key: "save-route", type: "button", disabled: busy || !providerId || !modelId,
          onClick: function () {
            save(function () { return scope.mutate([
              { op: "set", path: ["provider"], value: providerId },
              { op: "set", path: ["model"], value: modelId },
              { op: "set", path: ["mode"], value: "configured" }
            ]); });
          }
        }, t("settings.saveRoute")));
      }
      if (error) children.push(react.createElement("p", { key: "error", role: "alert" }, error));

      if (effectiveMode === "disabled" || !enabled) {
        children.push(
          react.createElement(
            "p",
            { key: "disabled-note", style: Object.assign({ marginTop: 0, marginBottom: 12 }, hintStyle) },
            t("settings.disabledNote")
          )
        );
      }

      children.push(
        react.createElement(
          "div",
          { key: "advanced" },
          react.createElement(
            "button",
            {
              type: "button",
              style: {
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontSize: 13,
                color: "var(--dsw-alias-label-tertiary)"
              },
              onClick: function () {
                setAdvancedOpen(!advancedOpen);
              }
            },
            (advancedOpen ? "\u25be " : "\u25b8 ") + t("settings.advanced")
          ),
          advancedOpen
            ? react.createElement(
                "div",
                { style: { paddingLeft: 8, marginTop: 6 } },
                react.createElement(
                  "div",
                  { style: { marginBottom: 6 } },
                  react.createElement("label", { style: labelStyle }, t("settings.timeout")),
                  react.createElement("input", {
                    type: "number",
                    min: 1000,
                    max: 120000,
                    value: typeof user.timeoutMs === "number" ? user.timeoutMs : "",
                    disabled: busy,
                    placeholder: "15000",
                    style: Object.assign({ width: 120 }, fieldStyle),
                    onChange: function (event) {
                      writeField("timeoutMs", event.target.value);
                    }
                  })
                ),
                react.createElement(
                  "div",
                  { style: { marginBottom: 6 } },
                  react.createElement("label", { style: labelStyle }, t("settings.maxAttempts")),
                  react.createElement("input", {
                    type: "number",
                    min: 1,
                    max: 3,
                    value: typeof user.maxAttempts === "number" ? user.maxAttempts : "",
                    disabled: busy,
                    placeholder: "2",
                    style: Object.assign({ width: 80 }, fieldStyle),
                    onChange: function (event) {
                      writeField("maxAttempts", event.target.value);
                    }
                  })
                ),
                react.createElement(
                  "p",
                  { style: hintStyle },
                  t("settings.advancedHint")
                )
              )
            : null
        )
      );

      // Which build is loaded — the first thing a bug report needs.
      children.push(versionFooter(t));

      return react.createElement("div", {}, children);
    }

  exports.SettingsSection = SettingsSection;
  return module.exports;
  }
});
