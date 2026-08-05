import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
const require = createRequire(import.meta.url);

const resolveOAuthPackageJson = (): string | undefined => {
	for (const packageName of ["openai-oauth", "@carl-stone/openai-oauth"]) {
		try {
			let directory = path.dirname(require.resolve(packageName));
			while (directory !== path.dirname(directory)) {
				const candidate = path.join(directory, "package.json");
				if (existsSync(candidate)) return candidate;
				directory = path.dirname(directory);
			}
		} catch {
			// Try the next install layout.
		}
	}
	return undefined;
};

export const runDoctor = async () => {
	const positRoot =
		process.env.POSIT_ASSISTANT_ROOT ??
		path.join(os.homedir(), ".local", "share", "rstudio", "pai", "bin");
	const oauthPackageJson = resolveOAuthPackageJson();
	const [gateway, oauth, posit, protocol, health] = await Promise.all([
		readJson<PackageInfo>(path.join(packageRoot, "package.json")),
		oauthPackageJson == null
			? Promise.resolve(undefined)
			: readJson<PackageInfo>(oauthPackageJson),
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
