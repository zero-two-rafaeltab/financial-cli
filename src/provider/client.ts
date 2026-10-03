import { createPrivateKey, sign } from "node:crypto";
import { Effect } from "effect";
import type { Snapshot } from "../auth";
import { attempt, failure } from "../shared";

export type ProviderOptions = {
	readonly baseUrl?: string;
	readonly testMode: boolean;
};
// Shared provider-adapter transport; no authorization/session policy lives here.
export const connectHttp = (snapshot: Snapshot, options: ProviderOptions) =>
	Effect.gen(function* () {
		const config = snapshot.config;
		const key = snapshot.privateKey;
		const base = options.baseUrl ?? "https://api.enablebanking.com";
		yield* attempt(
			"Input",
			"Provider endpoint overrides are restricted to explicit loopback test mode.",
			() => {
				const url = new URL(base);
				if (
					base !== "https://api.enablebanking.com" &&
					(!options.testMode ||
						url.protocol !== "http:" ||
						!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
						url.username ||
						url.password ||
						url.pathname !== "/" ||
						url.search ||
						url.hash)
				)
					throw new Error("Unsafe endpoint");
			},
		);
		const request = (method: "GET" | "POST", path: string, body?: unknown) =>
			Effect.gen(function* () {
				if (snapshot.endpoint !== base)
					return yield* Effect.fail(
						failure("Input", "Provider snapshot endpoint mismatch."),
					);
				if (config.testOnly !== options.testMode)
					return yield* Effect.fail(
						failure(
							"Input",
							"Test and production credentials must use separate configuration.",
						),
					);

				const jwt = yield* attempt(
					"Input",
					"Private key must be RSA with at least 2048 bits.",
					() => {
						const parsed = createPrivateKey(key);
						if (
							parsed.asymmetricKeyType !== "rsa" ||
							(parsed.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
						)
							throw new Error("Invalid key");
						const iat = Math.floor(Date.now() / 1000);
						const header = Buffer.from(
							JSON.stringify({
								typ: "JWT",
								alg: "RS256",
								kid: config.applicationId,
							}),
						).toString("base64url");
						const payload = Buffer.from(
							JSON.stringify({
								iss: "enablebanking.com",
								aud: "api.enablebanking.com",
								iat,
								exp: iat + 300,
							}),
						).toString("base64url");
						const data = `${header}.${payload}`;
						return `${data}.${sign("RSA-SHA256", Buffer.from(data), parsed).toString("base64url")}`;
					},
				);
				return yield* Effect.tryPromise({
					try: async (signal) => {
						const response = await fetch(`${base}${path}`, {
							method,
							redirect: "error",
							signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
							headers: {
								Authorization: `Bearer ${jwt}`,
								"Content-Type": "application/json",
								Accept: "application/json",
							},
							...(body === undefined ? {} : { body: JSON.stringify(body) }),
						});
						if (!response.ok) {
							await response.body?.cancel();
							return { status: response.status, data: undefined };
						}
						const reader = response.body?.getReader();
						if (!reader) throw new Error("No response");
						let size = 0;
						const parts: Uint8Array[] = [];
						try {
							while (true) {
								const part = await reader.read();
								if (part.done) break;
								size += part.value.length;
								if (size > 2 * 1024 * 1024)
									throw new Error("Oversize response");
								parts.push(part.value);
							}
						} finally {
							await reader.cancel();
						}
						return {
							status: response.status,
							data: JSON.parse(
								Buffer.concat(parts).toString("utf8"),
							) as unknown,
						};
					},
					catch: () =>
						failure(
							"Provider",
							"Enable Banking unavailable or returned an invalid response.",
						),
				});
			});

		return request;
	});
