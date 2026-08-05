import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PackageInfo = { version?: string };
type ProtocolInfo = { protocol?: string };

const readJson = async <T>(file: string): Promise<T | undefined> => {
	try {
		return JSON.parse(await readFile(file, "utf8")) as T;
	} catch {
		return undefined;
	}
};

const packageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

export const runDoctor = async () => {
	const positRoot =
		process.env.POSIT_ASSISTANT_ROOT ??
		path.join(os.homedir(), ".local", "share", "rstudio", "pai", "bin");
	const [gateway, oauth, posit, protocol, health] = await Promise.all([
		readJson<PackageInfo>(path.join(packageRoot, "package.json")),
		readJson<PackageInfo>(
			path.join(packageRoot, "node_modules", "openai-oauth", "package.json"),
		),
		readJson<PackageInfo>(path.join(positRoot, "package.json")),
		readJson<ProtocolInfo>(path.join(positRoot, "protocol.json")),
		fetch("http://127.0.0.1:10532/health", {
			signal: AbortSignal.timeout(2_000),
		})
			.then(async (response) => ({
				reachable: response.ok,
				status: response.status,
				body: await response.json().catch(() => undefined),
			}))
			.catch(() => ({ reachable: false })),
	]);

	return {
		gatewayVersion: gateway?.version ?? "unknown",
		openaiOauthVersion: oauth?.version ?? "unknown",
		positAssistant: {
			version: posit?.version ?? "not installed",
			protocol: protocol?.protocol ?? "unknown",
			path: positRoot,
		},
		localHealth: health,
	};
};
