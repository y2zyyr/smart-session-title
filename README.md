# smart-session-title

English | [简体中文](README.zh-CN.md)

Smarter automatic session titles for **DeepSeek Harness (DSH)**.
**0.5.0-rc.1 — release candidate**, intended for the npm `next` tag.

## What it does

Summarizes the first meaningful task into a short session title. By default,
**the title uses the exact provider and model used by that conversation**.
No separate model setup is required.

- Compresses oversized and code-heavy prompts instead of rejecting them.
- Waits for a meaningful task when a conversation starts with a greeting.
- Protects manual titles and prevents automatic title drift.
- Provides `/retitle` and a header button for explicit regeneration.
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

Validated with **DSH Desktop 2.0.9**, **Core 0.1.5-rc.1**, **Cordis 4.0.2**,
**Schemastery 3.18.2**, and **Node ≥22.15.0**.
DSH runtime peers use the prerelease-compatible range `^0.1.5-rc.1`; Schemastery remains pinned to `3.18.2`. Other Core versions have not been verified.

Startup checks the title, LLM, and Settings capabilities. Invalid settings fail
before the provider is registered. The Web client uses official slots, locale,
settingsScope, and Remote commands. No version-string hard rejection is used.

## Settings

Open **Settings → Smart Session Title**.
The official DSH Settings service persists the `smart-session-title` namespace in
**`$DSH_HOME/settings.yaml`**, handling atomic writes, revisions, and file watching.
Changes affect the next generation; an in-flight request keeps its initial policy.
There is no separate config file, custom watcher, or HTTP server.
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
| `maxTitleCharacters` | Unset (inherits 80 bytes) | Title **character cap** (Unicode code points); UI range 8–120 |
| `titleDatePosition` | Unset (no date) | `prefix` / `suffix`: put the session's creation date before or after the title |
| `titleDateFormat` | `ymd` | `ymd` (`2026-09-13`) or `md` (`09-13`); unused while no position is chosen |
| `titleStyle` | Unset (plugin default, currently action + object) | `action-object` or `short-name` |
| `titleLanguage` | Unset (follows the task's main language) | `zh` or `en`, forced |
| `titleExclusions` | Unset (nothing excluded) | String list of words that must not appear in a generated title; at most 50 entries of at most 64 characters |
| `lockedSessionIds` | Unset (nothing locked) | String list of session ids whose title no entry point may rewrite; at most 500 entries |

¹ For older deployments only, an explicit provider/model pin in the bundle row
remains effective until the user chooses a mode. The shipped bundle has no pin.
Explicit `current-session` always uses the session route.

For **Configured model**, enter both IDs and click **Save configured model**.
All three route fields are saved atomically. IDs come from DSH's Models page;
this plugin does not manage credentials or provide a model browser.
Selecting the **Configured model** radio alone is not enough: with a usable pair
already saved the plugin applies it immediately, otherwise the page states that
the change is not in effect yet — until then titles keep following
**Current session model**, i.e. the model each session logged.
**Advanced** exposes timeout and attempts. Empty numeric fields inherit the bundle
configuration; deployment-level compression options are in `cordis.patch.yml`.

### Title shape and content (cap, date, style, language, exclusions)

The **Title shape and content** block on the settings page needs no expanding:

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
  for the date automatically.
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
- the term list itself is stored in plain text in `settings.yaml`.

So its accurate name is "title exclusions", **not a privacy or redaction
feature**. Its most practical use is alongside **Optimize past titles**, to strip
a name out of a whole batch of historical titles.

### Title lock

The **lock button** beside a session title (to the right of "Regenerate title")
pins that title. The button shows the state itself: a closed padlock means
locked, and the hover text and accessible label always name what a click will do
("Lock title" / "Unlock title").

All four entry points honour it:

| Rule | Actual behaviour |
|---|---|
| Automatic generation skips locked sessions | the provider abstains (`locked`) without a model call |
| Regeneration says why it will not run | the button is disabled and reads "Title is locked; unlock it first" |
| The batch list excludes locked sessions | they are not listed, and the count is joined by "Locked sessions skipped: N" |
| A batch run cannot reach them | even "Select all" cannot select a locked row |

- The lock lives in the plugin's **own settings namespace** (`lockedSessionIds` in
  `settings.yaml`), **not in browser localStorage**: it survives a new window, a
  cleared browser profile, and a DSH restart.
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

- One `/retitle` per session, **strictly sequential**: a run of N sessions costs
  N model calls and never runs two generations at once.
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
  route, then restores the previous title mode. The switch is a real settings
  write for the duration of the retry, so it stays off unless you ask for it.
  The checkbox itself is remembered in browser storage, not in `settings.yaml`:
  that schema is host-owned and the client half may not extend it.

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
Both invoke DSH's official `SessionTitleService.refresh()`.
The button shows loading, prevents duplicate requests, and returns to idle afterward.

**Explicit regeneration can replace a manual title.** Automatic generation cannot.
Failures preserve the previous title; cancellation never retries.
When AI titles are disabled, `/retitle` returns `AI title generation is disabled.`
without a model call. A third party calling bare `refresh()` does not receive the
plugin's explicit permission token for replacing a manual title.

## Weak first prompts

`Hello → Thanks → Are you there? → Help me audit database performance` spends no
title calls on the greetings and generates a title when the task appears.
Accepted provider titles do not drift with later messages. Child sessions do not
automatically receive titles.

The policy reads messages and titles replayed by Core, rather than maintaining its
own history. Reopening a greeting-only session after a real process restart and
sending a meaningful task has been verified through the Web UI.

## Privacy

Title generation is an additional model request, bounded by `maxAttempts`.
By default it uses the conversation's model. Configured mode sends the compressed
first meaningful task to the explicitly selected provider, which may be different.

Titles never enter model context. The plugin does not append an extra
`session/title-llm-request` prompt copy to the session log.
Only the thirteen declared Settings fields are accepted. Unknown credential-shaped
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
| Configured model selected, but titles still follow the session model | The provider+model pair was not saved. With a usable pair the radio now applies it immediately; otherwise the page says the change is not in effect yet |
| A batch vanished after I reloaded the window | The runner lives in the client half; a full window reload ends it. Titles already written stay |
| Stop does not seem to end the run | Stop aborts the in-flight generation; if it lingers, the adapter ignored cancellation — check the log for the session that was running |

## Package contents

This repository contains the installable plugin, bilingual documentation, and license.
Private development reports, session records, and local test fixtures are excluded.

## Known limitations

- **REASONING_CONTROL_UNAVAILABLE_CONFIRMED:** there is no uniform cross-adapter
  reasoning-disable control. The plugin inherits adapter defaults instead of forcing `off`.
- Some reasoning models can exhaust the 96-token output budget; fallback remains intact.
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
host-policy, and provider behavior tests; no additional dependencies are needed.
Validation files are excluded from the published package by the `files` whitelist.

Settings reject out-of-range or fractional numeric input with an explanation and
verify persisted values after writes. Automatic fallback preserves overall batch
counts and shows retry progress separately. Stopping it is reported as stopped;
mode changes observed during fallback are preserved when restoring the route.
The exclusion tests drive the real provider with a fake model stream and assert
that a term never reaches either half of the prompt, that a surviving term is
retried exactly once and then deleted, and that an all-excluded prompt abstains
without a model call.
The lock tests cover all four entry points: the provider abstains AND does not
consume the `/retitle` permission, the command handler refuses, the header button
disables itself with the reason, and the batch list drops locked rows so that even
"Select all" cannot reach them.

The settings page uses four collapsible cards: model, title shape and content, advanced parameters, and batch retitling.
All four sections start collapsed and show concise saved-setting summaries;
an active batch opens its controls automatically. The layout adapts to narrow
windows, and form fields have associated labels and visible keyboard focus.
