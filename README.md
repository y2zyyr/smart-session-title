# smart-session-title

English | [简体中文](README.zh-CN.md)

Smarter automatic session titles for **DeepSeek Harness (DSH)**.
**0.3.0-rc.1 — release candidate**, intended for the npm `next` tag.

## What it does

Summarizes the first meaningful task into a short session title. By default,
**the title uses the exact provider and model used by that conversation**.
No separate model setup is required.

- Compresses oversized and code-heavy prompts instead of rejecting them.
- Waits for a meaningful task when a conversation starts with a greeting.
- Protects manual titles and prevents automatic title drift.
- Provides `/retitle` and a header button for explicit regeneration.
- Adds native settings and local diagnostics, with no telemetry service.

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

DSH supplies the pinned runtime peers; `--legacy-peer-deps` prevents npm from
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
Runtime peer versions are pinned. Other Core versions have not been verified.

Startup checks the title, LLM, and Settings capabilities. Invalid settings fail
before the provider is registered. The Web client uses official slots, locale,
settingsScope, and Remote commands. No version-string hard rejection is used.

## Settings

Open **Settings → Smart Session Title**.
The official DSH Settings service persists the `smart-session-title` namespace in
**`$DSH_HOME/settings.yaml`**, handling atomic writes, revisions, and file watching.
Changes affect the next generation; an in-flight request keeps its initial policy.
There is no separate config file, custom watcher, or HTTP server.

| Field | Default | Purpose |
|---|---|---|
| `enabled` | `true` | Master AI-title switch |
| `mode` | Follow the session¹ | `current-session`, `configured`, or `disabled` |
| `provider` | Unset | Existing DSH provider ID |
| `model` | Unset | Model ID belonging to that provider |
| `timeoutMs` | 15000 | Per-attempt timeout; UI range 1000–120000 ms |
| `maxAttempts` | 2 | Total attempts; range 1–3 |

¹ For older deployments only, an explicit provider/model pin in the bundle row
remains effective until the user chooses a mode. The shipped bundle has no pin.
Explicit `current-session` always uses the session route.

For **Configured model**, enter both IDs and click **Save configured model**.
All three route fields are saved atomically. IDs come from DSH's Models page;
this plugin does not manage credentials or provide a model browser.
**Advanced** exposes timeout and attempts. Empty numeric fields inherit the bundle
configuration; deployment-level compression options are in `cordis.patch.yml`.

### Optimize past titles

The same page lists your **stored sessions** with the title each one currently
has, so you can batch-regenerate titles written before this plugin was installed.
Pick the rows (or select all within one project) and start the run.

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
  Cancel takes effect after the session currently in flight, because the Remote
  command call carries no cancellation signal.

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
Only the six declared Settings fields are accepted. Unknown credential-shaped
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
- No task-drift retitling, shortcuts, cloud sync, telemetry, custom database, or
  advanced model-management UI.

## License

[MIT](LICENSE)
