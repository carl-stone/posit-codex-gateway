#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStderrDiagnosticLogger } from "./diagnostics.js";
import { runDoctor } from "./doctor.js";
import { DEFAULT_PORT, startGatewayServer } from "./server.js";

const args = process.argv.slice(2);
const packageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const packageJson = JSON.parse(
	await readFile(path.join(packageRoot, "package.json"), "utf8"),
) as { version: string };

if (args.includes("--version") || args.includes("-v")) {
	console.log(packageJson.version);
	process.exit(0);
}

if (args[0] === "doctor") {
	const report = await runDoctor();
	console.log(JSON.stringify(report, null, 2));
	process.exit(
		report.codexContract.compatible && report.positAssistant.protocol === "11.0"
			? 0
			: 1,
	);
}

if (args.includes("--help") || args.includes("-h")) {
	console.log(`posit-codex-gateway ${packageJson.version}

Usage:
  posit-codex-gateway [--port 10532] [--diagnostics]
  posit-codex-gateway doctor

The gateway always binds to 127.0.0.1.`);
	process.exit(0);
}

const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : DEFAULT_PORT;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
	console.error("--port must be an integer between 0 and 65535.");
	process.exit(2);
}
const diagnostics =
	args.includes("--diagnostics") ||
	process.env.POSIT_CODEX_GATEWAY_DIAGNOSTICS === "1";
const gateway = await startGatewayServer({
	port,
	...(diagnostics ? { diagnosticLogger: createStderrDiagnosticLogger() } : {}),
});
console.log(
	`posit-codex-gateway ${packageJson.version} listening at ${gateway.url}`,
);

const close = async () => {
	await gateway.close();
	process.exit(0);
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
