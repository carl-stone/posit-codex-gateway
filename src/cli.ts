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
  posit-codex-gateway [options]
  posit-codex-gateway doctor

Options:
  --host <host>              Proxy host. Default: 127.0.0.1.
  --port <port>              Proxy port. Default: 10532.
  --models <ids>             Comma-separated model ids.
  --codex-version <version>  Override the Codex client version.
  --base-url <url>           Override the upstream Codex base URL.
  --oauth-client-id <id>     Override the OAuth client id.
  --oauth-token-url <url>    Override the OAuth token URL.
  --oauth-file <path>        Path to the local auth.json file.
  --diagnostics              Emit adapter metadata to stderr.`);
	process.exit(0);
}

const option = (name: string): string | undefined => {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
};

const portValue = option("--port");
const port = portValue === undefined ? DEFAULT_PORT : Number(portValue);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
	console.error("--port must be an integer between 0 and 65535.");
	process.exit(2);
}
const models = option("--models")
	?.split(",")
	.map((model) => model.trim())
	.filter(Boolean);
const host = option("--host");
const codexVersion = option("--codex-version");
const baseURL = option("--base-url");
const clientId = option("--oauth-client-id");
const tokenUrl = option("--oauth-token-url");
const authFilePath = option("--oauth-file");
const diagnostics =
	args.includes("--diagnostics") ||
	process.env.POSIT_CODEX_GATEWAY_DIAGNOSTICS === "1";
const gateway = await startGatewayServer({
	...(host ? { host } : {}),
	port,
	...(models?.length ? { models } : {}),
	...(codexVersion ? { codexVersion } : {}),
	...(baseURL ? { baseURL } : {}),
	...(clientId ? { clientId } : {}),
	...(tokenUrl ? { tokenUrl } : {}),
	...(authFilePath ? { authFilePath } : {}),
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
