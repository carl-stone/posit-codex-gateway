import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createOpenAIOAuthFetchHandler } from "openai-oauth";
import type { DiagnosticLogger } from "./diagnostics.js";
import { createGatewayFetchHandler, type FetchHandler } from "./handler.js";
import { safeError } from "./security.js";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 10532;

export type GatewayServerOptions = {
	port?: number;
	diagnosticLogger?: DiagnosticLogger;
	upstreamHandler?: FetchHandler;
};

export type RunningGateway = {
	host: typeof DEFAULT_HOST;
	port: number;
	url: string;
	close: () => Promise<void>;
};

const toRequest = (
	request: IncomingMessage,
	port: number,
	signal: AbortSignal,
): Request => {
	const method = request.method ?? "GET";
	const init: RequestInit & { duplex?: "half" } = {
		method,
		headers: request.headers as HeadersInit,
		signal,
	};
	if (method !== "GET" && method !== "HEAD") {
		init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
		init.duplex = "half";
	}
	return new Request(
		`http://${DEFAULT_HOST}:${port}${request.url ?? "/"}`,
		init,
	);
};

const writeResponse = async (
	response: Response,
	output: ServerResponse,
): Promise<void> => {
	output.statusCode = response.status;
	output.statusMessage = response.statusText;
	response.headers.forEach((value, key) => {
		output.setHeader(key, value);
	});
	if (!response.body) {
		output.end();
		return;
	}
	await pipeline(
		Readable.fromWeb(
			response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
		),
		output,
	);
};

export const startGatewayServer = async (
	options: GatewayServerOptions = {},
): Promise<RunningGateway> => {
	const port = options.port ?? DEFAULT_PORT;
	const upstreamHandler =
		options.upstreamHandler ?? createOpenAIOAuthFetchHandler();
	const handler = createGatewayFetchHandler({
		upstreamHandler,
		...(options.diagnosticLogger
			? { diagnosticLogger: options.diagnosticLogger }
			: {}),
	});

	const server = createServer(async (request, response) => {
		const abort = new AbortController();
		const cancel = () => abort.abort();
		request.once("aborted", cancel);
		response.once("close", () => {
			if (!response.writableEnded) cancel();
		});
		try {
			await writeResponse(
				await handler(toRequest(request, port, abort.signal)),
				response,
			);
		} catch {
			if (
				response.headersSent ||
				response.writableEnded ||
				abort.signal.aborted
			) {
				response.destroy();
				return;
			}
			await writeResponse(
				safeError(500, "Unexpected gateway error.", "server_error"),
				response,
			);
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, DEFAULT_HOST, () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address() as AddressInfo;
	return {
		host: DEFAULT_HOST,
		port: address.port,
		url: `http://${DEFAULT_HOST}:${address.port}/v1`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
};
