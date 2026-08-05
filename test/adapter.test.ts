import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { adaptResponsesBody } from "../src/adapter.js";

const fixture = async () =>
	JSON.parse(
		await readFile(
			new URL("./fixtures/posit-0.9.8-responses.json", import.meta.url),
			"utf8",
		),
	) as Record<string, unknown>;

describe("adaptResponsesBody", () => {
	test("translates a Posit 0.9.8 explicit-cache request without losing payloads", async () => {
		const request = await fixture();
		const original = structuredClone(request);
		const adapted = adaptResponsesBody(request);

		expect(request).toEqual(original);
		expect(adapted.promptCacheBreakpointCount).toBe(3);
		expect(adapted.removedFieldPaths).toEqual([
			"input[].content[].prompt_cache_breakpoint",
			"input[].output.prompt_cache_breakpoint",
			"metadata",
			"prompt_cache_options",
			"prompt_cache_retention",
			"reasoning.unsupported",
			"stream_options.include_usage",
			"text.format.description",
			"text.unsupported",
		]);
		expect(adapted.body.prompt_cache_key).toBe("posit-session");
		expect(adapted.body.reasoning).toEqual({
			effort: "high",
			summary: "detailed",
			context: "posit",
		});
		expect(adapted.body.include).toEqual(["reasoning.encrypted_content"]);
		expect(adapted.body.tools).toEqual(request.tools);
		expect(adapted.body.input).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "function_call" }),
				expect.objectContaining({ type: "function_call_output" }),
			]),
		);
		expect(JSON.stringify(adapted.body)).not.toContain(
			"prompt_cache_breakpoint",
		);
	});

	test("removes breakpoints recursively and collapses their paths", () => {
		const request = {
			input: [
				{
					nested: [
						{ prompt_cache_breakpoint: 1 },
						{ prompt_cache_breakpoint: 2 },
					],
				},
			],
			prompt_cache_breakpoint: 3,
		};
		const adapted = adaptResponsesBody(request);
		expect(adapted.promptCacheBreakpointCount).toBe(3);
		expect(adapted.removedFieldPaths).toEqual([
			"input[].nested[].prompt_cache_breakpoint",
			"prompt_cache_breakpoint",
		]);
		expect(request.input[0]?.nested[0]?.prompt_cache_breakpoint).toBe(1);
	});

	test("filters unsupported root and nested fields", () => {
		const adapted = adaptResponsesBody({
			model: "gpt-5.6-sol",
			previous_response_id: "resp_1",
			stream_options: { reasoning_summary_delivery: "auto", unknown: true },
			text: {
				verbosity: "low",
				unknown: true,
				format: { type: "json_schema", name: "x", schema: {}, extra: true },
			},
		});
		expect(adapted.body).toEqual({
			model: "gpt-5.6-sol",
			stream_options: { reasoning_summary_delivery: "auto" },
			text: {
				verbosity: "low",
				format: { type: "json_schema", name: "x", schema: {} },
			},
		});
		expect(adapted.removedFieldPaths).toEqual([
			"previous_response_id",
			"stream_options.unknown",
			"text.format.extra",
			"text.unknown",
		]);
	});
});
