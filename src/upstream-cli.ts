import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { adaptResponsesBody, isJsonObject } from "./adapter.js";
import {
	createStderrDiagnosticLogger,
	type DiagnosticLogger,
	extractUsage,
} from "./diagnostics.js";

const DEFAULT_PORT = 10532;

const UPSTREAM_RUNTIME_DIRECTORY_VARIABLE = "OPENAI_OAUTH_INTERNAL_RUNTIME_DIR";
const GATEWAY_RUNTIME_DIRECTORY_VARIABLE =
	"POSIT_CODEX_GATEWAY_INTERNAL_RUNTIME_DIR";

export const brandUpstreamCliText = (text: string): string => {
	const help =
		text.startsWith("Free OpenAI API access with your ChatGPT account.") &&
		text.includes("\nUsage\n");
	const branded = help
		? text
				.replaceAll(
					"npx @carl-stone/openai-oauth@latest",
					"npx posit-codex-gateway@latest",
				)
				.replaceAll("npx openai-oauth@latest", "npx posit-codex-gateway@latest")
		: text;
	return branded
		.replace(
			"Free OpenAI API access with your ChatGPT account.",
			"Use RStudio Posit Assistant with your ChatGPT account.",
		)
		.replaceAll("npx openai-oauth stop", "npx posit-codex-gateway stop")
		.replaceAll("npx openai-oauth logs", "npx posit-codex-gateway logs")
		.replaceAll("npx openai-oauth login", "npx posit-codex-gateway login")
		.replaceAll(
			"npx @carl-stone/openai-oauth stop",
			"npx posit-codex-gateway stop",
		)
		.replaceAll(
			"npx @carl-stone/openai-oauth logs",
			"npx posit-codex-gateway logs",
		)
		.replaceAll(
			"npx @carl-stone/openai-oauth login",
			"npx posit-codex-gateway login",
		)
		.replace(
			"Start with `npx openai-oauth`",
			"Start with `npx posit-codex-gateway`",
		)
		.replace(
			"Start with `npx @carl-stone/openai-oauth`",
			"Start with `npx posit-codex-gateway`",
		)
		.replaceAll("Proxy port. Default: 10531.", "Proxy port. Default: 10532.")
		.replace("Default: stateless.", "Default: memory in posit-codex-gateway.")
		.replace(
			"  npx posit-codex-gateway@latest login [options]",
			"  npx posit-codex-gateway@latest login [options]\n  npx posit-codex-gateway@latest doctor",
		)
		.replace(
			"  --login-timeout-ms <ms>    Login timeout. Default: 300000",
			"  --login-timeout-ms <ms>    Login timeout. Default: 300000\n  --diagnostics              Emit adapter metadata to stderr.",
		)
		.replace(/Show version \([^)]+\)/g, "Show gateway version");
};

const installCliOutputBranding = (): void => {
	const log = console.log.bind(console);
	const info = console.info.bind(console);
	const warn = console.warn.bind(console);
	const error = console.error.bind(console);
	const branded = (values: unknown[]): unknown[] =>
		values.map((value) =>
			typeof value === "string" ? brandUpstreamCliText(value) : value,
		);
	console.log = (...values) => log(...branded(values));
	console.info = (...values) => info(...branded(values));
	console.warn = (...values) => warn(...branded(values));
	console.error = (...values) => error(...branded(values));
};

const defaultRuntimeDirectory = (): string => {
	if (process.platform === "darwin") {
		return path.join(
			os.homedir(),
			"Library",
			"Application Support",
			"posit-codex-gateway",
		);
	}
	if (process.platform === "win32") {
		return path.join(
			process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
			"posit-codex-gateway",
		);
	}
	return path.join(
		process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
		"posit-codex-gateway",
	);
};

export const prepareUpstreamCliArgv = (
	argv: string[],
): { argv: string[]; diagnostics: boolean } => {
	const diagnostics =
		argv.includes("--diagnostics") ||
		process.env.POSIT_CODEX_GATEWAY_DIAGNOSTICS === "1";
	const forwarded = argv.filter((argument) => argument !== "--diagnostics");
	const first = forwarded[0];
	const serves =
		first === undefined || first === "serve" || first.startsWith("-");
	const hasPort = forwarded.some(
		(argument) => argument === "--port" || argument.startsWith("--port="),
	);
	if (serves && !hasPort) forwarded.push("--port", String(DEFAULT_PORT));
	const hasResponsesState = forwarded.some(
		(argument) =>
			argument === "--responses-state" ||
			argument.startsWith("--responses-state="),
	);
	if (serves && !hasResponsesState) {
		forwarded.push("--responses-state", "memory");
	}
	return { argv: forwarded, diagnostics };
};

const toBodyText = async (
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
): Promise<string | undefined> => {
	if (typeof init?.body === "string") return init.body;
	if (input instanceof Request && init?.body === undefined && input.body) {
		return input.clone().text();
	}
	return undefined;
};

const adaptedFetchInput = async (
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
	logger?: DiagnosticLogger,
): Promise<
	| {
			input: Parameters<typeof fetch>[0];
			init: Parameters<typeof fetch>[1];
			requestId: string;
			model?: string | undefined;
	  }
	| undefined
> => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	const method = (
		init?.method ?? (input instanceof Request ? input.method : "GET")
	).toUpperCase();
	if (method !== "POST" || !url.pathname.endsWith("/responses")) {
		return undefined;
	}

	const bodyText = await toBodyText(input, init);
	if (bodyText === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyText);
	} catch {
		return undefined;
	}
	if (!isJsonObject(parsed)) return undefined;

	const adapted = adaptResponsesBody(parsed);
	const headers = new Headers(
		init?.headers ?? (input instanceof Request ? input.headers : undefined),
	);
	headers.delete("content-length");
	const requestId = crypto.randomUUID();
	const model =
		typeof adapted.body.model === "string" ? adapted.body.model : undefined;
	logger?.({
		type: "responses_request",
		requestId,
		model,
		removedFieldPaths: adapted.removedFieldPaths,
		promptCacheBreakpointCount: adapted.promptCacheBreakpointCount,
	});

	const nextInit = {
		...init,
		method,
		headers,
		body: JSON.stringify(adapted.body),
	};
	return input instanceof Request
		? {
				input: new Request(input, nextInit),
				init: undefined,
				requestId,
				model,
			}
		: { input, init: nextInit, requestId, model };
};

export const installUpstreamFetchAdapter = (
	logger?: DiagnosticLogger,
): (() => void) => {
	const upstreamFetch = globalThis.fetch.bind(globalThis);
	globalThis.fetch = async (input, init) => {
		const startedAt = Date.now();
		const adapted = await adaptedFetchInput(input, init, logger);
		try {
			const response = await upstreamFetch(
				adapted?.input ?? input,
				adapted?.init ?? init,
			);
			if (adapted && logger) {
				const event = {
					type: "responses_response" as const,
					requestId: adapted.requestId,
					model: adapted.model,
					status: response.status,
					durationMs: Date.now() - startedAt,
				};
				const contentType = response.headers.get("content-type") ?? "";
				if (!contentType.includes("text/event-stream")) {
					void response
						.clone()
						.json()
						.then((body) => logger({ ...event, usage: extractUsage(body) }))
						.catch(() => logger(event));
				} else {
					logger(event);
				}
			}
			return response;
		} catch (error) {
			if (adapted && logger) {
				logger({
					type: "responses_error",
					requestId: adapted.requestId,
					model: adapted.model,
					status: 0,
					durationMs: Date.now() - startedAt,
				});
			}
			throw error;
		}
	};
	return () => {
		globalThis.fetch = upstreamFetch;
	};
};

const resolveUpstreamCliPath = (): string => {
	const require = createRequire(import.meta.url);
	const indexPath = require.resolve("openai-oauth");
	return path.join(path.dirname(indexPath), "cli.js");
};

export const runUpstreamCli = async (argv: string[]): Promise<void> => {
	const prepared = prepareUpstreamCliArgv(argv);
	process.env[UPSTREAM_RUNTIME_DIRECTORY_VARIABLE] =
		process.env[GATEWAY_RUNTIME_DIRECTORY_VARIABLE] ??
		defaultRuntimeDirectory();
	if (prepared.diagnostics) {
		process.env.POSIT_CODEX_GATEWAY_DIAGNOSTICS = "1";
	}
	process.argv = [
		process.argv[0] ?? process.execPath,
		process.argv[1] ?? "",
		...prepared.argv,
	];
	installCliOutputBranding();
	installUpstreamFetchAdapter(
		prepared.diagnostics ? createStderrDiagnosticLogger() : undefined,
	);
	// The installed upstream CLI remains responsible for parsing, login, process
	// lifecycle, logs, status, and stop. Its detached child re-enters this file.
	await import(pathToFileURL(resolveUpstreamCliPath()).href);
};
