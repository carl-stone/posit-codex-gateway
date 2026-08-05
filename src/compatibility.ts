import { CODEX_RESPONSES_REQUEST_FIELDS } from "./adapter.js";

const CODEX_COMMON_SOURCE =
	"https://raw.githubusercontent.com/openai/codex/main/codex-rs/codex-api/src/common.rs";

export type ContractCompatibility = {
	compatible: boolean;
	adapterFields: string[];
	upstreamFields: string[];
	missingFromAdapter: string[];
	absentUpstream: string[];
	source: string;
};

export const extractResponsesRequestFields = (source: string): string[] => {
	const body = source.match(
		/pub struct ResponsesApiRequest\s*\{([\s\S]*?)\n\}/,
	)?.[1];
	if (!body)
		throw new Error("Could not find ResponsesApiRequest in Codex source.");
	return [...body.matchAll(/\bpub\s+(\w+):/g)]
		.map((match) => match[1])
		.filter((field): field is string => field !== undefined);
};

export const checkCurrentCodexContract = async (
	request: typeof fetch = fetch,
): Promise<ContractCompatibility> => {
	const response = await request(CODEX_COMMON_SOURCE, {
		headers: { "User-Agent": "posit-codex-gateway-contract-check" },
	});
	if (!response.ok) {
		throw new Error(
			`Codex contract check failed with HTTP ${response.status}.`,
		);
	}
	const upstreamFields = extractResponsesRequestFields(await response.text());
	const adapterFields = [...CODEX_RESPONSES_REQUEST_FIELDS];
	const missingFromAdapter = upstreamFields.filter(
		(field) => !adapterFields.includes(field as (typeof adapterFields)[number]),
	);
	const absentUpstream = adapterFields.filter(
		(field) => !upstreamFields.includes(field),
	);
	return {
		compatible: missingFromAdapter.length === 0 && absentUpstream.length === 0,
		adapterFields,
		upstreamFields,
		missingFromAdapter,
		absentUpstream,
		source: CODEX_COMMON_SOURCE,
	};
};
