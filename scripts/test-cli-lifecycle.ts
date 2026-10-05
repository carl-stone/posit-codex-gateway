import { execFile } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), "r-assistant-gateway-cli-"));
const runtimeDirectory = path.join(root, "runtime");
const authFilePath = path.join(root, "auth.json");
const positRoot = path.join(root, "posit-assistant");
const cliPath = path.resolve(
	process.env.GATEWAY_TEST_CLI_PATH ?? "dist/cli.js",
);
const packageVersion = (
	JSON.parse(await readFile("package.json", "utf8")) as { version: string }
).version;
const positRequest = JSON.parse(
	await readFile("test/fixtures/responses-request.json", "utf8"),
) as Record<string, unknown>;
// Synthetic fixture based on the 1.6 Assistant client, not a captured conversation.
const posit16Request = JSON.parse(
	await readFile("test/fixtures/responses-request-1.6.json", "utf8"),
) as Record<string, unknown>;
const env = {
	...process.env,
	POSITRON_EXTENSIONS_DIR: path.join(root, "extensions"),
	R_ASSISTANT_GATEWAY_INTERNAL_RUNTIME_DIR: runtimeDirectory,
	POSIT_ASSISTANT_ROOT: positRoot,
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

await mkdir(positRoot);
await Promise.all([
	writeFile(
		authFilePath,
		JSON.stringify({
			tokens: { access_token: "test-token", account_id: "test-account" },
		}),
	),
	writeFile(
		path.join(positRoot, "package.json"),
		JSON.stringify({ version: "1.6.1" }),
	),
]);

const run = (args: string[]) =>
	execute(process.execPath, [cliPath, ...args], { env, timeout: 15_000 });

try {
	const version = await run(["--version"]);
	if (version.stdout.trim() !== packageVersion) {
		throw new Error(`Unexpected version output: ${version.stdout}`);
	}

	const started = await run([
		"--detach",
		"--port",
		"0",
		"--models",
		"gpt-5.6-sol,gpt-6-astra",
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
	if (
		process.platform !== "win32" &&
		((await stat(authFilePath)).mode & 0o777) !== 0o600
	) {
		throw new Error("Gateway did not restrict OAuth credential permissions.");
	}
	const doctor = JSON.parse((await run(["doctor"])).stdout) as {
		compatibility: { supported: boolean };
		localHealth: { reachable: boolean; url: string };
	};
	if (
		!doctor.compatibility.supported ||
		!doctor.localHealth.reachable ||
		doctor.localHealth.url !== `${gatewayUrl.replace(/\/v1$/, "")}/health`
	) {
		throw new Error("Doctor did not recognize the active compatible gateway.");
	}
	const modelsResponse = await fetch(`${gatewayUrl}/models`, {
		headers: { Authorization: "Bearer local-gateway" },
	});
	const models = (await modelsResponse.json()) as {
		data?: Array<{ id?: string }>;
	};
	if (
		!modelsResponse.ok ||
		!models.data?.some((model) => model.id === "gpt-5.6-sol") ||
		!models.data?.some((model) => model.id === "gpt-6-astra")
	) {
		throw new Error("Gateway did not support placeholder-key model discovery.");
	}
	const missingContinuation = await fetch(`${gatewayUrl}/responses`, {
		method: "POST",
		headers: {
			Authorization: "Bearer local-gateway",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "gpt-5.6-sol",
			previous_response_id: "missing-response",
			input: [{ role: "user", content: "continue" }],
		}),
	});
	const missingContinuationBody = (await missingContinuation.json()) as {
		error?: { code?: string };
	};
	if (
		missingContinuation.status !== 400 ||
		missingContinuationBody.error?.code !== "response_state_not_found"
	) {
		throw new Error(
			"Gateway silently discarded unresolved continuation state.",
		);
	}
	const gatewayResponse = await fetch(`${gatewayUrl}/responses`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(positRequest),
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
	const serializedForwardedBody = JSON.stringify(forwardedBody);
	const adaptationFailures = [
		forwardedBody.prompt_cache_key !== "test-session" && "cache key changed",
		"max_output_tokens" in forwardedBody && "output limit remained",
		"prompt_cache_options" in forwardedBody && "cache options remained",
		serializedForwardedBody.includes("prompt_cache_breakpoint") &&
			"cache breakpoint remained",
		!serializedForwardedBody.includes(
			'"output":[{"type":"input_text","text":"model summary"}]',
		) && "structured function output changed",
	].filter(Boolean);
	if (adaptationFailures.length > 0) {
		throw new Error(
			`Detached gateway did not adapt the Posit 1.3.0 request correctly: ${adaptationFailures.join(", ")}.`,
		);
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

	const posit16Response = await fetch(`${gatewayUrl}/responses`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(posit16Request),
	});
	if (
		!posit16Response.ok ||
		!(await posit16Response.text()).includes("response.completed")
	) {
		throw new Error("Gateway rejected the synthetic Assistant 1.6 request.");
	}
	const forwarded16 = receivedBodies[2];
	const serialized16 = JSON.stringify(forwarded16);
	if (
		forwarded16?.model !== "gpt-6-astra" ||
		JSON.stringify(forwarded16.tools) !==
			JSON.stringify(posit16Request.tools) ||
		forwarded16.prompt_cache_key !== "test-session-1.6" ||
		serialized16.includes("prompt_cache_breakpoint") ||
		serialized16.includes("prompt_cache_options") ||
		serialized16.includes("max_output_tokens") ||
		JSON.stringify(forwarded16.reasoning) !==
			JSON.stringify({
				effort: "xhigh",
				summary: "detailed",
				context: "all_turns",
			})
	) {
		throw new Error(
			"Gateway changed the Assistant 1.6 model, tools, or reasoning.",
		);
	}
	const forwarded16Input = forwarded16.input as Array<Record<string, unknown>>;
	const expected16Input = posit16Request.input as Array<
		Record<string, unknown>
	>;
	for (const index of [1, 2, 3]) {
		if (
			JSON.stringify(forwarded16Input[index]) !==
			JSON.stringify(expected16Input[index])
		) {
			throw new Error(
				"Gateway changed the Assistant 1.6 file, reasoning, or patch payload.",
			);
		}
	}
	if (
		JSON.stringify(forwarded16Input[4]) !==
		JSON.stringify({
			type: "function_call_output",
			call_id: "call_patch",
			output: [{ type: "input_text", text: "Applied patch to analysis.R." }],
		})
	) {
		throw new Error(
			"Gateway changed the Assistant 1.6 structured patch result.",
		);
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
	await writeFile(
		path.join(runtimeDirectory, "runtime.json"),
		JSON.stringify({ url: gatewayUrl }),
	);
	try {
		await run(["doctor"]);
		throw new Error("doctor unexpectedly succeeded after stop");
	} catch (error) {
		const result = error as { stdout?: string };
		if (!result.stdout?.includes('"reachable": false')) throw error;
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
