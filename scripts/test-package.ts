import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check through npm run test:package.");
const root = await mkdtemp(
	path.join(os.tmpdir(), "r-assistant-gateway-package-"),
);
const consumer = path.join(root, "consumer");
const npm = (args: string[]) =>
	execute(process.execPath, [npmCli, ...args], {
		// An outer npm pack/publish --dry-run must not suppress the temporary
		// archive and consumer install that this verification actually exercises.
		env: { ...process.env, npm_config_dry_run: "false" },
		timeout: 60_000,
		maxBuffer: 5 * 1024 * 1024,
	});

try {
	// Avoid prepack -> verify -> test:package recursion. verify already built dist.
	const packed = JSON.parse(
		(
			await npm([
				"pack",
				"--ignore-scripts",
				"--json",
				"--pack-destination",
				root,
			])
		).stdout,
	) as Array<{ filename: string }>;
	const filename = packed[0]?.filename;
	if (!filename) throw new Error("npm pack did not produce an archive.");
	await npm([
		"install",
		"--prefix",
		consumer,
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		path.join(root, filename),
	]);
	const installed = path.join(consumer, "node_modules", "r-assistant-gateway");
	const runtimeRequire = createRequire(path.join(installed, "package.json"));
	const providerRequire = createRequire(
		runtimeRequire.resolve("@openai-oauth/ai-sdk"),
	);
	const utilsEntry = providerRequire.resolve("@ai-sdk/provider-utils");
	const utils = JSON.parse(
		await readFile(
			path.join(path.dirname(utilsEntry), "..", "package.json"),
			"utf8",
		),
	) as { version: string };
	const gateway = JSON.parse(await readFile("package.json", "utf8")) as {
		overrides: { "@openai-oauth/ai-sdk": { "@ai-sdk/provider-utils": string } };
	};
	if (
		utils.version !==
		gateway.overrides["@openai-oauth/ai-sdk"]["@ai-sdk/provider-utils"]
	) {
		throw new Error(
			`Packaged install lost the security override: ${utils.version}.`,
		);
	}
	await npm(["audit", "--prefix", consumer, "--omit=dev", "--json"]);
	await execute(
		process.execPath,
		["--import", "tsx", "scripts/test-cli-lifecycle.ts"],
		{
			env: {
				...process.env,
				GATEWAY_TEST_CLI_PATH: path.join(installed, "dist", "cli.js"),
			},
			timeout: 90_000,
		},
	);
	console.log("Packaged install audit and detached CLI lifecycle passed.");
} finally {
	await rm(root, { recursive: true, force: true });
}
