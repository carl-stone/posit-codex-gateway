import { afterEach, describe, expect, test, vi } from "vitest";
import {
	brandUpstreamCliText,
	installUpstreamFetchAdapter,
	prepareUpstreamCliArgv,
} from "../src/upstream-cli.js";

describe("upstream CLI delegation", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("forwards CLI arguments unchanged except the RStudio default port", () => {
		expect(
			prepareUpstreamCliArgv([
				"--detach",
				"--host",
				"0.0.0.0",
				"--models",
				"gpt-5.6-sol",
			]).argv,
		).toEqual([
			"--detach",
			"--host",
			"0.0.0.0",
			"--models",
			"gpt-5.6-sol",
			"--port",
			"10532",
		]);
		expect(prepareUpstreamCliArgv(["--port=10533"]).argv).toEqual([
			"--port=10533",
		]);
		expect(prepareUpstreamCliArgv(["status"]).argv).toEqual(["status"]);
		expect(prepareUpstreamCliArgv(["logs", "--follow"]).argv).toEqual([
			"logs",
			"--follow",
		]);
		expect(prepareUpstreamCliArgv(["stop"]).argv).toEqual(["stop"]);
		expect(prepareUpstreamCliArgv(["login", "--no-open"]).argv).toEqual([
			"login",
			"--no-open",
		]);
	});

	test("brands upstream guidance with the executable that owns the runtime", () => {
		expect(
			brandUpstreamCliText(
				"OpenAI OAuth is running. Stop with `npx openai-oauth stop`.",
			),
		).toBe(
			"OpenAI OAuth is running. Stop with `npx posit-codex-gateway stop`.",
		);
		expect(brandUpstreamCliText("Proxy port. Default: 10531.")).toBe(
			"Proxy port. Default: 10532.",
		);
		const updateNotice =
			"A newer version of openai-oauth is available: 2.0.0 -> 2.1.0.\nRun `npx openai-oauth@latest` to use the newest version.";
		expect(brandUpstreamCliText(updateNotice)).toBe(updateNotice);
	});

	test("preserves cancellation and the exact streaming response", async () => {
		const response = new Response("stream", {
			headers: { "content-type": "text/event-stream" },
		});
		let forwardedSignal: AbortSignal | undefined;
		const upstream = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				init?: Parameters<typeof fetch>[1],
			) => {
				forwardedSignal = init?.signal ?? undefined;
				return response;
			},
		);
		vi.stubGlobal("fetch", upstream);
		const restore = installUpstreamFetchAdapter();
		const abort = new AbortController();
		try {
			const result = await fetch("https://example.test/responses", {
				method: "POST",
				body: JSON.stringify({ model: "gpt-5.6-sol", stream: true }),
				signal: abort.signal,
			});
			expect(result).toBe(response);
			abort.abort();
			expect(forwardedSignal?.aborted).toBe(true);
		} finally {
			restore();
		}
	});

	test("logs only redacted metadata, response usage, and upstream errors", async () => {
		const secretKey = "SECRET_TOOL_RESULT_KEY";
		const events: unknown[] = [];
		const upstream = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					output: [{ content: "secret answer" }],
					usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
				}),
			)
			.mockRejectedValueOnce(new Error("upstream failed"));
		vi.stubGlobal("fetch", upstream);
		const restore = installUpstreamFetchAdapter((event) => events.push(event));
		const body = JSON.stringify({
			model: "gpt-5.6-sol",
			input: [
				{
					output: {
						[secretKey]: { prompt_cache_breakpoint: true },
					},
				},
			],
		});
		try {
			await fetch("https://example.test/responses", { method: "POST", body });
			await vi.waitFor(() => expect(events).toHaveLength(2));
			expect(events[1]).toMatchObject({
				type: "responses_response",
				status: 200,
				usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
			});
			expect(JSON.stringify(events)).not.toContain(secretKey);
			expect(JSON.stringify(events)).not.toContain("secret answer");

			await expect(
				fetch("https://example.test/responses", { method: "POST", body }),
			).rejects.toThrow("upstream failed");
			expect(events.at(-1)).toMatchObject({
				type: "responses_error",
				status: 0,
			});
		} finally {
			restore();
		}
	});

	test("strips only the gateway diagnostics extension", () => {
		expect(prepareUpstreamCliArgv(["--detach", "--diagnostics"])).toEqual({
			argv: ["--detach", "--port", "10532"],
			diagnostics: true,
		});
	});

	test("adapts only outbound Responses requests before upstream fetch", async () => {
		const response = new Response("upstream");
		const upstream = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) => response,
		);
		vi.stubGlobal("fetch", upstream);
		const restore = installUpstreamFetchAdapter();

		try {
			const result = await fetch(
				"https://chatgpt.com/backend-api/codex/responses",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model: "gpt-5.6-sol",
						input: [
							{
								role: "user",
								content: [
									{
										type: "input_text",
										text: "hello",
										prompt_cache_breakpoint: { mode: "explicit" },
									},
								],
							},
						],
						prompt_cache_key: "posit-session",
						prompt_cache_options: { mode: "explicit" },
						stream: true,
					}),
				},
			);

			expect(result).toBe(response);
			const forwarded = upstream.mock.calls[0]?.[1];
			const body = JSON.parse(String(forwarded?.body));
			expect(body.prompt_cache_key).toBe("posit-session");
			expect(body.prompt_cache_options).toBeUndefined();
			expect(JSON.stringify(body)).not.toContain("prompt_cache_breakpoint");
		} finally {
			restore();
		}
	});

	test("passes every non-Responses fetch through unchanged", async () => {
		const upstream = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				_init?: Parameters<typeof fetch>[1],
			) => Response.json({ ok: true }),
		);
		vi.stubGlobal("fetch", upstream);
		const restore = installUpstreamFetchAdapter();
		const init = { headers: { Accept: "application/json" } };
		try {
			await fetch("https://chatgpt.com/backend-api/codex/models", init);
			expect(upstream).toHaveBeenCalledWith(
				"https://chatgpt.com/backend-api/codex/models",
				init,
			);
		} finally {
			restore();
		}
	});
});
