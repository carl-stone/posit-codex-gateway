export const CODEX_RESPONSES_ADAPTER_VERSION = 1;

export const CODEX_RESPONSES_REQUEST_FIELDS = [
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
] as const;

const ROOT_FIELDS = new Set<string>(CODEX_RESPONSES_REQUEST_FIELDS);
const REASONING_FIELDS = new Set(["effort", "summary", "context"]);
const STREAM_OPTIONS_FIELDS = new Set(["reasoning_summary_delivery"]);
const TEXT_FIELDS = new Set(["verbosity", "format"]);
const TEXT_FORMAT_FIELDS = new Set(["type", "strict", "schema", "name"]);
const SAFE_REMOVED_ROOT_FIELDS = new Set([
	"previous_response_id",
	"prompt_cache_options",
	"prompt_cache_retention",
]);

export type ResponsesAdaptation = {
	body: Record<string, unknown>;
	promptCacheBreakpointCount: number;
	removedFieldPaths: string[];
	version: typeof CODEX_RESPONSES_ADAPTER_VERSION;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const removeBreakpoints = (
	value: unknown,
	removed: Set<string>,
	counter: { value: number },
): unknown => {
	if (!Array.isArray(value) && !isRecord(value)) return value;

	type Container = unknown[] | Record<string, unknown>;
	const root: Container = Array.isArray(value) ? [] : {};
	const pending: Array<{ source: Container; target: Container }> = [
		{ source: value, target: root },
	];

	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) break;
		if (Array.isArray(current.source) && Array.isArray(current.target)) {
			for (const item of current.source) {
				if (Array.isArray(item) || isRecord(item)) {
					const child: Container = Array.isArray(item) ? [] : {};
					current.target.push(child);
					pending.push({ source: item, target: child });
				} else {
					current.target.push(item);
				}
			}
			continue;
		}

		if (!Array.isArray(current.source) && !Array.isArray(current.target)) {
			for (const [key, item] of Object.entries(current.source)) {
				if (key === "prompt_cache_breakpoint") {
					counter.value += 1;
					removed.add("**.prompt_cache_breakpoint");
					continue;
				}
				if (Array.isArray(item) || isRecord(item)) {
					const child: Container = Array.isArray(item) ? [] : {};
					current.target[key] = child;
					pending.push({ source: item, target: child });
				} else {
					current.target[key] = item;
				}
			}
		}
	}

	return root;
};

const filterRecord = (
	value: unknown,
	allowed: Set<string>,
	path: string,
	removed: Set<string>,
): unknown => {
	if (!isRecord(value)) return value;
	const copy: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (!allowed.has(key)) {
			removed.add(`${path}.*`);
			continue;
		}
		copy[key] = item;
	}
	return Object.keys(copy).length > 0 ? copy : undefined;
};

export const adaptResponsesBody = (
	body: Record<string, unknown>,
): ResponsesAdaptation => {
	const removed = new Set<string>();
	const counter = { value: 0 };
	const recursivelyCleaned = removeBreakpoints(
		body,
		removed,
		counter,
	) as Record<string, unknown>;
	const adapted: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(recursivelyCleaned)) {
		if (!ROOT_FIELDS.has(key)) {
			removed.add(SAFE_REMOVED_ROOT_FIELDS.has(key) ? key : "$.*");
			continue;
		}
		adapted[key] = value;
	}

	if ("reasoning" in adapted) {
		adapted.reasoning = filterRecord(
			adapted.reasoning,
			REASONING_FIELDS,
			"reasoning",
			removed,
		);
	}
	if ("stream_options" in adapted) {
		adapted.stream_options = filterRecord(
			adapted.stream_options,
			STREAM_OPTIONS_FIELDS,
			"stream_options",
			removed,
		);
	}
	if ("text" in adapted) {
		adapted.text = filterRecord(adapted.text, TEXT_FIELDS, "text", removed);
		if (isRecord(adapted.text) && "format" in adapted.text) {
			adapted.text = {
				...adapted.text,
				format: filterRecord(
					adapted.text.format,
					TEXT_FORMAT_FIELDS,
					"text.format",
					removed,
				),
			};
		}
	}

	return {
		body: adapted,
		promptCacheBreakpointCount: counter.value,
		removedFieldPaths: [...removed].sort(),
		version: CODEX_RESPONSES_ADAPTER_VERSION,
	};
};

export const isJsonObject = isRecord;
