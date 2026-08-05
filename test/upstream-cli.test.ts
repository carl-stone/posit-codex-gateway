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
			"Posit Codex Gateway is running. Stop with `npx posit-codex-gateway stop`.",
		);
		expect(brandUpstreamCliText("Proxy port. Default: 10531.")).toBe(
			"Proxy port. Default: 10532.",
		);
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
