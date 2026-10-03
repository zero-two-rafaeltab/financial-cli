import { expect, test } from "bun:test";
import { Effect } from "effect";
import type {
	CredentialStore,
	Snapshot,
	StoredSession,
} from "../src/capabilities/authentication";
import { enableBankingSource } from "../src/provider";
import { key } from "./key-fixture";
import { deadline } from "./runtime-fixture";

export const syntheticSessions: readonly StoredSession[] = [
	{
		bank: "ING Synthetic",
		country: "NL",
		identity: "a".repeat(64),
		sessionId: "497f6eca-6276-4993-bfeb-53cbbbba6f08",
		validUntil: "2099-01-01T00:00:00Z",
		requestedAccess: {
			validUntil: "2099-01-01T00:00:00Z",
			transactions: true,
			balances: false,
		},
	},
	{
		bank: "Revolut Synthetic",
		country: "NL",
		identity: "a".repeat(64),
		sessionId: "507f6eca-6276-4993-bfeb-53cbbbba6f08",
		validUntil: "2099-01-01T00:00:00Z",
		requestedAccess: {
			validUntil: "2099-01-01T00:00:00Z",
			transactions: true,
			balances: false,
		},
	},
];
const uids = [
	"617f6eca-6276-4993-bfeb-53cbbbba6f08",
	"627f6eca-6276-4993-bfeb-53cbbbba6f08",
];
function credentials(
	endpoint: string,
	sessions = syntheticSessions,
): CredentialStore {
	const snapshot: Snapshot = {
		config: {
			applicationId: "717f6eca-6276-4993-bfeb-53cbbbba6f08",
			callbackUrl: "https://example.test/callback",
			port: 8787,
			testOnly: true,
		},
		privateKey: key,
		identity: "a".repeat(64),
		endpoint,
	};
	return {
		exclusive: () => Effect.succeed(undefined),
		keygen: () => Effect.succeed("unused"),
		configure: () => Effect.void,
		config: () => Effect.succeed(snapshot.config),
		privateKey: () => Effect.succeed(key),
		snapshot: () => Effect.succeed(snapshot),
		sessions: () => Effect.succeed(sessions),
		saveSession: () => Effect.void,
	};
}

test("collection HTTP adapter resolves both synthetic banks, encodes cursors/ranges and translates official transaction fields", async () => {
	const seen: URL[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			seen.push(url);
			expect(request.method).toBe("GET");
			expect(request.headers.get("Authorization")).toMatch(/^Bearer /);
			const index =
				url.pathname.includes(syntheticSessions[1]?.sessionId ?? "absent") ||
				url.pathname.includes(uids[1] ?? "absent")
					? 1
					: 0;
			const uid = uids[index];
			const primary = `synthetic-primary-${index}`;
			if (url.pathname.startsWith("/sessions/"))
				return Response.json({
					status: "AUTHORIZED",
					access: { transactions: true, valid_until: "2099-01-01T00:00:00Z" },
					aspsp: { name: syntheticSessions[index]?.bank, country: "NL" },
					accounts: [uid],
					accounts_data: [
						{
							uid,
							identification_hash: primary,
							identification_hashes: [primary],
						},
					],
				});
			if (url.pathname.endsWith("/details"))
				return Response.json({
					uid,
					currency: index === 0 ? "EUR" : "GBP",
					cash_account_type: "CACC",
					identification_hash: primary,
					identification_hashes: [primary],
				});
			if (url.pathname.endsWith("/transactions"))
				return Response.json({
					transactions: [
						{
							transaction_amount: {
								amount: "9007199254740993.0100",
								currency: "EUR",
							},
							credit_debit_indicator: "DBIT",
							status: "PDNG",
							booking_date: "2026-10-02",
							value_date: "2026-10-01",
							creditor: { name: "SYNTHETIC-MERCHANT-SECRET" },
							remittance_information: ["synthetic reference"],
							merchant_category_code: "5411",
							reference_number: "synthetic-rf",
							transaction_id: null,
						},
					],
					continuation_key: url.searchParams.has("continuation_key")
						? null
						: "cursor +/&?",
				});
			return new Response("Unexpected path", { status: 404 });
		},
	});
	try {
		const source = enableBankingSource(credentials(server.url.origin), {
			testMode: true,
			baseUrl: server.url.origin,
		});
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const feeds = yield* source.open({});
					expect(feeds).toHaveLength(2);
					for (const feed of feeds) {
						const accounts = yield* feed.accounts();
						expect(accounts).toHaveLength(1);
						const account = accounts[0];
						if (!account) throw new Error("Missing synthetic account");
						const first = yield* feed.page(account, {
							strategy: "default",
							from: "2026-10-01",
							to: "2026-10-03",
						});
						expect(first.transactions[0]).toMatchObject({
							amount: "9007199254740993.0100",
							direction: "debit",
							status: "pending",
							creditor: "SYNTHETIC-MERCHANT-SECRET",
							bookingDate: "2026-10-02",
							valueDate: "2026-10-01",
							referenceNumber: "synthetic-rf",
						});
						expect(first.next).toBe("cursor +/&?");
						const last = yield* feed.page(
							account,
							{ strategy: "default", from: "2026-10-01", to: "2026-10-03" },
							first.next,
						);
						expect(last.next).toBeUndefined();
					}
				}),
			),
		);
		expect(
			seen.filter(
				(u) => u.searchParams.get("continuation_key") === "cursor +/&?",
			),
		).toHaveLength(2);
		expect(
			seen
				.filter((u) => u.pathname.endsWith("/transactions"))
				.every(
					(u) =>
						u.searchParams.get("date_from") === "2026-10-01" &&
						u.searchParams.get("date_to") === "2026-10-03",
				),
		).toBe(true);
	} finally {
		await server.stop(true);
	}
});

test("collection translates nullable optional transaction fields into absent local values", async () => {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			const uid = uids[0];
			const primary = "synthetic-nullable-primary";
			if (path.startsWith("/sessions/"))
				return Response.json({
					status: "AUTHORIZED",
					access: { transactions: true, valid_until: "2099-01-01T00:00:00Z" },
					aspsp: { name: "ING Synthetic", country: "NL" },
					accounts: [uid],
					accounts_data: [
						{
							uid,
							identification_hash: primary,
							identification_hashes: [primary],
						},
					],
				});
			if (path.endsWith("/details"))
				return Response.json({
					uid,
					currency: "EUR",
					cash_account_type: "CACC",
					identification_hash: primary,
					identification_hashes: [primary],
				});
			return Response.json({
				transactions: [null, { name: null }].map((party) => ({
					transaction_amount: { amount: "42.0100", currency: "EUR" },
					credit_debit_indicator: "DBIT",
					status: "PDNG",
					entry_reference: null,
					transaction_id: null,
					booking_date: null,
					value_date: null,
					transaction_date: null,
					creditor: party,
					debtor: party,
					merchant_category_code: null,
					reference_number: null,
					reference_number_schema: null,
					remittance_information: null,
					note: null,
				})),
				continuation_key: null,
			});
		},
	});
	try {
		const source = enableBankingSource(
			credentials(server.url.origin, syntheticSessions.slice(0, 1)),
			{ testMode: true, baseUrl: server.url.origin },
		);
		const page = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const feed = (yield* source.open({}))[0];
					if (!feed) throw new Error("Missing synthetic feed");
					const account = (yield* feed.accounts())[0];
					if (!account) throw new Error("Missing synthetic account");
					return yield* feed.page(account, { strategy: "longest" });
				}),
			),
		);
		expect(page.next).toBeUndefined();
		expect(page.transactions).toHaveLength(2);
		for (const transaction of page.transactions)
			expect(transaction).toEqual({
				amount: "42.0100",
				currency: "EUR",
				direction: "debit",
				status: "pending",
				bookingDate: undefined,
				valueDate: undefined,
				transactionDate: undefined,
				creditor: undefined,
				debtor: undefined,
				merchantCategoryCode: undefined,
				referenceNumber: undefined,
				referenceScheme: undefined,
				remittance: [],
				note: undefined,
				entryReference: undefined,
				detailId: undefined,
			});
	} finally {
		await server.stop(true);
	}
});

test("collection refuses missing consent, invalid contracts and provider failures without leaking bodies", async () => {
	let variant = "no-consent";
	const marker = "SYNTHETIC-PRIVATE-PROVIDER-BODY";
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			const uid = uids[0];
			const primary = "synthetic-primary";
			if (url.pathname.startsWith("/sessions/"))
				return Response.json({
					status: variant === "revoked" ? "REVOKED" : "AUTHORIZED",
					access: {
						...(variant === "unknown-consent"
							? {}
							: { transactions: variant !== "no-consent" }),
						valid_until: "2099-01-01T00:00:00Z",
					},
					aspsp: { name: "ING Synthetic", country: "NL" },
					accounts: [uid],
					accounts_data: [
						{
							uid,
							identification_hash: primary,
							identification_hashes: [primary],
						},
					],
				});
			if (url.pathname.endsWith("/details"))
				return Response.json({
					uid,
					currency: "EUR",
					cash_account_type: "CACC",
					identification_hash:
						variant === "changed-account" ? "changed" : primary,
					identification_hashes: [primary],
				});
			if (variant === "http-failure")
				return new Response(marker, { status: 500 });
			return Response.json({
				transactions: [
					{
						transaction_amount: {
							amount: variant === "numeric-money" ? 1.23 : "1.23",
							currency: "EUR",
						},
						credit_debit_indicator: "DBIT",
						status: "BOOK",
						booking_date:
							variant === "invalid-date" ? "2026-02-30" : "2026-10-02",
						note: marker,
					},
				],
				continuation_key: null,
			});
		},
	});
	try {
		for (const mode of [
			"legacy",
			"no-consent",
			"unknown-consent",
			"revoked",
			"changed-account",
			"numeric-money",
			"invalid-date",
			"http-failure",
		]) {
			variant = mode;
			const saved = syntheticSessions.slice(0, 1).map((session) => ({
				...session,
				requestedAccess:
					mode === "legacy" ? undefined : session.requestedAccess,
			}));
			const source = enableBankingSource(
				credentials(server.url.origin, saved),
				{ testMode: true, baseUrl: server.url.origin },
			);
			const result = await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const feed = (yield* source.open({}))[0];
						if (!feed) throw new Error("No feed");
						const account = (yield* feed.accounts())[0];
						if (!account) throw new Error("No account");
						return yield* feed.page(account, { strategy: "longest" });
					}),
				).pipe(
					Effect.match({
						onSuccess: () => ({ kind: "unexpected", message: "" }),
						onFailure: (e) => ({ kind: e.kind, message: e.message }),
					}),
				),
			);
			expect(result.kind).toBe(
				["legacy", "no-consent", "unknown-consent", "revoked"].includes(mode)
					? "Access"
					: "Provider",
			);
			expect(result.message).not.toContain(marker);
		}
	} finally {
		await server.stop(true);
	}
});

test("interrupting a page body read cancels HTTP work and releases the authentication scope", async () => {
	let held = false;
	let signalReady: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		signalReady = resolve;
	});
	let signalCancelled: () => void = () => {};
	const cancelled = new Promise<void>((resolve) => {
		signalCancelled = resolve;
	});
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			const uid = uids[0];
			const primary = "synthetic-primary";
			if (path.startsWith("/sessions/"))
				return Response.json({
					status: "AUTHORIZED",
					access: { transactions: true, valid_until: "2099-01-01T00:00:00Z" },
					aspsp: { name: "ING Synthetic", country: "NL" },
					accounts: [uid],
					accounts_data: [
						{
							uid,
							identification_hash: primary,
							identification_hashes: [primary],
						},
					],
				});
			if (path.endsWith("/details"))
				return Response.json({
					uid,
					currency: "EUR",
					cash_account_type: "CACC",
					identification_hash: primary,
					identification_hashes: [primary],
				});
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('{"transactions":['));
						signalReady();
					},
					cancel() {
						signalCancelled();
					},
				}),
			);
		},
	});
	try {
		const auth = {
			...credentials(server.url.origin, syntheticSessions.slice(0, 1)),
			exclusive: () =>
				Effect.acquireRelease(
					Effect.sync(() => {
						held = true;
					}),
					() =>
						Effect.sync(() => {
							held = false;
						}),
				),
		};
		const source = enableBankingSource(auth, {
			testMode: true,
			baseUrl: server.url.origin,
		});
		const controller = new AbortController();
		const pending = Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const feed = (yield* source.open({}))[0];
					if (!feed) throw new Error("No feed");
					const account = (yield* feed.accounts())[0];
					if (!account) throw new Error("No account");
					return yield* feed.page(account, { strategy: "longest" });
				}),
			),
			{ signal: controller.signal },
		);
		const settled = pending.then(
			() => undefined,
			() => undefined,
		);
		try {
			await deadline(ready);
			expect(held).toBe(true);
			controller.abort();
			await expect(deadline(pending)).rejects.toThrow();
			expect(held).toBe(false);
			await deadline(cancelled);
		} finally {
			controller.abort();
			await deadline(settled);
		}
	} finally {
		await server.stop(true);
	}
});
