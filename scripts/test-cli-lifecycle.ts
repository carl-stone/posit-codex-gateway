import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), "posit-codex-cli-"));
const runtimeDirectory = path.join(root, "runtime");
const authFilePath = path.join(root, "auth.json");
const cliPath = path.resolve("dist/cli.js");
const env = {
	...process.env,
	POSIT_CODEX_GATEWAY_INTERNAL_RUNTIME_DIR: runtimeDirectory,
};
const receivedBodies: Array<Record<string, unknown>> = [];
let responseRequestCount = 0;
const codexServer = createServer((request, response) => {
	if (request.method !== "POST" || request.url !== "/responses") {
		response.writeHead(404, { "content-type": "application/json" });
		response.end('{"error":{"message":"not found"}}');
		return;
	}
	const chunks: Buffer[] = [];
	request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
	request.on("end", () => {
		responseRequestCount += 1;
		receivedBodies.push(
			JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
				string,
				unknown
			>,
		);
		response.writeHead(200, { "content-type": "text/event-stream" });
		if (responseRequestCount === 1) {
			response.end(
				[
					'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_test","status":"in_progress"}}',
					'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_test","call_id":"call_test","name":"inspect_environment","arguments":"{}","status":"completed"}}',
					'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_test","status":"completed","output":[]}}',
					"",
				].join("\n\n"),
			);
			return;
		}
		response.end(
			'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_done","status":"completed","output":[]}}\n\n',
		);
	});
});
await new Promise<void>((resolve, reject) => {
	codexServer.once("error", reject);
	codexServer.listen(0, "127.0.0.1", () => {
		codexServer.off("error", reject);
		resolve();
	});
});
const codexPort = (codexServer.address() as AddressInfo).port;

await writeFile(
	authFilePath,
	JSON.stringify({
		tokens: { access_token: "test-token", account_id: "test-account" },
	}),
);

const run = (args: string[]) =>
	execute(process.execPath, [cliPath, ...args], { env, timeout: 15_000 });

try {
	const version = await run(["--version"]);
	if (version.stdout.trim() !== "0.1.0") {
		throw new Error(`Unexpected version output: ${version.stdout}`);
	}

	const started = await run([
		"--detach",
		"--port",
		"0",
		"--models",
		"gpt-5.6-sol",
		"--base-url",
		`http://127.0.0.1:${codexPort}`,
		"--oauth-file",
		authFilePath,
	]);
	if (!started.stdout.includes("Available Models: gpt-5.6-sol")) {
		throw new Error(`Unexpected detach output: ${started.stdout}`);
	}
	const gatewayUrl = started.stdout.match(/http:\/\/127\.0\.0\.1:\d+\/v1/)?.[0];
	if (!gatewayUrl) {
		throw new Error(`Could not find detached gateway URL: ${started.stdout}`);
	}
	const gatewayResponse = await fetch(`${gatewayUrl}/responses`, {
		method: "POST",
		headers: { "content-type": "application/json" },
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
	});
	if (!gatewayResponse.ok) {
		throw new Error(
			`Detached gateway returned HTTP ${gatewayResponse.status}.`,
		);
	}
	if (!(await gatewayResponse.text()).includes("response.completed")) {
		throw new Error(
			"Detached gateway did not preserve the streaming response.",
		);
	}
	const forwardedBody = receivedBodies[0];
	if (!forwardedBody) {
		throw new Error("Detached gateway did not forward a Responses request.");
	}
	if (
		forwardedBody.prompt_cache_key !== "posit-session" ||
		"prompt_cache_options" in forwardedBody ||
		JSON.stringify(forwardedBody).includes("prompt_cache_breakpoint")
	) {
		throw new Error("Detached gateway did not apply the Posit adapter.");
	}

	const continuationResponse = await fetch(`${gatewayUrl}/responses`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model: "gpt-5.6-sol",
			input: [
				{ type: "item_reference", id: "fc_test" },
				{
					type: "function_call_output",
					call_id: "call_test",
					output: '{"objects":["fit","counts"]}',
				},
			],
			stream: true,
		}),
	});
	if (!continuationResponse.ok) {
		throw new Error(
			`Detached gateway rejected a tool continuation with HTTP ${continuationResponse.status}.`,
		);
	}
	await continuationResponse.text();
	const continuedBody = receivedBodies[1];
	if (
		!continuedBody ||
		JSON.stringify(continuedBody).includes("item_reference") ||
		!JSON.stringify(continuedBody).includes('"function_call"') ||
		!JSON.stringify(continuedBody).includes('"function_call_output"')
	) {
		throw new Error("Detached gateway did not replay the tool continuation.");
	}

	const status = await run(["status"]);
	if (!status.stdout.includes("is running at")) {
		throw new Error(`Unexpected status output: ${status.stdout}`);
	}

	const logs = await run(["logs"]);
	if (!logs.stdout.includes("started at")) {
		throw new Error(`Unexpected logs output: ${logs.stdout}`);
	}

	const stopped = await run(["stop"]);
	if (!stopped.stdout.includes("stopped")) {
		throw new Error(`Unexpected stop output: ${stopped.stdout}`);
	}

	try {
		await run(["status"]);
		throw new Error("status unexpectedly succeeded after stop");
	} catch (error) {
		const result = error as { stdout?: string };
		if (!result.stdout?.includes("not running")) throw error;
	}

	console.log("Detached CLI lifecycle passed.");
} finally {
	await run(["stop"]).catch(() => undefined);
	await new Promise<void>((resolve, reject) => {
		codexServer.close((error) => (error ? reject(error) : resolve()));
	});
	await rm(root, { recursive: true, force: true });
}
