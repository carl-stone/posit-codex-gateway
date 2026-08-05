import { describe, expect, test } from "vitest";
import {
	checkCurrentCodexContract,
	extractResponsesRequestFields,
} from "../src/compatibility.js";

const fields = [
	"model",
	"instructions",
	"input",
	"tools",
	"tool_choice",
	"parallel_tool_calls",
	"reasoning",
	"store",
	"stream",
	"stream_options",
	"include",
	"service_tier",
	"prompt_cache_key",
	"text",
	"client_metadata",
];

describe("Codex contract compatibility", () => {
	test("extracts ResponsesApiRequest fields", () => {
		const source = `pub struct ResponsesApiRequest {\n${fields
			.map((field) => `    pub ${field}: Option<Value>,`)
			.join("\n")}\n}`;
		expect(extractResponsesRequestFields(source)).toEqual(fields);
	});

	test("reports compatible fields using an injected network response", async () => {
		const source = `pub struct ResponsesApiRequest {\n${fields
			.map((field) => `    pub ${field}: Value,`)
			.join("\n")}\n}`;
		const result = await checkCurrentCodexContract(
			async () => new Response(source),
		);
		expect(result.compatible).toBe(true);
		expect(result.missingFromAdapter).toEqual([]);
		expect(result.absentUpstream).toEqual([]);
	});
});
