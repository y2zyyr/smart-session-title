# smart-session-title

[English](README.md) | 简体中文

DeepSeek Harness 会话智能标题插件。**0.2.0-rc.1 — 发布候选版本**，npm 标签为 `next`。

## 功能

自动把会话任务概括为短标题。默认直接使用**该会话实际使用的 provider/model**，无需另选模型。
压缩过长、代码密集的输入，拒绝无任务含义的问候和无用模型输出；保留 DSH 的 fallback、人工标题保护、持久化、投影与并发控制。

## 为什么需要它

已验证的 DSH 内建 provider 在输入超过 4096 bytes 时不调用模型。本插件会压缩再生成；15,536-byte 原始测试提示已通过真实模型验证。
它只替换 provider，不修改 Core 或 `app.asar`，不自建 LLM HTTP client。

## 安装

手动管理的 profile 可在其目录内执行：

```bash
npm install smart-session-title@next --legacy-peer-deps
```

运行时 Core 依赖由 DSH 提供；此参数避免 npm 安装另一套 Core。请确认下方兼容版本。

从 npm 安装：`smart-session-title@next`（当前为 RC 版本）。将包放入所选 profile 的 `node_modules/smart-session-title`，在该 profile 的 `package.json` 中把 bundle 放在 base/Web bundle 之后：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "smart-session-title"
      ]
    }
  }
}
```

保留 profile 中原有的其他 bundles。备份 profile 的 `package.json` 和 `cordis.patch.yml` 后再编辑，重启 DSH。
`cordis.patch.yml` 会禁用内建 `session-title-llm`，然后注册本插件。
启动日志应包含 `smart-session-title provider registered ... automatic=all-prompts`。

移除 bundle 并重启即可恢复内建 provider。不要直接禁用本插件行而留下禁用内建 provider 的 patch。
已在真实 DSH Desktop profile 完成安装和启动验证。

## 兼容性

验证环境：DSH Desktop **2.0.9**、Core **0.1.5-rc.1**、Cordis **4.0.2**、Schemastery **3.18.2**，Node **≥22.15.0**。
`dsh-llm`、`dsh-session-title`、`dsh-settings` 和 Schemastery peerDependencies 使用精确版本。
启动检查 title service、LLM、Settings 能力；非法设置在 provider 注册之前失败。
Web 端需要 DSH 原生 slots、locale、settingsScope 和 Remote commands。
其他 Core 版本尚未验证，不按版本字符串硬编码拒绝。

## 设置

打开 **设置 → Smart Session Title**。配置通过 DSH 官方 `settingsScope` / Remote Settings 写入
**`$DSH_HOME/settings.yaml` 的 `smart-session-title` namespace**；由 DSH 负责原子写入、revision 和文件 watcher。
没有独立 JSON、sidecar、额外 watcher 或 HTTP 服务。下一次生成实时使用新设置，当前进行中的请求保持开始时的配置。

| 字段 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | AI 标题总开关 |
| `mode` | 未选择时跟随会话¹ | `current-session` / `configured` / `disabled` |
| `provider` | 未设置 | 已在 DSH 中配置的 provider ID |
| `model` | 未设置 | 同一 provider 下的 model ID |
| `timeoutMs` | 15000 | 每次尝试期限；UI 范围 1000–120000 ms |
| `maxAttempts` | 2 | 总尝试数；范围 1–3 |

¹ 兼容原 Phase 1/2 部署：若在 bundle 行配置中明确钉住了 provider/model，且用户从未选择模式，仍保留该路由。
显式选择 `current-session` 后始终使用会话路由。本插件随附配置没有钉住模型。

选择 Configured model 后，先填完整 provider/model，再点击 **Save configured model**，一次提交完整路由。
ID 来自 DSH 的 Models 页面；本插件没有模型浏览器，也不接受凭据字段。
Advanced 展开 timeout/maxAttempts。空值继承 bundle 行配置；其他部署级压缩参数见 `cordis.patch.yml`。

## 模型模式

- **current-session**：使用 `request.route`，即当前会话实际的 provider/model，不替换成全局默认模型。
- **configured**：仅标题使用保存的 provider/model；主会话模型不变。缺任一字段立即拒绝保存。
- **disabled**（或关闭 Enabled）：标题 LLM calls = 0，provider title events = 0；fallback、人工改名、标题投影照常。

Configured 模式支持标题与主会话使用不同的 provider/model。

## 重新生成

使用 `/retitle`，或点击会话标题旁的重新生成按钮。二者都走官方 `SessionTitleService.refresh()`。
按钮在请求中禁用并显示 loading，完成后恢复；重复点击合并同一会话的请求。
**显式重新生成可以替换人工标题**；自动生成始终保护人工标题。失败保留旧标题，取消不重试。
AI 关闭时 `/retitle` 返回 `AI title generation is disabled.`，不调用模型。
第三方直接调用裸 `refresh()` 不会获得本插件显式覆盖人工标题的 token。

## 弱语义首条消息

`你好 → 谢谢 → 在吗 → 帮我审计数据库性能`：前三条 0 次标题调用，真实任务出现后才生成一次。
后续消息不会使 provider 标题漂移，子会话不会自动生成标题。
决策读取 Core 回放的消息和标题，不依赖插件内存历史。

## 隐私

标题生成是额外的 LLM 请求；默认使用当前会话模型，失败时最多重试到 `maxAttempts`。
configured 模式会把压缩后的首条有效任务发送给所选 provider，该 provider 可能不同于会话 provider。
标题不会进入模型上下文；插件不额外保存 `session/title-llm-request` 提示副本。

插件 Settings 只允许六个声明字段，unknown-key guard 拒绝 `apiKey`、token、cookie、credential、secret、password 等未知字段。
UI 只处理模型 ID 和运行参数，凭据完全由 DSH 管理。
诊断不写完整 Prompt、完整模型响应或凭据；adapter 原始错误文本也不写入插件日志，避免错误回显敏感输入。

## 本地诊断

插件使用 **`ctx.logger`**。DSH Desktop 的正式 `FileExporter` / `LogFileSink` 将其持久化至
**`<DSH userData>/logs/host/dsh-YYYY-MM-DD.log`**，warn/error 同时进入 `.error.log`。
本机通常为 `~/Library/Application Support/DSH Desktop/logs/host/`；请以实际 userData 为准。
日志级别需允许 info 才能看到成功/abstain；warn 包含失败/超时。

检索 `smart-session-title generation`：字段包括 sessionId、route、attempt、rawBytes、preparedBytes、elapsedMs、result/outcome、failureReason。
结果区分 generated、abstained、failed、timed-out、retried、cancelled。
DSH 自己的日志脱敏器可能把 sessionId 显示为 `****`；插件不绕过它。
`/title-status` 可查看当前进程内计数；计数重启归零，持久历史以日志为准。
纯 SDK/Web 运行器未必默认配置文件 exporter；本插件不会自行创建文件 sink。
Phase 3 已在隔离真实 DSH runtime 挂载原装 Desktop exporter，确认成功和失败日志真正落盘。

## 插件冲突

全局只能有一个标题 provider。`already registered` 表示另一个 provider 仍活跃，启动应失败。
不要同时启用内建标题 provider 或其他第三方标题插件。本 bundle 已负责替换内建 provider。

## 故障排查

| Problem | Likely cause / 处理 |
|---|---|
| Always fallback | 模型失败、输出被拒绝或 AI disabled；检查本地诊断 |
| already registered | 另一个标题 provider 活跃；移除冲突 bundle |
| /retitle says disabled | AI 总开关关闭或 mode=disabled |
| configured model fails | provider/model 不可用或模型输出不适合短标题；选择 Current session model |
| title never updates | 检查 smart-session-title 日志；已有人工/provider 标题会受保护 |
| greeting remains | 尚无 meaningful task；发送真实任务 |
| 设置启动失败 | 无效值或未知字段；修正该 namespace，provider 不会部分加载 |
| 日志文件没有成功记录 | 检查 Desktop logLevel 和正式文件 exporter 是否启用 |

## 发布内容

此仓库仅包含可安装插件、中英文说明和许可证。开发报告、会话记录、本机测试资料不公开。

## 已知限制

- **REASONING_CONTROL_UNAVAILABLE_CONFIRMED**：没有跨 adapter 的统一 reasoning-disabled 控制。插件不硬塞 `off`，沿用 adapter 默认行为。
- 某些 reasoning 模型可能用尽 96-token 标题输出预算，正确保留 fallback。
- Configured 模式的 provider/model 从 DSH 已注册的模型中选择，取不到列表时回退手动输入；设置页与标题按钮文案跟随 DSH 界面语言（中英双语词典，其他语言回退英文）。
- 不做任务漂移自动重命名、快捷键、云同步、遥测、独立数据库或复杂模型管理。

## 许可证

MIT
