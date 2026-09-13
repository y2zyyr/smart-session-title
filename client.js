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
    var PLUGIN_VERSION = "0.3.0-rc.6";

    /**
     * Where the batch block remembers its automatic-fallback checkbox. It is a
     * UI preference, not plugin configuration: `settings.yaml` is a host-owned
     * schema this client half may not extend, so it stays in the browser.
     */
    var BATCH_FALLBACK_STORAGE_KEY = "smart-session-title.batch.autoFallback";

    /** Read the remembered fallback preference (false when unavailable). */
    function readFallbackPreference() {
      try {
        return window.localStorage.getItem(BATCH_FALLBACK_STORAGE_KEY) === "1";
      } catch (error) {
        return false;
      }
    }

    /** Remember the fallback preference; storage failures are not fatal. */
    function writeFallbackPreference(enabled) {
      try {
        window.localStorage.setItem(BATCH_FALLBACK_STORAGE_KEY, enabled ? "1" : "0");
      } catch (error) {
        // Private mode / disabled storage: the checkbox still works for this page.
      }
    }

    /** Muted helper-text style shared by the settings blocks. */
    var HINT_STYLE = {
      fontSize: 12,
      color: "var(--dsw-alias-label-tertiary)",
      margin: 0,
      lineHeight: 1.4
    };

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
      "settings.configuredUnsaved": "尚未生效：选好 Provider 与模型后必须点击「保存指定模型」，否则标题仍按「跟随当前会话模型」生成（历史会话会用它们各自记录的旧模型）。",
      "settings.saveRoute": "保存指定模型",
      "settings.saveFailed": "设置保存失败。请检查填写内容与 DSH 日志。",
      "settings.disabledNote": "AI 标题已关闭。DSH 仍会根据首条提示设置 fallback 标题，人工重命名不受影响。",
      "settings.advanced": "高级",
      "settings.timeout": "超时（毫秒）",
      "settings.maxAttempts": "最大尝试次数",
      "settings.advancedHint": "留空表示继承部署的 composition 配置。改动作用于下一次标题生成；凭据仍由 DSH 管理。",
      "settings.version": "版本",
      // Batch: optimize past titles ---------------------------------
      "batch.legend": "批量优化历史标题",
      "batch.intro": "选中要重新生成标题的历史会话。每个会话调用一次模型；被选中的标题会被重写，包括你手动改过的标题。",
      "batch.costHint": "每个会话一次模型调用：选得越多越慢，并产生相应的模型费用。",
      "batch.routeHint": "「跟随当前会话模型」会使用每个会话自己记录的模型；旧会话记录的模型可能已不存在或凭据失效，此时改成「指定模型」再重试即可。",
      "batch.retryFailed": "重试失败项",
      "batch.fallback": "失败后自动用「指定模型」重跑一次",
      "batch.fallbackHint": "仅在已保存「指定模型」时可用：重跑期间标题路由会临时切到该模型，结束后自动恢复原设置（中途刷新窗口可能停在切换后的状态）。",
      "batch.fallbackNeedsRoute": "先在「标题模型」里选好并保存「指定模型」，才能启用自动兜底。",
      "batch.fallbackRunning": "正在用「指定模型」自动重跑失败项…",
      "batch.fallbackDone": "已用「指定模型」自动重跑失败项。",
      "batch.fallbackFailed": "自动兜底未执行（可能没有可用的指定模型）。",
      "batch.routeInUse": "本次使用的标题路由",
      "batch.routeDead": "记录模型已不可用",
      "batch.routeDeadSummary": "以下会话记录的模型已不在 DSH 中（跟随当前会话模型时它们必然失败，切到指定模型再重试）",
      "batch.load": "加载历史会话",
      "batch.reload": "重新加载",
      "batch.loading": "正在加载历史会话…",
      "batch.loadFailed": "无法读取历史会话列表。",
      "batch.unavailable": "当前浏览器无法读取历史会话。",
      "batch.empty": "没有可处理的历史会话（无用户消息或子代理会话会被跳过）。",
      "batch.count": "可处理会话",
      "batch.cwd": "项目目录",
      "batch.allCwd": "全部项目",
      "batch.selectAll": "全选",
      "batch.clear": "清空",
      "batch.selectedCount": "已选",
      "batch.start": "开始优化",
      "batch.cancel": "停止",
      "overlay.running": "批量优化",
      "overlay.stop": "停止",
      "overlay.stopping": "停止中…",
      "batch.cancelling": "正在停止：已中断当前会话的生成，队列不再继续…",
      "batch.status": "状态",
      "batch.running": "正在优化",
      "batch.done": "已完成",
      "batch.cancelled": "已取消",
      "batch.completedCount": "已完成",
      "batch.okCount": "成功",
      "batch.failedCount": "失败",
      "batch.current": "当前",
      "batch.runningBadge": "运行中",
      "batch.noTitle": "（无标题）",
      "batch.disabled": "AI 标题已关闭，无法批量优化。",
      "batch.truncated": "仅显示前 300 条，请先用项目目录筛选。",
      "batch.failures": "失败的会话",
      "batch.kindError": "生成失败",
      "batch.kindUnavailable": "命令不可用"
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
      "settings.configuredUnsaved": "Not in effect yet: pick a provider and a model, then click \"Save configured model\". Until then titles keep following \"Current session model\" (stored sessions use the old model each one logged).",
      "settings.saveRoute": "Save configured model",
      "settings.saveFailed": "Settings could not be saved. Check the values and DSH logs.",
      "settings.disabledNote": "AI titles are off. DSH still sets a fallback title from your first prompt, and manual renames are unaffected.",
      "settings.advanced": "Advanced",
      "settings.timeout": "Timeout (ms)",
      "settings.maxAttempts": "Max attempts",
      "settings.advancedHint": "An empty field inherits the deployment's composition config. Changes apply to the next title generation; credentials stay managed by DSH.",
      "settings.version": "Version",
      // Batch: optimize past titles ---------------------------------
      "batch.legend": "Optimize past titles",
      "batch.intro": "Pick the past sessions to retitle. Each one costs one model call; the selected titles are rewritten, including titles you renamed by hand.",
      "batch.costHint": "One model call per session: the more you select, the slower and the more expensive the run.",
      "batch.routeHint": "\"Current session model\" uses the model each session logged. For old sessions that model may no longer exist or its credentials may be gone; switch to \"Configured model\" and retry.",
      "batch.retryFailed": "Retry failed",
      "batch.fallback": "On failure, retry once with the configured model",
      "batch.fallbackHint": "Needs a saved configured model: the title route switches to it for the retry and is restored afterwards (an interrupted window can leave it switched).",
      "batch.fallbackNeedsRoute": "Save a configured model first to enable the automatic fallback.",
      "batch.fallbackRunning": "Retrying the failed sessions with the configured model…",
      "batch.fallbackDone": "Failed sessions were retried with the configured model.",
      "batch.fallbackFailed": "Automatic fallback did not run (no usable configured model?).",
      "batch.routeInUse": "Title route in use",
      "batch.routeDead": "logged model unavailable",
      "batch.routeDeadSummary": "Sessions below log a model DSH no longer serves (they cannot succeed while following the session model; switch to a configured model and retry)",
      "batch.load": "Load past sessions",
      "batch.reload": "Reload",
      "batch.loading": "Loading past sessions…",
      "batch.loadFailed": "Could not read the past-session list.",
      "batch.unavailable": "Past sessions are not readable in this browser.",
      "batch.empty": "No past sessions to optimize (sessions without a user message and subagent sessions are skipped).",
      "batch.count": "Sessions available",
      "batch.cwd": "Project",
      "batch.allCwd": "All projects",
      "batch.selectAll": "Select all",
      "batch.clear": "Clear",
      "batch.selectedCount": "Selected",
      "batch.start": "Start",
      "batch.cancel": "Stop",
      "overlay.running": "Batch retitle",
      "overlay.stop": "Stop",
      "overlay.stopping": "Stopping…",
      "batch.cancelling": "Stopping: the current session's generation was cancelled and the queue will not continue…",
      "batch.status": "Status",
      "batch.running": "Optimizing",
      "batch.done": "Finished",
      "batch.cancelled": "Cancelled",
      "batch.completedCount": "Completed",
      "batch.okCount": "Succeeded",
      "batch.failedCount": "Failed",
      "batch.current": "Current",
      "batch.runningBadge": "running",
      "batch.noTitle": "(no title)",
      "batch.disabled": "AI titles are off; batch optimization is unavailable.",
      "batch.truncated": "Only the first 300 rows are shown; narrow the list with the project filter.",
      "batch.failures": "Failed sessions",
      "batch.kindError": "generation failed",
      "batch.kindUnavailable": "command unavailable"
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
     *
     * `text` carries the host's own wording — the new title on success, and the
     * real failure reason on failure (dead historical route, timeout,
     * maxOutputTokens, no usable message). That is what turns a batch failure
     * list from 13 identical "failed" rows into something actionable.
     */
    function interpretOutcome(outcome) {
      if (outcome && typeof outcome.ok === "boolean") {
        if (!outcome.ok) return { kind: "error", text: failureText(outcome.error) };
        outcome = outcome.value;
      }
      if (outcome === undefined) return { kind: "unavailable", text: "" };
      var result = outcome.result;
      if (result !== undefined && result.kind === "success") {
        return { kind: "success", text: typeof result.text === "string" ? result.text : "" };
      }
      if (result !== undefined && result.kind === "error") {
        return { kind: "error", text: typeof result.text === "string" ? result.text : "" };
      }
      return { kind: "error", text: "" };
    }

    /** Best-effort message text out of a Remote failure value. */
    function failureText(value) {
      if (typeof value === "string") return value;
      if (value !== null && typeof value === "object") {
        if (typeof value.message === "string") return value.message;
        if (typeof value.text === "string") return value.text;
      }
      return "";
    }

    /** Bound one recorded reason so a failure list stays readable. */
    function truncateReason(text) {
      if (typeof text !== "string") return "";
      return text.length > 200 ? text.slice(0, 200) + "…" : text;
    }

    /** Accepted title of one `session.list` row ("" when it has none yet). */
    function titleOfSessionRow(row) {
      var values = row !== null && row !== undefined && row.projections !== undefined
        ? row.projections.values
        : undefined;
      var title = values !== undefined && values !== null ? values.title : undefined;
      return typeof title === "string" ? title : "";
    }

    /**
     * Whether one `session.list` row may be batch-retitled.
     *
     * Excluded, each for a verified host-side reason:
     *  - subagent / child sessions: the `agent` lookup refuses to resume a
     *    subagent-owned Session into an ordinary Agent
     *    (`hasApiSessionSubagentOwner` → ownership error);
     *  - blank sessions: no eligible `user/message`, so `/retitle` can only
     *    fail with "no usable user message";
     *  - rows without an id: nothing to address.
     */
    function isBatchCandidate(row) {
      if (row === null || row === undefined || typeof row !== "object") return false;
      if (typeof row.sessionId !== "string" || row.sessionId.length === 0) return false;
      if (row.origin === "subagent" || row.parentSessionId !== undefined) return false;
      if (row.blank === true) return false;
      return true;
    }

    /** Keep only the retitleable rows, preserving the host's ordering. */
    function selectBatchCandidates(items) {
      var out = [];
      if (!Array.isArray(items)) return out;
      for (var index = 0; index < items.length; index += 1) {
        if (isBatchCandidate(items[index])) out.push(items[index]);
      }      return out;
    }

    /**
     * The model route one stored session logged last, read from the
     * `modelSelection` projection that `session.list` already carries
     * (`values.modelSelection.lastUsed.{provider,model}`, falling back to the
     * queued `next` selection).
     *
     * This is what "Current session model" mode will actually use for that
     * session, so the batch list can warn BEFORE the run instead of reporting
     * N identical failures afterwards.
     */
    function routeOfSessionRow(row) {
      var values = row !== null && row !== undefined && row.projections !== undefined
        ? row.projections.values
        : undefined;
      var selection = values !== undefined && values !== null ? values.modelSelection : undefined;
      if (selection === undefined || selection === null) return undefined;
      var candidate = selection.lastUsed !== null && selection.lastUsed !== undefined
        ? selection.lastUsed
        : selection.next;
      if (candidate === null || candidate === undefined) return undefined;
      if (typeof candidate.provider !== "string" || typeof candidate.model !== "string") return undefined;
      return { provider: candidate.provider, model: candidate.model };
    }

    /**
     * Whether a session's logged route can still be served.
     *
     * @param route - `routeOfSessionRow(row)` or undefined.
     * @param catalog - the DSH provider directory (`loadModelCatalog` result).
     * @returns `"unknown"` (no route/directory to judge with), `"provider-missing"`
     *   (the provider is gone — the observed failure mode), `"model-missing"`
     *   (provider known but the model is not among its configured models), or `"ok"`.
     */
    function classifySessionRoute(route, catalog) {
      if (route === undefined || route === null || route.provider === "") return "unknown";
      if (catalog === undefined || catalog === null || !Array.isArray(catalog.providers)) return "unknown";
      if (catalog.providers.length === 0) return "unknown";
      var known = false;
      for (var index = 0; index < catalog.providers.length; index += 1) {
        if (catalog.providers[index].id === route.provider) {
          known = true;
          break;
        }
      }
      if (!known) return "provider-missing";
      var models = modelsForProvider(catalog, route.provider);
      if (models.length > 0 && models.indexOf(route.model) === -1) return "model-missing";
      return "ok";
    }

    /** Tight label for a session's logged route, e.g. `opencode-go/deepseek-v4`. */
    function routeLabelOf(route) {
      return route === undefined || route === null ? "" : route.provider + "/" + route.model;
    }

    /** Reset value of the batch runner's snapshot. */
    function idleBatchSnapshot() {
      return {
        status: "idle",
        total: 0,
        completed: 0,
        succeeded: 0,
        failed: 0,
        currentSessionId: "",
        failures: [],
        cancelRequested: false,
        // "idle" | "running" | "done" | "failed": the optional second pass that
        // re-runs the failures with the configured route.
        fallback: "idle"
      };
    }

    /**
     * Runner for "optimize past titles".
     *
     * Sequential by design — one `/retitle` at a time — so a run of N sessions
     * costs exactly N model calls and cannot stampede the provider. Every step
     * goes through the same public Remote the header button uses
     * (`ctx.remote.commands.execute(sessionId, "/retitle")`), whose host side
     * resumes a cold Session on demand before running the real command handler.
     *
     * The runner lives in plugin scope (created once in `apply`), NOT in React
     * state: closing the settings page unmounts the component but leaves the run
     * going, and reopening the page re-subscribes to this snapshot. Only a full
     * DSH window reload can interrupt a run — and each session that already
     * finished keeps the title it wrote.
     *
     * @param execute - `(sessionId, signal) => Promise<outcome>`: the `/retitle`
     *   route. `signal` is a real client-side cancellation: the Remote accepts a
     *   trailing AbortSignal (the descriptor declares `cancellation`), and the
     *   gateway forwards it as the host invocation's cancellation, which aborts
     *   the in-flight generation. That is what makes Stop immediate.
     * @param hooks - optional `{ runFallback }`. `runFallback(failures, runPass)`
     *   is called ONCE after a run that had failures, when the user enabled the
     *   automatic fallback. It owns switching the title route (plugin scope holds
     *   the settings scope) and must await `runPass(rows)`, then restore. Without
     *   this hook — and without a saved configured route — no second pass runs.
     */
    function createBatchController(execute, hooks) {
      var runFallbackHook = hooks !== undefined && hooks !== null ? hooks.runFallback : undefined;
      var listeners = [];
      var state = idleBatchSnapshot();
      var cancelled = false;
      var inflight = null;
      var autoFallback = false;
      var fallbackAttempted = false;
      // Aborts the ONE session currently generating, so Stop does not wait out
      // its remaining attempts.
      var currentAbort = null;

      function emit(patch) {
        state = Object.assign({}, state, patch);
        for (var index = 0; index < listeners.length; index += 1) listeners[index](state);
      }

      function record(entry, verdict) {
        if (verdict.kind === "success") {
          emit({
            completed: state.completed + 1,
            succeeded: state.succeeded + 1,
            currentSessionId: ""
          });
          return;
        }
        emit({
          completed: state.completed + 1,
          failed: state.failed + 1,
          failures: state.failures.concat([{
            sessionId: entry.sessionId,
            kind: verdict.kind,
            reason: truncateReason(verdict.text)
          }]),
          currentSessionId: ""
        });
      }

      function step(queue, index) {
        if (cancelled || index >= queue.length) return Promise.resolve();
        var entry = queue[index];
        emit({ currentSessionId: entry.sessionId });
        var abort = typeof AbortController === "function" ? new AbortController() : null;
        currentAbort = abort;
        return Promise.resolve()
          .then(function () {
            return execute(entry.sessionId, abort === null ? undefined : abort.signal);
          })
          .then(
            function (outcome) {
              // An interrupted session is neither a success nor a failure: the
              // user stopped it, so it must not pollute the failure list.
              if (abort !== null && abort.signal.aborted) return;
              record(entry, interpretOutcome(outcome));
            },
            function () {
              if (abort !== null && abort.signal.aborted) return;
              record(entry, { kind: "error" });
            }
          )
          .then(function () {
            currentAbort = null;
            return cancelled ? undefined : step(queue, index + 1);
          });
      }

      /** Deduplicate rows into the queue one pass will run. */
      function buildQueue(rows) {
        var queue = [];
        var seen = {};
        for (var index = 0; index < (rows || []).length; index += 1) {
          var row = rows[index];
          var id = row !== null && row !== undefined ? row.sessionId : undefined;
          if (typeof id !== "string" || id.length === 0 || seen[id] === true) continue;
          seen[id] = true;
          queue.push({ sessionId: id, title: titleOfSessionRow(row) });
        }
        return queue;
      }

      /** Run one pass over `queue`, resetting the counters. */
      function runPass(queue) {
        emit({
          status: "running",
          total: queue.length,
          completed: 0,
          succeeded: 0,
          failed: 0,
          currentSessionId: queue[0].sessionId,
          failures: [],
          cancelRequested: false
        });
        return step(queue, 0).then(function () {
          emit({
            status: cancelled ? "cancelled" : "done",
            currentSessionId: "",
            cancelRequested: false
          });
          return state;
        });
      }

      /** Should this finished pass trigger the one allowed fallback pass? */
      function shouldFallback(result) {
        return autoFallback === true &&
          fallbackAttempted === false &&
          cancelled === false &&
          typeof runFallbackHook === "function" &&
          result.failed > 0 &&
          result.failures.length > 0;
      }

      /** Second pass: the hook switches the route, runs the failures, restores. */
      function beginFallback(result) {
        fallbackAttempted = true;
        var failed = result.failures.map(function (failure) {
          return { sessionId: failure.sessionId };
        });
        emit({ fallback: "running" });
        return Promise.resolve()
          .then(function () {
            return runFallbackHook(failed, function (rows) {
              return runPass(buildQueue(rows));
            });
          })
          .then(
            function () {
              emit({ fallback: "done" });
            },
            function () {
              emit({ fallback: "failed" });
            }
          );
      }

      return {
        /** Observe progress; returns the unsubscribe function. */
        subscribe: function (listener) {
          listeners.push(listener);
          return function () {
            var at = listeners.indexOf(listener);
            if (at !== -1) listeners.splice(at, 1);
          };
        },
        /** Current immutable progress snapshot. */
        getSnapshot: function () {
          return state;
        },
        /** Whether a run is in flight right now. */
        isRunning: function () {
          return inflight !== null;
        },
        /** Enable/disable the single automatic fallback pass. */
        setAutoFallback: function (enabled) {
          autoFallback = enabled === true;
        },
        /** Whether the automatic fallback pass is enabled. */
        isAutoFallback: function () {
          return autoFallback;
        },
        /** Number of sessions a `start` with these rows would actually run. */
        countRunnable: function (rows) {
          return buildQueue(rows).length;
        },
        /**
         * Run one batch. Joins an in-flight run instead of starting a second.
         * @param rows - `session.list` rows (extra fields are ignored).
         * @returns a promise resolving to the final snapshot.
         */
        start: function (rows) {
          if (inflight !== null) return inflight;
          var queue = buildQueue(rows);
          if (queue.length === 0) return Promise.resolve(state);
          cancelled = false;
          // A user-initiated run re-arms the fallback; the fallback pass itself
          // runs through `runPass` and can never re-arm it.
          fallbackAttempted = false;
          emit({ fallback: "idle" });
          inflight = runPass(queue)
            .then(function (result) {
              return shouldFallback(result) ? beginFallback(result) : undefined;
            })
            .then(
              function () {
                inflight = null;
                return state;
              },
              function (error) {
                inflight = null;
                emit({ status: "done", currentSessionId: "", cancelRequested: false });
                throw error;
              }
            );
          return inflight;
        },
        /**
         * Stop now.
         *
         * The in-flight `/retitle` call is aborted through the Remote's optional
         * AbortSignal, so the host cancels that session's generation instead of
         * finishing it; the queue then stops without recording the interrupted
         * session as failed. A pending automatic fallback is dropped, never
         * started. Anything already written by earlier sessions stays written.
         */
        cancel: function () {
          if (inflight === null || cancelled) return;
          cancelled = true;
          fallbackAttempted = true;
          if (currentAbort !== null) {
            try {
              currentAbort.abort();
            } catch (error) {
              // An abort of an already-settled step is not an error worth losing
              // the cancellation over.
            }
          }
          emit({ cancelRequested: true });
        }
      };
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
    var inject = [
      "slots",
      "remote",
      "remote.commands",
      "remote.llm",
      // Stored-Session list for the batch optimizer (`session.list`); declaring
      // the namespace is what makes the Remote granted at all.
      "remote.session",
      "locale",
      "settingsScope"
    ];

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

      // Batch runner, created in plugin scope so a run survives the settings
      // page being closed. It drives the SAME `/retitle` command route as the
      // header button; the host resumes each stored Session on demand.
      // The settings scope must exist before the fallback hook can use it (the
      // hook itself only runs once a batch has failures).
      var settingsScope = ctx.settingsScope.bind({ namespace: NS });

      var batch = createBatchController(
        function (sessionId, signal) {
          // The 4th argument is the optional AbortSignal the descriptor's
          // `cancellation` field allows; it is what makes Stop immediate.
          return ctx.remote.commands.execute(sessionId, RETITLE_LINE, [], signal);
        },
        {
          /**
           * Automatic fallback, opted into by the user in the batch block.
           *
           * "Current session model" uses each stored session's logged model, and a
           * session from months ago may name a provider DSH no longer serves — it
           * then fails in milliseconds, every time. A true host-side route
           * fallback would live in `resolveTitleRoute` (host half, compiled), so
           * the client does the next best thing with the public settings scope:
           * switch the title route to the saved configured pair for ONE retry pass
           * over exactly the failed sessions, then put the previous mode back.
           *
           * The write is real (it is the same field the user edits in Settings),
           * which is why it is opt-in, one-shot, and restored — and why an
           * interrupted window can leave the route switched; the setting is
           * visible in the UI, never hidden.
           */
          runFallback: function (failures, runPass) {
            var snapshot = settingsScope.getSnapshot();
            var value = snapshot !== undefined && snapshot !== null && snapshot.status === "ready"
              ? snapshot.value || {}
              : {};
            var provider = typeof value.provider === "string" ? value.provider : "";
            var model = typeof value.model === "string" ? value.model : "";
            if (provider === "" || model === "") {
              return Promise.reject(new Error("no configured title route to fall back to"));
            }
            var previousMode = value.mode;
            function restore() {
              return previousMode === undefined
                ? Promise.resolve(settingsScope.unset("mode"))
                : Promise.resolve(settingsScope.set("mode", previousMode));
            }
            return Promise.resolve(settingsScope.set("mode", "configured"))
              .then(function () {
                return runPass(failures);
              })
              .then(restore, function (error) {
                return restore().then(function () {
                  throw error;
                });
              });
          }
        }
      );
      ctx.effect(
        function () {
          return function () {
            // Plugin unload must not leave a run driving model calls.
            batch.cancel();
          };
        },
        "smart-session-title: batch runner"
      );

      /**
       * Read every visible stored Session through the public `session.list`
       * Remote. The host serves this WITHOUT resuming an Agent, so listing is
       * free; `ok:false` covers a host that did not grant the namespace.
       */
      function listSessions() {
        var sessionRemote = ctx.remote === undefined || ctx.remote === null ? undefined : ctx.remote.session;
        if (sessionRemote === undefined || sessionRemote === null || typeof sessionRemote.list !== "function") {
          return Promise.resolve({ ok: false });
        }
        return Promise.resolve(sessionRemote.list({}));
      }

      // The settings page binds this plugin's own namespace scope through the
      // settings domain's base service — the documented route for a feature that
      // owns a preference. (Bound above, because the batch fallback needs it too.)
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
                remote: ctx.remote,
                // Batch optimizer: the plugin-scope runner (progress survives
                // this page being closed) and the stored-Session reader.
                batch: batch,
                listSessions: listSessions
              };
            }
          },
          SettingsSection
        );
      });

      // Global progress + stop control. `shell.overlay` is the shipped root-scope
      // overlay layer, so the batch can be stopped from anywhere in the app —
      // including after the settings page was closed, which is exactly when a run
      // most needs a visible stop.
      ctx.slots.inject("shell.overlay", function () {
        return ctx.slots.register(
          {
            name: "shell.overlay",
            id: "smart-session-title-batch",
            order: 20,
            // Plain string: this slot renders components, never a projected label.
            label: "Batch retitle progress",
            locale: NS,
            inject: function () {
              return { batch: batch };
            }
          },
          BatchOverlayAction
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
                  if (mode !== "configured") {
                    writeField("mode", mode);
                    return;
                  }
                  // "Configured" needs both halves, so it is persisted atomically
                  // WITH them. When a usable pair already exists (saved earlier, or
                  // just picked from the dropdowns) apply it now — otherwise the
                  // radio looks like it took effect while generations keep using
                  // each session's own logged model. With no pair yet, the block
                  // below says explicitly that the save button is still required.
                  var pendingProvider = (draft.provider !== undefined ? draft.provider : (value.provider || "")).trim();
                  var pendingModel = (draft.model !== undefined ? draft.model : (value.model || "")).trim();
                  if (pendingProvider !== "" && pendingModel !== "") {
                    save(function () {
                      return scope.mutate([
                        { op: "set", path: ["provider"], value: pendingProvider },
                        { op: "set", path: ["model"], value: pendingModel },
                        { op: "set", path: ["mode"], value: "configured" }
                      ]);
                    });
                  }
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
        // Nothing is persisted until provider+model+mode are saved together, so a
        // radio click alone leaves generations on the session route. Say so.
        if (chosenMode !== "configured") {
          children.push(
            react.createElement(
              "p",
              { key: "configured-unsaved", role: "status", style: Object.assign({ marginTop: 0, marginBottom: 8 }, hintStyle) },
              t("settings.configuredUnsaved")
            )
          );
        }
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

      // Batch retitle of stored sessions — explicit selection, then a run that
      // keeps going after this page is closed (the runner lives in plugin scope).
      // `route` tells the block which model a run will actually use, so a batch
      // that keeps failing on dead historical routes explains itself.
      children.push(
        react.createElement(BatchTitleOptimizer, {
          key: "batch",
          t: t,
          batch: props.batch,
          listSessions: props.listSessions,
          disabled: !enabled || effectiveMode === "disabled",
          route: {
            mode: effectiveMode,
            provider: value.provider || "",
            model: value.model || ""
          },
          // Provider directory: lets the list flag sessions whose logged model is
          // gone before the run instead of after it fails.
          catalog: catalog
        })
      );

      // Which build is loaded — the first thing a bug report needs.
      children.push(versionFooter(t));

      return react.createElement("div", {}, children);
    }

    /**
     * Global batch indicator + stop control.
     *
     * Registered into the shipped `shell.overlay` slot (`kind: list`,
     * `scope: root`, rendered inside the frame's overlay layer). The runner lives
     * in plugin scope, so a batch keeps going after the settings page is closed —
     * without this, the only way to stop it would be to reopen that page. It
     * renders nothing unless a run is actually in flight, so an idle app is
     * untouched.
     *
     * @param props.batch - the plugin-scope batch runner.
     */
    function BatchOverlayAction(props) {
      var t = translatorOf(props);
      var batch = props.batch;
      var snapPair = react.useState(function () {
        return batch !== undefined ? batch.getSnapshot() : idleBatchSnapshot();
      });
      var snap = snapPair[0];
      var setSnap = snapPair[1];
      var mounted = react.useRef(true);

      react.useEffect(function () {
        return function () {
          mounted.current = false;
        };
      }, []);

      react.useEffect(
        function () {
          if (batch === undefined) return undefined;
          setSnap(batch.getSnapshot());
          return batch.subscribe(function (next) {
            if (mounted.current) setSnap(next);
          });
        },
        [batch]
      );

      if (batch === undefined || snap.status !== "running") return null;

      var percent = snap.total === 0 ? 0 : Math.round((snap.completed / snap.total) * 100);
      var stopping = snap.cancelRequested === true;

      // `shell.overlay`'s layer is pointer-events:none and only its direct child
      // becomes interactive, so the pill positions itself and stays clickable.
      return react.createElement(
        "div",
        {
          "data-smart-session-title-batch": true,
          style: {
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 21,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid var(--dsw-alias-border-l4)",
            background: "var(--dsw-alias-bg-base)",
            color: "var(--dsw-alias-label-secondary)",
            boxShadow: "0 2px 10px rgba(0, 0, 0, 0.18)",
            fontSize: 12
          }
        },
        react.createElement(
          "span",
          { style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 96 } },
          react.createElement(
            "span",
            {},
            t("overlay.running") + " " + String(snap.completed) + " / " + String(snap.total)
          ),
          react.createElement(
            "span",
            {
              role: "progressbar",
              "aria-valuemin": 0,
              "aria-valuemax": snap.total,
              "aria-valuenow": snap.completed,
              style: {
                height: 4,
                borderRadius: 999,
                background: "var(--dsw-alias-border-l4)",
                overflow: "hidden"
              }
            },
            react.createElement("span", {
              style: {
                display: "block",
                height: "100%",
                width: String(percent) + "%",
                background: "var(--dsw-alias-label-tertiary)"
              }
            })
          )
        ),
        react.createElement(
          "button",
          {
            type: "button",
            disabled: stopping,
            onClick: function () {
              batch.cancel();
            },
            style: {
              padding: "3px 10px",
              borderRadius: 999,
              border: "1px solid var(--dsw-alias-border-l4)",
              background: "transparent",
              color: "inherit",
              fontSize: 12,
              cursor: stopping ? "default" : "pointer",
              opacity: stopping ? 0.45 : 1
            }
          },
          stopping ? t("overlay.stopping") : t("overlay.stop")
        )
      );
    }

    /**
     * "Optimize past titles" block: pick stored sessions, then batch-retitle them.
     *
     * Reads the stored Session list through the public `session.list` Remote
     * (which the host serves WITHOUT resuming any Agent), then hands the chosen
     * rows to the shared batch runner. Progress comes from the runner, so
     * unmounting this page leaves the run going and reopening it shows the live
     * state again.
     *
     * @param props.t - the slot translator.
     * @param props.batch - `createBatchController` instance from `apply`.
     * @param props.listSessions - `() => Promise<{ok, value:{items}}>`.
     * @param props.disabled - true when AI titles are switched off.
     */
    function BatchTitleOptimizer(props) {
      var t = translatorOf(props);
      var batch = props.batch;
      var listSessions = props.listSessions;
      var aiDisabled = props.disabled === true;
      // DSH's provider directory, used to warn about sessions whose logged model
      // no longer exists — before the run, not after thirteen failures.
      var catalog = props.catalog;

      // `undefined` = not loaded yet, `null` = load failed, array = loaded rows.
      var rowsPair = react.useState(undefined);
      var rows = rowsPair[0];
      var setRows = rowsPair[1];
      var loadingPair = react.useState(false);
      var loading = loadingPair[0];
      var setLoading = loadingPair[1];
      var selectedPair = react.useState({});
      var selected = selectedPair[0];
      var setSelected = selectedPair[1];
      var cwdPair = react.useState("");
      var cwdFilter = cwdPair[0];
      var setCwdFilter = cwdPair[1];
      var snapPair = react.useState(function () {
        return batch !== undefined ? batch.getSnapshot() : idleBatchSnapshot();
      });
      var snap = snapPair[0];
      var setSnap = snapPair[1];
      // Remembered across page loads (browser storage, not plugin settings — see
      // BATCH_FALLBACK_STORAGE_KEY), so a user who wants the fallback keeps it.
      var fallbackPair = react.useState(readFallbackPreference);
      var autoFallback = fallbackPair[0];
      var setAutoFallback = fallbackPair[1];

      var mounted = react.useRef(true);
      var lastStatus = react.useRef(snap.status);
      react.useEffect(function () {
        return function () {
          mounted.current = false;
        };
      }, []);

      react.useEffect(
        function () {
          if (batch === undefined) return undefined;
          setSnap(batch.getSnapshot());
          return batch.subscribe(function (next) {
            if (mounted.current) setSnap(next);
          });
        },
        [batch]
      );

      // The runner owns the flag (it may fire the fallback pass long after this
      // page is closed), so keep it in step with the remembered preference.
      react.useEffect(function () {
        if (batch !== undefined) batch.setAutoFallback(autoFallback);
      }, [batch, autoFallback]);

      function load() {
        if (listSessions === undefined) return;
        setLoading(true);
        Promise.resolve()
          .then(function () {
            return listSessions();
          })
          .then(
            function (result) {
              if (!mounted.current) return;
              setLoading(false);
              if (result === undefined || result === null || result.ok !== true) {
                setRows(null);
                return;
              }
              var items = result.value !== undefined && result.value !== null && Array.isArray(result.value.items)
                ? result.value.items
                : [];
              setRows(selectBatchCandidates(items));
            },
            function () {
              if (!mounted.current) return;
              setLoading(false);
              setRows(null);
            }
          );
      }

      // A finished run rewrote titles: reload the rows so the list shows them.
      // Guarded on `rows !== undefined` so merely opening the page never starts
      // an unrequested list load, and on the status change so one run refreshes
      // exactly once (a short run can go idle → done without an observed middle).
      react.useEffect(function () {
        var previous = lastStatus.current;
        lastStatus.current = snap.status;
        var terminal = snap.status === "done" || snap.status === "cancelled";
        if (terminal && previous !== snap.status && rows !== undefined) load();
      });

      if (batch === undefined || listSessions === undefined) {
        return react.createElement(
          "fieldset",
          { style: { border: "none", padding: 0, margin: "16px 0 0 0" } },
          react.createElement(
            "legend",
            { style: { fontWeight: 500, marginBottom: 4, padding: 0, fontSize: 13 } },
            t("batch.legend")
          ),
          react.createElement("p", { style: HINT_STYLE }, t("batch.unavailable"))
        );
      }

      var fieldStyle = {
        boxSizing: "border-box",
        padding: "4px 8px",
        borderRadius: 6,
        border: "1px solid var(--dsw-alias-border-l4)",
        background: "var(--dsw-alias-bg-base)",
        color: "inherit",
        fontSize: 13
      };
      var buttonStyle = {
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid var(--dsw-alias-border-l4)",
        background: "var(--dsw-alias-bg-base)",
        color: "inherit",
        fontSize: 13,
        cursor: "pointer"
      };
      var running = snap.status === "running";
      var list = Array.isArray(rows) ? rows : [];
      var cwds = [];
      for (var index = 0; index < list.length; index += 1) {
        var cwd = typeof list[index].cwd === "string" ? list[index].cwd : "";
        if (cwd !== "" && cwds.indexOf(cwd) === -1) cwds.push(cwd);
      }
      var visible = cwdFilter === "" ? list : list.filter(function (row) { return row.cwd === cwdFilter; });
      var ROW_LIMIT = 300;
      var truncated = visible.length > ROW_LIMIT;
      if (truncated) visible = visible.slice(0, ROW_LIMIT);
      var selectedRows = list.filter(function (row) { return selected[row.sessionId] === true; });
      var canStart = !running && !aiDisabled && selectedRows.length > 0;
      // How many of the rows on screen are doomed in "Current session model"
      // mode because DSH no longer serves the model they logged.
      var deadRoutes = 0;
      for (var deadIndex = 0; deadIndex < visible.length; deadIndex += 1) {
        var deadStatus = classifySessionRoute(routeOfSessionRow(visible[deadIndex]), catalog);
        if (deadStatus === "provider-missing" || deadStatus === "model-missing") deadRoutes += 1;
      }

      var children = [];

      children.push(
        react.createElement(
          "legend",
          { key: "legend", style: { fontWeight: 500, marginBottom: 4, padding: 0, fontSize: 13 } },
          t("batch.legend")
        )
      );
      children.push(
        react.createElement("p", { key: "intro", style: Object.assign({ marginTop: 0, marginBottom: 4 }, HINT_STYLE) }, t("batch.intro"))
      );
      children.push(
        react.createElement("p", { key: "cost", style: Object.assign({ marginTop: 0, marginBottom: 8 }, HINT_STYLE) }, t("batch.costHint"))
      );
      children.push(
        react.createElement("p", { key: "route", style: Object.assign({ marginTop: 0, marginBottom: 8 }, HINT_STYLE) }, t("batch.routeHint"))
      );
      // Which route this run will use — the single most useful fact when a batch
      // keeps failing: in session mode each stored session brings its own model.
      if (props.route !== undefined && props.route !== null) {
        var routeText = props.route.mode === "configured"
          ? t("settings.modeConfigured") + ": " + (props.route.provider || "—") + " / " + (props.route.model || "—")
          : t("settings.modeCurrent");
        children.push(
          react.createElement(
            "p",
            { key: "route-in-use", style: Object.assign({ marginTop: 0, marginBottom: 8 }, HINT_STYLE) },
            t("batch.routeInUse") + ": " + routeText
          )
        );
        // Automatic fallback opt-in. It needs a SAVED configured pair, because
        // that is the route the retry pass switches to.
        var fallbackReady = props.route.provider !== "" && props.route.model !== "";
        children.push(
          react.createElement(
            "label",
            {
              key: "fallback",
              style: {
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                marginBottom: 2,
                cursor: fallbackReady && !running ? "pointer" : "default"
              }
            },
            react.createElement("input", {
              type: "checkbox",
              checked: autoFallback,
              disabled: !fallbackReady || running,
              onChange: function (event) {
                var next = event.target.checked;
                setAutoFallback(next);
                writeFallbackPreference(next);
                if (batch !== undefined) batch.setAutoFallback(next);
              }
            }),
            t("batch.fallback")
          )
        );
        children.push(
          react.createElement(
            "p",
            { key: "fallback-hint", style: Object.assign({ marginTop: 0, marginBottom: 8 }, HINT_STYLE) },
            fallbackReady ? t("batch.fallbackHint") : t("batch.fallbackNeedsRoute")
          )
        );
      }

      if (aiDisabled) {
        children.push(
          react.createElement("p", { key: "off", style: Object.assign({ marginTop: 0, marginBottom: 8 }, HINT_STYLE) }, t("batch.disabled"))
        );
      }

      children.push(
        react.createElement(
          "div",
          { key: "load", style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 } },
          react.createElement(
            "button",
            {
              type: "button",
              style: buttonStyle,
              disabled: loading || running,
              onClick: load
            },
            loading ? t("batch.loading") : rows === undefined ? t("batch.load") : t("batch.reload")
          ),
          list.length > 0
            ? react.createElement(
                "span",
                { style: HINT_STYLE },
                t("batch.count") + ": " + String(list.length)
              )
            : null
        )
      );

      if (rows === null) {
        children.push(
          react.createElement("p", { key: "load-error", role: "alert", style: HINT_STYLE }, t("batch.loadFailed"))
        );
      } else if (Array.isArray(rows) && list.length === 0) {
        children.push(react.createElement("p", { key: "empty", style: HINT_STYLE }, t("batch.empty")));
      }

      if (list.length > 0) {
        children.push(
          react.createElement(
            "div",
            { key: "toolbar", style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 } },
            cwds.length > 1
              ? react.createElement(
                  "select",
                  {
                    value: cwdFilter,
                    disabled: running,
                    style: Object.assign({ maxWidth: 260 }, fieldStyle, { width: "auto" }),
                    onChange: function (event) {
                      setCwdFilter(event.target.value);
                    }
                  },
                  [react.createElement("option", { key: "__all", value: "" }, t("batch.allCwd"))].concat(
                    cwds.map(function (value) {
                      return react.createElement("option", { key: value, value: value }, value);
                    })
                  )
                )
              : null,
            react.createElement(
              "button",
              {
                type: "button",
                style: buttonStyle,
                disabled: running,
                onClick: function () {
                  var next = Object.assign({}, selected);
                  for (var i = 0; i < visible.length; i += 1) next[visible[i].sessionId] = true;
                  setSelected(next);
                }
              },
              t("batch.selectAll")
            ),
            react.createElement(
              "button",
              {
                type: "button",
                style: buttonStyle,
                disabled: running,
                onClick: function () {
                  setSelected({});
                }
              },
              t("batch.clear")
            ),
            react.createElement(
              "span",
              { style: HINT_STYLE },
              t("batch.selectedCount") + ": " + String(selectedRows.length)
            )
          )
        );

        // Say it up front: these sessions record a model DSH no longer serves, so
        // in "Current session model" mode they can only fail.
        if (deadRoutes > 0) {
          children.push(
            react.createElement(
              "p",
              { key: "dead-routes", role: "status", style: Object.assign({ marginTop: 0, marginBottom: 6 }, HINT_STYLE) },
              "⚠ " + t("batch.routeDeadSummary") + ": " + String(deadRoutes) + " / " + String(visible.length)
            )
          );
        }

        children.push(
          react.createElement(
            "div",
            {
              key: "rows",
              style: {
                maxHeight: 220,
                overflowY: "auto",
                border: "1px solid var(--dsw-alias-border-l4)",
                borderRadius: 6,
                padding: "2px 6px",
                marginBottom: 8
              }
            },
            visible.map(function (row) {
              var title = titleOfSessionRow(row);
              var rowRoute = routeOfSessionRow(row);
              var routeStatus = classifySessionRoute(rowRoute, catalog);
              var meta = [];
              if (typeof row.cwd === "string" && row.cwd !== "") meta.push(row.cwd);
              if (typeof row.updatedAt === "number") meta.push(new Date(row.updatedAt).toLocaleString());
              // The model this session would use in "Current session model" mode —
              // flagged when DSH no longer knows it, which is the whole reason a
              // batch of old sessions fails.
              if (rowRoute !== undefined) {
                meta.push(
                  routeLabelOf(rowRoute) +
                    (routeStatus === "provider-missing" || routeStatus === "model-missing"
                      ? " ⚠ " + t("batch.routeDead")
                      : "")
                );
              }
              if (row.running === true) meta.push(t("batch.runningBadge"));
              return react.createElement(
                "label",
                {
                  key: row.sessionId,
                  style: {
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                    padding: "3px 0",
                    fontSize: 13,
                    cursor: running ? "default" : "pointer"
                  }
                },
                react.createElement("input", {
                  type: "checkbox",
                  checked: selected[row.sessionId] === true,
                  disabled: running,
                  onChange: function () {
                    var next = Object.assign({}, selected);
                    if (next[row.sessionId] === true) delete next[row.sessionId];
                    else next[row.sessionId] = true;
                    setSelected(next);
                  }
                }),
                react.createElement(
                  "span",
                  { style: { display: "flex", flexDirection: "column", minWidth: 0 } },
                  react.createElement(
                    "span",
                    { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                    title === "" ? t("batch.noTitle") : title
                  ),
                  react.createElement("span", { style: HINT_STYLE }, meta.join(" · "))
                )
              );
            })
          )
        );

        if (truncated) {
          children.push(react.createElement("p", { key: "truncated", style: HINT_STYLE }, t("batch.truncated")));
        }

        children.push(
          react.createElement(
            "div",
            { key: "actions", style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 } },
            react.createElement(
              "button",
              {
                type: "button",
                style: Object.assign({}, buttonStyle, {
                  opacity: canStart ? 1 : 0.45,
                  cursor: canStart ? "pointer" : "default"
                }),
                disabled: !canStart,
                onClick: function () {
                  batch.start(selectedRows);
                }
              },
              t("batch.start") + " (" + String(selectedRows.length) + ")"
            ),
            !running && snap.failures.length > 0
              ? react.createElement(
                  "button",
                  {
                    type: "button",
                    style: buttonStyle,
                    onClick: function () {
                      // Retry exactly the sessions that failed, with whatever
                      // route settings are in force now (the usual fix is to
                      // move from "follow the session model" to a configured
                      // model, because an old session's logged route may be gone).
                      batch.start(snap.failures.map(function (failure) {
                        return { sessionId: failure.sessionId };
                      }));
                    }
                  },
                  t("batch.retryFailed") + " (" + String(snap.failures.length) + ")"
                )
              : null
          )
        );
      }

      if (snap.status !== "idle") {
        var percent = snap.total === 0 ? 0 : Math.round((snap.completed / snap.total) * 100);
        var statusLabel = snap.status === "running"
          ? t("batch.running")
          : snap.status === "cancelled"
            ? t("batch.cancelled")
            : t("batch.done");
        children.push(
          react.createElement(
            "div",
            { key: "progress" },
            react.createElement(
              "div",
              { style: { display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 } },
              react.createElement("span", {}, t("batch.status") + ": " + statusLabel),
              react.createElement(
                "span",
                { style: { color: "var(--dsw-alias-label-tertiary)" } },
                t("batch.completedCount") + " " + String(snap.completed) + " / " + String(snap.total) +
                  " · " + t("batch.okCount") + " " + String(snap.succeeded) +
                  " · " + t("batch.failedCount") + " " + String(snap.failed)
              )
            ),
            react.createElement(
              "div",
              {
                role: "progressbar",
                "aria-valuemin": 0,
                "aria-valuemax": snap.total,
                "aria-valuenow": snap.completed,
                style: {
                  height: 6,
                  borderRadius: 999,
                  margin: "4px 0",
                  background: "var(--dsw-alias-border-l4)",
                  overflow: "hidden"
                }
              },
              react.createElement("div", {
                style: {
                  height: "100%",
                  width: String(percent) + "%",
                  borderRadius: 999,
                  background: "var(--dsw-alias-label-tertiary)"
                }
              })
            ),
            snap.cancelRequested === true && running
              ? react.createElement("p", { style: HINT_STYLE }, t("batch.cancelling"))
              : null,
            snap.fallback === "running"
              ? react.createElement("p", { role: "status", style: HINT_STYLE }, t("batch.fallbackRunning"))
              : null,
            snap.fallback === "done"
              ? react.createElement(
                  "p",
                  { role: "status", style: HINT_STYLE },
                  t("batch.fallbackDone") + " (" + t("settings.modeConfigured") + ")"
                )
              : null,
            snap.fallback === "failed"
              ? react.createElement("p", { role: "status", style: HINT_STYLE }, t("batch.fallbackFailed"))
              : null,
            // Stop lives here rather than beside the selection buttons: it must
            // stay reachable while a run is in flight, whatever state the list is
            // in. The same control also sits in the global overlay, for when this
            // page is closed.
            running
              ? react.createElement(
                  "button",
                  {
                    type: "button",
                    style: Object.assign({}, buttonStyle, { marginTop: 4, marginBottom: 4 }),
                    disabled: snap.cancelRequested === true,
                    onClick: function () {
                      batch.cancel();
                    }
                  },
                  t("batch.cancel")
                )
              : null,
            running && snap.currentSessionId !== ""
              ? react.createElement(
                  "p",
                  { style: Object.assign({ marginTop: 0, marginBottom: 4 }, HINT_STYLE) },
                  t("batch.current") + ": " + snap.currentSessionId
                )
              : null,
            snap.failures.length > 0
              ? react.createElement(
                  "div",
                  { style: { marginTop: 4 } },
                  react.createElement("p", { style: Object.assign({ marginTop: 0, marginBottom: 2 }, HINT_STYLE) }, t("batch.failures")),
                  snap.failures.map(function (failure) {
                    // The host's own wording is the actionable part: it is what
                    // separates a dead historical route from a timeout.
                    var label = failure.kind === "unavailable" ? t("batch.kindUnavailable") : t("batch.kindError");
                    var detail = typeof failure.reason === "string" && failure.reason !== ""
                      ? label + ": " + failure.reason
                      : label;
                    return react.createElement(
                      "p",
                      { key: failure.sessionId, style: Object.assign({}, HINT_STYLE, { wordBreak: "break-word" }) },
                      failure.sessionId + " — " + detail
                    );
                  })
                )
              : null
          )
        );
      }

      return react.createElement(
        "fieldset",
        { style: { border: "none", padding: 0, margin: "16px 0 0 0" } },
        children
      );
    }

  exports.SettingsSection = SettingsSection;
  exports.BatchTitleOptimizer = BatchTitleOptimizer;
  exports.BatchOverlayAction = BatchOverlayAction;
  exports.createBatchController = createBatchController;
  exports.selectBatchCandidates = selectBatchCandidates;
  exports.isBatchCandidate = isBatchCandidate;
  exports.titleOfSessionRow = titleOfSessionRow;
  exports.routeOfSessionRow = routeOfSessionRow;
  exports.classifySessionRoute = classifySessionRoute;
  return module.exports;
  }
});
