# smart-session-title

English | [简体中文](README.zh-CN.md)

Smarter automatic session titles for **DeepSeek Harness (DSH)**.
**0.5.0-rc.17 — release candidate**, intended for the npm `next` tag.


This release adds **title preview and batch before/after comparison**: generate candidates without replacing titles, then apply only those you select. It also fixes exclusion reassembly, final title limits, settings bounds, live locks, fallback route ownership, permanent-error retries, and repeated Goal retitling.

The redesigned interface uses grouped forms, blue action buttons, and Title settings / Batch optimize navigation. Common title rules stay visible; advanced parameters and detailed help are collapsed. A footer Save settings button saves all edits and shows the result. Batch processing supports automatic loading, title/ID search and project filters, with side-by-side title comparisons that stack in narrow panels. Batch routing reflects saved settings; fixed-model mode hides redundant automatic fallback. Date format appears only when a date affix is enabled.

## What it does

Summarizes the first meaningful task into a short session title. By default,
**the title uses the exact provider and model used by that conversation**.
No separate model setup is required.

- Compresses oversized and code-heavy prompts instead of rejecting them.
- Waits for a meaningful task when a conversation starts with a greeting.
- Protects manual titles and prevents automatic title drift.
- Provides `/retitle` and a header button for explicit regeneration; an explicit
  request also outranks the weak-prompt filter, so a session whose messages are
  only terse commands (`继续写` / `发布`) can still be retitled.
- **Title shape and content**: a character cap, an optional date affix, a title
  **style** (default / short task name / action + object) and a **language**
  (auto / Chinese / English).
- **Title exclusions**: delete customer names or internal codes from the
  generation flow and re-check the final title — it constrains only titles this
  plugin generates.
- **Title lock**: a lock button beside the title; automatic generation skips it,
  regeneration refuses, and the batch list excludes it.
- **Optimizes titles of your stored sessions in bulk** — pick them from a list,
  watch a progress bar, and keep the run going (or stop it) after Settings is
  closed. See [Optimize past titles](#optimize-past-titles).
- Adds native settings (the page footer shows the running plugin version) and
  local diagnostics, with no telemetry service.

DSH retains ownership of fallback titles, persistence, projections, cancellation,
and stale-result protection. This plugin replaces only the title provider.

## Why

In the tested DSH version, the built-in provider rejects inputs above 4096 bytes
before calling the model. This plugin compresses them first. A 15,536-byte prompt
has been validated with a real model. Neither DSH Core nor `app.asar` is modified;
all model calls use DSH's existing LLM service.

## Install

Package: [`smart-session-title@next`](https://www.npmjs.com/package/smart-session-title).
The `next` tag deliberately identifies a release candidate.

Use your DSH profile's package-management workflow to install the package into
that profile. For a manually managed profile, run this **inside the profile directory**:

```bash
npm install smart-session-title@next --legacy-peer-deps
```

DSH supplies the runtime peers; `--legacy-peer-deps` prevents npm from
installing a separate Core stack. Follow the compatibility requirements below.
For local installation, copying this package into the profile's
`node_modules/smart-session-title` is also supported and has been verified on Desktop.

Back up the profile's `package.json` and `cordis.patch.yml`. Add the bundle **after**
the base and Web bundles, preserving all other existing bundles:

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

Restart DSH. The bundle disables the built-in `session-title-llm` provider before
registering this one. The startup log includes
`smart-session-title provider registered ... automatic=all-prompts`.

To uninstall, remove the bundle entry and restart, then remove the package.
This restores the built-in provider. Disabling only this plugin's row while leaving
its replacement patch active does not restore the built-in provider.

## Compatibility

The last live installation and startup verification used **DSH Desktop 2.0.9**,
**Core 0.1.5-rc.1**, **Cordis 4.0.2**, **Schemastery 3.18.2**, and **Node ≥22.15.0**.
The official `deepseek-harness` **v0.2.0-rc.1** release and its matching
registry packages use Core **0.2.0-rc.1**. The current local DSH Desktop 2.0.9
`app.asar` provides Core **0.2.0-rc.2**, **Cordis 4.0.4**, and
**Schemastery 3.18.4**. The plugin's required contracts were checked against
the official `rc.1` documentation and the local `rc.2` bundle, but it has not
yet had a live startup verification on Core 0.2. Peer ranges cover both Core
generations: `^0.1.5-rc.1 || ^0.2.0-rc.1` for DSH runtime packages and
`~3.18.2` for Schemastery. Other Core versions have not been verified.

Startup checks the title and LLM services, then validates settings before the
provider is registered. Core 0.1 uses `settings.register` and `settingsScope`;
Core 0.2 uses volatile plugin Config and `configForms`. The Web client uses
official slots, locale, and Remote commands. No version-string hard rejection
is used.

## Settings

Open **Settings → Smart Session Title** on Core 0.1. Core 0.2 offers the same
settings from both **Settings → Smart Session Title** and
**Plugins → Installed → smart-session-title**. Core 0.1 persists the
`smart-session-title` namespace in **`$DSH_HOME/settings.yaml`**. Core 0.2
stores the same fields in this plugin's
volatile Config in the active DSH profile. Both use DSH's own atomic writes,
revisions, and change notifications. Changes affect the next generation; an
in-flight request keeps its initial policy, except that a new title lock aborts it and prevents accepting its result. The plugin creates no sidecar file,
custom watcher, or HTTP server.
The footer of the page shows the loaded plugin version, so a bug report can name
the exact build.

| Field | Default | Purpose |
|---|---|---|
| `enabled` | `true` | Master AI-title switch |
| `mode` | Follow the session¹ | `current-session`, `configured`, or `disabled` |
| `provider` | Unset | Existing DSH provider ID |
| `model` | Unset | Model ID belonging to that provider |
| `timeoutMs` | 15000 | Per-attempt timeout; UI range 1000–120000 ms |
| `maxAttempts` | 2 | Total attempts; range 1–3 |
| `maxTitleCharacters` | Unset (inherits 80 bytes) | Entire title **character cap**, including the date (Unicode code points); range 8–120 |
| `titleDatePosition` | Unset (no date) | `prefix` / `suffix`: put the session's creation date before or after the title |
| `titleDateFormat` | `ymd` | `ymd` (`2026-09-13`) or `md` (`09-13`); unused while no position is chosen |
| `titleStyle` | Unset (plugin default, currently action + object) | `action-object` or `short-name` |
| `titleLanguage` | Unset (follows the task's main language) | `zh` or `en`, forced |
| `titleExclusions` | Unset (nothing excluded) | String list of words that must not appear in a generated title; at most 50 entries of at most 64 characters |
| `lockedSessionIds` | Unset (nothing locked) | String list of session ids whose title no entry point may rewrite; at most 500 entries |

¹ For older deployments only, an explicit provider/model pin in the bundle row
remains effective until the user chooses a mode. The shipped bundle has no pin.
Explicit `current-session` always uses the session route.

Edit settings, then click **Save settings** in the page footer. Changes stay local until saved; model and title rules are written together. Failed saves and page navigation retain your edits. Batch optimization uses the last saved route. Provider and model must both be selected in fixed-model mode.
**Advanced** exposes timeout and attempts. Empty numeric fields inherit the bundle
configuration; deployment-level compression options are in `cordis.patch.yml`.

### Title shape and content (cap, date, style, language, exclusions)

**Title shape and content** is shown directly, separately from Advanced:

- **Maximum title characters**: empty inherits the deployment config, i.e. DSH's
  `maxTitleBytes: 80` (about 26 CJK characters or 80 Latin characters). A value
  between 8 and 120 applies a code-point cap *on top of* the byte cap, and the
  cut prefers a separator so a word is not sliced in half.
- **Date position / Date format**: the date is the **session's creation time**
  (`session.header.createdAt`, local time), not the moment of generation —
  regenerating a title, or batch-retitling an old session, keeps that session's
  own day. Choose a prefix (`2026-09-13 Title`), a suffix
  (`Title · 2026-09-13`), or none.
- The affix is **reserved out of the 80-byte budget** before the body is
  shortened: DSH truncates an over-long title from the *tail*, so an unreserved
  suffix would be the first thing lost. A character cap therefore leaves room
  for the date automatically. If the date would leave fewer than four body characters, it is omitted; an 8-character cap therefore omits a full year–month–day date.
- A date containing an excluded term, or forming one across the body/date boundary, is omitted.
- When no usable date exists (a session header without `createdAt`, or an
  unresolvable time zone) the plugin adds no affix instead of a broken title.
- The date applies only to **titles this plugin generates**: the fallback title
  used while AI titles are off, and titles you rename by hand, are written by
  DSH Core and never carry it.

#### Style and language

| Setting | Title for the same task ("检查登录接口并解决超时问题") |
|---|---|
| Default (action + object) + Auto | 修复登录接口超时 |
| Short task name + Chinese | 登录接口超时 |
| Action + object + English | Fix login API timeout |

- **Language: Auto** (the default) follows the language primarily used by the
  task; technology names such as React or API, and error identifiers, keep their
  original form. Choosing **Chinese** or **English** forces a translation, and
  keeps those names unchanged too.
- Both settings **replace** the corresponding default rule in the system prompt
  instead of stacking next to it: asking for a short task name does not also ask
  for a verb plus object. The retry directive follows the same preferences, so a
  setting can never look "intermittent" on the second attempt.
- Automatic generation, manual regeneration and batch runs share one code path,
  so one setting covers all three.
- **Changing a setting never rewrites an existing title** — titles live in the
  session log and only the next generation reads the new value.
- Limit: the fallback title (AI off) and the previous title retained after a
  failed generation are both unaffected by style and language.

#### Title exclusions

Fill one word per line under **Title exclusions** (customer names, internal
project codes), at most 50 entries of at most 64 characters:

```text
Acme Corp
internal-project-x
```

With the task "修复客户甲的订单导出错误", an accepted result is
"修复订单导出错误". Two layers:

1. **Before generation** the words are **deleted** from the text handed to the
   model (the terms themselves appear in neither the prompt nor the logs), and the
   model is told that some names were removed on purpose, to refer to them
   generically, and never to guess or restore one.
2. **After generation** the **exact string about to be stored** is checked again;
   a surviving term triggers one retry with a stronger directive.

If the last attempt still contains the term, the plugin **deletes the term from
the title** rather than giving the title up — because giving it up leaves DSH's
fallback title on the sidebar, and that fallback is the opening of the raw first
message, i.e. precisely the path that would display the name. If deleting the
term leaves nothing that passes validation, the generation fails outright and the
sidebar keeps what it had.

Matching is **literal**: terms containing ASCII letters ignore case (`Acme` hides
`ACME`), everything else matches exactly. There is no stemming, alias or
translation — add `客户甲`, `ClientA` and `甲方` separately.

**It constrains only titles this plugin generates.** That boundary is deliberate:

- DSH's fallback title (**what a brand-new session shows until the model
  answers**, taken from the raw first message) is not affected;
- titles you renamed by hand are not affected;
- the conversation itself is never modified — what the main model receives is
  unrelated to this setting;
- the term list itself is stored in plain text in DSH-managed settings: `settings.yaml`
  on Core 0.1 or the active profile configuration on Core 0.2.

So its accurate name is "title exclusions", **not a privacy or redaction
feature**. Its most practical use is alongside **Optimize past titles**, to strip
a name out of a whole batch of historical titles.

### Title lock

The **lock button** beside a session title (to the right of "Regenerate title")
pins that title. The button shows the state itself: a closed padlock means
locked, and the hover text and accessible label always name what a click will do
("Lock title" / "Unlock title").

Automatic generation, `/retitle`, preview, application and batch processing honour it:

| Rule | Actual behaviour |
|---|---|
| Automatic generation skips locked sessions | the provider abstains (`locked`) without a model call |
| Regeneration says why it will not run | the button is disabled and reads "Title is locked; unlock it first" |
| The batch list excludes locked sessions | they are not listed, and the count is joined by "Locked sessions skipped: N" |
| A batch run cannot reach them | even "Select all" cannot select a locked row |

- The lock lives in this plugin's **host-managed configuration** (`lockedSessionIds`),
  **not in browser localStorage**: it survives a new window, a cleared browser
  profile, and a DSH restart.
- Locking during generation aborts the model stream. A final live check refuses the result even if a settings notification was missed. A full 500-entry lock list permits unlocking but rejects a new lock before writing.
- There is no "include anyway" override — unlocking is an explicit action. That is
  deliberate: a lock that one entry point can bypass is not a lock.
- **Two things it cannot lock**, the same class of limit as the exclusion words:
  ① while a session still has no title, DSH Core sets a fallback derived from the
  first message; ② renaming a title yourself in DSH's UI is unaffected. The lock
  protects an EXISTING title from this plugin's automatic, regenerate and batch
  paths.
- The honest cost: the id list lives in a config file, and a settings reset or a
  restored settings backup drops every lock with it.

### Optimize past titles

The same page lists your **stored sessions** with the title each one currently
has, so you can batch-regenerate titles written before this plugin was installed.
Pick the rows (filter by project, select all within the current filter), then
start the run. Up to 300 rows are rendered at once — narrow with the project
filter for larger histories.

- One generation at a time, **strictly sequential**. Each session may make up to `maxAttempts` model calls; an automatic fallback pass can add calls. Preview also calls the model, while applying a candidate does not.
- Selected titles are rewritten, **including titles you renamed by hand** — the
  explicit `/retitle` path is DSH's documented way to unpin a manual title.
- Sessions without an eligible user message and subagent sessions are skipped
  (the host has nothing to generate from, or refuses to resume them).
- Progress (completed / succeeded / failed) is owned by a plugin-scope runner,
  not by the page: **closing Settings does not stop a run**, and reopening the
  page shows the live progress again. Only reloading the whole DSH window
  interrupts a run, and every session that already finished keeps its new title.
  **Stop** is immediate: `commands/execute` accepts a trailing `AbortSignal`, so
  the in-flight generation is cancelled rather than waited out, the queue does not
  continue, and the interrupted session is counted as neither success nor failure.
  Stop is reachable both in the settings page and from a small global progress
  pill (`shell.overlay`), which is what makes a background run stoppable after the
  settings page is closed.
- Failures list the **host's own reason** (dead route, timeout, maxOutputTokens,
  no usable message) instead of a generic "failed", and **Retry failed**
  re-runs exactly those sessions with whatever route settings are in force now.
- Route caveat: **Current session model** uses the model each stored session
  logged, and an old session may name a provider/model that no longer exists or
  whose credentials are gone — those fail within milliseconds. Switch to
  **Configured model**, pick a working pair, then use **Retry failed**.
- The list shows each session's **logged model** (from DSH's `modelSelection`
  projection) and flags the ones DSH no longer serves, with a count, *before*
  the run: those sessions cannot succeed while following the session model.
- **Automatic fallback** (opt-in, off by default): with a saved configured model,
  a finished run retries exactly the failed sessions once on that configured
  route, then restores the previous title mode only while it still owns the temporary route. User saves to mode, provider or model are preserved, including an explicit save of the same configured mode. The switch is a real settings
  write for the duration of the retry, so it stays off unless you ask for it.
  The checkbox itself is remembered in browser storage, not in host-managed
  settings: it only controls batch behavior in this browser.

## Preview and apply

Click **Preview title** beside a conversation title to see its previous title and a candidate. Generating the preview calls the configured title model but does not write a `session/title` event. **Apply this title** saves that exact candidate through DSH's official `sessionTitle.rename()`; application makes no new model call. The accepted title has user ownership and is protected from automatic regeneration.

In **Batch optimize**, select sessions and click **Preview selected**. Review the side-by-side previous/candidate pairs, which stack in narrow panels. After preview, the session picker collapses; expand **Change session selection** to edit it. Search and project filters also apply to candidates. Filtering keeps existing selections, and the footer counts all selected candidates. Uncheck any you do not want, then click **Apply selected** in the footer. Applied rows are marked; failed applications retain their reason. **Optimize directly** still regenerates and writes immediately; its fallback option is under **Direct optimization and fallback**. Both preview and application run serially and support Stop. Closing Settings retains progress and comparisons; reloading the window clears the client queue and comparison view.

Previews use the current saved route without the temporary automatic fallback, which would invalidate their settings revision. Fix a failed route, save it, and preview again. The host keeps at most 500 candidates for one hour. New user input, Goal changes, title changes, or relevant title setting/route changes require a new preview. Locks and the AI switch are checked again at application. A host restart or plugin unload clears the cache.

Command equivalents are `/title-preview` (returns a JSON candidate with `previewId`) and `/title-apply <previewId>`. Tokens belong to one session and can be applied once. DSH records command lifecycle/results as usual; a preview changes no title and adds no synthetic user message.

## Model modes

- **current-session:** uses the actual conversation `request.route`, never a
  substituted global default model.
- **configured:** sends only title requests to the saved provider/model pair.
  The main conversation route stays unchanged. Incomplete pairs are rejected.
- **disabled**, or `enabled=false`: zero title-model calls and zero provider-title
  events. Fallback titles, manual renaming, and title projections keep working.

Configured mode supports using a different provider and model from the conversation.

## Regenerate

Run `/retitle` or click the regenerate button beside the session title.
Ordinary user-input sessions invoke DSH's official `SessionTitleService.refresh()`; Goal-only sessions use the guarded recovery described below.
The button shows loading, prevents duplicate requests, and returns to idle afterward.

**Explicit regeneration can replace a manual title.** Automatic generation cannot.
Failures preserve the previous title; cancellation never retries.
When AI titles are disabled, `/retitle` returns `AI title generation is disabled.`
without a model call. A third party calling bare `refresh()` does not receive the
plugin's explicit permission token for replacing a manual title.

**Explicit `/retitle` outranks the weak-prompt filter.** When no message names a
task — typically a writing-mode session whose only human messages are terse
commands such as `继续写` or `发布` — `/retitle` generates from the **newest** such
command instead of failing. Automatic scheduling keeps the filter unchanged:
greetings, bare URLs, paths, code-only and punctuation-only prompts still abstain.

A session driven only by DSH `/goal` commands is also retitleable on explicit
request. Core does not include Goal-source messages in its ordinary title input,
so the plugin reads the newest Goal objective as an explicit-only temporary input;
it does not append a synthetic conversation message or use this path for automatic
title scheduling. Repeated `/retitle` after `/goal edit` uses the new objective even when a previous title exists. A newer generation supersedes an older one, and intervening input, route changes or manual renaming prevents stale output from being saved. Accepted Goal titles use the official `rename()` API and have user ownership.

Permanent adapter failures such as `UNKNOWN_MODEL`, `NO_ADAPTER`, `AUTH` and invalid credentials do not retry. Transient failures use cancellable backoff (250 ms, then 500 ms), respecting `providerRetryAfterMs` only within a bounded window of at most 5 seconds and no longer than `timeoutMs`. A longer retry-after is reported as a failure instead of retrying early. Output-quality retries remain bounded by `maxAttempts`.

## Weak first prompts

`Hello → Thanks → Are you there? → Help me audit database performance` spends no
title calls on the greetings and generates a title when the task appears.
Accepted provider titles do not drift with later messages. Child sessions do not
automatically receive titles.

The policy reads messages and titles replayed by Core, rather than maintaining its
own history. Reopening a greeting-only session after a real process restart and
sending a meaningful task has been verified through the Web UI.
`/retitle` is an explicit request and relaxes exactly one weak shape: the newest
short imperative becomes an eligible source. Every other weak shape (greeting,
bare URL/path/code, punctuation-only, demonstrative) still abstains even then.

## Privacy

Title generation is an additional model request, bounded by `maxAttempts`.
By default it uses the conversation's model. Configured mode sends the compressed
first meaningful task to the explicitly selected provider, which may be different.

Titles never enter model context. The plugin does not append an extra
`session/title-llm-request` prompt copy to the session log.
Only the fourteen declared Settings fields are accepted. Unknown credential-shaped
fields such as `apiKey`, token, cookie, credential, secret, and password are rejected.
Credentials remain entirely managed by DSH.

Plugin diagnostics contain no full prompt, model response, or credential.
Raw adapter error messages are replaced with fixed failure descriptions to prevent
sensitive input being echoed into diagnostic logs.

## Observability

The plugin uses **`ctx.logger`**. Desktop's official **FileExporter / LogFileSink**
persists records in **`<DSH userData>/logs/host/dsh-YYYY-MM-DD.log`**, with warnings
and errors also written to `.error.log`. On macOS, userData is commonly
`~/Library/Application Support/DSH Desktop/`.

Search for `smart-session-title generation`. Metadata includes sessionId, route,
attempt, rawBytes, preparedBytes, elapsedMs, result/outcome, and failureReason.
Outcomes distinguish generated, abstained, failed, timed-out, retried, and cancelled.
Desktop's own masking may replace sessionId with `****`; the plugin does not bypass it.
Enable info-level logging to retain success and abstention records.

`/title-status` shows process-local counters, which reset on restart. Persistent
history lives in the log files. Standalone SDK/Web runners may not install a file
exporter by default; the plugin does not create its own sink. Real disk persistence
has been tested using the shipped Desktop exporter in an isolated DSH runtime.

## Conflicts

DSH permits only one title provider. An `already registered` error means another
provider is active and loading must fail. Do not enable another third-party title
provider alongside this plugin. The supplied bundle replaces the built-in one.

## Troubleshooting

| Problem | Likely cause / action |
|---|---|
| Always fallback | Model failed, output was rejected, or AI is disabled; inspect diagnostics |
| already registered | Another title provider is active; remove the conflicting bundle |
| /retitle says disabled | Master switch is off or mode is disabled |
| Configured model fails | Provider/model unavailable or unsuitable for the short output budget; try Current session model |
| Title never updates | Inspect logs; existing manual/provider titles are automatically protected |
| Greeting remains | No meaningful task yet; send the actual task |
| Settings prevent startup | Invalid value or unknown field; correct the plugin namespace |
| No successful generations in log files | Check Desktop log level and its file exporter |
| Batch: most old sessions fail with `model error: upstream failure` | Those sessions logged a provider/model DSH no longer serves, so "Current session model" cannot work for them. The list flags them before the run; switch to Configured model (or tick the fallback) and use Retry failed |
| Configured model selected, but titles still follow the session model | The provider+model pair was not saved. Click Save settings to apply the selected mode and model |
| A batch vanished after I reloaded the window | The runner lives in the client half; a full window reload ends it. Titles already written stay |
| Stop does not seem to end the run | Stop aborts the in-flight generation; if it lingers, the adapter ignored cancellation — check the log for the session that was running |

## Package contents

This repository contains the installable plugin, bilingual documentation, and license.
Private development reports, session records, and local test fixtures are excluded.

## Known limitations

- **REASONING_CONTROL_UNAVAILABLE_CONFIRMED:** there is no uniform cross-adapter
  reasoning-disable control. The plugin inherits adapter defaults instead of forcing `off`.
- A reasoning model's thinking is billed against the same output budget: the old
  96-token cap made them return `max-tokens` with no title text at all. The
  default is now `maxOutputTokens: 1024`, and a `max-tokens` finish with **no
  text block** is treated as budget starvation and retried once. A model that did
  emit text and kept going is still a terminal protocol failure — its paragraph
  is never salvaged into a title.
- Configured mode picks the provider and model from those already registered
  in DSH, and falls back to manual IDs when a provider lists no models. Settings
  and header copy follow the DSH UI language (zh/en dictionaries; other
  languages fall back to English).
- The batch runner lives in the **Web client half**, not on the host: closing the
  settings page does not stop a run, but reloading the DSH window does. The host
  modules in `lib/*.js` are tracked and shipped. Their original TypeScript sources
  are unavailable, so JavaScript is maintained directly alongside `lib/*.d.ts`.
  A persistent job queue and host-side route fallback are not implemented.
- The automatic-fallback preference is stored in browser localStorage; the batch
  queue is not persisted. A reloaded window starts from an idle state (titles already written are permanent).
- No task-drift retitling, shortcuts, cloud sync, telemetry, custom database, or
  advanced model-management UI.

## License

[MIT](LICENSE)

## Development checks

Run `npm test` with Node.js 22.15 or newer. The repository includes client/i18n,
host-policy, provider behavior, preview lifecycle and host integration tests; no additional dependencies are needed.
Validation files are excluded from the published package by the `files` whitelist.

Settings reject out-of-range or fractional numeric input with an explanation and
verify persisted values after writes. Automatic fallback preserves overall batch
counts and shows retry progress separately. Stopping it is reported as stopped;
mode, provider/model changes and explicit same-value saves during fallback are preserved when restoring the route.
The exclusion tests drive the real provider with a fake model stream and assert
that a term never reaches either half of the prompt, that a surviving term is
retried exactly once and then deleted, and that an all-excluded prompt abstains
without a model call.
The lock tests cover all four entry points: the provider abstains AND does not
consume the `/retitle` permission, the command handler refuses, the header button
disables itself with the reason, and the batch list drops locked rows so that even
"Select all" cannot reach them.
The short-command tests cover both sides: a session made only of `继续写` / `发布`
still abstains with zero model calls on an automatic schedule, while an explicit
`/retitle` generates from the newest one and overrides a manual title — and a
noise-only session (greeting, URL, code) still abstains even for `/retitle`.
The output-budget tests cover both sides too: a `max-tokens` finish with **no text
block** is retried once (asserting both calls carry the configured `maxTokens`),
while a `max-tokens` finish **with** a text block stays a terminal protocol
failure after a single call.

The settings page shows model choices and common title rules directly, with a unified Save settings button in the footer. Advanced parameters and usage help start collapsed. Navigation switches between settings and batch comparison. The layout adapts to narrow panels and DSH's dark theme; fields have associated labels and visible keyboard focus.

Title rules use two columns, stack in narrow panels, and give exclusion words a full-width editor.
Detailed rules stay in a collapsed help section.

### Copy the current SessionId

The conversation header shows the current session ID in small, muted monospace text. Click to copy the full ID even when the display is truncated; hover to see the full value. Paste it into another conversation to help an agent locate this session (reading requires suitable tools and permissions). Open another session first to copy its ID. A failed clipboard write offers a read-only field for manual copying.

In plugin settings, **Show Session ID** changes this after clicking Save settings. It is on by default, persists as `showSessionId`, and works independently of AI title generation and title locking. It does not change session titles.

On DSH Desktop 2.0.9 the ID occupies a separate left-aligned line between the title toolbar and the conversation/trajectory tabs. This scoped layout depends on the verified host CSS class; if it changes, the ID falls back to the inline header slot.

The conversation header shows text labels for Regenerate title and Lock title / Title locked. Regeneration replaces the current title, including manual titles, without rerunning the conversation. Locking blocks automatic, manual and batch generation by this plugin; click Title locked to unlock. Chatting, manual renaming and DSH fallback titles remain available. The settings page explains these actions too.

Controls share consistent heights, spacing and button hierarchy, with primary actions anchored at the bottom. Candidate titles use a pale blue background, completion and in-flight progress have distinct presentations, and detailed help starts collapsed.

Title model requests omit the optional `sessionId` association from the first attempt, including with `maxAttempts: 1`. This retains rc.16 isolation from session-linked DSH request extensions. A global `REQUEST_EXTENSION` failure is terminal and reports its cause without repeating the request. All model calls still use `ctx.llm.stream()`.

The Core 0.2 global settings entry, late settings-service mounting, supported refresh icon, and explicit query-container sizing from rc.16 remain in place.

The additional regressions cover exclusions reconstructed by deletion, compressed placeholders and system examples; final title/date caps; both settings schema generations; locks during streaming; permanent/transient errors and cancellation during backoff; one-shot previews, expiry and stale-session rejection; selected batch application; repeated Goal edits and superseded Goal generations. The fake React renderer tracks effect dependencies and cleanup, and exercises effect replay and unmount cancellation.
