import { Effect, Layer, Schema } from "effect";
import {
	type AuthError,
	type BankingProvider,
	Provider,
	type RemoteSessionStatus,
	type ReportedAccess,
} from "../auth";
import { attempt, decode, failure, Timestamp } from "../shared";

import { connectHttp } from "./client";

const Aspsps = Schema.Struct({
	aspsps: Schema.Array(
		Schema.Struct({
			name: Schema.NonEmptyString,
			psu_types: Schema.Array(Schema.Literals(["personal", "business"])),
			country: Schema.String.check(
				Schema.makeFilter((s) => /^[A-Z]{2}$/.test(s)),
			),
			maximum_consent_validity: Schema.Number.check(
				Schema.makeFilter((n) => Number.isSafeInteger(n) && n > 0),
			),
		}),
	),
});
const Authorization = Schema.Struct({ url: Schema.NonEmptyString });
const Access = Schema.Struct({
	valid_until: Timestamp,
	transactions: Schema.optional(Schema.Boolean),
	balances: Schema.optional(Schema.Boolean),
});
const Exchange = Schema.Struct({
	session_id: Schema.String.check(Schema.isUUID()),
	access: Access,
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
	access: Access,
});
function accessReport(access: {
	readonly transactions?: boolean;
	readonly balances?: boolean;
}): { readonly reportedAccess?: ReportedAccess } {
	return access.transactions === undefined && access.balances === undefined
		? {}
		: {
				reportedAccess: {
					...(access.transactions === undefined
						? {}
						: { transactions: access.transactions }),
					...(access.balances === undefined
						? {}
						: { balances: access.balances }),
				},
			};
}

export function enableBankingLayer(options: {
	readonly baseUrl?: string;
	readonly testMode: boolean;
}) {
	return Layer.succeed(Provider, {
		connect: (snapshot) =>
			Effect.gen(function* () {
				const request = yield* connectHttp(snapshot, options);
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
							Effect.flatMap((input) =>
								decode(Aspsps, input).pipe(
									Effect.mapError(() =>
										failure(
											"Provider",
											"Enable Banking returned invalid connector metadata.",
										),
									),
								),
							),
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
					authorize: (config, bank, state, access) =>
						request("POST", "/auth", {
							access: {
								valid_until: access.validUntil,
								balances: access.balances,
								transactions: access.transactions,
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
								...accessReport(data.access),
							})),
						),
					status: (session) =>
						request(
							"GET",
							`/sessions/${encodeURIComponent(session.sessionId)}`,
						).pipe(
							Effect.flatMap(
								(response): Effect.Effect<RemoteSessionStatus, AuthError> =>
									response.status === 404
										? Effect.succeed({ status: "missing" as const })
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
													Effect.map((data) => ({
														validUntil: data.access.valid_until,
														...accessReport(data.access),
														status: (
															{
																AUTHORIZED: "authorized",
																CANCELLED: "cancelled",
																CLOSED: "closed",
																EXPIRED: "expired",
																INVALID: "invalid",
																PENDING_AUTHORIZATION: "pending-authorization",
																RETURNED_FROM_BANK: "returned-from-bank",
																REVOKED: "revoked",
															} as const
														)[data.status],
													})),
												),
							),
						),
				};
				return service;
			}),
	});
}
