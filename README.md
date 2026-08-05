# posit-codex-gateway

Use your existing ChatGPT/Codex OAuth session with RStudio Posit Assistant through a small local compatibility gateway.

> **Unofficial community project.** This project is not affiliated with, endorsed by, or supported by Posit or OpenAI.

## Quick start

Requires Node.js 20 or newer and a ChatGPT/Codex OAuth session already available to [`openai-oauth`](https://github.com/EvanZhouDev/openai-oauth).

```sh
npx posit-codex-gateway
```

In RStudio Posit Assistant, configure an OpenAI-compatible provider with this base URL:

```text
http://127.0.0.1:10532/v1
```

No API key is needed by the gateway. If the provider form requires a value, use a local placeholder; `openai-oauth` supplies OAuth to the Codex transport.

## Compatibility

| posit-codex-gateway | Posit Assistant | RStudio protocol | openai-oauth | Codex Responses contract |
| --- | --- | --- | --- | --- |
| 0.1.x | 0.9.8 | 11.0 | 2.x (developed with 2.0.0) | Adapter v1, checked in CI |

Posit Assistant 0.9.8 sends the full conversation and tool history on each turn. The gateway therefore uses `openai-oauth`'s default stateless Responses path and does not keep continuation memory.

## What the adapter does

Posit 0.9.8 emits explicit prompt-cache controls. The current ChatGPT/Codex Responses endpoint uses implicit caching instead. For `POST /v1/responses` only, the gateway:

- preserves `prompt_cache_key`;
- removes `prompt_cache_options`, deprecated `prompt_cache_retention`, and every recursive `prompt_cache_breakpoint`;
- allowlists the current Codex root contract and supported nested reasoning, streaming, and text-format controls;
- preserves messages, image inputs, tools, tool calls, tool arguments/results, `reasoning.encrypted_content`, and streaming; and
- passes the adapted `Request` to `openai-oauth`'s official `createOpenAIOAuthFetchHandler()`.

Every other route—including OAuth handling, models, chat completions, and images—is delegated directly to `openai-oauth`. Upstream continues to enforce its normal `store: false`, encrypted-reasoning, and streaming transport behavior.

## Doctor and troubleshooting

```sh
npx posit-codex-gateway doctor
```

`doctor` is read-only. It reports the gateway version, installed Posit Assistant version and protocol, installed `openai-oauth` version, local health at port 10532, and compatibility with the current `openai/codex` `ResponsesApiRequest`. It does not read conversations or credentials. The contract check uses GitHub; normal gateway startup does not require GitHub access.

Common checks:

- **Port already in use:** stop the existing gateway or run `npx posit-codex-gateway --port 10533` and update the provider URL.
- **OAuth/login problem:** run `npx openai-oauth login`, then restart the gateway.
- **Provider cannot connect:** confirm the base URL is exactly `http://127.0.0.1:10532/v1` and run `doctor`.
- **Contract drift:** update the adapter allowlists only after checking the corresponding `openai/codex` request type.

## Privacy and local security boundary

The gateway binds only to `127.0.0.1`; there is intentionally no `0.0.0.0` option. It rejects non-loopback `Host` and browser `Origin` values and requires JSON content for Responses requests. Treat software running under your local account as trusted: any local process able to reach the port can submit requests through your OAuth session.

Diagnostics are off by default. Enable metadata-only JSON lines with `--diagnostics` or `POSIT_CODEX_GATEWAY_DIAGNOSTICS=1`. Logged fields are limited to request ID, model, removed field paths, breakpoint count, status, duration, and token usage when safely available. Prompts, content, tool arguments/results, credentials, headers, auth material, and reasoning content are never logged.

OAuth tokens remain managed by `openai-oauth`. Gateway error bodies are deliberately generic and do not expose auth material.

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
