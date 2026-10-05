import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { adaptResponsesBody } from "../src/adapter.js";

const fixture = async (name = "responses-request.json") =>
	JSON.parse(
		await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
	) as Record<string, unknown>;

describe("adaptResponsesBody", () => {
	test("translates a Posit 1.3.0 explicit-cache request without losing payloads", async () => {
		const request = await fixture();
		const original = structuredClone(request);
		const adapted = adaptResponsesBody(request);

		expect(request).toEqual(original);
		expect(adapted.promptCacheBreakpointCount).toBe(3);
		expect(adapted.removedFieldPaths).toEqual([
			"$.*",
			"**.prompt_cache_breakpoint",
			"prompt_cache_options",
		]);
		expect(adapted.body.prompt_cache_key).toBe("test-session");
		expect(adapted.body.reasoning).toEqual({
			effort: "high",
			summary: "detailed",
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
		expect(adapted.body).not.toHaveProperty("max_output_tokens");
		expect(adapted.body).not.toHaveProperty("prompt_cache_options");
	});

	test("preserves Posit 1.3.0 structured function-call output", async () => {
		const adapted = adaptResponsesBody(await fixture());
		const input = adapted.body.input as Array<Record<string, unknown>>;
		const output = input.find((item) => item.type === "function_call_output");
		expect(output).toEqual({
			type: "function_call_output",
			call_id: "call_1",
			output: [{ type: "input_text", text: "model summary" }],
		});
	});

	test("preserves the synthetic Assistant 1.6 GPT-6 apply_patch contract", async () => {
		const request = await fixture("responses-request-1.6.json");
		const original = structuredClone(request);
		const adapted = adaptResponsesBody(request);

		expect(request).toEqual(original);
		expect(adapted.body.model).toBe("gpt-6-astra");
		expect(adapted.body.tools).toEqual(request.tools);
		expect(adapted.body.reasoning).toEqual({
			effort: "xhigh",
			summary: "detailed",
			context: "all_turns",
		});
		expect(adapted.body.prompt_cache_key).toBe("test-session-1.6");
		expect(adapted.body.input).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "reasoning",
					encrypted_content: "synthetic-encrypted-reasoning",
				}),
				expect.objectContaining({ type: "function_call", name: "apply_patch" }),
				{
					type: "function_call_output",
					call_id: "call_patch",
					output: [
						{ type: "input_text", text: "Applied patch to analysis.R." },
					],
				},
			]),
		);
		const input = adapted.body.input as Array<Record<string, unknown>>;
		expect(input[1]).toEqual((request.input as unknown[])[1]);
		expect(input[3]).toEqual((request.input as unknown[])[3]);
		expect(adapted.promptCacheBreakpointCount).toBe(2);
		expect(adapted.removedFieldPaths).toEqual([
			"$.*",
			"**.prompt_cache_breakpoint",
			"prompt_cache_options",
			"reasoning.*",
		]);
	});

	test("removes markers only from Posit Responses content parts", () => {
		const request = {
			input: [
				{
					role: "user",
					content: [
						{
							type: "input_text",
							text: "hello",
							prompt_cache_breakpoint: { mode: "explicit" },
							metadata: { prompt_cache_breakpoint: "user data" },
						},
					],
				},
				{
					type: "function_call_output",
					call_id: "call_1",
					output: [
						{
							type: "input_text",
							text: "result",
							prompt_cache_breakpoint: { mode: "explicit" },
						},
					],
				},
			],
		};
		const adapted = adaptResponsesBody(request);
		expect(adapted.promptCacheBreakpointCount).toBe(2);
		expect(adapted.removedFieldPaths).toEqual(["**.prompt_cache_breakpoint"]);
		expect(JSON.stringify(adapted.body)).toContain(
			'"metadata":{"prompt_cache_breakpoint":"user data"}',
		);
		expect(
			(
				request.input[0] as (typeof request.input)[0] & {
					content: Array<Record<string, unknown>>;
				}
			).content[0]?.prompt_cache_breakpoint,
		).toEqual({ mode: "explicit" });
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
			"stream_options.*",
			"text.*",
			"text.format.*",
		]);
	});

	test("preserves opaque schemas and deeply clones them without recursion", () => {
		const schema = JSON.parse(
			'{"type":"object","properties":{"prompt_cache_breakpoint":{"type":"string"},"__proto__":{"type":"number"}}}',
		) as Record<string, unknown>;
		let cursor = schema;
		for (let depth = 0; depth < 20_000; depth += 1) {
			const child: Record<string, unknown> = {};
			cursor.next = child;
			cursor = child;
		}
		cursor.value = "end";
		const request = {
			input: [],
			tools: [{ type: "function", name: "schema_test", parameters: schema }],
		};

		const adapted = adaptResponsesBody(request);
		const tools = adapted.body.tools as Array<Record<string, unknown>>;
		const adaptedSchema = tools[0]?.parameters as Record<string, unknown>;
		const properties = adaptedSchema.properties as Record<string, unknown>;
		expect(
			(properties.prompt_cache_breakpoint as Record<string, unknown>).type,
		).toBe("string");
		expect(Object.hasOwn(properties, "__proto__")).toBe(true);
		const protoProperty = Object.getOwnPropertyDescriptor(
			properties,
			"__proto__",
		)?.value as Record<string, unknown>;
		expect(protoProperty.type).toBe("number");
		let adaptedCursor = adaptedSchema;
		for (let depth = 0; depth < 20_000; depth += 1) {
			adaptedCursor = adaptedCursor.next as Record<string, unknown>;
		}
		expect(adaptedCursor.value).toBe("end");
		expect(adaptedSchema === schema).toBe(false);
		expect(adapted.removedFieldPaths).toEqual([]);
	});
});
