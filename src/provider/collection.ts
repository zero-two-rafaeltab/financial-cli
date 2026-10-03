import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import type { CredentialStore } from "../capabilities/authentication";
import {
	type Account,
	type BankFeed,
	CollectionError,
	type CollectionSource,
	type TransactionStatus,
} from "../capabilities/transactions";
import { connectHttp, type ProviderOptions } from "./client";
import { Details, SessionData, Transactions } from "./collection-schema";

const error = (kind: CollectionError["kind"], message: string) =>
	new CollectionError({ kind, message });
const digest = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
	schema: S,
	input: unknown,
): Effect.Effect<S["Type"], CollectionError> =>
	Schema.decodeUnknownEffect(schema)(input).pipe(
		Effect.mapError(() =>
			error("Provider", "Invalid Enable Banking collection response."),
		),
	);
const statuses: Record<
	(typeof Transactions.Type.transactions)[number]["status"],
	TransactionStatus
> = {
	BOOK: "booked",
	PDNG: "pending",
	CNCL: "cancelled",
	HOLD: "hold",
	OTHR: "other",
	RJCT: "rejected",
	SCHD: "scheduled",
};

export function enableBankingSource(
	credentials: CredentialStore,
	options: ProviderOptions,
): CollectionSource {
	return {
		open: (selection) =>
			Effect.gen(function* () {
				yield* credentials
					.exclusive()
					.pipe(
						Effect.mapError(() =>
							error(
								"Storage",
								"Unable to lock authentication storage for collection.",
							),
						),
					);
				const endpoint = options.baseUrl ?? "https://api.enablebanking.com";
				const snapshot = yield* credentials
					.snapshot(endpoint)
					.pipe(
						Effect.mapError(() =>
							error(
								"Access",
								"Authentication configuration is missing or unsafe.",
							),
						),
					);
				const request = yield* connectHttp(snapshot, options).pipe(
					Effect.mapError(() =>
						error(
							"Access",
							"Authentication configuration and provider endpoint do not match.",
						),
					),
				);
				const sessions = (yield* credentials
					.sessions()
					.pipe(
						Effect.mapError(() =>
							error("Storage", "Unable to read saved sessions safely."),
						),
					)).filter(
					(s) =>
						s.identity === snapshot.identity &&
						(!selection.bank || s.bank === selection.bank) &&
						(!selection.country || s.country === selection.country),
				);
				const namespace = [
					"enable-banking",
					endpoint,
					snapshot.config.testOnly,
					snapshot.config.applicationId,
				];
				const get = (path: string) =>
					request("GET", path).pipe(
						Effect.mapError(() =>
							error("Provider", "Enable Banking collection request failed."),
						),
						Effect.flatMap((response) =>
							response.status >= 200 && response.status < 300
								? Effect.succeed(response.data)
								: Effect.fail(
										error(
											[401, 403, 404].includes(response.status)
												? "Access"
												: "Provider",
											"Enable Banking rejected collection or is unavailable.",
										),
									),
						),
					);
				const feeds: BankFeed[] = sessions.map((session) => {
					const bankKey = digest([...namespace, session.bank, session.country]);
					const revision = digest(session.sessionId);
					const resolved = new Map<string, Account>();
					return {
						key: bankKey,
						bank: session.bank,
						country: session.country,
						accounts: () =>
							Effect.gen(function* () {
								if (!session.requestedAccess?.transactions)
									return yield* Effect.fail(
										error(
											"Access",
											"Fresh owner transaction consent is required. Run auth login --transactions consent.",
										),
									);
								if (Date.parse(session.validUntil) <= Date.now())
									return yield* Effect.fail(
										error(
											"Access",
											"Saved session is expired; owner consent is required.",
										),
									);
								const data = yield* get(
									`/sessions/${encodeURIComponent(session.sessionId)}`,
								).pipe(Effect.flatMap((input) => decode(SessionData, input)));
								if (
									data.status !== "AUTHORIZED" ||
									Date.parse(data.access.valid_until) <= Date.now() ||
									data.access.transactions !== true ||
									data.aspsp.name !== session.bank ||
									data.aspsp.country !== session.country
								)
									return yield* Effect.fail(
										error(
											"Access",
											"An authorized, unexpired session with explicit transaction consent is required.",
										),
									);
								if (
									data.accounts.length === 0 ||
									new Set(data.accounts).size !== data.accounts.length ||
									data.accounts_data.length !== data.accounts.length ||
									new Set(data.accounts_data.map((a) => a.uid)).size !==
										data.accounts.length ||
									data.accounts_data.some(
										(a) =>
											!data.accounts.includes(a.uid) ||
											!a.identification_hashes.includes(a.identification_hash),
									)
								)
									return yield* Effect.fail(
										error(
											"Provider",
											"Session account resolution is incomplete or ambiguous.",
										),
									);
								const accounts: Account[] = [];
								for (const item of data.accounts_data) {
									const key = digest([
										...namespace,
										session.bank,
										session.country,
										item.identification_hash,
									]);
									if (
										selection.accountKeys &&
										!selection.accountKeys.includes(key)
									)
										continue;
									const details = yield* get(
										`/accounts/${encodeURIComponent(item.uid)}/details`,
									).pipe(Effect.flatMap((input) => decode(Details, input)));
									if (
										(details.uid !== undefined && details.uid !== item.uid) ||
										details.identification_hash !== item.identification_hash ||
										!details.identification_hashes.includes(
											item.identification_hash,
										)
									)
										return yield* Effect.fail(
											error(
												"Provider",
												"Provider account identity changed during resolution.",
											),
										);
									const account: Account = {
										provider: "enable-banking",
										bankKey,
										key,
										bank: session.bank,
										country: session.country,
										currency: details.currency,
										providerAccountId: item.uid,
										identificationHash: item.identification_hash,
										sourceIdentity: snapshot.identity,
										authorizationRevision: revision,
									};
									if (accounts.some((a) => a.key === key))
										return yield* Effect.fail(
											error(
												"Provider",
												"Multiple session accounts share a primary identity.",
											),
										);
									resolved.set(key, account);
									accounts.push(account);
								}
								return accounts;
							}),
						page: (account, window, cursor) =>
							Effect.gen(function* () {
								if (
									resolved.get(account.key)?.providerAccountId !==
									account.providerAccountId
								)
									return yield* Effect.fail(
										error(
											"Input",
											"Account must be resolved by this bank feed.",
										),
									);
								const query = new URLSearchParams({
									strategy: window.strategy,
								});
								if (window.from) query.set("date_from", window.from);
								if (window.to && window.strategy !== "longest")
									query.set("date_to", window.to);
								if (cursor !== undefined) query.set("continuation_key", cursor);
								const data = yield* get(
									`/accounts/${encodeURIComponent(account.providerAccountId)}/transactions?${query}`,
								).pipe(Effect.flatMap((input) => decode(Transactions, input)));
								return {
									next: data.continuation_key ?? undefined,
									transactions: data.transactions.map((t) => ({
										amount: t.transaction_amount.amount,
										currency: t.transaction_amount.currency,
										direction:
											t.credit_debit_indicator === "CRDT"
												? ("credit" as const)
												: ("debit" as const),
										status: statuses[t.status],
										bookingDate: t.booking_date,
										valueDate: t.value_date,
										transactionDate: t.transaction_date,
										creditor: t.creditor?.name,
										debtor: t.debtor?.name,
										merchantCategoryCode: t.merchant_category_code,
										referenceNumber: t.reference_number,
										referenceScheme: t.reference_number_schema,
										remittance: t.remittance_information ?? [],
										note: t.note,
										entryReference: t.entry_reference ?? undefined,
										detailId: t.transaction_id ?? undefined,
									})),
								};
							}),
					};
				});
				return feeds;
			}),
	};
}
