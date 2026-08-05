import http from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { type RunningGateway, startGatewayServer } from "../src/server.js";

const running: RunningGateway[] = [];
afterEach(async () => {
	await Promise.all(running.splice(0).map((server) => server.close()));
});

describe("Node HTTP bridge", () => {
	test("preserves streaming bytes and non-stream responses", async () => {
		const streamBody =
			'event: response.output_text.delta\ndata: {"delta":"hello"}\n\n';
		const server = await startGatewayServer({
			port: 0,
			upstreamHandler: async (request) => {
				const body = (await request.json()) as { stream?: boolean };
				return body.stream
					? new Response(streamBody, {
							headers: { "Content-Type": "text/event-stream" },
						})
					: Response.json({ id: "resp_1", status: "completed" });
			},
		});
		running.push(server);
		const streamed = await fetch(`${server.url}/responses`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: "gpt-5.6-sol", stream: true }),
		});
		expect(await streamed.text()).toBe(streamBody);
		const regular = await fetch(`${server.url}/responses`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: "gpt-5.6-sol", stream: false }),
		});
		expect(await regular.json()).toEqual({ id: "resp_1", status: "completed" });
	});

	test("propagates client cancellation to the wrapped Fetch request", async () => {
		let observedAbort: (() => void) | undefined;
		const aborted = new Promise<void>((resolve) => {
			observedAbort = resolve;
		});
		const server = await startGatewayServer({
			port: 0,
			upstreamHandler: async (request) => {
				request.signal.addEventListener("abort", () => observedAbort?.(), {
					once: true,
				});
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("first"));
						},
					}),
					{ headers: { "Content-Type": "text/event-stream" } },
				);
			},
		});
		running.push(server);
		const client = http.request(`${server.url}/responses`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
		client.write(JSON.stringify({ model: "gpt-5.6-sol", stream: true }));
		client.end();
		client.once("response", (response) => response.destroy());
		await expect(
			Promise.race([
				aborted,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("abort not propagated")), 1_000),
				),
			]),
		).resolves.toBeUndefined();
	});
});
