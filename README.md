# posit-codex-gateway

Love Codex models, hate Codex API prices? ☀️ 🌍 🌙
Use your existing ChatGPT/Codex subscription sign-in with RStudio Posit Assistant.

`posit-codex-gateway` is a small local bridge between RStudio and
[`openai-oauth`](https://github.com/EvanZhouDev/openai-oauth). It signs in with
your ChatGPT account and adjusts Posit Assistant requests so they work with the
Codex Responses service.

> **Unofficial community project.** This project is not affiliated with,
> endorsed by, or supported by Posit or OpenAI.

## Before you start

You need:

- [Node.js 20 or newer](https://nodejs.org/en/download);
- RStudio with Posit Assistant 0.9.8 (RStudio protocol 11.0); and
- a ChatGPT/Codex Plus or Pro subscription.

This gateway uses your ChatGPT/Codex sign-in. You do not need an OpenAI API key.

## Quick start

With Node.js installed, run these commands in a Terminal window:

```sh
npm install --global posit-codex-gateway
posit-codex-gateway login
posit-codex-gateway
```

The last command keeps the gateway running in the foreground. Leave that
Terminal window open while you use Posit Assistant.

Or, to run it in the background instead, use:

```sh
posit-codex-gateway --detach
```

### Connect Posit Assistant

In the Posit Assistant pane in RStudio, select the gear > Configure LLM providers > OpenAI.
Change the Base URL and API key to:

| Setting | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:10532/v1` |
| API key | Leave empty |

The gateway supplies all models available through your ChatGPT/Codex account.

## Start, check, and stop the gateway

These commands are useful when the gateway is running in the background:

```sh
posit-codex-gateway status
posit-codex-gateway logs --follow
posit-codex-gateway stop
```

Run `posit-codex-gateway` again to start it in the foreground after stopping
it. The default port is `10532`, which matches the Posit Assistant URL above.
You can choose another port with, for example, `--port 10533`; if you do,
change the provider's base URL to match.

## What you need to know

The gateway connects Posit Assistant to your ChatGPT/Codex session and handles
the request-format differences automatically. There is nothing special to
configure in Posit Assistant beyond the local base URL shown above.

Messages, images, reasoning, tools, tool calls and results, and streaming
responses are supported. The gateway keeps a temporary, in-memory record of
recent Responses items so Posit Assistant can continue after a tool call. This
record is not written to disk and disappears when the gateway stops.

Sign-in, model discovery, chat and image requests, OAuth refresh, and the
connection to ChatGPT/Codex are provided by `openai-oauth`.

## Supported versions

| Gateway | Posit Assistant | RStudio protocol | OAuth runtime | Responses adapter |
| --- | --- | --- | --- | --- |
| 0.1.x | 0.9.8 | 11.0 | `@carl-stone/openai-oauth` 2.0.0-memory.1 | v1 |

The project checks that its requests still match Codex automatically in CI.

## Troubleshooting

Run the read-only diagnostic report with:

```sh
posit-codex-gateway doctor
```

It reports the installed gateway, Posit Assistant, and `openai-oauth` versions
and whether the local gateway is healthy. It does not read conversations or
credentials.

Common fixes:

- **RStudio cannot connect:** make sure the gateway is running and the base URL
  is exactly `http://127.0.0.1:10532/v1`.
- **The port is busy:** stop the other process, or start with
  `posit-codex-gateway --port <number>` and update the base URL.
- **Sign-in fails:** run `posit-codex-gateway login` again, then restart the
  gateway.
- **A conversation fails after restarting the gateway:** start a new Posit
  Assistant conversation. Temporary tool-continuation state is cleared when
  the gateway stops.
- **The background gateway isn't working:** run `status`, inspect `logs`, then
  use `stop` before starting it again.

## Privacy and network behavior

By default, the gateway listens only on your computer at `127.0.0.1`. It uses
the same host behavior as `openai-oauth`; an explicit `--host` can make it
reachable from other interfaces, so use that option only when you intend to.

OAuth credentials and upstream transport are handled by `openai-oauth`.
Recent Responses items are held only in the running process, with upstream's
default limits of 256 responses and 2,000 items. They are never persisted by
the gateway and are discarded when it stops or restarts.
Diagnostics are off by default. If enabled with `--diagnostics`, they contain
metadata only: request ID, model, schema-only removed-field patterns, cache
breakpoint count, status, duration, and safely available token counts. Prompts,
conversation content, tool arguments/results, credentials, headers, auth
material, and reasoning content are not logged.

## Advanced CLI options

The gateway accepts the same public commands and options as its `openai-oauth`
runtime, including `login`, `--host`, `--port`, `--models`,
`--codex-version`, `--base-url`, OAuth overrides, `--no-open`, login timeout,
`--detach`, `status`, `logs`, `stop`, `--responses-state`,
`--responses-max-responses`, and `--responses-max-items`.

There are two intentional defaults for Posit Assistant: port `10532` and
process-local Responses memory. You can explicitly override either default,
although `--responses-state stateless` will prevent Posit tool-call
continuations from working. `doctor` and `--diagnostics` are gateway-specific
additions.

## Development

```sh
npm install
npm run verify
npm run check:contract
npm pack --dry-run
```

CI runs tests, typechecking, linting, and the TypeScript build. A separate
scheduled/manual workflow checks for Codex contract drift. Dependabot watches
the npm and GitHub Actions dependencies.

## Credits and license

This project uses a narrowly scoped build of
[`openai-oauth`](https://github.com/EvanZhouDev/openai-oauth) by Evan Zhou and
the OpenAI OAuth contributors while its Responses-memory change is pending
upstream review. The dependency ships its own Apache-2.0 license and notice;
this repository's required attribution is included in [NOTICE](NOTICE).

The original gateway code in this repository is copyright Carl Stone and is
licensed under Apache-2.0. See [LICENSE](LICENSE).
