import { expect, test } from "bun:test";
import { Effect } from "effect";
import { Provider } from "../src/capabilities/authentication";
import { enableBankingLayer } from "../src/provider";
import { key } from "./key-fixture";

test("provider discovery rejects non-integer consent metadata without disclosing the response", async () => {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () =>
			Response.json({
				aspsps: [
					{
						name: "Synthetic Bank",
						country: "NL",
						psu_types: ["personal"],
						maximum_consent_validity: 1.5,
					},
				],
				secret: "SYNTHETIC-RESPONSE-SECRET",
			}),
	});
	const endpoint = `http://127.0.0.1:${server.port}`;
	try {
		const outcome = await Effect.runPromise(
			Effect.gen(function* () {
				const provider = yield* (yield* Provider).connect({
					endpoint,
					privateKey: key,
					identity: "synthetic-identity",
					config: {
						applicationId: "00000000-0000-4000-8000-000000000001",
						callbackUrl: "https://fixture.test/callback",
						port: 8787,
						testOnly: true,
					},
				});
				return yield* provider.banks();
			}).pipe(
				Effect.provide(
					enableBankingLayer({ baseUrl: endpoint, testMode: true }),
				),
				Effect.match({
					onSuccess: () => ({ kind: "accepted", message: "accepted" }),
					onFailure: (error) => ({ kind: error.kind, message: error.message }),
				}),
			),
		);
		expect(outcome.kind).toBe("Provider");
		expect(outcome.message).not.toContain("SYNTHETIC-RESPONSE-SECRET");
	} finally {
		server.stop(true);
	}
});
