#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDoctor } from "./doctor.js";
import { runUpstreamCli } from "./upstream-cli.js";

const argv = process.argv.slice(2);
const packageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

if (argv.includes("--version")) {
	const packageJson = JSON.parse(
		await readFile(path.join(packageRoot, "package.json"), "utf8"),
	) as { version: string };
	console.log(packageJson.version);
} else if (argv[0] === "doctor") {
	const report = await runDoctor();
	console.log(JSON.stringify(report, null, 2));
	process.exitCode =
		report.codexContract.compatible && report.positAssistant.protocol === "11.0"
			? 0
			: 1;
} else {
	await runUpstreamCli(argv);
}
