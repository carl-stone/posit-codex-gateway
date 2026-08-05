export type TokenUsage = {
	inputTokens?: number | undefined;
	outputTokens?: number | undefined;
	totalTokens?: number | undefined;
	cachedInputTokens?: number | undefined;
	reasoningTokens?: number | undefined;
};

export type DiagnosticEvent = {
	type: "responses_request" | "responses_response" | "responses_error";
	requestId: string;
	model?: string | undefined;
	removedFieldPaths?: string[];
	promptCacheBreakpointCount?: number;
	status?: number;
	durationMs?: number;
	usage?: TokenUsage;
};

export type DiagnosticLogger = (event: DiagnosticEvent) => void;

export const createStderrDiagnosticLogger = (): DiagnosticLogger => (event) => {
	process.stderr.write(`${JSON.stringify(event)}\n`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const extractUsage = (value: unknown): TokenUsage => {
	if (!isRecord(value) || !isRecord(value.usage)) return {};
	const usage = value.usage;
	const inputDetails = isRecord(usage.input_tokens_details)
		? usage.input_tokens_details
		: undefined;
	const outputDetails = isRecord(usage.output_tokens_details)
		? usage.output_tokens_details
		: undefined;
	return {
		inputTokens:
			typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
		outputTokens:
			typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
		totalTokens:
			typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
		cachedInputTokens:
			typeof inputDetails?.cached_tokens === "number"
				? inputDetails.cached_tokens
				: undefined,
		reasoningTokens:
			typeof outputDetails?.reasoning_tokens === "number"
				? outputDetails.reasoning_tokens
				: undefined,
	};
};
