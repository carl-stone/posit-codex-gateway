# R Assistant Gateway

Love Codex models, hate API prices? ☀️ 🌍 🌙
Use your existing ChatGPT/Codex subscription sign-in with Posit Assistant in RStudio or Positron.

`r-assistant-gateway` is a small local compatibility bridge between Posit
Assistant's OpenAI Responses client and ChatGPT/Codex. It uses
[`@carl-stone/openai-oauth`](https://github.com/carl-stone/openai-oauth) to sign
in with your ChatGPT account and translates Posit Assistant's requests into the
request contract accepted by ChatGPT/Codex.

It is intentionally only that bridge. It is not a general OpenAI proxy or an
API-key replacement for other applications.

> **Unofficial community project.** This project is not affiliated with,
> endorsed by, or supported by Posit or OpenAI.

## Before you start

You need:

- [Node.js 24 or newer](https://nodejs.org/en/download);
- RStudio or Positron with Posit Assistant installed; and
- a ChatGPT/Codex Plus or Pro subscription.

Posit Assistant **1.6.0 and 1.6.1** are recognized in either IDE, alongside
**1.3.0 and 1.3.1**. See [compatibility validation](#compatibility-validation)
for the distinction between live testing and synthetic regression coverage.

The gateway uses your ChatGPT/Codex sign-in. You do not need an OpenAI API key.

## Quick start

With Node.js installed, run these commands in a Terminal window:

```sh
npm install --global r-assistant-gateway
r-assistant-gateway login
r-assistant-gateway
```

The last command keeps the gateway running in the foreground. Leave that
Terminal window open while you use Posit Assistant.

To run it in the background instead, use:

```sh
r-assistant-gateway --detach
```

### Connect Posit Assistant

Choose the **OpenAI** provider in either IDE:

- **RStudio:** in the Posit Assistant pane, select **gear > Configure AI
  providers > OpenAI**.
- **Positron:** open the Command Palette, run **Authentication: Configure
  Language Model Providers**, and select **OpenAI**. The separately named
  **OpenAI Compatible** provider defaults to Chat Completions; this gateway
  uses Responses.

Enter the same connection settings in either IDE:

| Setting | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:10532/v1` |
| API key | `local-gateway` |

`local-gateway` is only a non-secret placeholder required by the OpenAI setup
form. The gateway does not use it as an OpenAI API key; upstream requests use
your ChatGPT/Codex sign-in. A non-empty value also lets Posit Assistant discover
the models available through your account from the gateway. One running gateway
can serve both IDEs on the same computer. In Positron, open the chat with
**View: Show Posit Assistant**. See the official
[Positron provider instructions](https://positron.posit.co/assistant-providers.html)
for the provider dialog.

### A model is missing from the Positron selector

Posit Assistant 1.6.1 discovers GPT-6 models through the OpenAI provider,
including `gpt-6-astra`; no custom-model entry is needed. Use **Reload model
list** in the model menu after changing provider settings. Assistant 1.6.1
also fixes model lists that appeared empty during slow startup credential checks.

Assistant 1.3.1 only discovers IDs beginning with `gpt-5`, `gpt-4`, or `o`,
so GPT-6 models are hidden on that older version. Upgrade Assistant, or add a
custom model using **Open AI Provider Settings (JSON)**. Preserve existing
provider settings and use current model capabilities rather than an old
context-limit example. See Posit’s
[custom model settings reference](https://assistant.posit.co/docs/reference/providers-settings/).
Custom entries do not grant access to models unavailable to your account.

## Start, check, and stop the gateway

These commands are useful when the gateway runs in the background:

```sh
r-assistant-gateway status
r-assistant-gateway logs --follow
r-assistant-gateway doctor
r-assistant-gateway stop
```

Run `r-assistant-gateway` again to start it in the foreground after stopping
it. The default port is `10532`, which matches the Posit Assistant URL above.
You can choose another port with, for example, `--port 10533`; if you do, change
the provider's base URL to match.

## What the gateway translates

Posit Assistant uses the OpenAI Responses wire format in both IDEs when the
OpenAI provider is selected. For current Codex
models it can send developer and user input, images and files, tool definitions,
function calls, structured function outputs, encrypted reasoning, and explicit
prompt-cache controls.

ChatGPT/Codex accepts most of that request directly. The gateway removes only
known incompatible fields:

- `prompt_cache_options`;
- `prompt_cache_breakpoint` markers on Posit's input content parts;
- `previous_response_id` and legacy prompt-cache retention fields; and
- any other root field outside the current Codex request contract, including
  Posit's `max_output_tokens`.

The model, messages, images, files, reasoning, tools, function calls and
structured results, cache key, and streaming response remain intact. The
adapter never mutates the request object supplied by its caller.

The OAuth runtime handles sign-in, token refresh, model discovery, upstream
transport, and server lifecycle. The gateway defaults its optional Responses
history to process-local memory so ID-based continuations can be resolved when
needed. That history is discarded whenever the gateway stops.

## Compatibility validation

Gateway 0.3.x recognizes Posit Assistant **1.3.0, 1.3.1, 1.6.0, and 1.6.1**
using the same version list for both IDEs. These are explicit recognized
versions, not minimum version requirements; other releases are unvalidated,
not necessarily incompatible.

- **Live IDE testing:** Assistant 1.3.0 in RStudio and 1.3.1 in Positron.
  A basic live smoke test with Assistant 1.6.1 in Positron was also confirmed.
- **Synthetic regression testing:** the 1.3 Responses request and the newer
  1.6-shaped GPT-6 request, including `apply_patch`, structured tool results,
  file input, encrypted reasoning, and explicit cache controls. Both fixtures
  also run through the detached CLI against a local mock Codex endpoint.

The 1.6.1 smoke test is not exhaustive tool or model coverage. Assistant 1.6.0
and newer RStudio Assistant installations have not been live-tested.

## Troubleshooting

Run the read-only diagnostic report with:

```sh
r-assistant-gateway doctor
```

It reports the installed gateway and OAuth runtime versions, Posit Assistant
in RStudio (`positAssistant`) and Positron (`positronAssistant`), and the active
gateway’s health. Each Assistant entry includes its version and installation
path. The compatibility check accepts any version in
`supportedPositAssistantVersions` from either IDE, alongside the expected OAuth
runtime. An unrecognized Assistant version is unvalidated, not necessarily
incompatible. An older or missing installation in the other IDE does not
prevent success. The command
still exits unsuccessfully if the gateway health check fails.

Positron detection checks `~/.positron/extensions`, using the extension registry
when available and ignoring removed extensions. For a custom extension directory
(such as a `--extensions-dir` setup), set `POSITRON_EXTENSIONS_DIR`. Detection
reports installed packages; it does not check whether an extension is enabled
in the active Positron profile. The diagnostic report does not read conversations
or credentials.

Common fixes:

- **RStudio or Positron cannot connect:** make sure the gateway is running and the base URL
  is exactly `http://127.0.0.1:10532/v1`.
- **The port is busy:** stop the other process, or start with
  `r-assistant-gateway --port <number>` and update the base URL.
- **Sign-in fails:** run `r-assistant-gateway login` again, then restart the
  gateway.
- **A conversation fails after restarting the gateway:** start a new Posit
  Assistant conversation. Temporary continuation state is cleared on restart.
- **`doctor` does not recognize your Assistant version:** versions 1.3.0,
  1.3.1, 1.6.0, and 1.6.1 are recognized in either IDE. A failed version check
  does not establish that your installation cannot work.
  For an administrator-managed or otherwise nonstandard installation, set
  `POSIT_ASSISTANT_ROOT` to RStudio’s `pai/bin` directory, or
  `POSITRON_EXTENSIONS_DIR` to Positron’s extension directory, before running
  `doctor`.
- **`doctor` reports an unexpected OAuth runtime:** reinstall the matching
  `r-assistant-gateway` release rather than upgrading its runtime directly.
- **The background gateway is not working:** run `status`, inspect `logs`, then
  use `stop` before starting it again.

## Privacy and network behavior

By default, the gateway listens only on your computer at `127.0.0.1`. It uses
the same host behavior as `openai-oauth`. An explicit non-loopback `--host` can
make the unauthenticated endpoint reachable by other computers; every client
that can reach it can use your ChatGPT/Codex subscription. Keep the default
unless that access is deliberate and protected by your network.

OAuth credentials and upstream transport are handled by the published OAuth
runtime. Recent Responses items are held only in the running process, with
default limits of 256 response-history entries and 2,000 items. They are never
persisted by the gateway and are discarded when it stops or restarts.

On POSIX systems, gateway startup and login restrict the selected OAuth
credential file to its owner (`0600`).

Diagnostics are off by default. If enabled with `--diagnostics`, they contain
metadata only: request ID, model, schema-only removed-field patterns, cache
breakpoint count, status, duration, and safely available token counts. Prompts,
conversation content, tool arguments and results, credentials, headers, auth
material, and reasoning content are not logged.

## Advanced CLI options

The gateway accepts the same public commands and options as its OAuth runtime,
including `login`, `--host`, `--port`, `--models`, `--codex-version`,
`--base-url`, OAuth overrides, `--no-open`, login timeout, `--detach`, `status`,
`logs`, `stop`, `--responses-state`, `--responses-max-responses`, and
`--responses-max-items`.

There are two intentional Posit defaults: port `10532` and process-local
Responses memory. You can override the port. Setting `--responses-state
stateless` disables continuation by response or item IDs, so `doctor` does not
consider that configuration healthy for Posit Assistant. `doctor` and
`--diagnostics` are specific to this gateway.

Model discovery automatically resolves the latest stable Codex client version
from npm, caching it for one hour. Installing or updating the Codex CLI is not
required. If registry discovery fails, the runtime falls back to its older
built-in version; `--codex-version <version>` overrides it when needed.

### OAuth runtime limitations

- Use an IPv4 host such as the default `127.0.0.1`. The pinned OAuth runtime
  does not correctly advertise an IPv6 host.
- Cancelling a request in the client may not stop the upstream generation. The
  pinned runtime does not yet propagate HTTP disconnects to its upstream fetch.
- The delegated runtime also exposes unadapted chat-completion and image routes.
  They are outside this gateway's supported surface; this is another reason to
  keep the listener on the default loopback address.

## Development

```sh
npm ci
npm run verify
npm audit
npm pack --dry-run
```

`npm run verify` performs typechecking, linting, unit tests, a TypeScript build,
and detached CLI tests with synthetic Assistant 1.3 and 1.6 Responses requests.
It also packs the gateway, installs it in an isolated consumer project, audits
that installation, verifies the security-patched dependency, and reruns the
CLI lifecycle against the installed package. No real credentials or ChatGPT
requests are used by these tests.

The OAuth runtime remains pinned to the memory-enabled fork. An npm override
pins `@ai-sdk/provider-utils` to patched 4.0.57 for GHSA-866g-f22w-33x8. The
runtime and its production dependency tree, including its explicit `zod` peer,
are bundled into the npm package because overrides alone do not apply when
users install a dependency. The overrides are scoped to each SDK parent to
avoid npm's resolver loop with global overrides and bundled dependencies. The
packaged-install test guards against accidentally shipping the old dependency.

CI also performs an npm package dry run. Dependabot watches npm and GitHub
Actions dependencies.

## Credits and license

This project uses
[`@carl-stone/openai-oauth`](https://github.com/carl-stone/openai-oauth), a
published fork of Evan Zhou's `openai-oauth`. The dependency ships its own
Apache-2.0 license and notice; this repository's required attribution is
included in [NOTICE](NOTICE).

The original gateway code in this repository is copyright Carl Stone and is
licensed under Apache-2.0. See [LICENSE](LICENSE).

## Legal

R Assistant Gateway is an unofficial community project. It is not affiliated
with, endorsed by, or supported by Posit Software, PBC.

Posit, RStudio, Positron, and Posit Assistant are trademarks of Posit Software,
PBC, all rights reserved, and may be registered in the United States Patent and
Trademark Office and in other countries.
