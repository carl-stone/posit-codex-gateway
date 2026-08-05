import { randomUUID } from "node:crypto";
import { adaptResponsesBody, isJsonObject } from "./adapter.js";
import { type DiagnosticLogger, extractUsage } from "./diagnostics.js";

export type FetchHandler = (request: Request) => Promise<Response>;

export type GatewayHandlerOptions = {
	upstreamHandler: FetchHandler;
	diagnosticLogger?: DiagnosticLogger;
	now?: () => number;
	requestId?: () => string;
};

export const createGatewayFetchHandler = (
	options: GatewayHandlerOptions,
): FetchHandler => {
	const now = options.now ?? Date.now;
	const createRequestId = options.requestId ?? randomUUID;

	return async (request) => {
		const url = new URL(request.url);
		if (request.method !== "POST" || url.pathname !== "/v1/responses") {
			return options.upstreamHandler(request);
		}

		let parsed: unknown;
		try {
			parsed = await request.json();
		} catch {
			return errorResponse("Request body must be valid JSON.", 400);
		}
		if (!isJsonObject(parsed)) {
			return errorResponse("Request body must be a JSON object.", 400);
		}

		const adaptation = adaptResponsesBody(parsed);
		const requestId = createRequestId();
		const startedAt = now();
		const model =
			typeof adaptation.body.model === "string"
				? adaptation.body.model
				: undefined;
		options.diagnosticLogger?.({
			type: "responses_request",
			requestId,
			model,
			removedFieldPaths: adaptation.removedFieldPaths,
			promptCacheBreakpointCount: adaptation.promptCacheBreakpointCount,
		});

		const headers = new Headers(request.headers);
		headers.delete("content-length");
		const adaptedRequest = new Request(request.url, {
			method: request.method,
			headers,
			body: JSON.stringify(adaptation.body),
			signal: request.signal,
		});

		try {
			const response = await options.upstreamHandler(adaptedRequest);
			const event = {
				type: "responses_response" as const,
				requestId,
				model,
				status: response.status,
				durationMs: now() - startedAt,
			};
			const contentType = response.headers.get("content-type") ?? "";
			if (
				options.diagnosticLogger &&
				!contentType.includes("text/event-stream")
			) {
				void response
					.clone()
					.json()
					.then((body) =>
						options.diagnosticLogger?.({
							...event,
							usage: extractUsage(body),
						}),
					)
					.catch(() => options.diagnosticLogger?.(event));
			} else {
				options.diagnosticLogger?.(event);
			}
			return response;
		} catch (error) {
			options.diagnosticLogger?.({
				type: "responses_error",
				requestId,
				model,
				status: 0,
				durationMs: now() - startedAt,
			});
			throw error;
		}
	};
};

const errorResponse = (message: string, status: number): Response =>
	Response.json(
		{ error: { message, type: "invalid_request_error" } },
		{ status },
	);
