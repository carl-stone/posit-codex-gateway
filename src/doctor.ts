import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGatewayRuntimeDirectory } from "./upstream-cli.js";

type PackageInfo = { version?: string; name?: string; publisher?: string };
type RuntimeInfo = { url?: string };

// Both IDEs use the same Assistant Responses contract. Keep recognition explicit:
// an unknown release is unvalidated, not necessarily incompatible.
export const SUPPORTED_POSIT_ASSISTANT_VERSIONS: readonly string[] = [
	"1.3.0",
	"1.3.1",
	"1.6.0",
	"1.6.1",
];
export const SUPPORTED_POSIT_ASSISTANT_VERSION = "1.6.1";
export const SUPPORTED_POSITRON_ASSISTANT_VERSION =
	SUPPORTED_POSIT_ASSISTANT_VERSION;
export const SUPPORTED_OPENAI_OAUTH_VERSION = "2.0.0-memory.2";

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

const positAssistantRoots = (): string[] => {
	if (process.env.POSIT_ASSISTANT_ROOT) {
		return [process.env.POSIT_ASSISTANT_ROOT];
	}
	if (process.platform === "win32") {
		return [
			path.join(
				process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
				"rstudio",
				"pai",
				"bin",
			),
			path.join(
				process.env.PROGRAMDATA ?? "C:\\ProgramData",
				"rstudio",
				"pai",
				"bin",
			),
		];
	}
	return [
		path.join(
			process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
			"rstudio",
			"pai",
			"bin",
		),
		path.join("/etc", "rstudio", "pai", "bin"),
	];
};

type ExtensionEntry = {
	identifier?: { id?: string };
	relativeLocation?: string;
};

const detectPositronAssistant = async () => {
	const root =
		process.env.POSITRON_EXTENSIONS_DIR ??
		path.join(os.homedir(), ".positron", "extensions");
	const registry = await readJson<ExtensionEntry[]>(
		path.join(root, "extensions.json"),
	);
	const obsolete = await readJson<Record<string, boolean>>(
		path.join(root, ".obsolete"),
	);
	// Prefer the registry so leftover directories from an upgrade are not reported.
	const names = Array.isArray(registry)
		? registry
				.filter((entry) => entry.identifier?.id === "posit.assistant")
				.map((entry) => entry.relativeLocation)
				.filter((name): name is string => typeof name === "string")
		: (await readdir(root).catch(() => [])).filter((name) =>
				name.startsWith("posit.assistant-"),
			);
	const installations = await Promise.all(
		names
			.filter((name) => path.basename(name) === name && !obsolete?.[name])
			.map(async (name) => {
				const directory = path.join(root, name);
				const info = await readJson<PackageInfo>(
					path.join(directory, "package.json"),
				);
				if (
					info?.name !== "assistant" ||
					info.publisher !== "posit" ||
					typeof info.version !== "string"
				)
					return undefined;
				return { version: info.version, path: directory };
			}),
	);
	const found = installations.filter((item) => item !== undefined);
	found.sort((a, b) =>
		b.version.localeCompare(a.version, "en", { numeric: true }),
	);
	return found[0] ?? { version: "not installed", path: root };
};

export const runDoctor = async () => {
	const roots = positAssistantRoots();
	let positRoot = roots[0] ?? "";
	let posit: PackageInfo | undefined;
	for (const candidate of roots) {
		const candidatePackage = await readJson<PackageInfo>(
			path.join(candidate, "package.json"),
		);
		if (candidatePackage) {
			positRoot = candidate;
			posit = candidatePackage;
			break;
		}
	}

	const positronAssistant = await detectPositronAssistant();
	const oauthPackageJson = resolveOAuthPackageJson();
	const [gateway, oauth, runtime] = await Promise.all([
		readJson<PackageInfo>(path.join(packageRoot, "package.json")),
		oauthPackageJson == null
			? Promise.resolve(undefined)
			: readJson<PackageInfo>(oauthPackageJson),
		readJson<RuntimeInfo>(
			path.join(resolveGatewayRuntimeDirectory(), "runtime.json"),
		),
	]);

	let healthUrl = "http://127.0.0.1:10532/health";
	if (typeof runtime?.url === "string") {
		try {
			healthUrl = new URL("/health", runtime.url).href;
		} catch {
			// Fall back to the default gateway address for malformed stale state.
		}
	}
	const health = await fetch(healthUrl, {
		signal: AbortSignal.timeout(2_000),
	})
		.then(async (response) => {
			const body: unknown = await response.json().catch(() => undefined);
			const valid =
				typeof body === "object" &&
				body !== null &&
				"ok" in body &&
				body.ok === true &&
				"replay_state" in body &&
				body.replay_state === "memory";
			return {
				reachable: response.ok && valid,
				status: response.status,
				body,
				url: healthUrl,
				...(response.ok && !valid
					? { error: "Unexpected gateway health response." }
					: {}),
			};
		})
		.catch(() => ({ reachable: false, url: healthUrl }));

	const positVersion = posit?.version ?? "not installed";
	const oauthVersion = oauth?.version ?? "unknown";
	return {
		gatewayVersion: gateway?.version ?? "unknown",
		openaiOauthVersion: oauthVersion,
		positAssistant: {
			version: positVersion,
			path: positRoot,
		},
		positronAssistant,
		compatibility: {
			supported:
				(SUPPORTED_POSIT_ASSISTANT_VERSIONS.includes(positVersion) ||
					SUPPORTED_POSIT_ASSISTANT_VERSIONS.includes(
						positronAssistant.version,
					)) &&
				oauthVersion === SUPPORTED_OPENAI_OAUTH_VERSION,
			supportedPositAssistantVersions: SUPPORTED_POSIT_ASSISTANT_VERSIONS,
			expectedPositAssistantVersion: SUPPORTED_POSIT_ASSISTANT_VERSION,
			expectedPositronAssistantVersion: SUPPORTED_POSITRON_ASSISTANT_VERSION,
			expectedOpenaiOauthVersion: SUPPORTED_OPENAI_OAUTH_VERSION,
		},
		localHealth: health,
	};
};
