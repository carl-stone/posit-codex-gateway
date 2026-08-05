# posit-codex-gateway

Love Codex models, hate Codex API prices? ☀️ 🌍 🌙
Use your existing ChatGPT/Codex subscription sign-in with RStudio Posit Assistant.

`posit-codex-gateway` is a small local bridge between [`openai-oauth`](https://github.com/EvanZhouDev/openai-oauth) and the Posit Assistant interface for RStudio. `openai-oauth` runs a local (by default) server to use the ChatGPT desktop app as a `/responses` API endpoint. This package extends that server to work with the particular quirks of how Posit Assistant calls that API. `openai-oauth` is installed with this package and all of its command-line arguments are retained, but call it separately if you want to set up an API server not for Posit Assistant.

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
configure in Posit Assistant beyond the local base URL shown above. I have not used ChatGPT models in Posit 

Your conversation is sent to ChatGPT/Codex as part of each request, and the
gateway does not keep its own conversation history or memory. Messages,
images, reasoning, tools, tool calls and results, and streaming responses are
supported.

Sign-in, model discovery, chat and image requests, OAuth refresh, and the
connection to ChatGPT/Codex are provided by `openai-oauth`.

## Supported versions

| Gateway | Posit Assistant | RStudio protocol | openai-oauth | Responses adapter |
| --- | --- | --- | --- | --- |
| 0.1.x | 0.9.8 | 11.0 | 2.0.0 | v1 |

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
- **The background gateway isn't working:** run `status`, inspect `logs`, then
  use `stop` before starting it again.

## Privacy and network behavior

By default, the gateway listens only on your computer at `127.0.0.1`. It uses
the same host behavior as `openai-oauth`; an explicit `--host` can make it
reachable from other interfaces, so use that option only when you intend to.

OAuth credentials and upstream transport are handled by `openai-oauth`.
Diagnostics are off by default. If enabled with `--diagnostics`, they contain
metadata only: request ID, model, schema-only removed-field patterns, cache
breakpoint count, status, duration, and safely available token counts. Prompts,
conversation content, tool arguments/results, credentials, headers, auth
material, and reasoning content are not logged.

## Advanced CLI options

The gateway accepts the same public commands and options as
`openai-oauth` 2.0.0, including `login`, `--host`, `--port`, `--models`,
`--codex-version`, `--base-url`, OAuth overrides, `--no-open`, login timeout,
`--detach`, `status`, `logs`, and `stop`.

The only intentional default difference is the port: this gateway uses
`10532` instead of `openai-oauth`'s `10531` so it matches the Posit Assistant
configuration. `doctor` and `--diagnostics` are gateway-specific additions.

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

This project uses [`openai-oauth`](https://github.com/EvanZhouDev/openai-oauth)
by Evan Zhou and the OpenAI OAuth contributors. Its required attribution notice
is included in [NOTICE](NOTICE).

The original gateway code in this repository is copyright Carl Stone and is
licensed under Apache-2.0. See [LICENSE](LICENSE).
