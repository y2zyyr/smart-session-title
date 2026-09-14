# smart-session-title

[English](README.md) | 简体中文

DeepSeek Harness 会话智能标题插件。**0.5.0-rc.1 — 发布候选版本**，npm 标签为 `next`。

## 功能

自动把会话任务概括为短标题。默认直接使用**该会话实际使用的 provider/model**，无需另选模型。
压缩过长、代码密集的输入，拒绝无任务含义的问候和无用模型输出；保留 DSH 的 fallback、人工标题保护、持久化、投影与并发控制。

- 提供 `/retitle` 与标题旁的重新生成按钮，显式重新生成可覆盖人工标题。
- **标题格式与内容**：字数上限、日期前缀/后缀，以及标题**风格**（默认/简短任务名/动作＋对象）与**语言**（自动/中文/英文）。
- **标题排除词**：把客户名、内部代号等词从生成流程中删除，并复核最终标题；只约束本插件生成的标题。
- **标题锁定**：会话标题旁的锁按钮；自动生成跳过、重新生成拒绝、批量默认排除。
- **批量优化历史会话标题**：列表勾选、进度条、关闭设置页后继续跑，并且随时可停。
- 设置页页脚显示当前插件版本，便于反馈问题时指明构建版本。

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
`dsh-llm`、`dsh-session-title`、`dsh-settings` 的 peerDependencies 使用兼容预发布版本的范围 `^0.1.5-rc.1`；Schemastery 保持精确版本 `3.18.2`。
启动检查 title service、LLM、Settings 能力；非法设置在 provider 注册之前失败。
Web 端需要 DSH 原生 slots、locale、settingsScope 和 Remote commands。
其他 Core 版本尚未验证，不按版本字符串硬编码拒绝。

## 设置

打开 **设置 → 智能会话标题**。配置通过 DSH 官方 `settingsScope` / Remote Settings 写入
**`$DSH_HOME/settings.yaml` 的 `smart-session-title` namespace**；由 DSH 负责原子写入、revision 和文件 watcher。
没有独立 JSON、sidecar、额外 watcher 或 HTTP 服务。下一次生成实时使用新设置，当前进行中的请求保持开始时的配置。
设置页页脚显示当前插件版本。

| 字段 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | AI 标题总开关 |
| `mode` | 未选择时跟随会话¹ | `current-session` / `configured` / `disabled` |
| `provider` | 未设置 | 已在 DSH 中配置的 provider ID |
| `model` | 未设置 | 同一 provider 下的 model ID |
| `timeoutMs` | 15000 | 每次尝试期限；UI 范围 1000–120000 ms |
| `maxAttempts` | 2 | 总尝试数；范围 1–3 |
| `maxTitleCharacters` | 未设置（继承 80 字节） | 标题**字数上限**（Unicode 码点）；UI 范围 8–120 |
| `titleDatePosition` | 未设置（不加日期） | `prefix` / `suffix`：把会话创建日期放在标题前或后 |
| `titleDateFormat` | `ymd` | `ymd`（`2026-09-13`）或 `md`（`09-13`）；未选位置时该项无作用 |
| `titleStyle` | 未设置（插件默认，当前为「动作＋对象」） | `action-object`（动作＋对象）或 `short-name`（简短任务名） |
| `titleLanguage` | 未设置（跟随任务主要语言） | `zh`（中文）或 `en`（英文），强制生效 |
| `titleExclusions` | 未设置（不排除） | 字符串数组：不希望出现在生成标题里的词，最多 50 条、每条 ≤ 64 字符 |
| `lockedSessionIds` | 未设置（无锁定） | 字符串数组：标题被锁定、任何入口都不得改写的会话 id，最多 500 条 |

¹ 兼容原 Phase 1/2 部署：若在 bundle 行配置中明确钉住了 provider/model，且用户从未选择模式，仍保留该路由。
显式选择 `current-session` 后始终使用会话路由。本插件随附配置没有钉住模型。

选择 Configured model 后，先填完整 provider/model，再点击 **Save configured model**，一次提交完整路由。
ID 来自 DSH 的 Models 页面；本插件没有模型浏览器，也不接受凭据字段。
只点 **指定模型** 单选按钮是不够的：若已有可用的 provider/model 组合，插件会立即应用；否则页面会明确提示
「尚未生效」——在保存之前，标题仍按「跟随当前会话模型」生成，也就是用每个会话自己记录的旧模型。
Advanced 展开 timeout/maxAttempts。空值继承 bundle 行配置；其他部署级压缩参数见 `cordis.patch.yml`。

### 标题格式与内容（字数、日期、风格、语言、排除词）

设置页的 **标题格式与内容** 区块（不需要展开 Advanced）：

- **标题最大字数**：留空表示继承部署配置，也就是 DSH 的 `maxTitleBytes: 80`（约 26 个汉字或 80 个西文字符）。
  填写 8–120 后，先按字节截断、再按字数截断，两个上限同时成立；截断优先落在分隔符处，避免切断单词。
- **日期位置 / 日期格式**：日期取**会话创建时间**（`session.header.createdAt`，本地时区），不是「生成时刻」——
  重新生成标题、或对历史会话批量补标题，日期都保持该会话自己的那天。位置可选前缀（`2026-09-13 标题`）
  或后缀（`标题 · 2026-09-13`），也可选「不添加」。
- 前缀与后缀都会**先从 80 字节预算里扣除**再截断正文：DSH 对超长标题是按字节**从尾部**截断的，
  不预留的话后缀会第一个被吃掉。因此设置了字数上限时，正文可用字数会自动减去日期占用的空间。
- 日期取不到（会话头缺少 `createdAt`、或时区不可解析）时不加前后缀，而不是生成一个坏标题。
- 该日期只作用于**本插件生成的标题**：AI 关闭时的 fallback 标题、以及你手动重命名的标题由 DSH Core 生成/写入，
  不会带上它。

#### 风格与语言

| 设置 | 同一段任务「检查登录接口并解决超时问题」的标题 |
|---|---|
| 默认（或动作＋对象）＋自动 | 修复登录接口超时 |
| 简短任务名＋中文 | 登录接口超时 |
| 动作＋对象＋英文 | Fix login API timeout |

- **语言「自动」**（默认）跟随任务内容的主要语言，技术名称（React、API、错误标识符）保持原样；
  选**中文**或**英文**则强制翻译，技术名称同样保持原样。
- 这两项**替换**系统提示里对应的默认规则，而不是叠加：选「简短任务名」时不会同时要求「动词＋对象」，
  重试指令也跟随同一设置，所以不会出现「第一次遵守、重试又变回去」。
- 三者（自动生成、手动重新生成、批量处理）走同一个入口，因此设置对三种场景同时生效。
- **修改设置不会重写已有标题**——标题已写在会话日志里，只有下一次生成才会用新设置。
- 边界：AI 关闭时的 fallback 标题、以及模型失败时保留的旧标题，都不受风格/语言影响。

#### 标题排除词

在 **标题排除词** 里每行填一个词（例如客户名、内部项目代号），最多 50 条、每条 ≤ 64 字符：

```text
客户甲
内部项目代号
```

任务是「修复客户甲的订单导出错误」时，生成结果可以是「修复订单导出错误」。两层处理：

1. **生成前**：这些词会从送给模型的提示文本中**删除**（词本身不会出现在提示或日志里），
   并告知模型「部分名称已被移除，需要用概括性称呼，不要猜测或还原」。
2. **生成后**：对**最终要入库的那个标题字符串**再检查一次；仍命中时先带强化指令重试一次。

最后一次尝试仍命中时，**直接把这个词从标题里删掉**，而不是放弃这个标题。原因是：放弃会让 DSH 的
fallback 标题留在侧栏上，而 fallback 正是取首条用户消息的开头——那才是真正会把客户名显示出来的路径。
若删词后标题已经空到无法通过校验，本次生成明确失败（侧栏保留原样），不做无意义的兜底。

匹配规则：**按字面匹配**。含英文字母的词忽略大小写（`Acme` 命中 `ACME`），其余按原文精确匹配；
不存在词形还原、别名或翻译——`客户甲` / `ClientA` / `甲方` 需要分别添加。

**它只能约束本插件生成的标题**，这是刻意不扩大宣传的边界：

- DSH 的 fallback 标题（**新会话在模型回答前显示的就是它**，取自首条消息原文）不受影响；
- 你手动重命名的标题不受影响；
- 对话原文当然不会被修改——发给主模型的对话内容与本设置无关；
- 排除词表本身以明文存在 `settings.yaml` 里。

因此它的准确名字是「标题排除词」，**不是隐私或脱敏功能**。它最实际的用途是配合**批量优化历史标题**，
把一批历史标题里的名字一次性去掉。

### 标题锁定

会话标题旁的**锁定按钮**（在「重新生成标题」右边）用于把某个标题钉死。锁定状态由按钮本身显示：
闭合的锁表示已锁定，鼠标悬停与无障碍标签始终说明点击会做什么（「锁定标题」/「解锁标题」）。

锁定生效的四个入口：

| 你的规则 | 实际行为 |
|---|---|
| 自动生成跳过锁定会话 | provider 直接弃权（`locked`），不发起模型调用 |
| 手动重新生成提示已锁定 | 重新生成按钮变为禁用并显示「标题已锁定，请先解锁」 |
| 批量列表排除锁定会话 | 列表不显示它们，并在计数旁显示「已跳过已锁定会话: N」 |
| 批量运行覆盖不到它们 | 连「全选」也选不中锁定行 |

- 锁定状态保存在**插件自己的 settings namespace**（`settings.yaml` 的 `lockedSessionIds`），
  **不是浏览器 localStorage**：换窗口、清浏览器数据、重启 DSH 后锁定都还在。
- 没有「仍然包含」的覆盖开关——解锁是一个明确动作。这是刻意的：锁定若能被某个入口绕过就不叫锁定。
- **锁不住的两件事**（与排除词同类的边界）：① 会话还没有标题时，DSH Core 仍会写入取自首条消息的
  fallback 标题；② 你自己在 DSH 界面手动改名不受影响。锁定保护的是**已有标题**不被本插件的自动、
  重新生成与批量路径改写。
- 代价（诚实说明）：会话 id 列表存在配置文件里，且「重置设置」或还原配置备份会一并丢掉锁定。

### 批量优化历史标题

同一页面会列出**已存储的会话**及各自当前标题，用于给插件安装之前产生的会话补做标题优化：
勾选要处理的行（可按项目目录筛选后全选）再开始；单次最多渲染 300 行，历史很多时先用项目目录筛选。

- 每个会话一条 `/retitle`，**严格串行**：N 个会话即 N 次模型调用，不会同时跑两个生成。
- 被选中的标题会被重写，**包括你手动改过的标题**——显式 `/retitle` 是 DSH 设计上解开人工标题钉住的方式。
- 没有可用用户消息的会话与子代理会话会被跳过（前者无内容可生成，后者 host 拒绝恢复）。
- 进度（已完成 / 成功 / 失败）由插件作用域的运行器持有，而不是页面状态：**关闭设置页不会中断批次**，
  重新打开设置页会继续显示实时进度。只有刷新整个 DSH 窗口才会中断；已完成会话的新标题都已落盘。
  **停止是即时的**：`commands/execute` 接受尾部 `AbortSignal`，因此当前会话的生成会被真正中断，队列不再继续，
  被中断的会话既不算成功也不算失败。停止入口有两个：设置页内按钮，以及全局的小进度浮标（`shell.overlay`）——
  后者让「设置页已关闭」的后台批次也能随时停。
- 失败项会显示 **host 给出的真实原因**（路由失效 / 超时 / maxOutputTokens / 无可用消息），而不是笼统的「失败」；
  **重试失败项** 会用当前生效的路由设置只重跑这些会话。
- 路由注意：**跟随当前会话模型** 使用每个已存储会话自己记录的模型；旧会话记录的 provider/model 可能已不存在、
  或凭据已失效，这类失败会在毫秒级返回。此时切到 **指定模型** 选一个可用组合，再点 **重试失败项**。
- 列表会显示每个会话**记录的模型**（取自 DSH 的 `modelSelection` 投影），并在**开跑前**标出 DSH 已不再提供的那些
  并给出数量：这些会话在「跟随当前会话模型」下必然失败。
- **自动兜底**（默认关闭，需手动勾选）：已保存「指定模型」时，跑完一批后会用该路由**只重跑失败的会话一次**，
  结束后恢复原来的标题模式。重跑期间是一次真实的设置写入，因此默认不开启。
  勾选状态记在浏览器本地存储，而不是 `settings.yaml`——那份 Schema 归 host 所有，客户端半不能扩展字段。

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

插件 Settings 只允许十三个声明字段，unknown-key guard 拒绝 `apiKey`、token、cookie、credential、secret、password 等未知字段。
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
| 批量时大量旧会话 `model error: upstream failure` | 这些会话记录的 provider/model 已不在 DSH 中，「跟随当前会话模型」对它们必然失败；列表会提前标出，切「指定模型」（或勾选自动兜底）后点「重试失败项」 |
| 选了「指定模型」但标题仍跟随会话模型 | provider+model 未保存。有可用组合时现在点单选即生效；否则页面会提示「尚未生效」 |
| 刷新窗口后批次不见了 | 运行器在客户端半：关闭设置页不受影响，但整个窗口刷新会中断；已写入的标题不会回滚 |
| 点了停止好像没停 | 停止会 abort 在飞的生成；若仍拖住说明 adapter 忽略了取消，按日志里那个会话排查 |

## 发布内容

此仓库仅包含可安装插件、中英文说明和许可证。开发报告、会话记录、本机测试资料不公开。

## 已知限制

- **REASONING_CONTROL_UNAVAILABLE_CONFIRMED**：没有跨 adapter 的统一 reasoning-disabled 控制。插件不硬塞 `off`，沿用 adapter 默认行为。
- 某些 reasoning 模型可能用尽 96-token 标题输出预算，正确保留 fallback。
- Configured 模式的 provider/model 从 DSH 已注册的模型中选择，取不到列表时回退手动输入；设置页与标题按钮文案跟随 DSH 界面语言（中英双语词典，其他语言回退英文）。
- 批量运行器位于 **Web 客户端半**而非 host：关闭设置页不会中断，但刷新 DSH 窗口会中断；host 模块 `lib/*.js` 已入库且随包发布，原始 TypeScript 源码不可用，因此直接维护 JavaScript，并同步维护 `lib/*.d.ts`。目前未实现持久任务队列与 host 层路由回退。
- 自动兜底的勾选状态与批次队列不持久化：刷新窗口后回到空闲态（已写入的标题不受影响）。
- 不做任务漂移自动重命名、快捷键、云同步、遥测、独立数据库或复杂模型管理。

## 许可证

MIT

## 开发验证

使用 Node.js 22.15 或更新版本运行 `npm test`。仓库包含客户端/i18n、host 策略和
provider 行为测试，无需新增依赖。`files` 白名单保证验证文件不随 npm 包发布。

设置界面会解释数字越界或非整数错误，并在写入后核对实际保存值。自动兜底保留
整批会话统计，单独显示重试进度；停止重试会显示已停止，恢复路由时保留期间观察到
的用户模式修改。兜底偏好存于浏览器 localStorage，批量队列不持久化，刷新后回到空闲状态。
排除词的验证用假模型流驱动真实 provider：断言排除词不会进入提示的任何一半、残留时恰好重试
一次随后被删除、以及整段内容都是排除词时直接弃权且不发起模型调用。
锁定的验证覆盖四个入口：provider 弃权且**不消耗** `/retitle` 令牌、`/retitle` 处理器拒绝、
客户端按钮本地禁用并给出原因、批量列表排除锁定行且「全选」也选不中。

设置页分为「标题模型」「标题格式与内容」「高级参数」「批量优化」四个可折叠区域，
默认收起并显示简短的已保存设置摘要。批量运行时自动展开。布局适配窄窗口，表单关联标签并提供
清晰的键盘焦点提示。
