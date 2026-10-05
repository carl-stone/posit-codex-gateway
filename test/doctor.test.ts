import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	runDoctor,
	SUPPORTED_OPENAI_OAUTH_VERSION,
	SUPPORTED_POSIT_ASSISTANT_VERSION,
	SUPPORTED_POSIT_ASSISTANT_VERSIONS,
} from "../src/doctor.js";

let positRoot: string;
let runtimeRoot: string;
const originalExtensionsRoot = process.env.POSITRON_EXTENSIONS_DIR;
const originalPositRoot = process.env.POSIT_ASSISTANT_ROOT;
const originalRuntimeRoot =
	process.env.R_ASSISTANT_GATEWAY_INTERNAL_RUNTIME_DIR;

beforeEach(async () => {
	positRoot = await mkdtemp(path.join(os.tmpdir(), "posit-assistant-doctor-"));
	runtimeRoot = path.join(positRoot, "runtime");
	await mkdir(runtimeRoot);
	process.env.POSIT_ASSISTANT_ROOT = positRoot;
	process.env.POSITRON_EXTENSIONS_DIR = path.join(positRoot, "extensions");
	process.env.R_ASSISTANT_GATEWAY_INTERNAL_RUNTIME_DIR = runtimeRoot;
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ ok: true, replay_state: "memory" })),
	);
});

afterEach(async () => {
	if (originalExtensionsRoot === undefined)
		delete process.env.POSITRON_EXTENSIONS_DIR;
	else process.env.POSITRON_EXTENSIONS_DIR = originalExtensionsRoot;
	if (originalPositRoot === undefined) {
		delete process.env.POSIT_ASSISTANT_ROOT;
	} else {
		process.env.POSIT_ASSISTANT_ROOT = originalPositRoot;
	}
	if (originalRuntimeRoot === undefined) {
		delete process.env.R_ASSISTANT_GATEWAY_INTERNAL_RUNTIME_DIR;
	} else {
		process.env.R_ASSISTANT_GATEWAY_INTERNAL_RUNTIME_DIR = originalRuntimeRoot;
	}
	vi.unstubAllGlobals();
	await rm(positRoot, { recursive: true, force: true });
});

describe("doctor gateway compatibility", () => {
	test("ignores the unrelated RStudio integration protocol", async () => {
		await Promise.all([
			writeFile(
				path.join(positRoot, "package.json"),
				JSON.stringify({ version: SUPPORTED_POSIT_ASSISTANT_VERSION }),
			),
			writeFile(
				path.join(positRoot, "protocol.json"),
				JSON.stringify({ protocol: "99.0" }),
			),
		]);

		const report = await runDoctor();

		expect(report.positAssistant).toEqual({
			version: SUPPORTED_POSIT_ASSISTANT_VERSION,
			path: positRoot,
		});
		expect(report.compatibility).toMatchObject({
			supported: true,
			expectedPositAssistantVersion: SUPPORTED_POSIT_ASSISTANT_VERSION,
			expectedPositronAssistantVersion: SUPPORTED_POSIT_ASSISTANT_VERSION,
			supportedPositAssistantVersions: SUPPORTED_POSIT_ASSISTANT_VERSIONS,
			expectedOpenaiOauthVersion: SUPPORTED_OPENAI_OAUTH_VERSION,
		});
		expect(report.localHealth).toMatchObject({ reachable: true, status: 200 });
	});

	test("reports an untested Posit Assistant version", async () => {
		await writeFile(
			path.join(positRoot, "package.json"),
			JSON.stringify({ version: "1.7.0" }),
		);

		const report = await runDoctor();

		expect(report.compatibility).toMatchObject({
			supported: false,
			expectedPositAssistantVersion: SUPPORTED_POSIT_ASSISTANT_VERSION,
			expectedOpenaiOauthVersion: SUPPORTED_OPENAI_OAUTH_VERSION,
		});
	});

	test("rejects an unrelated HTTP service on the gateway port", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ ok: true })),
		);
		await writeFile(
			path.join(positRoot, "package.json"),
			JSON.stringify({ version: SUPPORTED_POSIT_ASSISTANT_VERSION }),
		);

		const report = await runDoctor();

		expect(report.localHealth).toMatchObject({
			reachable: false,
			error: "Unexpected gateway health response.",
		});
	});

	test("checks the active gateway URL from runtime state", async () => {
		await Promise.all([
			writeFile(
				path.join(positRoot, "package.json"),
				JSON.stringify({ version: SUPPORTED_POSIT_ASSISTANT_VERSION }),
			),
			writeFile(
				path.join(runtimeRoot, "runtime.json"),
				JSON.stringify({ url: "http://127.0.0.1:15432/v1" }),
			),
		]);

		const report = await runDoctor();

		expect(fetch).toHaveBeenCalledWith(
			"http://127.0.0.1:15432/health",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(report.localHealth).toMatchObject({
			reachable: true,
			url: "http://127.0.0.1:15432/health",
		});
	});
});

const installExtension = async (version: string) => {
	const name = `posit.assistant-${version}-universal`;
	const directory = path.join(positRoot, "extensions", name);
	await mkdir(directory, { recursive: true });
	await writeFile(
		path.join(directory, "package.json"),
		JSON.stringify({ name: "assistant", publisher: "posit", version }),
	);
	return { name, directory };
};

test.each(SUPPORTED_POSIT_ASSISTANT_VERSIONS)(
	"recognizes Assistant %s in either IDE",
	async (version) => {
		await writeFile(
			path.join(positRoot, "package.json"),
			JSON.stringify({ version }),
		);
		expect((await runDoctor()).compatibility.supported).toBe(true);

		await rm(path.join(positRoot, "package.json"));
		await installExtension(version);
		const report = await runDoctor();
		expect(report.positAssistant.version).toBe("not installed");
		expect(report.positronAssistant.version).toBe(version);
		expect(report.compatibility.supported).toBe(true);
	},
);

test("supports Positron without an RStudio installation", async () => {
	const extension = await installExtension("1.3.1");
	const report = await runDoctor();
	expect(report.positAssistant.version).toBe("not installed");
	expect(report.positronAssistant).toEqual({
		version: "1.3.1",
		path: extension.directory,
	});
	expect(report.compatibility.supported).toBe(true);
});

test("reports both IDEs and accepts Positron alongside an older RStudio Assistant", async () => {
	await writeFile(
		path.join(positRoot, "package.json"),
		JSON.stringify({ version: "0.9.8" }),
	);
	await installExtension("1.3.1");
	const report = await runDoctor();
	expect(report.positAssistant.version).toBe("0.9.8");
	expect(report.positronAssistant.version).toBe("1.3.1");
	expect(report.compatibility.supported).toBe(true);
});

test("does not let an old supported extension mask a newer untested registered version", async () => {
	await installExtension("1.3.1");
	const current = await installExtension("1.4.0");
	await writeFile(
		path.join(positRoot, "extensions", "extensions.json"),
		JSON.stringify([
			{ identifier: { id: "posit.assistant" }, relativeLocation: current.name },
		]),
	);
	const report = await runDoctor();
	expect(report.positronAssistant.version).toBe("1.4.0");
	expect(report.compatibility.supported).toBe(false);
});

test("ignores removed, malformed, and unrelated extensions", async () => {
	const removed = await installExtension("1.3.1");
	await writeFile(
		path.join(positRoot, "extensions", ".obsolete"),
		JSON.stringify({ [removed.name]: true }),
	);
	const malformed = await installExtension("1.3.2");
	await writeFile(path.join(malformed.directory, "package.json"), "{");
	const unrelated = await installExtension("1.3.3");
	await writeFile(
		path.join(unrelated.directory, "package.json"),
		JSON.stringify({ name: "assistant", publisher: "other", version: "1.3.1" }),
	);
	const report = await runDoctor();
	expect(report.positronAssistant.version).toBe("not installed");
	expect(report.compatibility.supported).toBe(false);
});
