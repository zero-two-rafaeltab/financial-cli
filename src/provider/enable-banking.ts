import { createPrivateKey, sign } from "node:crypto";
import { Effect, Layer, Schema } from "effect";
import { type BankingProvider, Provider } from "../auth";
import { attempt, decode, failure, Timestamp } from "../shared";

const Aspsps = Schema.Struct({
	aspsps: Schema.Array(
		Schema.Struct({
			name: Schema.NonEmptyString,
			psu_types: Schema.Array(Schema.Literals(["personal", "business"])),
			country: Schema.String.check(
				Schema.makeFilter((s) => /^[A-Z]{2}$/.test(s)),
			),
			maximum_consent_validity: Schema.Number.check(
				Schema.makeFilter((n) => Number.isFinite(n) && n > 0),
			),
		}),
	),
});
const Authorization = Schema.Struct({ url: Schema.NonEmptyString });
const Exchange = Schema.Struct({
	session_id: Schema.String.check(Schema.isUUID()),
	access: Schema.Struct({ valid_until: Timestamp }),
	accounts: Schema.Array(Schema.Unknown),
});
const Status = Schema.Struct({
	status: Schema.Literals([
		"AUTHORIZED",
		"CANCELLED",
		"CLOSED",
		"EXPIRED",
		"INVALID",
		"PENDING_AUTHORIZATION",
		"RETURNED_FROM_BANK",
		"REVOKED",
	]),
	access: Schema.Struct({ valid_until: Timestamp }),
});

export function enableBankingLayer(options: {
	readonly baseUrl?: string;
	readonly testMode: boolean;
}) {
	return Layer.succeed(Provider, {
		connect: (snapshot) =>
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
				const request = (
					method: "GET" | "POST",
					path: string,
					body?: unknown,
				) =>
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
									signal: AbortSignal.any([
										signal,
										AbortSignal.timeout(15_000),
									]),
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
				const success = (response: {
					status: number;
					data: unknown;
				}): Effect.Effect<unknown, import("../shared").AuthError> =>
					response.status < 300
						? Effect.succeed(response.data)
						: Effect.fail(
								failure(
									"Provider",
									"Enable Banking rejected the request or is unavailable.",
								),
							);
				const service: BankingProvider = {
					banks: () =>
						request("GET", "/aspsps?service=AIS&psu_type=personal").pipe(
							Effect.flatMap(success),
							Effect.flatMap((input) => decode(Aspsps, input)),
							Effect.map((data) =>
								data.aspsps
									.filter((bank) => bank.psu_types.includes("personal"))
									.map((bank) => ({
										name: bank.name,
										country: bank.country,
										maximumConsentValidity: bank.maximum_consent_validity,
									})),
							),
						),
					authorize: (config, bank, state) =>
						request("POST", "/auth", {
							access: {
								valid_until: new Date(
									Date.now() +
										Math.min(bank.maximumConsentValidity, 86400) * 1000,
								).toISOString(),
								balances: false,
								transactions: false,
							},
							aspsp: { name: bank.name, country: bank.country },
							state,
							redirect_url: config.callbackUrl,
							psu_type: "personal",
						}).pipe(
							Effect.flatMap(success),
							Effect.flatMap((input) => decode(Authorization, input)),
							Effect.flatMap((data) =>
								attempt(
									"Provider",
									"Provider returned an unsafe authorization URL.",
									() => {
										const url = new URL(data.url);
										if (
											url.protocol !== "https:" ||
											url.username ||
											url.password ||
											url.hash
										)
											throw new Error("Unsafe URL");
										for (const key of url.searchParams.keys())
											if (
												/^(?:code|token|access_token|session_id|iban|error_description)$/i.test(
													key,
												)
											)
												throw new Error("Sensitive URL");
										return url.toString();
									},
								),
							),
						),
					exchange: (code) =>
						request("POST", "/sessions", { code }).pipe(
							Effect.flatMap(success),
							Effect.flatMap((input) => decode(Exchange, input)),
							Effect.map((data) => ({
								sessionId: data.session_id,
								validUntil: data.access.valid_until,
							})),
						),
					status: (session) =>
						request(
							"GET",
							`/sessions/${encodeURIComponent(session.sessionId)}`,
						).pipe(
							Effect.flatMap((response) =>
								response.status === 404
									? Effect.succeed("missing" as const)
									: response.status === 401 || response.status === 403
										? Effect.fail(
												failure(
													"Provider",
													"Provider credentials rejected; session validity could not be verified.",
												),
											)
										: success(response).pipe(
												Effect.flatMap((input) =>
													decode(Status, input).pipe(
														Effect.mapError(() =>
															failure(
																"Provider",
																"Enable Banking returned an invalid status response.",
															),
														),
													),
												),
												Effect.map((data) =>
													data.status === "AUTHORIZED" &&
													Date.parse(data.access.valid_until) <= Date.now()
														? ("expired" as const)
														: (
																{
																	AUTHORIZED: "authorized",
																	CANCELLED: "cancelled",
																	CLOSED: "closed",
																	EXPIRED: "expired",
																	INVALID: "invalid",
																	PENDING_AUTHORIZATION:
																		"pending-authorization",
																	RETURNED_FROM_BANK: "returned-from-bank",
																	REVOKED: "revoked",
																} as const
															)[data.status],
												),
											),
							),
						),
				};
				return service;
			}),
	});
}
