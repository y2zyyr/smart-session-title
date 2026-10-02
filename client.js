/**
 * `smart-session-title` — browser half.
 *
 * Contributes preview, regenerate, lock and SessionId actions through
 * `conversation.session.header.actions`, plus Settings and a batch overlay.
 * Generation and application invoke host commands through the existing public
 * `ctx.remote.commands.execute(sessionId, line, [], signal)` contract. Model
 * calls, title persistence and stale-result guards live on the host.
 *
 * Why hand-written instead of built: a client half is a browser module loaded
 * through `window.__ModuleLoader__.load`, and the packages it needs (`react`,
 * the primitives) are supplied by the runtime's `require`, not by node_modules.
 * Bundling would add a toolchain for no benefit, so this file is written
 * directly against that contract — the same shape shipped client plugins use.
 *
 * Styling uses visible action labels and accessible tooltips using the design-token custom properties the
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
    var PREVIEW_LINE = "/title-preview";
    var APPLY_PREVIEW_LINE = "/title-apply";

    /**
     * This plugin's version, shown in the settings page footer.
     *
     * This half is hand-written (see the file header), so no build step can
     * inject the value from package.json the way a bundled client half does.
     * The two are kept in sync deliberately: `validation/verify-i18n.mjs`
     * fails when this string and package.json's `version` drift apart.
     */
    var PLUGIN_VERSION = "0.5.0-rc.17";

    /**
     * Where the batch block remembers its automatic-fallback checkbox. It is a
     * UI preference, not plugin configuration: this checkbox only controls the
     * current browser's batch behavior, so it stays in browser storage on both
     * Core generations.
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
      "preview.open": "预览标题",
      "preview.generating": "正在生成预览…",
      "preview.applying": "正在应用…",
      "preview.old": "原标题",
      "preview.new": "候选标题",
      "preview.apply": "应用此标题",
      "preview.close": "关闭",
      "preview.failed": "标题预览或应用失败",
      "preview.invalid": "未收到有效的标题预览",
      "preview.hint": "预览调用模型，但不会保存标题。应用后按人工标题保护；预览一小时内有效，会话或标题设置变化后需重新预览。",
      "preview.applied": "已应用",
      "batch.preview": "预览所选",
      "batch.comparison": "标题对比",
      "batch.previewHint": "先预览再勾选应用。预览使用当前标题模型设置，不执行自动兜底；已有标题只在应用时改变。",
      "batch.applyPreviews": "应用所选",
      "batch.selectPreviews": "全选候选标题",
      "batch.previewDone": "预览完成",
      "batch.applying": "正在应用标题",
      "batch.previewing": "正在生成预览",
      "batch.applyDone": "应用完成",
      "batch.clearPreviews": "清空对比",
      "settings.showSessionId": "显示 Session ID",
      "settings.sessionIdBrief": "点击对话顶部的 ID 可复制，方便定位会话。",
      "settings.showSessionIdHint": "默认开启。点击浅灰色会话 ID 可复制完整值，粘贴到其他对话可帮助 agent 定位此会话。能否读取取决于 agent 的工具与权限；复制其他会话的 ID 需先打开该会话。此开关独立于 AI 标题生成。",
      "sessionId.copy": "复制当前会话 SessionId",
      "sessionId.copied": "已复制",
      "sessionId.failed": "复制失败，请重试或手动复制下方 ID",

      // Header action ----------------------------------------------
      "action.regenerate": "重新生成标题",
      "action.regenerating": "正在重新生成标题…",
      "action.disabled": "AI 标题已关闭",
      "action.unavailable": "重新生成标题：命令不可用",
      "action.failed": "重新生成标题失败",
      // Title lock, beside the title in the conversation header ----------
      "action.locked": "标题已锁定，请先解锁",
      "lock.lock": "锁定标题",
      "lock.unlock": "解锁标题",
      "lock.failed": "锁定状态保存失败",
      // Settings nav label -----------------------------------------
      "nav": "智能会话标题",
      "action.short": "重新生成标题",
      "lock.short": "锁定标题",
      "lock.active": "标题已锁定",
      "action.help": "用当前标题设置重新生成此会话的标题，会覆盖人工修改的标题；不会刷新或重新运行对话。",
      "lock.help": "阻止本插件自动生成、重新生成、预览、应用和批量修改此标题；不会锁定对话，仍可聊天和人工改名。",
      "lock.unlockHelp": "解除标题锁定，允许本插件再次生成或批量修改此标题。",
      "settings.headerActions": "使用说明",
      "settings.lockBoundary": "标题锁定不影响 DSH 的兜底标题或人工改名。锁定后，先解锁才能重新生成标题。",

      "settings.saving": "保存中…",
      "settings.saved": "已保存",
      "settings.unsaved": "有未保存的修改",
      "settings.preferences": "标题设置",
      "settings.expression": "表达方式",
      "settings.lengthDate": "长度与日期",
      "batch.open": "批量优化",
      "batch.back": "标题设置",
      "settings.tagline": "让会话标题更清晰、更好找",
      "settings.brand": "smart-session-title",
      "settings.enabledHint": "自动为会话生成标题",
      "settings.currentHint": "使用当前会话的模型",
      "batch.tagline": "先预览，再选择要应用的标题",
      "batch.chooseSessions": "重新选择会话",
      "batch.selectedPreviews": "已勾选候选标题",
      "batch.notSaved": "当前标题尚未更改",
      "batch.previewBrief": "预览会调用模型，应用后才保存标题。",
      "batch.directOptions": "直接优化与兜底设置",
      "batch.noMatches": "没有符合筛选条件的会话。",
      "batch.selectSession": "选择会话",
      "batch.selectCandidate": "选择候选标题",
      "batch.search": "搜索标题或会话 ID",
      "settings.modelHelp": "模型如何使用提示？",
      "settings.preview": "格式示例（不调用模型）",
      "settings.exampleAction": "优化登录页面的错误提示",
      "settings.exampleShort": "登录错误提示",

      // Settings page ----------------------------------------------
      "settings.unavailable": "当前浏览器中无法使用此设置。",
      "settings.loading": "正在加载…",
      "settings.enabled": "AI 标题生成",
      "settings.subtitle": "修改后点击「保存设置」生效。",
      "settings.defaultLength": "默认字数",
      "settings.characterUnit": "字",
      "settings.defaultParameters": "默认超时与重试",
      "settings.formatHelp": "格式与排除规则说明",
      "settings.shapeSummary": "留空使用默认字数，日期取会话创建时间。",
      "batch.summary": "选择会话后批量重新生成。",
      "batch.help": "费用与模型说明",
      "settings.modelLegend": "标题模型",
      "settings.modeCurrent": "跟随会话",
      "settings.modeConfigured": "固定模型",
      "settings.modeDisabled": "已禁用",
      "settings.provider": "Provider",
      "settings.providerPlaceholder": "Provider ID",
      "settings.model": "模型",
      "settings.modelPlaceholder": "模型 ID",
      "settings.selectProvider": "选择 Provider…",
      "settings.selectModel": "选择模型…",
      "settings.manualModelHint": "该 Provider 未在此列出模型，请直接填写模型 ID。",
      "settings.modelNotServed": "⚠ 已保存的模型不在该 Provider 的模型列表中，生成会失败。请重新选择并保存。",
      "settings.modelNotServedSuggestion": "应改选模型 ID：",
      "settings.directoryUnavailable": "无法读取 DSH 的模型目录，请手动填写 Provider 与模型 ID。",
      "settings.configuredNotice": "压缩后的首条提示将发送给所选 Provider。",
      "settings.configuredUnsaved": "选择 Provider 和模型后，点击「保存设置」生效。",
      "settings.saveRoute": "保存设置",
      "settings.invalidNumber": "请输入范围内的整数：",
      "settings.saveFailed": "设置保存失败。请检查填写内容与 DSH 日志。",
      "settings.disabledNote": "AI 标题已关闭。DSH 仍会根据首条提示设置 fallback 标题，人工重命名不受影响。",
      "settings.advanced": "高级设置",
      "settings.timeout": "超时（毫秒）",
      "settings.maxAttempts": "最大尝试次数",
      "settings.advancedHint": "留空使用默认配置，下次生成时生效。",
      "settings.version": "版本",
      // Title shape + content: cap, date affix, style, language, exclusions ----
      "settings.shapeLegend": "标题规则",
      "settings.style": "标题风格",
      "settings.styleDefault": "动作＋对象（默认）",
      "settings.styleShortName": "简短任务名",
      "settings.styleActionObject": "动作＋对象",
      "settings.language": "标题语言",
      "settings.languageAuto": "跟随任务语言",
      "settings.languageZh": "中文",
      "settings.languageEn": "英文",
      "settings.contentHint": "「自动」跟随任务内容的主要语言；技术名称（React、API 等）保持原样。风格与语言适用于自动生成、手动重新生成和批量处理；改动不会重写已有标题。",
      "settings.maxCharacters": "字数上限",
      "settings.dateAffix": "日期位置",
      "settings.dateAffixOff": "不添加",
      "settings.dateAffixPrefix": "前缀",
      "settings.dateAffixSuffix": "后缀",
      "settings.dateFormat": "日期格式",
      "settings.dateFormatYmd": "年月日 · 2026-09-14",
      "settings.dateFormatMd": "月日 · 09-14",
      "settings.shapeHint": "字数上限留空表示继承部署配置（80 字节，约 26 个汉字或 80 个西文字符）。日期取会话创建时间（本地时区），重新生成标题不会改变它；选择后缀时，字数上限包含日期；无法为正文留出至少 4 个字符，或日期命中排除词时省略日期。",
      "settings.exclusions": "排除词",
      "settings.exclusionsBrief": "每行一个，最多 50 个。仅限插件生成的标题；不影响兜底标题、人工标题或对话原文。",
      "settings.exclusionsPlaceholder": "每行一个，生成时自动移除",
      "settings.exclusionsSummary": "排除词",
      "settings.exclusionsHint": "这些词会在生成前从提示文本中删除，生成后再检查一次；标题里仍出现时先重试一次，最后一次直接删掉该词，而不是放弃这个标题。按字面匹配，含英文字母时忽略大小写；别名、缩写、译名需分别添加。",
      "settings.invalidExclusions": "每个排除词一行、不超过 64 个字符，最多 50 个。",
      "settings.exclusionsBoundary": "只约束本插件生成的标题：DSH 的兜底标题（新会话在模型回答前显示的就是它）、你手动改过的标题和对话原文都不受此设置影响。",
      // Batch: optimize past titles ---------------------------------
      "batch.legend": "批量优化标题",
      "batch.intro": "仅处理选中的会话，也会覆盖人工修改的标题。",
      "batch.costHint": "每次生成都可能按「最大尝试次数」重试，自动兜底还会增加调用。预览同样调用模型；应用预览不再次调用。",
      "batch.routeHint": "「跟随会话」会使用每个会话自己记录的模型；旧会话记录的模型可能已不存在或凭据失效，此时改成「固定模型」再重试即可。",
      "batch.retryFailed": "重试失败项",
      "batch.fallback": "失败后自动用「固定模型」重跑一次",
      "batch.fallbackHint": "仅在已保存「固定模型」时可用：重跑期间标题路由会临时切到该模型，结束后恢复原模式；处理中用户保存的新路由会保留。中途刷新窗口可能停在临时模式。",
      "batch.fallbackNeedsRoute": "先在「标题模型」里选好并保存「固定模型」，才能启用自动兜底。",
      "batch.fallbackRunning": "正在用「固定模型」自动重跑失败项…",
      "batch.fallbackDone": "已用「固定模型」自动重跑失败项。",
      "batch.fallbackFailed": "自动兜底或模式恢复失败，请检查标题模型设置。",
      "batch.fallbackCancelled": "自动重跑已停止。",
      "batch.error": "批量任务异常结束。",
      "batch.routeInUse": "生成模型",
      "batch.routeDead": "记录模型已不可用",
      "batch.routeDeadSummary": "以下会话记录的模型已不在 DSH 中（跟随会话时它们必然失败，切到固定模型再重试）",
      "batch.load": "加载历史会话",
      "batch.reload": "重新加载",
      "batch.loading": "正在加载历史会话…",
      "batch.loadFailed": "无法读取历史会话列表。",
      "batch.unavailable": "当前浏览器无法读取历史会话。",
      "batch.empty": "没有可处理的历史会话（无用户消息、子代理会话或已锁定会话会被跳过）。",
      "batch.skippedLocked": "已跳过已锁定会话",
      "batch.count": "可处理会话",
      "batch.cwd": "项目目录",
      "batch.allCwd": "全部项目",
      "batch.selectAll": "全选",
      "batch.clear": "清空",
      "batch.selectedCount": "已选",
      "batch.start": "直接优化",
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
      "preview.open": "Preview title",
      "preview.generating": "Generating preview…",
      "preview.applying": "Applying…",
      "preview.old": "Previous title",
      "preview.new": "Candidate title",
      "preview.apply": "Apply this title",
      "preview.close": "Close",
      "preview.failed": "Title preview or application failed",
      "preview.invalid": "No valid title preview was returned",
      "preview.hint": "Preview calls the model without saving a title. Applying protects it as a manual title. Previews expire after one hour; session or title setting changes require a new preview.",
      "preview.applied": "Applied",
      "batch.preview": "Preview selected",
      "batch.comparison": "Title comparison",
      "batch.previewHint": "Preview, then select titles to apply. Preview uses the current title route without automatic fallback. Existing titles change only on application.",
      "batch.applyPreviews": "Apply selected",
      "batch.selectPreviews": "Select all candidates",
      "batch.previewDone": "Preview complete",
      "batch.applying": "Applying titles",
      "batch.previewing": "Generating previews",
      "batch.applyDone": "Application finished",
      "batch.clearPreviews": "Clear comparison",
      "settings.showSessionId": "Show Session ID",
      "settings.sessionIdBrief": "Click the ID in the conversation header to copy and locate a session.",
      "settings.showSessionIdHint": "On by default. Click the muted session ID to copy its full value, then paste it into another conversation to help an agent locate this session. Reading requires suitable tools and permissions. Open another session to copy its ID. This switch is independent of AI title generation.",
      "sessionId.copy": "Copy current session ID",
      "sessionId.copied": "Copied",
      "sessionId.failed": "Copy failed; retry or manually copy the ID below",

      // Header action ----------------------------------------------
      "action.regenerate": "Regenerate title",
      "action.regenerating": "Regenerating title…",
      "action.disabled": "AI title generation is disabled",
      "action.unavailable": "Regenerate title: command unavailable",
      "action.failed": "Regenerate title failed",
      // Title lock, beside the title in the conversation header ----------
      "action.locked": "Title is locked; unlock it first",
      "lock.lock": "Lock title",
      "lock.unlock": "Unlock title",
      "lock.failed": "Could not save the lock state",
      // Settings nav label -----------------------------------------
      "nav": "Smart Session Title",
      "action.short": "Regenerate title",
      "lock.short": "Lock title",
      "lock.active": "Title locked",
      "action.help": "Generate a new title using the current title settings, replacing manual titles too. Does not refresh or rerun the conversation.",
      "lock.help": "Prevent this plugin from generating, previewing, applying or batch retitling this title. You can still chat and rename the conversation yourself.",
      "lock.unlockHelp": "Unlock this title to allow generation and batch retitling again.",
      "settings.headerActions": "Usage guide",
      "settings.lockBoundary": "Title locking does not affect DSH fallback titles or manual renaming. Unlock before regenerating a title.",

      // Settings page ----------------------------------------------
      "settings.saving": "Saving\u2026",
      "settings.saved": "Saved",
      "settings.unsaved": "Unsaved changes",
      "settings.preferences": "Title settings",
      "settings.expression": "Expression",
      "settings.lengthDate": "Length and date",
      "batch.open": "Batch optimize",
      "batch.back": "Title settings",
      "settings.tagline": "Clearer titles, easier to find",
      "settings.brand": "smart-session-title",
      "settings.enabledHint": "Automatically generate session titles",
      "settings.currentHint": "Use each session's own model",
      "batch.tagline": "Preview first, then choose titles to apply",
      "batch.chooseSessions": "Change session selection",
      "batch.selectedPreviews": "Selected candidate titles",
      "batch.notSaved": "Current titles have not changed",
      "batch.previewBrief": "Preview calls the model. Titles are saved only when applied.",
      "batch.directOptions": "Direct optimization and fallback",
      "batch.noMatches": "No sessions match these filters.",
      "batch.selectSession": "Select session",
      "batch.selectCandidate": "Select candidate title",
      "batch.search": "Search titles or session IDs",
      "settings.modelHelp": "How is the prompt used?",
      "settings.preview": "Format example (no model call)",
      "settings.exampleAction": "Improve login error messages",
      "settings.exampleShort": "Login error messages",
      "settings.unavailable": "Settings are unavailable in this browser.",
      "settings.loading": "Loading…",
      "settings.enabled": "AI title generation",
      "settings.subtitle": "Change settings, then click Save settings to apply.",
      "settings.defaultLength": "Default length",
      "settings.characterUnit": "characters",
      "settings.defaultParameters": "Default timeout and retries",
      "settings.formatHelp": "Format and exclusion details",
      "settings.shapeSummary": "Leave the limit empty for defaults. Dates use session creation time.",
      "batch.summary": "Select sessions to retitle together.",
      "batch.help": "Costs and model details",
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
      "settings.modelNotServed": "⚠ The saved model is not in this provider's model list, so generation fails. Re-select a model and save.",
      "settings.modelNotServedSuggestion": "Select instead:",
      "settings.directoryUnavailable": "Could not read the DSH model directory; enter the provider and model IDs manually.",
      "settings.configuredNotice": "The compressed first prompt is sent to this provider.",
      "settings.configuredUnsaved": "Choose a provider and model, then click \"Save settings\".",
      "settings.saveRoute": "Save settings",
      "settings.invalidNumber": "Enter an integer in this range:",
      "settings.saveFailed": "Settings could not be saved. Check the values and DSH logs.",
      "settings.disabledNote": "AI titles are off. DSH still sets a fallback title from your first prompt, and manual renames are unaffected.",
      "settings.advanced": "Advanced",
      "settings.timeout": "Timeout (ms)",
      "settings.maxAttempts": "Max attempts",
      "settings.advancedHint": "Leave empty to inherit defaults. Applies to the next generation.",
      "settings.version": "Version",
      // Title shape + content: cap, date affix, style, language, exclusions ----
      "settings.shapeLegend": "Title shape and content",
      "settings.style": "Style",
      "settings.styleDefault": "Default",
      "settings.styleShortName": "Short task name",
      "settings.styleActionObject": "Action + object",
      "settings.language": "Language",
      "settings.languageAuto": "Auto",
      "settings.languageZh": "Chinese",
      "settings.languageEn": "English",
      "settings.contentHint": "\"Auto\" follows the language primarily used by the task; technology names (React, API, …) stay as they are. Style and language apply to automatic, manual and batch generation, and changing them never rewrites an existing title.",
      "settings.maxCharacters": "Character limit",
      "settings.dateAffix": "Date position",
      "settings.dateAffixOff": "None",
      "settings.dateAffixPrefix": "Prefix",
      "settings.dateAffixSuffix": "Suffix",
      "settings.dateFormat": "Date format",
      "settings.dateFormatYmd": "Year–month–day · 2026-09-14",
      "settings.dateFormatMd": "Month–day · 09-14",
      "settings.shapeHint": "An empty character limit inherits the deployment config (80 bytes: about 26 CJK characters or 80 Latin characters). The date is the session's creation time in local time and does not move when a title is regenerated; the character limit includes the date. The date is omitted when it leaves fewer than 4 body characters or contains an excluded term.",
      "settings.exclusions": "Excluded words",
      "settings.exclusionsBrief": "One per line · Up to 50 words or phrases. Applies only to plugin-generated titles.",
      "settings.exclusionsPlaceholder": "One per line, removed before generation",
      "settings.exclusionsSummary": "Exclusions",
      "settings.exclusionsHint": "These words are deleted from the prompt text before generation and checked again afterwards: a surviving term is retried once, then deleted from the title on the last attempt rather than giving the title up. Matching is literal, and case-insensitive when the term contains ASCII letters; aliases, abbreviations and translations must be added separately.",
      "settings.invalidExclusions": "Each exclusion takes one line of at most 64 characters, with at most 50 entries.",
      "settings.exclusionsBoundary": "This constrains only titles this plugin generates. DSH's fallback title (what a brand-new session shows until the model answers), titles you renamed yourself, and the conversation itself are unaffected.",
      // Batch: optimize past titles ---------------------------------
      "batch.legend": "Batch optimize titles",
      "batch.intro": "Only selected sessions are changed, including manually renamed titles.",
      "batch.costHint": "Generation can retry up to Max attempts; fallback adds calls. Preview also calls the model; applying a preview makes no new model call.",
      "batch.routeHint": "\"Current session model\" uses the model each session logged. For old sessions that model may no longer exist or its credentials may be gone; switch to \"Configured model\" and retry.",
      "batch.retryFailed": "Retry failed",
      "batch.fallback": "On failure, retry once with the configured model",
      "batch.fallbackHint": "Needs a saved configured model: the title route switches to it for the retry then restores the previous mode while preserving user route saves. Reloading can leave the temporary mode in place.",
      "batch.fallbackNeedsRoute": "Save a configured model first to enable the automatic fallback.",
      "batch.fallbackRunning": "Retrying the failed sessions with the configured model…",
      "batch.fallbackDone": "Failed sessions were retried with the configured model.",
      "batch.fallbackFailed": "Automatic fallback or mode restoration failed. Check the title model settings.",
      "batch.fallbackCancelled": "Automatic retry stopped.",
      "batch.error": "The batch ended unexpectedly.",
      "batch.routeInUse": "Generation model",
      "batch.routeDead": "logged model unavailable",
      "batch.routeDeadSummary": "Sessions below log a model DSH no longer serves (they cannot succeed while following the session model; switch to a configured model and retry)",
      "batch.load": "Load past sessions",
      "batch.reload": "Reload",
      "batch.loading": "Loading past sessions…",
      "batch.loadFailed": "Could not read the past-session list.",
      "batch.unavailable": "Past sessions are not readable in this browser.",
      "batch.empty": "No past sessions to optimize (sessions without a user message, subagent sessions and locked sessions are skipped).",
      "batch.skippedLocked": "Locked sessions skipped",
      "batch.count": "Sessions available",
      "batch.cwd": "Project",
      "batch.allCwd": "All projects",
      "batch.selectAll": "Select all",
      "batch.clear": "Clear",
      "batch.selectedCount": "Selected",
      "batch.start": "Optimize directly",
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
      if (outcome == null || typeof outcome !== "object") return { kind: "unavailable", text: "" };
      var result = outcome.result;
      if (result != null && result.kind === "success") {
        return { kind: "success", text: typeof result.text === "string" ? result.text : "" };
      }
      if (result != null && result.kind === "error") {
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

    // DSH resolves rejected mutations after recovery, and publishes only the
    // latest queued write. Serialize our writes and verify the recovered value.
    function settingsDisclosure(title, summary, content) {
      return react.createElement("details", { className: "sst-card sst-disclosure" },
        react.createElement("summary", {},
          react.createElement("span", {}, title),
          react.createElement("span", { className: "sst-disclosure-summary" }, summary)),
        react.createElement("div", { className: "sst-disclosure-body" }, content));
    }

    /** Small local SVGs; no additional icon dependency or host CSS changes. */
    function uiGlyph(kind) {
      var paths = {
        search: ["M20 20l-4-4", "M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0"],
        reload: ["M20 7v5h-5", "M19 12a7 7 0 1 1-2-5l3 3"],
        model: ["M12 3v3", "M8 3h8", "M7 6h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3", "M8 11h.01M16 11h.01M8 16h8", "M1 11v4M23 11v4"],
        check: ["M5 12l4 4L19 6"],
        arrow: ["M4 12h16", "M14 6l6 6-6 6"]
      };
      return react.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24",
        fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round",
        "aria-hidden": true, focusable: false },
        (paths[kind] || []).map(function (path, index) { return react.createElement("path", { key: index, d: path }); }));
    }

    function switchControl(inputProps) {
      return react.createElement("span", { className: "sst-switch-control" },
        react.createElement("input", Object.assign({ type: "checkbox", role: "switch", className: "sst-switch-input" }, inputProps)),
        react.createElement("span", { className: "sst-switch-track", "aria-hidden": true }));
    }

    // Scoped to the plugin; native DSH theme tokens also keep dark mode readable.
    var SETTINGS_CSS = `
.sst-settings {
  --sst-surface: var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-1, #fff));
  --sst-border: var(--dsw-alias-border-l4, #e0e5ed);
  --sst-muted: var(--dsw-alias-label-tertiary, #667085);
  --sst-accent: #1769e8;
  --sst-accent-ink: color-mix(in srgb, var(--sst-accent) 70%, var(--dsw-alias-label-primary, #252b37));
  --sst-tint: color-mix(in srgb, var(--sst-accent) 7%, var(--sst-surface));
  container-type: inline-size; container-name: sst-settings;
  width: 100%; max-width: 680px; min-width: 0; margin: 0 auto;
  padding: 26px 28px 0; border: 1px solid var(--sst-border); border-radius: 14px;
  background: var(--sst-surface); color: var(--dsw-alias-label-primary, inherit);
  font-size: 14px; line-height: 1.6; box-sizing: border-box;
}
.sst-settings.sst-workspace { max-width: 1040px; }
.sst-settings *, .sst-settings *::before, .sst-settings *::after { box-sizing: border-box; }
.sst-settings [hidden] { display: none !important; }
.sst-settings .sst-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.sst-settings h2, .sst-settings h3, .sst-settings p { overflow-wrap: anywhere; }
.sst-settings .sst-wordmark { margin: 0 0 4px; color: var(--sst-muted); font-size: 12px; letter-spacing: .1px; }
.sst-settings .sst-page-heading { margin: 0 0 16px; }
.sst-settings .sst-page-heading h2 { margin: 0 0 4px; font-size: 23px; font-weight: 650; letter-spacing: -.4px; line-height: 1.4; }
.sst-settings .sst-page-heading > p:last-child { margin: 0; color: var(--sst-muted); font-size: 14px; }
.sst-settings .sst-tabs { display: flex; gap: 24px; margin-bottom: 22px; border-bottom: 1px solid var(--sst-border); }
.sst-settings button {
  min-height: 40px; padding: 8px 14px; border: 1px solid var(--sst-border); border-radius: 7px;
  background: var(--sst-surface); color: inherit; font: inherit; font-weight: 500; line-height: 1.4; cursor: pointer;
}
.sst-settings button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 4%, var(--sst-surface)); }
.sst-settings button:disabled { opacity: .45; cursor: default; }
.sst-settings .sst-tab { margin-bottom: -1px; padding: 10px 4px 13px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--sst-muted); }
.sst-settings .sst-tab.is-active { border-bottom-color: var(--sst-accent); color: var(--sst-accent-ink); }
.sst-settings .sst-primary, .sst-settings .sst-save-route { border-color: var(--sst-accent); background: var(--sst-accent); color: #fff; }
.sst-settings .sst-primary:hover:not(:disabled), .sst-settings .sst-save-route:hover:not(:disabled) { background: #125cd0; }
.sst-settings .sst-secondary { color: var(--sst-accent-ink); border-color: color-mix(in srgb, var(--sst-accent) 65%, var(--sst-border)); }
.sst-settings .sst-text-button { border-color: transparent; background: transparent; color: var(--sst-accent-ink); padding-left: 8px; padding-right: 8px; }
.sst-settings .sst-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 40px; padding: 8px; flex: 0 0 40px; }
.sst-settings input:not([type=checkbox]):not([type=radio]), .sst-settings select, .sst-settings textarea {
  width: 100% !important; min-height: 40px; padding: 8px 11px; border: 1px solid var(--sst-border);
  border-radius: 7px; background: var(--sst-surface); color: inherit; font: inherit; line-height: 1.4; max-width: 100%;
}
.sst-settings input::placeholder, .sst-settings textarea::placeholder { color: var(--sst-muted); opacity: .8; }
.sst-settings input[type=checkbox], .sst-settings input[type=radio] { accent-color: var(--sst-accent); }
.sst-settings input[type=checkbox]:not(.sst-switch-input) { width: 16px; height: 16px; min-height: 0; margin: 3px 0; flex: 0 0 16px; }
.sst-settings :is(input, select, textarea, button, summary):focus-visible { outline: 2px solid var(--sst-accent); outline-offset: 3px; }
.sst-settings :is(input, select, textarea):disabled { cursor: default; opacity: .6; }
.sst-settings .sst-section { padding: 22px 0; border-top: 1px solid var(--sst-border); }
.sst-settings .sst-model-section { padding-top: 0; border-top: 0; }
.sst-settings fieldset { min-width: 0; }
.sst-settings legend { font-size: 14px !important; font-weight: 600 !important; padding: 0; margin-bottom: 12px !important; }
.sst-settings .sst-field-label { display: block; margin-bottom: 7px; font-size: 13px; }
.sst-settings .sst-hint { margin: 6px 0 0; font-size: 12px; line-height: 1.6; color: var(--sst-muted); overflow-wrap: anywhere; }
.sst-settings .sst-toggle-row { display: flex; justify-content: space-between; align-items: center; gap: 18px; cursor: pointer; }
.sst-settings .sst-enabled { padding: 2px 0 24px; }
.sst-settings .sst-toggle-copy { min-width: 0; }
.sst-settings .sst-toggle-copy .sst-hint { display: block; margin-top: 3px; }
.sst-settings .sst-toggle-title { display: block; font-weight: 600; }
.sst-settings .sst-switch-control { position: relative; display: inline-flex; width: 44px; height: 25px; flex: 0 0 44px; }
.sst-settings .sst-switch-input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; z-index: 1; }
.sst-settings .sst-switch-track { width: 100%; border-radius: 999px; background: color-mix(in srgb, var(--sst-muted) 32%, var(--sst-surface)); }
.sst-settings .sst-switch-track::after { content: ""; display: block; width: 19px; height: 19px; border-radius: 50%; background: #fff; margin: 3px; box-shadow: 0 1px 3px #0002; transition: transform .16s ease; }
.sst-settings .sst-switch-input:checked + .sst-switch-track { background: var(--sst-accent); }
.sst-settings .sst-switch-input:checked + .sst-switch-track::after { transform: translateX(19px); }
.sst-settings .sst-switch-input:focus-visible + .sst-switch-track { outline: 2px solid var(--sst-accent); outline-offset: 3px; }
.sst-settings .sst-switch-input:disabled { cursor: default; }
.sst-settings .sst-switch-input:disabled + .sst-switch-track { opacity: .45; }
.sst-settings .sst-mode { margin-bottom: 8px !important; }
.sst-settings .sst-mode-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--sst-border); border-radius: 7px; overflow: hidden; }
.sst-settings .sst-mode-options > label { position: relative; display: flex; align-items: center; justify-content: center; padding: 9px 8px; min-height: 40px; font-size: 13px; cursor: pointer; }
.sst-settings .sst-mode-options > label + label { border-left: 1px solid var(--sst-border); }
.sst-settings .sst-mode-options > label:has(input:checked) { background: var(--sst-tint); color: var(--sst-accent-ink); box-shadow: inset 0 0 0 1px var(--sst-accent); }
.sst-settings .sst-mode-options > label:has(input:focus-visible) { outline: 2px solid var(--sst-accent); outline-offset: -3px; }
.sst-settings .sst-mode-options input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; margin: 0; cursor: inherit; }
.sst-settings .sst-model-card { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
.sst-settings .sst-model-card > * { grid-column: 1 / -1; margin: 0 !important; min-width: 0; }
.sst-settings .sst-model-card > div { grid-column: auto; }
.sst-settings .sst-model-card:empty { display: none; }
.sst-settings .sst-shape { display: flex; flex-direction: column; gap: 16px; margin: 0 !important; }
.sst-settings .sst-content-fields, .sst-settings .sst-date-fields, .sst-settings .sst-advanced-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; }
.sst-settings .sst-content-fields > div, .sst-settings .sst-date-fields > div, .sst-settings .sst-advanced-fields > div { margin: 0 !important; min-width: 0; }
.sst-settings .sst-number-field { display: flex; align-items: center; gap: 9px; }
.sst-settings .sst-number-field input { flex: 1; min-width: 0; }
.sst-settings .sst-number-field > span { color: var(--sst-muted); font-size: 12px; flex-shrink: 0; }
.sst-settings .sst-exclusions textarea { display: block; min-height: 76px; resize: vertical; }
.sst-settings .sst-exclusions > p { display: none; }
.sst-settings summary { cursor: pointer; font-size: 13px; color: var(--sst-muted); }
.sst-settings details[open] > summary { margin-bottom: 12px; }
.sst-settings .sst-card { padding: 16px 0; border-top: 1px solid var(--sst-border); }
.sst-settings .sst-card > summary { color: inherit; font-weight: 500; }
.sst-settings .sst-disclosure-body { margin-top: 12px; }
.sst-settings .sst-disclosure-body > div { margin: 0 !important; padding: 0 !important; }
.sst-settings .sst-advanced-fields > p { grid-column: 1 / -1; }
.sst-settings .sst-disclosure-summary { margin-left: 8px; color: var(--sst-muted); font-weight: 400; font-size: 12px; }
.sst-settings .sst-usage-help { padding: 16px 0; border-top: 1px solid var(--sst-border); }
.sst-settings .sst-usage-help h4 { font-size: 13px; margin: 14px 0 4px; }
.sst-settings .sst-usage-help p, .sst-settings .sst-format-help p, .sst-settings .sst-batch-help p { color: var(--sst-muted); font-size: 12px; line-height: 1.7; margin: 8px 0; }
.sst-settings .sst-save-status { margin: 0; color: var(--sst-muted); font-size: 12px; }
.sst-settings .sst-save-status:empty { display: none; }
.sst-settings .sst-footer { position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 18px 28px; margin: 8px -28px 0; border-top: 1px solid var(--sst-border); border-radius: 0 0 14px 14px; background: var(--sst-surface); }
.sst-settings .sst-footer-copy { flex: 1; min-width: 150px; }
.sst-settings .sst-footer-copy strong { font-size: 13px; font-weight: 600; }
.sst-settings .sst-version { margin: 0 !important; padding: 0 !important; border: 0 !important; color: var(--sst-muted); font-size: 12px; }
.sst-settings .sst-footer-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.sst-settings .sst-notice, .sst-settings [role=alert] { padding: 12px 14px; border: 1px solid var(--sst-border); border-radius: 8px; background: color-mix(in srgb, #df9d37 8%, var(--sst-surface)); font-size: 12px; margin: 8px 0 14px; }
.sst-settings .sst-batch { margin: 0; }
.sst-settings .sst-route-banner { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--sst-tint); border-radius: 8px; font-size: 13px; margin-bottom: 16px; overflow-wrap: anywhere; }
.sst-settings .sst-route-banner svg { color: var(--sst-accent-ink); flex-shrink: 0; }
.sst-settings .sst-filter-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.sst-settings .sst-search { display: flex; align-items: center; position: relative; flex: 1; min-width: 0; }
.sst-settings .sst-search svg { position: absolute; left: 12px; color: var(--sst-muted); pointer-events: none; }
.sst-settings .sst-search input { padding-left: 36px !important; }
.sst-settings .sst-filter-toolbar > select { width: 32% !important; min-width: 110px; max-width: 260px; text-overflow: ellipsis; }
.sst-settings .sst-batch-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: var(--sst-muted); font-size: 12px; margin: 6px 0 12px; }
.sst-settings .sst-selection-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 10px 12px; margin-bottom: 14px; border: 1px solid var(--sst-border); border-radius: 8px; }
.sst-settings .sst-selection-buttons, .sst-settings .sst-run-buttons { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.sst-settings .sst-selection-buttons button { min-height: 30px; padding: 4px 6px; border: 0; background: transparent; font-size: 13px; }
.sst-settings .sst-selection-buttons > span { color: var(--sst-muted); font-size: 12px; white-space: nowrap; }
.sst-settings .sst-session-list { max-height: 300px; overflow-y: auto; border: 1px solid var(--sst-border); border-radius: 8px; margin-bottom: 14px; }
.sst-settings .sst-session-row { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; cursor: pointer; font-size: 14px; overflow-wrap: anywhere; }
.sst-settings .sst-session-row + .sst-session-row { border-top: 1px solid var(--sst-border); }
.sst-settings .sst-session-row:hover { background: var(--sst-tint); }
.sst-settings .sst-session-row > span { display: flex; flex-direction: column; min-width: 0; }
.sst-settings .sst-row-title { font-weight: 500; }
.sst-settings .sst-row-meta { color: var(--sst-muted); font-size: 12px; line-height: 1.6; margin-top: 3px; overflow-wrap: anywhere; }
.sst-settings .sst-session-picker { margin-bottom: 16px; }
.sst-settings .sst-session-picker > summary { font-size: 12px; }
.sst-settings .sst-comparison { margin-top: 8px; }
.sst-settings .sst-comparison-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
.sst-settings .sst-comparison-toolbar h3 { margin: 0; font-size: 14px; font-weight: 600; }
.sst-settings .sst-comparison-toolbar button { min-height: 30px; font-size: 12px; padding: 4px 8px; }
.sst-settings .sst-comparison-table { border: 1px solid var(--sst-border); border-radius: 9px; overflow: hidden; }
.sst-settings .sst-comparison-heading, .sst-settings .sst-comparison-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) 20px minmax(0, 1fr); gap: 14px; align-items: center; padding: 12px 16px; }
.sst-settings .sst-comparison-heading { background: color-mix(in srgb, currentColor 3%, var(--sst-surface)); color: var(--sst-muted); font-size: 12px; font-weight: 500; }
.sst-settings .sst-comparison-rows { max-height: 420px; overflow-y: auto; }
.sst-settings .sst-comparison-row { align-items: start; border-top: 1px solid var(--sst-border); padding-top: 16px; padding-bottom: 16px; cursor: pointer; overflow-wrap: anywhere; }
.sst-settings .sst-comparison-row > div { min-width: 0; }
.sst-settings .sst-comparison-row input { margin-top: 5px !important; }
.sst-settings .sst-title-before { font-weight: 500; }
.sst-settings .sst-title-after { background: var(--sst-tint); padding: 12px 14px; border-radius: 6px; font-weight: 600; }
.sst-settings .sst-comparison-arrow { align-self: center; color: var(--sst-muted); }
.sst-settings .sst-mobile-label { display: none; color: var(--sst-muted); font-size: 11px; font-weight: 400; margin-bottom: 4px; }
.sst-settings .sst-candidate-state { display: block; margin-top: 5px; color: var(--sst-muted); font-size: 12px; font-weight: 400; }
.sst-settings .sst-batch-progress { padding: 14px 16px; margin-top: 18px; border: 1px solid var(--sst-border); border-radius: 8px; background: var(--sst-tint); }
.sst-settings .sst-batch-progress.is-success { border-color: color-mix(in srgb, #12a17b 30%, var(--sst-surface)); background: color-mix(in srgb, #12a17b 8%, var(--sst-surface)); }
.sst-settings .sst-progress-heading { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; }
.sst-settings .sst-progress-heading > strong { font-size: 13px; font-weight: 600; }
.sst-settings .sst-progress-title { display: inline-flex; align-items: center; gap: 8px; }
.sst-settings .sst-success-mark { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: #0c9270; color: #fff; flex-shrink: 0; }
.sst-settings .sst-progress-heading > span { color: var(--sst-muted); }
.sst-settings .sst-progress-track { height: 5px; margin: 12px 0; border-radius: 999px; overflow: hidden; background: var(--sst-border); }
.sst-settings .sst-progress-fill { height: 100%; border-radius: 999px; background: var(--sst-accent); }
.sst-settings .sst-batch-options, .sst-settings .sst-batch-help { margin: 14px 0; }
.sst-settings .sst-fallback-choice { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; }
.sst-settings .sst-empty { padding: 28px 16px; border: 1px dashed var(--sst-border); border-radius: 8px; text-align: center; color: var(--sst-muted); font-size: 13px; }
@container sst-settings (max-width: 520px) {
  .sst-settings .sst-filter-toolbar { flex-wrap: wrap; }
  .sst-settings .sst-search { flex-basis: calc(100% - 50px); }
  .sst-settings .sst-filter-toolbar > select { order: 3; width: 100% !important; max-width: none; }
  .sst-settings .sst-selection-toolbar { align-items: flex-start; }
  .sst-settings .sst-run-buttons { width: 100%; }
  .sst-settings .sst-comparison-heading { display: none; }
  .sst-settings .sst-comparison-row { grid-template-columns: 20px minmax(0, 1fr); gap: 10px; }
  .sst-settings .sst-comparison-row > input { grid-column: 1; grid-row: 1 / 3; }
  .sst-settings .sst-title-before, .sst-settings .sst-title-after { grid-column: 2; }
  .sst-settings .sst-comparison-arrow { display: none; }
  .sst-settings .sst-mobile-label { display: block; }
  .sst-settings .sst-disclosure-summary { display: none; }
}
@container sst-settings (max-width: 360px) {
  .sst-settings .sst-content-fields, .sst-settings .sst-date-fields, .sst-settings .sst-model-card, .sst-settings .sst-advanced-fields { grid-template-columns: minmax(0, 1fr); }
  .sst-settings .sst-footer-actions { width: 100%; }
  .sst-settings .sst-footer-actions > button { flex: 1; }
}
@media (max-width: 480px) { .sst-settings { padding: 20px 16px 0; } .sst-settings .sst-footer { margin-left: -16px; margin-right: -16px; padding: 16px; } }
@media (prefers-reduced-motion: reduce) { .sst-settings .sst-switch-track::after { transition: none; } }

`;

    var settingsWrites = new WeakMap();
    var settingsRouteWrites = new WeakMap();

    // Mirror the shared host constraints before either legacy Settings or
    // Core 0.2 ConfigForms writes. In particular, never store a 501st lock.
    function validateSettingsWrite(snapshot, ops) {
      if (!snapshot || snapshot.status !== "ready" || snapshot.writable === false) throw new Error("settings are not writable");
      var next = Object.assign({}, snapshot.value || {});
      var enums = { mode: ["current-session", "configured", "disabled"], titleDatePosition: ["prefix", "suffix"],
        titleDateFormat: ["ymd", "md"], titleStyle: ["action-object", "short-name"], titleLanguage: ["zh", "en"] };
      var ranges = { timeoutMs: [1000, 120000], maxAttempts: [1, 3], maxTitleCharacters: [8, 120] };
      var names = ["enabled", "showSessionId", "provider", "model", "titleExclusions", "lockedSessionIds"].concat(Object.keys(enums), Object.keys(ranges));
      ops.forEach(function (op) {
        if (!op || !Array.isArray(op.path) || op.path.length !== 1 || names.indexOf(op.path[0]) === -1 ||
            (op.op !== "set" && op.op !== "unset")) throw new Error("invalid settings operation");
        if (op.op === "unset") {
          if (snapshot.base && Object.prototype.hasOwnProperty.call(snapshot.base, op.path[0])) next[op.path[0]] = snapshot.base[op.path[0]];
          else delete next[op.path[0]];
        } else next[op.path[0]] = op.value;
      });
      ["enabled", "showSessionId"].forEach(function (key) {
        if (next[key] !== undefined && typeof next[key] !== "boolean") throw new Error("invalid boolean setting");
      });
      Object.keys(enums).forEach(function (key) {
        if (next[key] !== undefined && enums[key].indexOf(next[key]) === -1) throw new Error("invalid settings choice");
      });
      Object.keys(ranges).forEach(function (key) {
        if (next[key] !== undefined && (!Number.isInteger(next[key]) || next[key] < ranges[key][0] || next[key] > ranges[key][1])) throw new Error("invalid settings range");
      });
      ["provider", "model"].forEach(function (key) {
        if (next[key] !== undefined && (typeof next[key] !== "string" || next[key].trim() === "")) throw new Error("invalid title route");
      });
      if ((next.provider === undefined) !== (next.model === undefined) ||
          (next.mode === "configured" && next.provider === undefined)) throw new Error("incomplete title route");
      ["titleExclusions", "lockedSessionIds"].forEach(function (key) {
        var list = next[key];
        if (list === undefined) return;
        if (!Array.isArray(list) || list.length > (key === "titleExclusions" ? 50 : 500) || list.some(function (value) {
          return typeof value !== "string" || Array.from(value.trim()).length > 64 || /[\u0000-\u001f\u007f]/u.test(value);
        })) throw new Error("invalid settings list");
      });
    }
    /**
     * Value equality for the post-write check below.
     *
     * `===` is not enough once a setting is a LIST: the host resolves a fresh,
     * frozen array on every snapshot, so an identity comparison would report a
     * perfectly successful write as "not applied" and show a save error. Arrays
     * are compared element-wise; everything else keeps the strict identity check
     * that detects a silently ignored write.
     */
    function sameSettingValue(left, right) {
      if (left === right) return true;
      if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every(function (item, index) {
          return item === right[index];
        });
      }
      return false;
    }

    function persistSettings(scope, ops, expectedRevision) {
      var previous = settingsWrites.get(scope) || Promise.resolve();
      var task = previous.catch(function () {}).then(function () {
        var before = scope.getSnapshot();
        validateSettingsWrite(before, ops);
        return Promise.resolve(scope.mutate(ops, expectedRevision === undefined ? before.revision : expectedRevision)).then(function () {
          if (ops.some(function (op) { return ["mode", "provider", "model"].indexOf(op.path[0]) !== -1; })) {
            settingsRouteWrites.set(scope, (settingsRouteWrites.get(scope) || 0) + 1);
          }
        });
      }).then(function () {
        var snap = scope.getSnapshot();
        if (!snap || snap.status !== "ready" || !ops.every(function (op) {
          var key = op.path[0];
          return op.op === "unset"
            ? !Object.prototype.hasOwnProperty.call(snap.user || {}, key)
            : sameSettingValue((snap.value || {})[key], op.value) && sameSettingValue((snap.user || {})[key], op.value);
        })) throw new Error("settings write was not applied");
      });
      settingsWrites.set(scope, task);
      return task;
    }

    /** Read effective locks, including inherited Core 0.2 Config values. */
    function lockedIdsOf(snapshot) {
      if (!snapshot) return [];
      var user = snapshot.user || {};
      var ids = Object.prototype.hasOwnProperty.call(user, "lockedSessionIds") ? user.lockedSessionIds : (snapshot.value || {}).lockedSessionIds;
      return Array.isArray(ids) ? ids : [];
    }

    /** Whether one session's title is locked in the given snapshot. */
    function isLockedIn(snapshot, sessionId) {
      if (typeof sessionId !== "string" || sessionId.length === 0) return false;
      return lockedIdsOf(snapshot).indexOf(sessionId) !== -1;
    }

    /**
     * Flip one session's lock through the public settings scope.
     *
     * The lock lives in the plugin's own settings namespace on the host, NOT in
     * browser storage: a lock therefore survives a new window, a cleared browser
     * profile, and a DSH restart. The list is read back from the CURRENT snapshot
     * at click time and the write is fenced by that snapshot's revision, so a
     * concurrent change (another window locking a different session) fails the
     * write loudly instead of being silently clobbered by this read-modify-write.
     *
     * @param scope - the bound settings scope controller.
     * @param sessionId - the session whose lock to flip.
     * @returns a promise settling when the write landed (or was refused).
     */
    function toggleSessionLock(scope, sessionId) {
      if (scope === undefined || typeof sessionId !== "string" || sessionId.length === 0) {
        return Promise.resolve();
      }
      var snapshot = scope.getSnapshot();
      if (snapshot === null || snapshot === undefined || snapshot.status !== "ready") {
        return Promise.resolve();
      }
      var current = lockedIdsOf(snapshot);
      var next = current.indexOf(sessionId) === -1
        ? current.concat([sessionId])
        : current.filter(function (id) { return id !== sessionId; });
      // An empty list is an unset, so an absent key keeps meaning "nothing locked"
      // and DSH's persistent configuration never accumulates an empty array.
      return persistSettings(
        scope,
        next.length === 0
          ? [{ op: "unset", path: ["lockedSessionIds"] }]
          : [{ op: "set", path: ["lockedSessionIds"], value: next }],
        snapshot.revision
      );
    }

    function parseTitlePreview(text, sessionId) {
      try {
        var candidate = JSON.parse(text);
        if (!candidate || candidate.kind !== "title-preview" || candidate.sessionId !== sessionId ||
            typeof candidate.previewId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(candidate.previewId) ||
            typeof candidate.title !== "string" || candidate.title.trim() === "" ||
            typeof candidate.previousTitle !== "string" || !Number.isFinite(candidate.expiresAt)) return undefined;
        return candidate;
      } catch (error) { return undefined; }
    }

    /** Reset value of the batch runner's snapshot. */
    function idleBatchSnapshot() {
      return {
        status: "idle",
        operation: "regenerate",
        previews: [],
        total: 0,
        completed: 0,
        succeeded: 0,
        failed: 0,
        currentSessionId: "",
        failures: [],
        cancelRequested: false,
        // "idle" | "running" | "done" | "failed" | "cancelled": the optional second pass that
        // re-runs the failures with the configured route.
        fallback: "idle",
        retryTotal: 0,
        retryCompleted: 0
      };
    }

    /**
     * Runner for "optimize past titles".
     *
     * Sequential by design: only one preview, application or `/retitle` runs at a
     * time. Generations can make several bounded model attempts. Every step
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
     * @param execute - `(sessionId, signal, operation, entry) => Promise<outcome>`: the
     *   preview/apply/regenerate command route. `signal` is a real client-side cancellation: the Remote accepts a
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
        var retry = state.fallback === "running";
        var failures = state.failures.filter(function (failure) {
          return failure.sessionId !== entry.sessionId;
        });
        var previews = state.previews;
        if (verdict.kind === "success" && state.operation === "preview") {
          var candidate = parseTitlePreview(verdict.text, entry.sessionId);
          if (candidate === undefined) verdict = { kind: "error" };
          else previews = previews.filter(function (item) { return item.sessionId !== entry.sessionId; }).concat([candidate]);
        }
        var success = verdict.kind === "success";
        if (success && state.operation === "apply") previews = previews.map(function (item) {
          return item.previewId === entry.previewId ? Object.assign({}, item, { applied: true }) : item;
        });
        if (!success) failures.push({
          sessionId: entry.sessionId,
          previewId: entry.previewId,
          kind: verdict.kind,
          reason: truncateReason(verdict.text)
        });
        emit({
          completed: state.completed + (retry ? 0 : 1),
          succeeded: state.succeeded + (success ? 1 : 0),
          failed: failures.length,
          failures: failures,
          previews: previews,
          retryCompleted: state.retryCompleted + (retry ? 1 : 0),
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
            return execute(entry.sessionId, abort === null ? undefined : abort.signal, state.operation, entry);
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
        var seen = Object.create(null);
        for (var index = 0; index < (rows || []).length; index += 1) {
          var row = rows[index];
          var id = row !== null && row !== undefined ? row.sessionId : undefined;
          if (typeof id !== "string" || id.length === 0 || seen[id] === true) continue;
          seen[id] = true;
          queue.push({ sessionId: id, previewId: row.previewId });
        }
        return queue;
      }

      /** Retry results replace the original failure; interrupted retries keep it. */
      function runPass(queue, retry) {
        if (cancelled || queue.length === 0) return Promise.resolve(state);
        emit(retry ? {
          retryTotal: queue.length, retryCompleted: 0
        } : {
          status: "running", total: queue.length, completed: 0,
          succeeded: 0, failed: 0, failures: [],
          retryTotal: 0, retryCompleted: 0, cancelRequested: false
        });
        return step(queue, 0).then(function () { return state; });
      }

      /** Should this finished pass trigger the one allowed fallback pass? */
      function shouldFallback(result) {
        return state.operation === "regenerate" && autoFallback === true &&
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
            if (cancelled) return;
            return runFallbackHook(failed, function (rows) {
              return runPass(buildQueue(rows), true);
            });
          })
          .then(
            function () {
              emit({ fallback: cancelled ? "cancelled" : "done" });
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
        start: function (rows, operation) {
          if (inflight !== null) return inflight;
          var queue = buildQueue(rows);
          if (queue.length === 0) return Promise.resolve(state);
          cancelled = false;
          // A user-initiated run re-arms the fallback; the fallback pass itself
          // runs through `runPass` and can never re-arm it.
          fallbackAttempted = false;
          operation = operation === "preview" || operation === "apply" ? operation : "regenerate";
          emit({ fallback: "idle", operation: operation, previews: operation === "apply" ? state.previews : [] });
          inflight = runPass(queue)
            .then(function (result) {
              return shouldFallback(result) ? beginFallback(result) : undefined;
            })
            .then(
              function () {
                inflight = null;
                emit({ status: cancelled ? "cancelled" : "done", currentSessionId: "", cancelRequested: false });
                return state;
              },
              function () {
                inflight = null;
                emit({ status: "error", currentSessionId: "", cancelRequested: false });
                return state;
              }
            );
          return inflight;
        },
        clearPreviews: function () {
          if (inflight === null) emit({ previews: [] });
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
     * Read the cross-namespace settings mirror into a provider -> model-ID map
     * plus a provider -> ID -> display-name map, so the configured-mode
     * selectors can offer the models the user has already registered in DSH's
     * Models page instead of free-text IDs.
     *
     * Two document shapes are covered (both seen in real DSH deployments):
     *   1. `<ns>.providers.<providerId>.models = [{ id, name, ... }]`  (llm-pi-ai)
     *   2. `<ns>.models = [{ id, name, ... }]`                          (llm-deepseek)
     * Form 2's provider id is resolved later through `listConfigurableProviders`
     * (settingsNs -> provider), so it is stored under a synthetic `ns:` key.
     *
     * The ID — never the display name — is what `ctx.llm.stream()` accepts and
     * what `session.modelSelection` logs, so the ID is the only value a
     * selector may store; the name exists purely as the option label.
     */
    function readProviderModels(describeSnapshot) {
      var byProvider = Object.create(null);
      var labels = Object.create(null);
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
            var collected = collectModels(models);
            byProvider[providerId] = collected.ids;
            labels[providerId] = collected.labels;
          }
        }
        if (Array.isArray(value.models)) {
          var nsCollected = collectModels(value.models);
          byProvider["ns:" + ns] = nsCollected.ids;
          labels["ns:" + ns] = nsCollected.labels;
        }
      }
      return { byProvider: byProvider, labels: labels };
    }

    /**
     * Pull the canonical `id` out of a DSH model record list, remembering each
     * record's display `name` for the option label.
     *
     * Storing the name instead of the id is a silent, total failure: a real
     * deployment (`commandcode`, id `deepseek/deepseek-v4.1-flash`, name
     * `DeepSeek V4.1 Flash`) rejected the name locally in ~8ms with
     * `UNKNOWN_MODEL`, which surfaced only as a generic "upstream failure" on
     * every generation. A record without an `id` (older/hand-written shapes)
     * still falls back to its name so the entry stays selectable.
     */
    function collectModels(models) {
      var ids = [];
      var labels = Object.create(null);
      for (var index = 0; index < models.length; index += 1) {
        var model = models[index];
        if (model === null || typeof model !== "object") continue;
        var name = typeof model.name === "string" && model.name.length > 0 ? model.name : undefined;
        var id = typeof model.id === "string" && model.id.length > 0 ? model.id : name;
        if (id === undefined) continue;
        if (ids.indexOf(id) === -1) ids.push(id);
        labels[id] = name === undefined ? id : name;
      }
      return { ids: ids, labels: labels };
    }

    /**
     * Build the dropdown catalog: the provider directory plus, per provider,
     * the model names already configured in DSH.
     *
     * @param remote - `ctx.remote` (llm directory methods).
     * @param describe - the shared settings/config describe mirror.
     * @returns a promise of `{ providers, byProvider, byNs, labels }` where
     *   `providers` is `[{ id, name }]`, `byProvider` maps provider id -> model
     *   IDs, `byNs` maps settings namespace -> provider id, and `labels` maps
     *   provider id -> model ID -> display name.
     */
    function loadModelCatalog(remote, describe) {
      var mirror = readProviderModels(describe.getSnapshot());
      var byProvider = mirror.byProvider;
      var labels = mirror.labels;
      var llm = remote !== undefined && remote !== null ? remote.llm : undefined;
      if (llm === undefined ||
          typeof llm.listProviders !== "function" ||
          typeof llm.listConfigurableProviders !== "function") {
        // `remote.llm` was not granted (missing inject declaration) or this
        // host exposes a different surface: degrade to manual entry, and let
        // the caller surface the empty directory so the user knows why.
        return Promise.resolve({ providers: [], byProvider: byProvider, byNs: {}, labels: labels });
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
        return { providers: providers, byProvider: byProvider, byNs: byNs, labels: labels };
      }).catch(function () {
        // Directory unavailable: keep the mirror-derived map; the section
        // still works through the manual-entry fallback.
        return { providers: [], byProvider: byProvider, byNs: {}, labels: labels };
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

    /** The id -> display-name map for one provider id, mirror layouts included. */
    function modelLabelsForProvider(catalog, providerId) {
      if (catalog === undefined || catalog === null || providerId === undefined || providerId === "") return undefined;
      var labels = catalog.labels || {};
      if (labels[providerId] !== undefined) return labels[providerId];
      var byNs = catalog.byNs || {};
      for (var key of Object.keys(labels)) {
        if (key.indexOf("ns:") !== 0) continue;
        if (byNs[key.slice(3)] === providerId) return labels[key];
      }
      return undefined;
    }

    /**
     * The text one model option shows. The option's VALUE is always the model
     * ID; a display name that differs from it is spelled out beside the ID, so
     * a saved name that DSH cannot serve stays visibly distinct from the real
     * entry instead of looking like the same choice.
     */
    function modelOptionLabel(catalog, providerId, modelId) {
      var labels = modelLabelsForProvider(catalog, providerId);
      var name = labels === undefined ? undefined : labels[modelId];
      if (name === undefined || name === modelId) return modelId;
      return name + " · " + modelId;
    }

    /**
     * Reverse lookup for a saved value that resolved to nothing: a value equal
     * to a display NAME is repairable by selecting that model's ID, so the
     * settings hint can name the exact ID instead of only reporting a failure.
     */
    function modelIdForLabel(catalog, providerId, label) {
      var labels = modelLabelsForProvider(catalog, providerId);
      if (labels === undefined) return undefined;
      for (var id of Object.keys(labels)) {
        if (labels[id] === label && id !== label) return id;
      }
      return undefined;
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
          className: "sst-version",
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

    function TitlePreviewAction(props) {
      var t = translatorOf(props);
      var scope = props.scope;
      var snapshotPair = react.useState(function () { return scope === undefined ? undefined : scope.getSnapshot(); });
      var candidatePair = react.useState(undefined);
      var pendingPair = react.useState("");
      var errorPair = react.useState("");
      var mounted = react.useRef(true);
      var inflight = react.useRef(null);
      var dialog = react.useRef(null);
      react.useEffect(function () {
        mounted.current = true;
        candidatePair[1](undefined);
        errorPair[1]("");
        pendingPair[1]("");
        return function () {
          mounted.current = false;
          if (inflight.current !== null) inflight.current.abort();
          inflight.current = null;
        };
      }, [props.sessionId]);
      react.useEffect(function () {
        if (scope === undefined) return undefined;
        snapshotPair[1](scope.getSnapshot());
        return scope.subscribe(function () { if (mounted.current) snapshotPair[1](scope.getSnapshot()); });
      }, [scope]);
      var candidate = candidatePair[0];
      react.useEffect(function () { if (candidate && dialog.current) dialog.current.focus(); }, [candidate]);
      var disabled = isAiDisabledSnapshot(snapshotPair[0]) || isLockedIn(snapshotPair[0], props.sessionId);
      function request(operation) {
        if (inflight.current !== null || disabled || typeof props.execute !== "function") return Promise.resolve();
        var abort = new AbortController();
        inflight.current = abort;
        pendingPair[1](operation);
        errorPair[1]("");
        return Promise.resolve().then(function () {
          return props.execute(operation === "preview" ? PREVIEW_LINE : APPLY_PREVIEW_LINE + " " + candidate.previewId, abort.signal);
        }).then(function (result) {
          if (!mounted.current || abort.signal.aborted) return;
          var verdict = interpretOutcome(result);
          if (verdict.kind !== "success") throw new Error(truncateReason(verdict.text) || t("preview.failed"));
          if (operation === "preview") {
            var value = parseTitlePreview(verdict.text, props.sessionId);
            if (!value) throw new Error(t("preview.invalid"));
            candidatePair[1](value);
          } else candidatePair[1](undefined);
        }).catch(function (error) {
          if (mounted.current && !abort.signal.aborted) errorPair[1](t("preview.failed") + (error && error.message ? ": " + truncateReason(error.message) : ""));
        }).finally(function () {
          if (inflight.current === abort) inflight.current = null;
          if (mounted.current && !abort.signal.aborted) pendingPair[1]("");
        });
      }
      var pending = pendingPair[0];
      var reason = isLockedIn(snapshotPair[0], props.sessionId) ? t("action.locked") : isAiDisabledSnapshot(snapshotPair[0]) ? t("action.disabled") : t("preview.open");
      var buttonStyle = { border: "1px solid var(--dsw-alias-border-l4)", background: "var(--dsw-alias-bg-base)", color: "inherit", borderRadius: 6, padding: "4px 8px", fontSize: 12, cursor: "pointer" };
      return react.createElement("span", { className: "sst-preview-action" },
        react.createElement("button", { type: "button", style: buttonStyle, title: reason,
          disabled: disabled || !!pending || typeof props.execute !== "function", onClick: function () { return request("preview"); } },
          pending === "preview" ? t("preview.generating") : t("preview.open")),
        candidate ? react.createElement("div", { role: "dialog", "aria-label": t("preview.open"), tabIndex: -1, ref: dialog,
          onKeyDown: function (event) { if (event.key === "Escape" && !pending) candidatePair[1](undefined); },
          style: { position: "fixed", zIndex: 10000, top: 72, right: 16, width: "min(420px, calc(100vw - 32px))", boxSizing: "border-box", padding: 16,
            border: "1px solid var(--dsw-alias-border-l4)", borderRadius: 10, background: "var(--dsw-alias-bg-base)", color: "inherit", whiteSpace: "normal", boxShadow: "0 8px 30px #0003", maxHeight: "calc(100vh - 100px)", overflowY: "auto" } },
          react.createElement("strong", {}, t("preview.open")),
          react.createElement("p", { style: HINT_STYLE }, t("preview.hint")),
          react.createElement("dl", { style: { margin: "12px 0", overflowWrap: "anywhere" } },
            react.createElement("dt", { style: HINT_STYLE }, t("preview.old")),
            react.createElement("dd", { style: { margin: "4px 0 12px" } }, candidate.previousTitle || t("batch.noTitle")),
            react.createElement("dt", { style: HINT_STYLE }, t("preview.new")),
            react.createElement("dd", { style: { margin: "4px 0 12px", fontWeight: 500 } }, candidate.title)),
          react.createElement("div", { style: { display: "flex", gap: 8 } },
            react.createElement("button", { type: "button", style: buttonStyle, disabled: disabled || !!pending,
              onClick: function () { return request("apply"); } }, pending === "apply" ? t("preview.applying") : t("preview.apply")),
            react.createElement("button", { type: "button", style: buttonStyle, disabled: !!pending,
              onClick: function () { candidatePair[1](undefined); errorPair[1](""); } }, t("preview.close"))),
          errorPair[0] ? react.createElement("p", { role: "alert", style: HINT_STYLE }, errorPair[0]) : null)
          : errorPair[0] ? react.createElement("span", { role: "alert", style: HINT_STYLE }, errorPair[0]) : null);
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
        mounted.current = true;
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
      // A locked title is refused BEFORE the command is issued. The host refuses it
      // too (that half is what makes the guarantee hold for a stale client), but it
      // can only answer with a generic failure the user cannot act on — so the
      // button itself carries the reason instead.
      var locked = isLockedIn(settingsSnapshot, sessionId);
      var busy = state === "loading" || aiDisabled || locked;
      var label = locked
        ? t("action.locked")
        : aiDisabled
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
        width: "auto",
        gap: 5,
        fontSize: 12,
        whiteSpace: "nowrap",
        height: 28,
        padding: "0 8px",
        border: "none",
        borderRadius: 6,
        display: "inline-flex",
        alignItems: "center",
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
        title: state === "error" ? t("action.failed") : busy ? label : t("action.help"),
        onClick: onClick,
        onMouseEnter: function () {
          setHovered(true);
        },
        onMouseLeave: function () {
          setHovered(false);
        },
        children: [jsxRuntime.jsx(primitives.IconRefreshOutlineRegular, {}), react.createElement("span", {}, t("action.short"))]
      });
    }

    /**
     * The lock glyph: a 16px outline padlock whose shackle opens when unlocked.
     *
     * Drawn here rather than taken from the shipped primitives because the DSH
     * bundle exports no lock or pin icon (checked in `app.asar`: the primitives
     * package has no `IconLock*`/`IconPin*` name at all). An inline SVG keeps the
     * affordance dependency-free and, unlike a text or emoji glyph, adds no
     * user-visible string that would have to live in the dictionary.
     *
     * @param locked - whether the closed shackle should be drawn.
     */
    function lockGlyph(locked) {
      return jsxRuntime.jsxs("svg", {
        width: 16,
        height: 16,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.4,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        children: [
          jsxRuntime.jsx("rect", { key: "body", x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.4 }),
          jsxRuntime.jsx("path", {
            key: "shackle",
            d: locked
              ? "M5.8 7V5.2a2.2 2.2 0 0 1 4.4 0V7"
              : "M5.8 7V5.2a2.2 2.2 0 0 1 4.4 0"
          })
        ]
      });
    }

    /**
     * Header lock toggle for one session's title.
     *
     * The lock is the user's explicit "no entry point may rewrite this title". It
     * matters for the two DELIBERATE paths that are allowed to override a
     * hand-written title — the regenerate button beside it and the batch run —
     * which is exactly why it cannot live in this window's storage: the whole
     * point is that a lock set here also holds in another window, after a browser
     * profile reset, and after a DSH restart. It therefore goes through the same
     * official settings/config form the page uses (a DSH profile reset drops it).
     *
     * The button shows the state itself: a closed padlock means locked, and the
     * label always names the action the click would perform.
     */
    function LockTitleAction(props) {
      var t = translatorOf(props);
      var scope = props.scope;
      var sessionId = props.sessionId;

      var snapshotPair = react.useState(function () {
        return scope === undefined ? undefined : scope.getSnapshot();
      });
      var snapshot = snapshotPair[0];
      var setSnapshot = snapshotPair[1];
      var hoverPair = react.useState(false);
      var hovered = hoverPair[0];
      var setHovered = hoverPair[1];
      // A refused write (a concurrent change in another window, or a full list)
      // must be visible: report it on the button instead of failing silently.
      var failedPair = react.useState(false);
      var failed = failedPair[0];
      var setFailed = failedPair[1];
      var pendingPair = react.useState(false);
      var pending = pendingPair[0];
      var setPending = pendingPair[1];

      var mounted = react.useRef(true);
      react.useEffect(function () {
        mounted.current = true;
        return function () {
          mounted.current = false;
        };
      }, []);

      react.useEffect(
        function () {
          if (scope === undefined) return undefined;
          return scope.subscribe(function () {
            if (mounted.current) setSnapshot(scope.getSnapshot());
          });
        },
        [scope]
      );

      var locked = isLockedIn(snapshot, sessionId);
      var label = failed
        ? t("lock.failed")
        : locked
          ? t("lock.unlock")
          : t("lock.lock");
      var busy = scope === undefined || pending;

      // Shares the shipped header affordance's metrics with the regenerate button
      // beside it — 28px round, transparent, tertiary label colour, hover wash.
      var style = {
        width: "auto",
        gap: 5,
        fontSize: 12,
        whiteSpace: "nowrap",
        height: 28,
        padding: "0 8px",
        border: "none",
        borderRadius: 6,
        display: "inline-flex",
        alignItems: "center",
        placeItems: "center",
        flex: "none",
        background: hovered && !busy ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
        // A locked title is a state the user must be able to see at a glance, so
        // the glyph carries the primary colour instead of the tertiary wash.
        color: locked ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-tertiary)",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.45 : 1
      };

      return jsxRuntime.jsx("button", {
        type: "button",
        style: style,
        disabled: busy,
        "aria-pressed": locked ? "true" : "false",
        "aria-label": label,
        title: failed ? label : t(locked ? "lock.unlockHelp" : "lock.help"),
        onClick: function () {
          setFailed(false);
          setPending(true);
          Promise.resolve(toggleSessionLock(scope, sessionId)).then(
            function () {
              if (!mounted.current) return;
              setPending(false);
              setSnapshot(scope.getSnapshot());
            },
            function () {
              if (!mounted.current) return;
              setPending(false);
              setFailed(true);
            }
          );
        },
        onMouseEnter: function () {
          setHovered(true);
        },
        onMouseLeave: function () {
          setHovered(false);
        },
        children: [lockGlyph(locked), react.createElement("span", {}, t(locked ? "lock.active" : "lock.short"))]
      });
    }

    /** Read-only header utility; uses the existing session-scoped slot and settings mirror. */
    function SessionIdAction(props) {
      var t = translatorOf(props);
      var scope = props.scope;
      var pair = react.useState(function () { return scope && scope.getSnapshot(); });
      var feedback = react.useState(null);
      var request = react.useRef(0);
      react.useEffect(function () {
        if (!scope) return undefined;
        pair[1](scope.getSnapshot());
        return scope.subscribe(function () { pair[1](scope.getSnapshot()); });
      }, [scope]);
      react.useEffect(function () {
        request.current += 1;
        feedback[1](null);
        return function () { request.current += 1; };
      }, [props.sessionId]);
      var snap = pair[0];
      if (!snap || snap.status !== "ready" || (snap.user || {}).showSessionId === false || !props.sessionId) return null;
      var state = feedback[0];
      var label = state === "copied" ? t("sessionId.copied") : state === "failed" ? t("sessionId.failed") : t("sessionId.copy");
      // DSH Desktop 2.0.9: titleRow precedes tabs (verified in shipped client).
      // Scope positioning to a row containing our own element. If the host class
      // changes, the utility safely falls back to its ordinary inline slot.
      return react.createElement("span", { className: "sst-session-id", style: { display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 } },
        react.createElement("style", {}, ".uPhUma_titleRow:has(.sst-session-id){position:relative;padding-bottom:16px}.uPhUma_titleRow .sst-session-id{position:absolute;left:8px;bottom:0;max-width:calc(100% - 8px);height:16px}.uPhUma_titleRow .sst-session-id>button{max-width:min(480px,70vw)!important;padding:0 6px 0 0!important;line-height:14px}.uPhUma_header:has(.sst-session-id) .uPhUma_tabs{margin-top:4px}.sst-session-id [role=status]{white-space:nowrap}"),
        react.createElement("button", {
          type: "button",
          title: label + "\n" + props.sessionId,
          "aria-label": label + ": " + props.sessionId,
          style: { border: "none", background: "transparent", color: "var(--dsw-alias-label-tertiary)", fontSize: 11, fontFamily: "monospace", padding: "4px 6px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" },
          onClick: function (event) {
            event.stopPropagation();
            var token = ++request.current;
            return Promise.resolve().then(function () {
              return window.navigator.clipboard.writeText(props.sessionId);
            }).then(function () {
              if (request.current === token) feedback[1]("copied");
            }, function () {
              if (request.current === token) feedback[1]("failed");
            });
          }
        }, props.sessionId),
        react.createElement("span", { role: "status", style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)" } }, state ? label : ""),
        state === "failed" ? react.createElement("input", {
          readOnly: true, value: props.sessionId, "aria-label": t("sessionId.copy"),
          onFocus: function (event) { event.target.select(); },
          style: { width: 160, fontSize: 11, color: "var(--dsw-alias-label-secondary)", background: "transparent" }
        }) : null
      );
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
      "locale"
    ];

    /** Read a service that is optional across DSH Core generations. */
    function optionalService(ctx, name) {
      try {
        if (ctx !== undefined && ctx !== null && ctx[name] !== undefined) return ctx[name];
        return ctx !== undefined && ctx !== null && typeof ctx.get === "function" ? ctx.get(name) : undefined;
      } catch (error) {
        return undefined;
      }
    }

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
      // Core 0.1 exposes the legacy settingsScope service. Core 0.2 replaces it
      // with ConfigForms: the same snapshot/write contract, keyed by this
      // bundle's entry id, and a shared describe mirror for model discovery.
      var legacySettings;
      var configForms;
      var useConfigForms = false;
      var settingsScope;
      var settingsDescribe;
      var settingsIntegrationMounted = false;

      var batch = createBatchController(
        function (sessionId, signal, operation, entry) {
          // The 4th argument is the optional AbortSignal the descriptor's
          // `cancellation` field allows; it is what makes Stop immediate.
          var line = operation === "preview" ? PREVIEW_LINE : operation === "apply" ? APPLY_PREVIEW_LINE + " " + entry.previewId : RETITLE_LINE;
          return ctx.remote.commands.execute(sessionId, line, [], signal);
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
            if (settingsScope === undefined || settingsScope === null) {
              return Promise.reject(new Error("title settings are not available"));
            }
            var snapshot = settingsScope.getSnapshot();
            var value = snapshot !== undefined && snapshot !== null && snapshot.status === "ready"
              ? snapshot.value || {}
              : {};
            var provider = typeof value.provider === "string" ? value.provider : "";
            var model = typeof value.model === "string" ? value.model : "";
            if (provider === "" || model === "") {
              return Promise.reject(new Error("no configured title route to fall back to"));
            }
            var previousMode = (snapshot.user || {}).mode;
            var routeEpoch;
            var changed = false;
            var unsubscribe = function () {};
            function restore() {
              unsubscribe();
              var current = settingsScope.getSnapshot();
              if (changed || !current || current.status !== "ready" ||
                  (current.value || {}).mode !== "configured" ||
                  (current.value || {}).provider !== provider || (current.value || {}).model !== model ||
                  (settingsRouteWrites.get(settingsScope) || 0) !== routeEpoch) return Promise.resolve();
              return persistSettings(settingsScope, [previousMode === undefined
                ? { op: "unset", path: ["mode"] }
                : { op: "set", path: ["mode"], value: previousMode }], current.revision);
            }
            return persistSettings(settingsScope, [{ op: "set", path: ["mode"], value: "configured" }], snapshot.revision)
              .then(function () {
                routeEpoch = settingsRouteWrites.get(settingsScope) || 0;
                unsubscribe = settingsScope.subscribe(function () {
                  var current = settingsScope.getSnapshot();
                  if (!current || current.status !== "ready" || (current.value || {}).mode !== "configured" ||
                      (current.value || {}).provider !== provider || (current.value || {}).model !== model) changed = true;
                });
                return Promise.resolve().then(function () { return runPass(failures); })
                  .then(restore, function (error) {
                    return restore().then(function () { throw error; });
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

      // Core 0.1 renders the owned Settings section. Core 0.2 supports both
      // that global Settings entry and this installed bundle's package-detail
      // page. Both surfaces use the same component and settings form.
      function registerSettingsPage(slotName) {
        return ctx.slots.inject(slotName, function () {
          var options = {
            name: slotName,
            locale: NS,
            inject: function () {
              return {
                scope: settingsScope,
                describe: settingsDescribe,
                remote: ctx.remote,
                batch: batch,
                listSessions: listSessions
              };
            }
          };
          if (slotName === "plugins.bundle.config") {
            // Third-party bundles configure themselves on their installed
            // package detail page; `plugins.item` is reserved for official
            // plugins listed in the Official group.
            options.key = "smart-session-title";
          } else {
            options.id = "smart-session-title";
            options.order = 30;
            options.label = function () {
              return ctx.locale.bind(NS)("nav");
            };
          }
          return ctx.slots.register(options, SettingsSection);
        });
      }

      function registerSessionActionSlots() {
        return [
          ctx.slots.inject("conversation.session.header.actions", function () {
            return ctx.slots.register({ name: "conversation.session.header.actions", id: "smart-session-title-preview", order: 29,
              label: "Preview title", locale: NS, inject: function (sessionId) {
                return { sessionId: sessionId, scope: settingsScope, execute: function (line, signal) {
                  return ctx.remote.commands.execute(sessionId, line, [], signal);
                } };
              } }, TitlePreviewAction);
          }),
          ctx.slots.inject("conversation.session.header.actions", function () {
            return ctx.slots.register(
              {
                name: "conversation.session.header.actions",
                id: "smart-session-title-regenerate",
                order: 30,
                label: "Regenerate title",
                locale: NS,
                inject: function (sessionId) {
                  return {
                    regenerate: function () {
                      return controller.run(sessionId);
                    },
                    sessionId: sessionId,
                    scope: settingsScope
                  };
                }
              },
              RegenerateTitleAction
            );
          }),
          ctx.slots.inject("conversation.session.header.actions", function () {
            return ctx.slots.register(
              {
                name: "conversation.session.header.actions",
                id: "smart-session-title-lock",
                order: 31,
                label: "Lock title",
                locale: NS,
                inject: function (sessionId) {
                  return { sessionId: sessionId, scope: settingsScope };
                }
              },
              LockTitleAction
            );
          }),
          ctx.slots.inject("conversation.session.header.actions", function () {
            return ctx.slots.register({
              name: "conversation.session.header.actions",
              id: "smart-session-title-session-id",
              order: 32,
              label: "SessionId",
              locale: NS,
              inject: function (sessionId) {
                return { sessionId: sessionId, scope: settingsScope };
              }
            }, SessionIdAction);
          })
        ];
      }

      function mountSettingsIntegration(serviceCtx, serviceName) {
        if (settingsIntegrationMounted) return;
        var resolvedLegacy = serviceName === "settingsScope"
          ? optionalService(serviceCtx, "settingsScope")
          : undefined;
        var resolvedForms = serviceName === "configForms"
          ? optionalService(serviceCtx, "configForms")
          : undefined;
        if (resolvedLegacy !== undefined && typeof resolvedLegacy.bind === "function") {
          legacySettings = resolvedLegacy;
          settingsScope = resolvedLegacy.bind({ namespace: NS });
          settingsDescribe = typeof resolvedLegacy.describe === "function"
            ? resolvedLegacy.describe()
            : undefined;
          useConfigForms = false;
        } else if (resolvedForms !== undefined && typeof resolvedForms.get === "function") {
          configForms = resolvedForms;
          settingsScope = resolvedForms.get(NS);
          settingsDescribe = typeof resolvedForms.describe === "function"
            ? resolvedForms.describe()
            : undefined;
          useConfigForms = true;
        } else {
          return;
        }
        if (settingsScope === undefined || settingsScope === null) return;

        settingsIntegrationMounted = true;
        serviceCtx.effect(function () {
          var disposers = [];
          function keep(disposer) {
            if (typeof disposer === "function") disposers.push(disposer);
          }
          keep(registerSettingsPage("settings.section"));
          registerSessionActionSlots().forEach(keep);
          if (useConfigForms && typeof configForms.whileServed === "function") {
            keep(configForms.whileServed([NS], function () {
              return registerSettingsPage("plugins.bundle.config");
            }));
          }
          return function () {
            for (var i = disposers.length - 1; i >= 0; i--) disposers[i]();
            settingsScope = undefined;
            settingsDescribe = undefined;
            settingsIntegrationMounted = false;
          };
        }, "smart-session-title: settings integration");
      }

      var directLegacySettings = optionalService(ctx, "settingsScope");
      var directConfigForms = optionalService(ctx, "configForms");
      if (directLegacySettings !== undefined && typeof directLegacySettings.bind === "function") {
        mountSettingsIntegration(ctx, "settingsScope");
      } else if (directConfigForms !== undefined && typeof directConfigForms.get === "function") {
        mountSettingsIntegration(ctx, "configForms");
      } else if (typeof ctx.inject === "function") {
        ctx.effect(function () {
          var configFormsFiber = ctx.inject(["configForms"], function (serviceCtx) {
            mountSettingsIntegration(serviceCtx, "configForms");
          });
          var legacySettingsFiber = ctx.inject(["settingsScope"], function (serviceCtx) {
            mountSettingsIntegration(serviceCtx, "settingsScope");
          });
          return function () {
            if (configFormsFiber && typeof configFormsFiber.dispose === "function") configFormsFiber.dispose();
            if (legacySettingsFiber && typeof legacySettingsFiber.dispose === "function") legacySettingsFiber.dispose();
          };
        }, "smart-session-title: settings API bridge");
      }

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
            label: "Batch retitle progress",
            locale: NS,
            inject: function () {
              return { batch: batch };
            }
          },
          BatchOverlayAction
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
    exports.TitlePreviewAction = TitlePreviewAction;
    exports.parseTitlePreview = parseTitlePreview;
    exports.PREVIEW_LINE = PREVIEW_LINE;
    exports.APPLY_PREVIEW_LINE = APPLY_PREVIEW_LINE;
    exports.LockTitleAction = LockTitleAction;
    exports.SessionIdAction = SessionIdAction;
    exports.lockedIdsOf = lockedIdsOf;
    exports.toggleSessionLock = toggleSessionLock;
    exports.persistSettings = persistSettings;
    exports.isLockedIn = isLockedIn;
    exports.isAiDisabledSnapshot = isAiDisabledSnapshot;
    /**
     * Shared Settings page component — `settings.section` in the global
     * Settings navigation and `plugins.bundle.config` on the installed bundle
     * detail page in Core 0.2.
     *
     * Receives `scope` through the slot's `inject` face: a bound
     * shared settings form exposing `getSnapshot()`, `set(field, value)`
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
      var draftPair = react.useState({});
      var draft = draftPair[0];
      var setDraft = draftPair[1];
      // The exclusion list is edited as raw multi-line text. The draft keeps the
      // textarea showing exactly what was typed: the host trims, drops blank lines
      // and dedupes, and re-rendering that normalized list under the cursor would
      // fight the typist (a trailing newline would vanish mid-keystroke).
      var exclusionDraftPair = react.useState(undefined);
      var exclusionDraft = exclusionDraftPair[0];
      var setExclusionDraft = exclusionDraftPair[1];
      var errorPair = react.useState("");
      // Keep message keys in state so an open page follows locale changes.
      var issue = errorPair[0];
      var error = issue && typeof issue === "object"
        ? t(issue.key) + (issue.detail ? " " + issue.detail : "") : issue;
      var setError = errorPair[1];
      // Provider directory + configured models. `undefined` until the first
      // load resolves; the selectors fall back to manual entry meanwhile.
      var catalogPair = react.useState(undefined);
      var catalog = catalogPair[0];
      var setCatalog = catalogPair[1];
      var workspacePair = react.useState(false);
      var statusPair = react.useState("");
      var pendingRef = react.useRef({});
      var pendingPair = react.useState({});
      var savingPair = react.useState(false);
      var invalidRef = react.useRef({});
      function save(ops) {
        ops.forEach(function (op) { pendingRef.current[op.path[0]] = op; });
        pendingPair[1](Object.assign({}, pendingRef.current));
        setError("");
        statusPair[1]("");
        return Promise.resolve();
      }
      function submitSettings() {
        if (savingPair[0]) return;
        var invalid = Object.values(invalidRef.current)[0];
        if (invalid) { setError(invalid); return; }
        var ops = Object.values(pendingRef.current);
        var mode = draft.mode || (snap.user || {}).mode || (snap.value || {}).mode || "current-session";
        if (mode === "configured") {
          var provider = String(draft.provider !== undefined ? draft.provider : (snap.value || {}).provider || "").trim();
          var model = String(draft.model !== undefined ? draft.model : (snap.value || {}).model || "").trim();
          if (!provider || !model) { setError({ key: "settings.configuredUnsaved" }); return; }
          ops = ops.filter(function (op) { return ["mode", "provider", "model"].indexOf(op.path[0]) === -1; });
          ops.push({ op: "set", path: ["mode"], value: mode }, { op: "set", path: ["provider"], value: provider }, { op: "set", path: ["model"], value: model });
        }
        if (!ops.length) return;
        setError("");
        savingPair[1](true);
        statusPair[1]("settings.saving");
        return persistSettings(scope, ops).then(function () {
          pendingRef.current = {};
          pendingPair[1]({});
          setDraft({});
          setExclusionDraft(undefined);
          setSnap(scope.getSnapshot());
          statusPair[1]("settings.saved");
        }).catch(function () {
          statusPair[1]("");
          setError({ key: "settings.saveFailed" });
        }).finally(function () { savingPair[1](false); });
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

      var value = Object.assign({}, snap.value || {});
      var user = Object.assign({}, snap.user || {});
      Object.values(pendingPair[0]).forEach(function (op) {
        var field = op.path[0];
        if (op.op === "unset") { delete value[field]; delete user[field]; }
        else { value[field] = op.value; user[field] = op.value; }
      });
      var busy = !snap.writable || savingPair[0];
      // The exclusion list as persisted, used both by the textarea's initial text
      // and by the collapsed summary.
      var savedExclusions = Array.isArray(user.titleExclusions) ? user.titleExclusions : [];
      // Locked session ids as persisted; the batch list excludes them.
      var savedLockedIds = Array.isArray(user.lockedSessionIds) ? user.lockedSessionIds : [];

      // The resolved value carries the composition base; the raw user section
      // tells us what the human actually chose. `mode === undefined` means they
      // never chose, and the effective behaviour is the session route.
      var enabled = value.enabled !== false;
      var chosenMode = typeof user.mode === "string" ? user.mode : undefined;
      var effectiveMode = draft.mode || chosenMode || value.mode || "current-session";

      var fieldStyle = { minHeight: 40 };
      var labelStyle = { display: "block", marginBottom: 7, fontSize: 13 };
      var hintStyle = {
        fontSize: 12,
        color: "var(--dsw-alias-label-tertiary)",
        margin: 0,
        lineHeight: 1.4
      };

      function writeField(field, raw) {
        var limits = { timeoutMs: [1000, 120000], maxAttempts: [1, 3], maxTitleCharacters: [8, 120] };
        if (limits[field]) setDraft(function (current) { return Object.assign({}, current, { [field]: raw }); });
        if (raw !== "" && limits[field]) {
          var parsed = Number(raw);
          if (!Number.isInteger(parsed) || parsed < limits[field][0] || parsed > limits[field][1]) {
            invalidRef.current[field] = { key: "settings.invalidNumber", detail: limits[field][0] + "–" + limits[field][1] };
            setError(invalidRef.current[field]);
            return;
          }
          raw = parsed;
        }
        delete invalidRef.current[field];
        return save([raw === "" ? { op: "unset", path: [field] } : { op: "set", path: [field], value: raw }]);
      }

      /**
       * Persist the exclusion textarea.
       *
       * The textarea holds a raw multi-line string while the host stores a
       * normalized list, so the same normalization (trim, drop blanks, dedupe) is
       * applied here: the write stays idempotent, and an emptied box becomes an
       * `unset` instead of an empty array the host would have to special-case.
       *
       * The bounds mirror the host's own limits. Checking them here is what turns a
       * too-long line into a named message instead of the generic "settings could
       * not be saved" the rejected write would otherwise produce.
       */
      var EXCLUSION_LIMITS = { maxTerms: 50, maxCharacters: 64 };
      function writeExclusions(text) {
        delete invalidRef.current.titleExclusions;
        var terms = [];
        var seen = Object.create(null);
        var lines = String(text).split("\n");
        for (var index = 0; index < lines.length; index += 1) {
          var trimmed = lines[index].trim();
          if (trimmed === "" || seen[trimmed] === true) continue;
          if (Array.from(trimmed).length > EXCLUSION_LIMITS.maxCharacters) {
            invalidRef.current.titleExclusions = { key: "settings.invalidExclusions" };
            setError(invalidRef.current.titleExclusions);
            return undefined;
          }
          seen[trimmed] = true;
          terms.push(trimmed);
        }
        if (terms.length > EXCLUSION_LIMITS.maxTerms) {
          invalidRef.current.titleExclusions = { key: "settings.invalidExclusions" };
          setError(invalidRef.current.titleExclusions);
          return undefined;
        }
        if (terms.length === 0) return save([{ op: "unset", path: ["titleExclusions"] }]);
        return save([{ op: "set", path: ["titleExclusions"], value: terms }]);
      }

      var children = [];
      var sessionIdSetting = react.createElement("label", { key: "showSessionId", className: "sst-toggle-row" },
        react.createElement("span", { className: "sst-toggle-copy" },
          react.createElement("span", { className: "sst-toggle-title" }, t("settings.showSessionId")),
          react.createElement("span", { id: "sst-showSessionId-hint", className: "sst-hint" }, t("settings.sessionIdBrief"))),
        switchControl({
          id: "sst-showSessionId", checked: user.showSessionId !== false, disabled: busy,
          "aria-label": t("settings.showSessionId"), "aria-describedby": "sst-showSessionId-hint",
          onChange: function (event) { return save([{ op: "set", path: ["showSessionId"], value: event.target.checked }]); }
        }));

      children.push(
        react.createElement(
          "label",
          { key: "enabled", className: "sst-toggle-row sst-enabled" },
          react.createElement("span", { className: "sst-toggle-copy" },
            react.createElement("span", { className: "sst-toggle-title" }, t("settings.enabled")),
            react.createElement("span", { className: "sst-hint" }, t("settings.enabledHint"))),
          switchControl({
            "aria-label": t("settings.enabled"),
            checked: enabled && effectiveMode !== "disabled",
            disabled: busy,
            onChange: function (event) {
              save([{ op: "set", path: ["enabled"], value: event.target.checked }].concat(event.target.checked && effectiveMode === "disabled" ? [{ op: "set", path: ["mode"], value: "current-session" }] : []));
              if (event.target.checked && effectiveMode === "disabled") setDraft(Object.assign({}, draft, { mode: "current-session" }));
            }
          })
        )
      );

      children.push(
        react.createElement(
          "fieldset",
          {
            key: "mode",
            className: "sst-mode",
            style: { border: "none", padding: 0, margin: "0 0 12px 0" }
          },
          react.createElement(
            "legend",
            { style: { fontWeight: 500, marginBottom: 4, padding: 0, fontSize: 13 } },
            t("settings.modelLegend")
          ),
          react.createElement("div", { className: "sst-mode-options" }, ["current-session", "configured"].map(function (mode) {
            return react.createElement(
              "label",
              {
                key: mode,
                style: { cursor: busy ? "default" : "pointer" }
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
                  // Stage the complete route; only the unified Save action writes it.
                  var pendingProvider = (draft.provider !== undefined ? draft.provider : (value.provider || "")).trim();
                  var pendingModel = (draft.model !== undefined ? draft.model : (value.model || "")).trim();
                  if (pendingProvider !== "" && pendingModel !== "") {
                    save([
                        { op: "set", path: ["provider"], value: pendingProvider },
                        { op: "set", path: ["model"], value: pendingModel },
                        { op: "set", path: ["mode"], value: "configured" }
                      ]);
                  }
                }
              }),
              mode === "current-session"
                ? t("settings.modeCurrent")
                : mode === "configured"
                  ? t("settings.modeConfigured")
                  : t("settings.modeDisabled")
            );
          }))
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
            react.createElement("label", { style: labelStyle, htmlFor: "sst-provider" }, t("settings.provider")),
            providerOptions.length > 0
              ? react.createElement(
                  "select",
                  {
                    id: "sst-provider",
                    value: selectedProvider,
                    disabled: busy,
                    style: selectStyle(fieldStyle),
                    onChange: function (event) {
                      // Switching provider invalidates the model half of the route.
                      setDraft(Object.assign({}, draft, {
                        provider: event.target.value,
                        model: ""
                      }));
                    }
                  },
                  providerChildren
                )
              : react.createElement("input", {
                  type: "text",
                  id: "sst-provider",
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
          // `value` is the model ID — the only handle DSH accepts; the label may
          // add the provider's display name (see `modelOptionLabel`).
          modelChildren.push(
            react.createElement(
              "option",
              { key: model, value: model },
              modelOptionLabel(catalog, selectedProvider, model)
            )
          );
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
            react.createElement("label", { style: labelStyle, htmlFor: "sst-model" }, t("settings.model")),
            availableModels.length > 0
              ? react.createElement(
                  "select",
                  {
                    id: "sst-model",
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
                  id: "sst-model",
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
        // A saved value outside this provider's model list cannot be served: the
        // observed cause is a display NAME saved where DSH expects the model ID,
        // which fails every generation with an unhelpful "upstream failure".
        // Say so here, and name the repairable ID when the value is a name.
        if (selectedProvider !== "" && selectedModel !== "" &&
            availableModels.length > 0 && !modelKnown) {
          var suggestedModelId = modelIdForLabel(catalog, selectedProvider, selectedModel);
          children.push(
            react.createElement(
              "p",
              { key: "stale-model", role: "status", style: Object.assign({ marginTop: 0, marginBottom: 12 }, hintStyle) },
              t("settings.modelNotServed") +
                (suggestedModelId === undefined
                  ? ""
                  : " " + t("settings.modelNotServedSuggestion") + suggestedModelId)
            )
          );
        }
        children.push(
          react.createElement(
            "p",
            { key: "privacy", style: Object.assign({ marginTop: 0, marginBottom: 12 }, hintStyle) },
            react.createElement("details", {}, react.createElement("summary", {}, t("settings.modelHelp")), t("settings.configuredNotice"))
          )
        );
      }


      var saveButton = react.createElement("button", {
        className: "sst-save-route", type: "button", disabled: busy,
        onClick: submitSettings
      }, t("settings.saveRoute"));


      if (effectiveMode === "disabled" || !enabled) {
        children.push(
          react.createElement(
            "p",
            { key: "disabled-note", style: Object.assign({ marginTop: 0, marginBottom: 12 }, hintStyle) },
            t("settings.disabledNote")
          )
        );
      }

      var shapeIndex = children.length;

      // Title shape and content: the code-point cap, the optional date affix, the
      // phrasing/language preferences, and the exclusion words. All of them are
      // read by the host half on the NEXT generation, so there is nothing to save
      // until the unified Save action submits the staged fields.
      // The date itself comes from the session's creation time, which is why
      // this block offers no date picker: there is nothing for the user to pick.
      var exclusionsText = exclusionDraft !== undefined ? exclusionDraft : savedExclusions.join("\n");
      children.push(
        react.createElement(
          "fieldset",
          { key: "shape", className: "sst-shape", style: { border: "none", padding: 0, margin: "0 0 12px 0" } },
          react.createElement(
            "legend",
            { style: { fontWeight: 500, marginBottom: 4, padding: 0, fontSize: 13 } },
            t("settings.shapeLegend")
          ),

          react.createElement("div", { className: "sst-content-fields" },
          // Phrasing and language. Both are enums whose empty option is the unset
          // that follows the plugin default / the message's own language, so the UI
          // never needs a sentinel the host would have to know about.
          react.createElement(
            "div",
            { style: { marginBottom: 6 } },
            react.createElement("label", { style: labelStyle, htmlFor: "sst-titleStyle" }, t("settings.style")),
            react.createElement(
              "select",
              {
                id: "sst-titleStyle",
                value: typeof user.titleStyle === "string" ? user.titleStyle : "",
                disabled: busy,
                style: Object.assign({ width: 180 }, fieldStyle),
                onChange: function (event) {
                  writeField("titleStyle", event.target.value);
                }
              },
              react.createElement("option", { value: "" }, t("settings.styleDefault")),
              react.createElement("option", { value: "short-name" }, t("settings.styleShortName")),
              react.createElement("option", { value: "action-object" }, t("settings.styleActionObject"))
            )
          ),
          react.createElement(
            "div",
            { style: { marginBottom: 6 } },
            react.createElement("label", { style: labelStyle, htmlFor: "sst-titleLanguage" }, t("settings.language")),
            react.createElement(
              "select",
              {
                id: "sst-titleLanguage",
                value: typeof user.titleLanguage === "string" ? user.titleLanguage : "",
                disabled: busy,
                style: Object.assign({ width: 180 }, fieldStyle),
                onChange: function (event) {
                  writeField("titleLanguage", event.target.value);
                }
              },
              react.createElement("option", { value: "" }, t("settings.languageAuto")),
              react.createElement("option", { value: "zh" }, t("settings.languageZh")),
              react.createElement("option", { value: "en" }, t("settings.languageEn"))
            )
          ),
          ),

          react.createElement("div", { className: "sst-date-fields" },
          react.createElement(
            "div",
            { style: { marginBottom: 6 } },
            react.createElement("label", { style: labelStyle, htmlFor: "sst-maxCharacters" }, t("settings.maxCharacters")),
            react.createElement("div", { className: "sst-number-field" }, react.createElement("input", {
              type: "number",
              id: "sst-maxCharacters",
              min: 8,
              max: 120,
              value: draft.maxTitleCharacters !== undefined ? draft.maxTitleCharacters : (typeof user.maxTitleCharacters === "number" ? user.maxTitleCharacters : ""),
              disabled: busy,
              placeholder: t("settings.defaultLength"),
              style: Object.assign({ width: 80 }, fieldStyle),
              onChange: function (event) {
                writeField("maxTitleCharacters", event.target.value);
              }
            }), react.createElement("span", {}, t("settings.characterUnit")))
          ),
          react.createElement(
            "div",
            { style: { marginBottom: 6 } },
            react.createElement("label", { style: labelStyle, htmlFor: "sst-dateAffix" }, t("settings.dateAffix")),
            react.createElement(
              "select",
              {
                id: "sst-dateAffix",
                value: typeof user.titleDatePosition === "string" ? user.titleDatePosition : "",
                disabled: busy,
                style: Object.assign({ width: 140 }, fieldStyle),
                onChange: function (event) {
                  // The empty option is "no affix", which is an unset — never a
                  // sentinel string the host would have to know about.
                  writeField("titleDatePosition", event.target.value);
                }
              },
              react.createElement("option", { value: "" }, t("settings.dateAffixOff")),
              react.createElement("option", { value: "prefix" }, t("settings.dateAffixPrefix")),
              react.createElement("option", { value: "suffix" }, t("settings.dateAffixSuffix"))
            )
          ),
          react.createElement(
            "div",
            { hidden: !user.titleDatePosition, style: { marginBottom: 6 } },
            react.createElement("label", { style: labelStyle, htmlFor: "sst-dateFormat" }, t("settings.dateFormat")),
            react.createElement(
              "select",
              {
                id: "sst-dateFormat",
                value: typeof user.titleDateFormat === "string" ? user.titleDateFormat : "ymd",
                disabled: busy,
                style: Object.assign({ width: 140 }, fieldStyle),
                onChange: function (event) {
                  writeField("titleDateFormat", event.target.value);
                }
              },
              react.createElement("option", { value: "ymd" }, t("settings.dateFormatYmd")),
              react.createElement("option", { value: "md" }, t("settings.dateFormatMd"))
            )
          )
          ),
          react.createElement(
            "div",
            { className: "sst-exclusions" },
            react.createElement("label", { style: labelStyle, htmlFor: "sst-titleExclusions" }, t("settings.exclusions")),
            react.createElement("textarea", {
              id: "sst-titleExclusions",
              rows: 3,
              value: exclusionsText,
              disabled: busy,
              placeholder: t("settings.exclusionsPlaceholder"),
              style: Object.assign({ width: "100%", resize: "vertical" }, fieldStyle),
              onChange: function (event) {
                setExclusionDraft(event.target.value);
                writeExclusions(event.target.value);
              }
            }),
            react.createElement("p", { style: hintStyle }, t("settings.exclusionsBrief"))
          ),

          react.createElement("details", { className: "sst-format-help" },
            react.createElement("summary", {}, t("settings.formatHelp")),
            react.createElement("p", { style: Object.assign({}, hintStyle, { marginTop: 8 }) }, t("settings.contentHint")),
            react.createElement("p", { style: Object.assign({}, hintStyle, { marginTop: 8 }) }, t("settings.exclusionsHint")),
            react.createElement("p", { style: Object.assign({}, hintStyle, { marginTop: 8 }) }, t("settings.shapeHint")),
            react.createElement("p", { style: Object.assign({}, hintStyle, { marginTop: 8 }) }, t("settings.exclusionsBoundary")))
        )
      );

      var advancedIndex = children.length;
      children.push(react.createElement(
                "div",
                { className: "sst-advanced-fields" },
                react.createElement(
                  "div",
                  { style: { marginBottom: 6 } },
                  react.createElement("label", { style: labelStyle, htmlFor: "sst-timeout" }, t("settings.timeout")),
                  react.createElement("input", {
                    type: "number",
                    id: "sst-timeout",
                    min: 1000,
                    max: 120000,
                    value: draft.timeoutMs !== undefined ? draft.timeoutMs : (typeof user.timeoutMs === "number" ? user.timeoutMs : ""),
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
                  react.createElement("label", { style: labelStyle, htmlFor: "sst-maxAttempts" }, t("settings.maxAttempts")),
                  react.createElement("input", {
                    type: "number",
                    id: "sst-maxAttempts",
                    min: 1,
                    max: 3,
                    value: draft.maxAttempts !== undefined ? draft.maxAttempts : (typeof user.maxAttempts === "number" ? user.maxAttempts : ""),
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
              ));

      // Batch retitle of stored sessions — explicit selection, then a run that
      // keeps going after this page is closed (the runner lives in plugin scope).
      // `route` tells the block which model a run will actually use, so a batch
      // that keeps failing on dead historical routes explains itself.
      var batchIndex = children.length;
      children.push(
        react.createElement(BatchTitleOptimizer, {
          key: "batch",
          t: t,
          batch: props.batch,
          listSessions: props.listSessions,
          disabled: (snap.value || {}).enabled === false || (snap.value || {}).mode === "disabled",
          route: {
            mode: (snap.value || {}).mode || "current-session",
            provider: (snap.value || {}).provider || "",
            model: (snap.value || {}).model || ""
          },
          // Provider directory: lets the list flag sessions whose logged model is
          // gone before the run instead of after it fails.
          catalog: catalog,
          // Locked sessions are excluded from the batch. Read from the raw user
          // section so a lock toggled in the header while this page is open is
          // reflected on the next render.
          lockedSessionIds: savedLockedIds
        })
      );

      // Which build is loaded — the first thing a bug report needs.
      children.push(versionFooter(t));

      var advancedSummary = [
        typeof value.timeoutMs === "number" ? t("settings.timeout") + " " + value.timeoutMs : "",
        typeof value.maxAttempts === "number" ? t("settings.maxAttempts") + " " + value.maxAttempts : ""
      ].filter(Boolean).join(" · ") || t("settings.defaultParameters");

      return react.createElement("div", { className: "sst-settings" + (workspacePair[0] ? " sst-workspace" : "") },
        react.createElement("style", {}, SETTINGS_CSS),
        react.createElement("header", { className: "sst-page-heading" },
          react.createElement("p", { className: "sst-wordmark" }, t("settings.brand")),
          react.createElement("h2", {}, t(workspacePair[0] ? "batch.legend" : "nav")),
          react.createElement("p", {}, t(workspacePair[0] ? "batch.tagline" : "settings.tagline"))),
        react.createElement("nav", { className: "sst-tabs", "aria-label": t("nav") },
          react.createElement("button", { type: "button", className: "sst-tab" + (!workspacePair[0] ? " is-active" : ""),
            "aria-current": !workspacePair[0] ? "page" : undefined,
            onClick: function () { workspacePair[1](false); } }, t("batch.back")),
          react.createElement("button", { type: "button", className: "sst-tab" + (workspacePair[0] ? " is-active" : ""),
            "aria-current": workspacePair[0] ? "page" : undefined,
            onClick: function () { workspacePair[1](true); } }, t("batch.open"))),
        workspacePair[0] ? children[batchIndex]
          : react.createElement("div", {},
            error ? react.createElement("p", { role: "alert" }, error) : null,
            children[0],
            react.createElement("section", { className: "sst-section sst-model-section" },
              children[1],
              effectiveMode === "current-session" ? react.createElement("p", { className: "sst-hint" }, t("settings.currentHint")) : null,
              react.createElement("div", { className: "sst-model-card" },
                children.slice(2, shapeIndex).filter(function (child) { return (child.key || child.props.key) !== "privacy"; }))),
            react.createElement("section", { className: "sst-section" }, children[shapeIndex]),
            react.createElement("section", { className: "sst-section" }, sessionIdSetting),
            settingsDisclosure(t("settings.advanced"), advancedSummary, children[advancedIndex]),
            react.createElement("details", { className: "sst-usage-help" },
              react.createElement("summary", {}, t("settings.headerActions")),
              react.createElement("p", {}, t("settings.subtitle")),
              react.createElement("h4", {}, t("settings.modelHelp")),
              react.createElement("p", {}, t("settings.configuredNotice")),
              react.createElement("h4", {}, t("preview.open")),
              react.createElement("p", {}, t("preview.hint")),
              react.createElement("h4", {}, t("action.short")),
              react.createElement("p", {}, t("action.help")),
              react.createElement("h4", {}, t("lock.short")),
              react.createElement("p", {}, t("lock.help")),
              react.createElement("p", {}, t("settings.lockBoundary")),
              react.createElement("h4", {}, t("settings.showSessionId")),
              react.createElement("p", {}, t("settings.showSessionIdHint"))),
            react.createElement("footer", { className: "sst-footer" },
              react.createElement("div", { className: "sst-footer-copy" }, children[batchIndex + 1],
                react.createElement("p", { className: "sst-save-status", role: "status", "aria-live": "polite" },
                  (statusPair[0] ? t(statusPair[0]) : "") || (Object.keys(pendingPair[0]).length || Object.keys(draft).length || exclusionDraft !== undefined
                    ? t("settings.unsaved") : ""))),
              saveButton)));
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
        mounted.current = true;
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
      var previewSelectionPair = react.useState({});
      var previewSelection = previewSelectionPair[0];
      var setPreviewSelection = previewSelectionPair[1];
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

      var searchPair = react.useState("");
      var mounted = react.useRef(true);
      var lastStatus = react.useRef(snap.status);
      react.useEffect(function () {
        mounted.current = true;
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
        if (batch !== undefined) batch.setAutoFallback(autoFallback && (!props.route || props.route.mode !== "configured"));
      }, [batch, autoFallback, props.route && props.route.mode]);

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

      var initialLoad = react.useRef(false);
      react.useEffect(function () {
        if (!initialLoad.current) { initialLoad.current = true; load(); }
      }, [listSessions]);

      // A finished run rewrote titles: reload the rows so the list shows them.
      // Guarded on the status change so one run refreshes
      // exactly once (a short run can go idle → done without an observed middle).
      react.useEffect(function () {
        var previous = lastStatus.current;
        lastStatus.current = snap.status;
        var terminal = snap.status === "done" || snap.status === "cancelled" || snap.status === "error";
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

      var running = snap.status === "running";
      // Locked sessions are excluded from the batch, per the lock's whole purpose:
      // a batch run is one of the two deliberate paths allowed to overwrite a
      // hand-written title, so a lock that did not cover it would be a lock in name
      // only. They are excluded HERE (from the loaded candidates) rather than at
      // load time, so locking a session in the header takes effect on the next
      // render without reloading the list. There is no "include anyway" override by
      // design — unlock the session first, which is an explicit action.
      var lockedIds = Array.isArray(props.lockedSessionIds) ? props.lockedSessionIds : [];
      var allRows = Array.isArray(rows) ? rows : [];
      var list = [];
      var lockedSkipped = 0;
      for (var lockedIndex = 0; lockedIndex < allRows.length; lockedIndex += 1) {
        var candidateId = allRows[lockedIndex].sessionId;
        if (typeof candidateId === "string" && lockedIds.indexOf(candidateId) !== -1) {
          lockedSkipped += 1;
          continue;
        }
        list.push(allRows[lockedIndex]);
      }
      var cwds = [];
      for (var index = 0; index < list.length; index += 1) {
        var cwd = typeof list[index].cwd === "string" ? list[index].cwd : "";
        if (cwd !== "" && cwds.indexOf(cwd) === -1) cwds.push(cwd);
      }
      var visible = cwdFilter === "" ? list : list.filter(function (row) { return row.cwd === cwdFilter; });
      var query = searchPair[0].trim().toLocaleLowerCase();
      if (query) visible = visible.filter(function (row) { return (titleOfSessionRow(row) + " " + row.sessionId).toLocaleLowerCase().includes(query); });
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

      var previews = Array.isArray(snap.previews) ? snap.previews : [];
      var applicable = previews.filter(function (candidate) {
        return !candidate.applied && lockedIds.indexOf(candidate.sessionId) === -1;
      });
      var chosen = applicable.filter(function (candidate) { return previewSelection[candidate.previewId] !== false; });
      var rowsById = Object.create(null);
      allRows.forEach(function (row) { rowsById[row.sessionId] = row; });
      var visiblePreviews = previews.filter(function (candidate) {
        var row = rowsById[candidate.sessionId];
        return (!cwdFilter || row && row.cwd === cwdFilter) &&
          (!query || [candidate.previousTitle, candidate.title, candidate.sessionId].join(" ").toLocaleLowerCase().includes(query));
      });

      function selectVisibleSessions() {
        var next = Object.assign({}, selected);
        visible.forEach(function (row) { next[row.sessionId] = true; });
        setSelected(next);
      }
      function retryFailures() {
        batch.start(snap.failures.map(function (failure) {
          return { sessionId: failure.sessionId, previewId: failure.previewId };
        }), snap.operation);
      }

      var sessionRows = react.createElement("div", { className: "sst-session-list" },
        visible.length === 0 ? react.createElement("p", { className: "sst-empty" }, t("batch.noMatches"))
          : visible.map(function (row) {
            var title = titleOfSessionRow(row) || t("batch.noTitle");
            var rowRoute = routeOfSessionRow(row);
            var routeStatus = classifySessionRoute(rowRoute, catalog);
            var meta = [];
            if (typeof row.cwd === "string" && row.cwd !== "") meta.push(row.cwd);
            if (typeof row.updatedAt === "number") meta.push(new Date(row.updatedAt).toLocaleString());
            if (rowRoute !== undefined) meta.push(routeLabelOf(rowRoute) +
              (routeStatus === "provider-missing" || routeStatus === "model-missing" ? " · " + t("batch.routeDead") : ""));
            if (row.running === true) meta.push(t("batch.runningBadge"));
            return react.createElement("label", { key: row.sessionId, className: "sst-session-row" },
              react.createElement("input", {
                type: "checkbox", "aria-label": t("batch.selectSession") + ": " + title,
                checked: selected[row.sessionId] === true, disabled: running,
                onChange: function () {
                  var next = Object.assign({}, selected);
                  if (next[row.sessionId] === true) delete next[row.sessionId];
                  else next[row.sessionId] = true;
                  setSelected(next);
                }
              }),
              react.createElement("span", {},
                react.createElement("span", { className: "sst-row-title" }, title),
                react.createElement("span", { className: "sst-row-meta" }, meta.join(" · "))));
          }));

      var comparison = previews.length === 0 ? null : react.createElement("section", { key: "comparison", className: "sst-comparison" },
        react.createElement("div", { className: "sst-comparison-toolbar" },
          react.createElement("h3", {}, t("batch.comparison")),
          react.createElement("button", { type: "button", className: "sst-text-button", disabled: running,
            onClick: function () { setPreviewSelection({}); } }, t("batch.selectPreviews"))),
        visiblePreviews.length === 0 ? react.createElement("p", { className: "sst-empty" }, t("batch.noMatches"))
          : react.createElement("div", { className: "sst-comparison-table" },
            react.createElement("div", { className: "sst-comparison-heading", "aria-hidden": true },
              react.createElement("span", {}),
              react.createElement("span", {}, t("preview.old")),
              react.createElement("span", {}),
              react.createElement("span", {}, t("preview.new"))),
            react.createElement("div", { className: "sst-comparison-rows" }, visiblePreviews.map(function (candidate) {
              var locked = lockedIds.indexOf(candidate.sessionId) !== -1;
              var row = rowsById[candidate.sessionId];
              var meta = row && typeof row.cwd === "string" && row.cwd ? row.cwd : candidate.sessionId;
              return react.createElement("label", { key: candidate.previewId, className: "sst-comparison-row" },
                react.createElement("input", {
                  type: "checkbox", "aria-label": t("batch.selectCandidate") + ": " + candidate.title,
                  checked: !candidate.applied && !locked && previewSelection[candidate.previewId] !== false,
                  disabled: running || candidate.applied || locked,
                  onChange: function () {
                    var next = Object.assign({}, previewSelection);
                    next[candidate.previewId] = previewSelection[candidate.previewId] === false;
                    setPreviewSelection(next);
                  }
                }),
                react.createElement("div", { className: "sst-title-before" },
                  react.createElement("span", { className: "sst-mobile-label" }, t("preview.old")),
                  candidate.previousTitle || t("batch.noTitle"),
                  react.createElement("div", { className: "sst-row-meta", title: candidate.sessionId }, meta)),
                react.createElement("span", { className: "sst-comparison-arrow" }, uiGlyph("arrow")),
                react.createElement("div", { className: "sst-title-after" },
                  react.createElement("span", { className: "sst-mobile-label" }, t("preview.new")),
                  candidate.title,
                  candidate.applied || locked ? react.createElement("span", { className: "sst-candidate-state" },
                    t(candidate.applied ? "preview.applied" : "action.locked")) : null));
            }))));

      var progress = null;
      if (snap.status !== "idle") {
        var percent = snap.total === 0 ? 0 : Math.round((snap.completed / snap.total) * 100);
        var statusLabel = running
          ? t(snap.operation === "preview" ? "batch.previewing" : snap.operation === "apply" ? "batch.applying" : "batch.running")
          : snap.status === "cancelled" ? t("batch.cancelled")
            : snap.status === "error" ? t("batch.error")
              : t(snap.operation === "preview" ? "batch.previewDone" : snap.operation === "apply" ? "batch.applyDone" : "batch.done");
        progress = react.createElement("div", { key: "progress", className: "sst-batch-progress" +
          (snap.status === "done" && snap.failed === 0 ? " is-success" : ""), role: "status", "aria-live": "polite" },
          react.createElement("div", { className: "sst-progress-heading" },
            react.createElement("strong", { className: "sst-progress-title" },
              snap.status === "done" && snap.failed === 0 ? react.createElement("span", { className: "sst-success-mark" }, uiGlyph("check")) : null,
              statusLabel),
            react.createElement("span", {}, t("batch.completedCount") + " " + snap.completed + " / " + snap.total +
              " · " + t("batch.okCount") + " " + snap.succeeded + " · " + t("batch.failedCount") + " " + snap.failed)),
          running ? react.createElement("div", { className: "sst-progress-track", role: "progressbar",
            "aria-label": statusLabel, "aria-valuemin": 0, "aria-valuemax": snap.total, "aria-valuenow": snap.completed },
            react.createElement("div", { className: "sst-progress-fill", style: { width: percent + "%" } })) : null,
          snap.status === "done" && snap.operation === "preview" && !previews.some(function (candidate) { return candidate.applied; })
            ? react.createElement("p", { className: "sst-hint" }, t("batch.notSaved")) : null,
          snap.cancelRequested === true && running ? react.createElement("p", { className: "sst-hint" }, t("batch.cancelling")) : null,
          snap.fallback === "running" ? react.createElement("p", { className: "sst-hint" },
            t("batch.fallbackRunning") + " " + snap.retryCompleted + " / " + snap.retryTotal) : null,
          snap.fallback === "done" ? react.createElement("p", { className: "sst-hint" },
            t("batch.fallbackDone") + " (" + t("settings.modeConfigured") + ")") : null,
          snap.fallback === "cancelled" ? react.createElement("p", { className: "sst-hint" }, t("batch.fallbackCancelled")) : null,
          snap.fallback === "failed" ? react.createElement("p", { className: "sst-hint" }, t("batch.fallbackFailed")) : null,
          running ? react.createElement("button", { type: "button", disabled: snap.cancelRequested === true,
            onClick: function () { batch.cancel(); } }, t("batch.cancel")) : null,
          running && snap.currentSessionId ? react.createElement("p", { className: "sst-hint" },
            t("batch.current") + ": " + snap.currentSessionId) : null,
          snap.failures.length > 0 ? react.createElement("details", { className: "sst-batch-help", open: true },
            react.createElement("summary", {}, t("batch.failures") + " (" + snap.failures.length + ")"),
            snap.failures.map(function (failure) {
              var label = failure.kind === "unavailable" ? t("batch.kindUnavailable") : t("batch.kindError");
              return react.createElement("p", { key: failure.sessionId },
                failure.sessionId + " — " + label + (failure.reason ? ": " + failure.reason : ""));
            })) : null);
      }

      var fallbackReady = props.route && typeof props.route.provider === "string" && props.route.provider !== "" &&
        typeof props.route.model === "string" && props.route.model !== "";
      var directOptions = props.route && props.route.mode !== "configured"
        ? react.createElement("details", { className: "sst-batch-options" },
          react.createElement("summary", {}, t("batch.directOptions")),
          react.createElement("label", { className: "sst-fallback-choice" },
            react.createElement("input", { id: "sst-batch-fallback", type: "checkbox", checked: autoFallback,
              disabled: !fallbackReady || running,
              onChange: function (event) {
                var next = event.target.checked;
                setAutoFallback(next); writeFallbackPreference(next);
                batch.setAutoFallback(next);
              } }), t("batch.fallback")),
          react.createElement("p", { className: "sst-hint" },
            fallbackReady ? t("batch.fallbackHint") : t("batch.fallbackNeedsRoute"))) : null;

      var reloadLabel = loading ? t("batch.loading") : rows === undefined ? t("batch.load") : t("batch.reload");
      var routeText = props.route && props.route.mode === "configured"
        ? t("settings.modeConfigured") + ": " + (props.route.provider || "—") + " / " + (props.route.model || "—")
        : t("settings.modeCurrent");

      return react.createElement("section", { className: "sst-batch", "aria-label": t("batch.legend") },
        props.route ? react.createElement("div", { className: "sst-route-banner" }, uiGlyph("model"),
          react.createElement("span", {}, t("batch.routeInUse") + ": " + routeText)) : null,
        aiDisabled ? react.createElement("p", { className: "sst-notice" }, t("batch.disabled")) : null,
        react.createElement("div", { className: "sst-filter-toolbar" },
          react.createElement("div", { className: "sst-search" }, uiGlyph("search"),
            react.createElement("input", { type: "search", "aria-label": t("batch.search"), placeholder: t("batch.search"),
              value: searchPair[0], disabled: loading || running,
              onChange: function (event) { searchPair[1](event.target.value); } })),
          react.createElement("select", { "aria-label": t("batch.cwd"), value: cwdFilter, disabled: running,
            onChange: function (event) { setCwdFilter(event.target.value); } },
            [react.createElement("option", { key: "__all", value: "" }, t("batch.allCwd"))].concat(
              cwds.map(function (value) { return react.createElement("option", { key: value, value: value }, value); }))),
          react.createElement("button", { type: "button", className: "sst-icon-button", disabled: loading || running,
            title: reloadLabel, "aria-label": reloadLabel, onClick: load }, uiGlyph("reload"),
            react.createElement("span", { className: "sst-sr-only" }, reloadLabel))),
        loading ? react.createElement("p", { className: "sst-hint", role: "status" }, t("batch.loading")) : null,
        Array.isArray(rows) ? react.createElement("div", { className: "sst-batch-meta" },
          react.createElement("span", {}, t("batch.count") + ": " + list.length),
          lockedSkipped > 0 ? react.createElement("span", {}, t("batch.skippedLocked") + ": " + lockedSkipped) : null) : null,
        rows === null ? react.createElement("p", { role: "alert" }, t("batch.loadFailed"))
          : Array.isArray(rows) && list.length === 0 ? react.createElement("p", { className: "sst-empty" }, t("batch.empty")) : null,
        list.length > 0 ? react.createElement("div", { className: "sst-selection-toolbar" },
          react.createElement("div", { className: "sst-selection-buttons" },
            react.createElement("button", { type: "button", disabled: running, onClick: selectVisibleSessions }, t("batch.selectAll")),
            react.createElement("button", { type: "button", disabled: running, onClick: function () { setSelected({}); } }, t("batch.clear")),
            react.createElement("span", {}, t("batch.selectedCount") + ": " + selectedRows.length)),
          react.createElement("div", { className: "sst-run-buttons" },
            react.createElement("button", { type: "button", className: "sst-secondary", disabled: !canStart,
              onClick: function () { batch.start(selectedRows, "preview"); } }, t("batch.preview") + " (" + selectedRows.length + ")"),
            react.createElement("button", { type: "button", className: "sst-text-button", disabled: !canStart,
              title: t("batch.intro"), onClick: function () { batch.start(selectedRows); } },
              t("batch.start") + " (" + selectedRows.length + ")"))) : null,
        deadRoutes > 0 ? react.createElement("p", { className: "sst-notice", role: "status" },
          t("batch.routeDeadSummary") + ": " + deadRoutes + " / " + visible.length) : null,
        list.length > 0 ? previews.length > 0
          ? react.createElement("details", { className: "sst-session-picker" },
            react.createElement("summary", {}, t("batch.chooseSessions") + " · " + t("batch.selectedCount") + ": " + selectedRows.length),
            sessionRows) : sessionRows : null,
        truncated ? react.createElement("p", { className: "sst-hint" }, t("batch.truncated")) : null,
        comparison,
        progress,
        !running && !aiDisabled && snap.failures.length > 0 ? react.createElement("button", {
          type: "button", className: "sst-secondary", onClick: retryFailures
        }, t("batch.retryFailed") + " (" + snap.failures.length + ")") : null,
        directOptions,
        react.createElement("details", { className: "sst-batch-help" },
          react.createElement("summary", {}, t("batch.help")),
          react.createElement("p", {}, t("batch.intro")),
          react.createElement("p", {}, t("batch.costHint")),
          react.createElement("p", {}, t("batch.routeHint")),
          react.createElement("p", {}, t("batch.previewHint")),
          react.createElement("p", {}, t("preview.hint"))),
        previews.length > 0 ? react.createElement("footer", { className: "sst-footer" },
          react.createElement("div", { className: "sst-footer-copy" },
            react.createElement("strong", {}, t("batch.selectedPreviews") + ": " + chosen.length),
            react.createElement("p", { className: "sst-hint" }, t("batch.previewBrief"))),
          react.createElement("div", { className: "sst-footer-actions" },
            react.createElement("button", { type: "button", disabled: running,
              onClick: function () { batch.clearPreviews(); setPreviewSelection({}); } }, t("batch.clearPreviews")),
            react.createElement("button", { type: "button", className: "sst-primary",
              disabled: running || aiDisabled || chosen.length === 0,
              onClick: function () { batch.start(chosen, "apply"); } }, t("batch.applyPreviews") + " (" + chosen.length + ")"))) : null);

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
