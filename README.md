# posit-codex-gateway

Want to use RStudio's Posit Assistant with your existing ChatGPT Plus/Pro subscription? Now you can! [`openai-oauth`](https://github.com/EvanZhouDev/openai-oauth) provides a local server for translating the ChatGPT/Codex desktop app to /v1/responses, and this package provides a thin layer that adapts RStudio's Posit Assistant (v0.9.8) requests to that API.

> **Unofficial community project.** This project is not affiliated with, endorsed by, or supported by Posit or OpenAI.

## Quick start

Requires Node.js 20 or newer.

Install the gateway:

```sh
npm install --global posit-codex-gateway
```

Log in with your ChatGPT or Codex account:

```sh
posit-codex-gateway login
```

Start the gateway:

```sh
posit-codex-gateway
```

Leave this terminal window open while you use Posit Assistant. To run it in the background instead:

```sh
posit-codex-gateway --detach
```

The gateway preserves the `openai-oauth` CLI lifecycle:

```sh
posit-codex-gateway status
posit-codex-gateway logs --follow
posit-codex-gateway stop
```

In RStudio Posit Assistant, add an OpenAI-compatible provider. Set its base URL to:

```text
http://127.0.0.1:10532/v1
```

The gateway does not need an API key. If RStudio requires one, enter any placeholder, such as `local`.


## Compatibility

| posit-codex-gateway | Posit Assistant | RStudio protocol | openai-oauth | Codex Responses contract |
| --- | --- | --- | --- | --- |
| 0.1.x | 0.9.8 | 11.0 | 2.0.0 | Adapter v1, checked in CI |

Posit Assistant 0.9.8 sends the full conversation and tool history on each turn. The gateway therefore uses `openai-oauth`'s default stateless Responses path and does not keep continuation memory.

## What the adapter does

Posit 0.9.8 emits explicit prompt-cache controls. The current ChatGPT/Codex Responses endpoint uses implicit caching instead. For `POST /v1/responses` only, the gateway:

- preserves `prompt_cache_key`;
- removes `prompt_cache_options`, deprecated `prompt_cache_retention`, and every recursive `prompt_cache_breakpoint`;
- allowlists the current Codex root contract and supported nested reasoning, streaming, and text-format controls;
- preserves messages, image inputs, tools, tool calls, tool arguments/results, `reasoning.encrypted_content`, and streaming; and
- delegates the CLI and server to `openai-oauth`, while adapting only its outbound Codex Responses fetch.

Every other route—including OAuth handling, models, chat completions, and images—is delegated directly to `openai-oauth`. Upstream continues to enforce its normal `store: false`, encrypted-reasoning, and streaming transport behavior.

## CLI compatibility

The gateway supports the same public commands and options as `openai-oauth` 2.0.0: foreground and detached serving, `status`, `logs`, `stop`, `login`, `--host`, `--port`, model and Codex overrides, OAuth overrides, browser control, and login timeout. The only intentional default difference is port 10532, which matches the RStudio provider configuration, instead of upstream's port 10531. `doctor` and `--diagnostics` are gateway-specific additions.

## Doctor and troubleshooting

```sh
npx posit-codex-gateway doctor
```

`doctor` is read-only. It reports the gateway version, installed Posit Assistant version and protocol, installed `openai-oauth` version, local health at port 10532, and compatibility with the current `openai/codex` `ResponsesApiRequest`. It does not read conversations or credentials. The contract check uses GitHub; normal gateway startup does not require GitHub access.

Common checks:

- **Port already in use:** stop the existing gateway or run `npx posit-codex-gateway --port 10533` and update the provider URL.
- **OAuth/login problem:** run `npx posit-codex-gateway login`, then restart the gateway.
- **Provider cannot connect:** confirm the base URL is exactly `http://127.0.0.1:10532/v1` and run `doctor`.
- **Contract drift:** update the adapter allowlists only after checking the corresponding `openai/codex` request type.

## Network and diagnostics

The gateway follows `openai-oauth` network behavior: it defaults to `127.0.0.1` and accepts the same explicit `--host` override. The adapter does not add Host, Origin, or content-type restrictions.

Diagnostics are off by default. Enable metadata-only JSON lines with `--diagnostics` or `POSIT_CODEX_GATEWAY_DIAGNOSTICS=1`. Logged fields are limited to request ID, model, schema-only removed-field patterns, breakpoint count, status, duration, and token usage when safely available. User-defined property names are redacted. Prompts, content, tool arguments/results, credentials, headers, auth material, and reasoning content are never logged.

OAuth tokens and upstream errors remain managed by `openai-oauth`.

## Development

```sh
npm install
npm run verify
npm run check:contract
npm pack --dry-run
```

CI runs tests, typechecking, linting, and the unbundled TypeScript build. A separate scheduled/manual workflow checks the current Codex contract. Dependabot watches npm dependencies and GitHub Actions.

## Credits and license

Built around [`openai-oauth`](https://github.com/EvanZhouDev/openai-oauth) by Evan Zhou. The Posit request-adaptation logic was extracted and rewritten from Apache-2.0 work developed in the `carl-stone/openai-oauth` fork; see [NOTICE](NOTICE).

Licensed under Apache-2.0.
