import { readFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";
import type { DiagnosticEvent } from "../src/diagnostics.js";
import { createGatewayFetchHandler } from "../src/handler.js";

const request = (body: unknown, signal?: AbortSignal) =>
	new Request("http://127.0.0.1:10532/v1/responses", {
		method: "POST",
		headers: { "Content-Type": "application/json", Host: "127.0.0.1:10532" },
		body: typeof body === "string" ? body : JSON.stringify(body),
		...(signal ? { signal } : {}),
	});

describe("createGatewayFetchHandler", () => {
	test("adapts only POST /v1/responses and returns the exact upstream response", async () => {
		const response = new Response("stream", {
			headers: { "Content-Type": "text/event-stream" },
		});
		const upstream = vi.fn(async (_forwarded: Request) => response);
		const handler = createGatewayFetchHandler({ upstreamHandler: upstream });
		const input = JSON.parse(
			await readFile(
				new URL("./fixtures/posit-0.9.8-responses.json", import.meta.url),
				"utf8",
			),
		);

		const result = await handler(request(input));
		expect(result).toBe(response);
		const forwarded = upstream.mock.calls[0]?.[0];
		const body = await forwarded?.json();
		expect(body.prompt_cache_key).toBe("posit-session");
		expect(body.prompt_cache_options).toBeUndefined();
		expect(body.input[1].content[1].image_url).toBe(
			"data:image/png;base64,AA==",
		);
	});

	test("delegates non-Responses routes without consuming or replacing the Request", async () => {
		const upstream = vi.fn(async () => Response.json({ ok: true }));
		const handler = createGatewayFetchHandler({ upstreamHandler: upstream });
		const input = new Request("http://127.0.0.1:10532/v1/models", {
			headers: { Host: "localhost:10532" },
		});
		await handler(input);
		expect(upstream).toHaveBeenCalledWith(input);
	});

	test("rejects malformed JSON but does not impose a content-type policy", async () => {
		const upstream = vi.fn(async () => new Response("ok"));
		const handler = createGatewayFetchHandler({ upstreamHandler: upstream });
		expect((await handler(request("{"))).status).toBe(400);
		const nonJsonContentType = new Request(
			"http://127.0.0.1:10532/v1/responses",
			{
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: "{}",
			},
		);
		expect((await handler(nonJsonContentType)).status).toBe(200);
		expect(upstream).toHaveBeenCalledOnce();
	});

	test("preserves cancellation", async () => {
		const abort = new AbortController();
		let forwardedSignal: AbortSignal | undefined;
		const handler = createGatewayFetchHandler({
			upstreamHandler: async (forwarded) => {
				forwardedSignal = forwarded.signal;
				return new Response("ok");
			},
		});
		await handler(request({ model: "gpt-5.6-sol" }, abort.signal));
		abort.abort();
		expect(forwardedSignal?.aborted).toBe(true);
	});

	test("passes non-stream responses, tool loops, and upstream errors through", async () => {
		const responses = [
			Response.json({
				id: "resp_1",
				output: [{ type: "function_call", call_id: "c1" }],
			}),
			Response.json({ id: "resp_2", output: [{ type: "message" }] }),
			Response.json({ error: { type: "upstream_error" } }, { status: 502 }),
		];
		const handler = createGatewayFetchHandler({
			upstreamHandler: async () => responses.shift() as Response,
		});
		const first = await handler(request({ model: "gpt-5.6-sol", input: [] }));
		const second = await handler(
			request({
				model: "gpt-5.6-sol",
				input: [
					{ type: "function_call_output", call_id: "c1", output: "done" },
				],
			}),
		);
		const error = await handler(request({ model: "gpt-5.6-sol", input: [] }));
		expect((await first.json()).id).toBe("resp_1");
		expect((await second.json()).id).toBe("resp_2");
		expect(error.status).toBe(502);
	});

	test("logs metadata only and captures non-stream token usage", async () => {
		const events: DiagnosticEvent[] = [];
		const handler = createGatewayFetchHandler({
			upstreamHandler: async () =>
				Response.json({
					output: [{ content: "secret answer" }],
					usage: {
						input_tokens: 4,
						output_tokens: 2,
						total_tokens: 6,
					},
				}),
			diagnosticLogger: (event) => events.push(event),
			requestId: () => "req-safe",
			now: () => 10,
		});
		await handler(
			request({
				model: "gpt-5.6-sol",
				input: [{ role: "user", content: "secret prompt" }],
				tools: [{ name: "secret_tool", arguments: "secret argument" }],
				prompt_cache_options: { mode: "explicit" },
			}),
		);
		await vi.waitFor(() => expect(events).toHaveLength(2));
		expect(events[1]).toMatchObject({
			type: "responses_response",
			requestId: "req-safe",
			status: 200,
			usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
		});
		const serialized = JSON.stringify(events);
		expect(serialized).not.toContain("secret prompt");
		expect(serialized).not.toContain("secret answer");
		expect(serialized).not.toContain("secret_tool");
		expect(serialized).not.toContain("secret argument");
	});

	test("does not add Host or Origin restrictions", async () => {
		let forwarded: Request | undefined;
		const handler = createGatewayFetchHandler({
			upstreamHandler: async (request) => {
				forwarded = request;
				return new Response("ok");
			},
		});
		const input = new Request("http://127.0.0.1/v1/responses", {
			method: "POST",
			headers: {
				Host: "example.test",
				Origin: "https://example.test",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ model: "gpt-5.6-sol" }),
		});
		expect((await handler(input)).status).toBe(200);
		expect(forwarded?.headers.get("host")).toBe("example.test");
		expect(forwarded?.headers.get("origin")).toBe("https://example.test");
	});
});
