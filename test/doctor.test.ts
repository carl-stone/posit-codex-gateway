import { afterEach, describe, expect, test, vi } from "vitest";
import { runDoctor } from "../src/doctor.js";

describe("doctor", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("checks local health without contacting the contract source", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				Response.json({ ok: true, replay_state: "stateless" }),
			);
		vi.stubGlobal("fetch", fetchMock);

		const report = await runDoctor();

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:10532/health");
		expect(report).not.toHaveProperty("codexContract");
	});
});
