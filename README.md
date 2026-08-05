# posit-codex-gateway

Use your existing ChatGPT/Codex subscription sign-in with RStudio Posit Assistant.

`posit-codex-gateway` is a small local bridge. It starts the official [`openai-oauth`](https://github.com/EvanZhouDev/openai-oauth) server and makes
the one request-format adjustment needed by Posit Assistant.

> **Unofficial community project.** This project is not affiliated with,
> endorsed by, or supported by Posit or OpenAI.

## Before you start

You need:

- [Node.js 20 or newer](https://nodejs.org/en/download);
- RStudio with Posit Assistant 0.9.8 (RStudio protocol 11.0); and
- a ChatGPT/Codex Plus or Pro subscription.

This gateway uses your ChatGPT/Codex sign-in. You do not need an OpenAI API
key.

## Quick start

Install Node.js first if it is not already installed. Then run these commands
in a Terminal window:

```sh
npm install --global posit-codex-gateway
posit-codex-gateway login
posit-codex-gateway
```

The last command keeps the gateway running in the foreground. Leave that
Terminal window open while you use Posit Assistant.

To run it in the background instead, use:

```sh
posit-codex-gateway --detach
```

### Connect Posit Assistant

In RStudio, add an OpenAI-compatible provider for Posit Assistant.
Use these settings:

| Setting | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:10532/v1` |
| API key | Leave empty |

The gateway supplies the models available through your ChatGPT/Codex account.

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

Your conversation is sent to ChatGPT/Codex as part of each request, but the
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
credentials, and it does not require an internet connection.

Common fixes:

- **RStudio cannot connect:** make sure the gateway is running and the base URL
  is exactly `http://127.0.0.1:10532/v1`.
- **The port is busy:** stop the other process, or start with
  `posit-codex-gateway --port 10533` and update the base URL.
- **Sign-in fails:** run `posit-codex-gateway login` again, then restart the
  gateway.
- **A background gateway is confusing:** run `status`, inspect `logs`, then
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

The gateway is a local bridge, not a hosted proxy. Its local trust boundary is
your computer and any interface you explicitly expose with `--host`.

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

Built around [`openai-oauth`](https://github.com/EvanZhouDev/openai-oauth) by
Evan Zhou. The Posit request-adaptation logic was extracted and rewritten from
Apache-2.0 work developed in the `carl-stone/openai-oauth` fork; see
[NOTICE](NOTICE).

Licensed under Apache-2.0.
