const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const hostnameFromHostHeader = (host: string): string | undefined => {
	try {
		return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "");
	} catch {
		return undefined;
	}
};

export const isLoopbackHostname = (hostname: string): boolean =>
	LOOPBACK_NAMES.has(hostname.toLowerCase());

export const validateLocalRequest = (
	request: Request,
): Response | undefined => {
	const host = request.headers.get("host");
	if (!host || !isLoopbackHostname(hostnameFromHostHeader(host) ?? "")) {
		return safeError(403, "Request Host must be loopback.", "forbidden");
	}

	const origin = request.headers.get("origin");
	if (origin && origin !== "null") {
		try {
			const parsed = new URL(origin);
			if (parsed.protocol !== "http:" || !isLoopbackHostname(parsed.hostname)) {
				return safeError(403, "Request Origin must be loopback.", "forbidden");
			}
		} catch {
			return safeError(403, "Request Origin is invalid.", "forbidden");
		}
	}
	return undefined;
};

export const isJsonContentType = (value: string | null): boolean => {
	if (!value) return false;
	const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
	return (
		mediaType === "application/json" || mediaType?.endsWith("+json") === true
	);
};

export const safeError = (
	status: number,
	message: string,
	type: string,
): Response =>
	Response.json(
		{ error: { message, type } },
		{ status, headers: { "Cache-Control": "no-store" } },
	);
