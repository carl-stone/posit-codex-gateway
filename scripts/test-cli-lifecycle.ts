import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
		"--oauth-file",
		authFilePath,
	]);
	if (!started.stdout.includes("Available Models: gpt-5.6-sol")) {
		throw new Error(`Unexpected detach output: ${started.stdout}`);
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
	await rm(root, { recursive: true, force: true });
}
