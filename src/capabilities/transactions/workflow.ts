import { Clock, Effect } from "effect";
import {
	type BankFeed,
	type BankSyncResult,
	type Collection,
	CollectionError,
	type Coverage,
	type QueryInput,
	type QueryResult,
	Source,
	Store,
	type SyncInput,
	type SyncResult,
} from "./contract";
import { collectionWindow, dated, selected, validate } from "./policy";
import { content, reconcile } from "./reconciliation";

export const sync = (
	input: SyncInput = {},
): Effect.Effect<
	SyncResult,
	import("./contract").CollectionError,
	Source | Store
> =>
	Effect.scoped(
		Effect.gen(function* () {
			yield* validate(input);
			const store = yield* Store;
			const source = yield* Source;
			yield* store.exclusive();
			let collection = yield* store.read();
			const feeds = (yield* source.open(input)).filter(
				(f) =>
					(input.bank === undefined || f.bank === input.bank) &&
					(input.country === undefined || f.country === input.country),
			);
			if (feeds.length === 0) return { outcome: "no-sessions", banks: [] };
			const results: BankSyncResult[] = [];
			for (const feed of feeds) {
				const now = new Date(yield* Clock.currentTimeMillis).toISOString();
				const previousBank = collection.banks.find((b) => b.key === feed.key);
				const running = {
					key: feed.key,
					bank: feed.bank,
					country: feed.country,
					outcome: "running" as const,
					lastAttemptAt: now,
					selection: input.accountKeys
						? ("selected-accounts" as const)
						: ("all-accounts" as const),
					lastCompletedAt: previousBank?.lastCompletedAt,
				};
				collection = {
					...collection,
					banks: [
						...collection.banks.filter((b) => b.key !== feed.key),
						running,
					],
				};
				yield* store.replace(collection);
				const outcome = yield* collectBank(collection, feed, input, now).pipe(
					Effect.match({
						onSuccess: (value) => ({ ok: true as const, value }),
						onFailure: (error) => ({ ok: false as const, error }),
					}),
				);
				if (!outcome.ok) {
					collection = {
						...collection,
						banks: [
							...collection.banks.filter((b) => b.key !== feed.key),
							{
								...running,
								outcome: "failed",
								failureKind: outcome.error.kind,
							},
						],
					};
					yield* store.replace(collection);
					const previousAccounts = collection.accounts.filter(
						(a) => a.bankKey === feed.key && selected(a, input),
					);
					const retained = counts(collection, previousAccounts);
					results.push({
						bank: feed.bank,
						country: feed.country,
						outcome: "failed",
						failureKind: outcome.error.kind,
						...retained,
					});
					continue;
				}
				if (outcome.value.accounts.length === 0) {
					collection = {
						...collection,
						banks: [
							...collection.banks.filter((b) => b.key !== feed.key),
							...(previousBank ? [previousBank] : []),
						],
					};
					yield* store.replace(collection);
					results.push({
						bank: feed.bank,
						country: feed.country,
						outcome: "skipped",
						accounts: 0,
						transactions: 0,
						uncertain: 0,
					});
					continue;
				}
				const accounts = outcome.value.accounts;
				let next = outcome.value.next;
				const completedAt = new Date(
					yield* Clock.currentTimeMillis,
				).toISOString();
				next = {
					...next,
					banks: [
						...next.banks.filter((b) => b.key !== feed.key),
						{
							key: feed.key,
							bank: feed.bank,
							country: feed.country,
							outcome: "complete",
							lastAttemptAt: now,
							selection: input.accountKeys
								? ("selected-accounts" as const)
								: ("all-accounts" as const),
							lastCompletedAt:
								input.accountKeys || input.from || input.to
									? previousBank?.lastCompletedAt
									: completedAt,
						},
					],
				};
				yield* store.replace(next);
				collection = next;
				results.push({
					bank: feed.bank,
					country: feed.country,
					outcome: "complete",
					...counts(next, accounts),
				});
			}
			return {
				outcome: results.every((r) => r.outcome === "skipped")
					? "no-accounts"
					: "attempted",
				banks: results,
			};
		}),
	);

export const query = (
	input: QueryInput = {},
): Effect.Effect<QueryResult, CollectionError, Store> =>
	Effect.gen(function* () {
		yield* validate(input);
		const store = yield* Store;
		const collection = yield* store.read();
		const accounts = collection.accounts.filter((a) => selected(a, input));
		const keys = new Set(accounts.map((a) => a.key));
		const field = input.dateField ?? "bookingDate";
		const candidates = collection.transactions.filter((t) => {
			const text = [
				t.data.creditor,
				t.data.debtor,
				t.data.referenceNumber,
				t.data.note,
				...t.data.remittance,
			]
				.filter(Boolean)
				.join(" ")
				.toLocaleLowerCase("en");
			return (
				keys.has(t.accountKey) &&
				(input.includeSuperseded || !t.supersededBy) &&
				(!input.status || t.data.status === input.status) &&
				(!input.currency || t.data.currency === input.currency) &&
				(!input.direction || t.data.direction === input.direction) &&
				(!input.text || text.includes(input.text.toLocaleLowerCase("en")))
			);
		});
		const matched = candidates
			.filter((t) => dated(t.data[field], input))
			.sort(
				(a, b) =>
					(a.data[field] ?? "9999").localeCompare(b.data[field] ?? "9999") ||
					a.key.localeCompare(b.key),
			);
		return {
			accounts,
			transactions: matched.slice(
				input.offset ?? 0,
				(input.offset ?? 0) + (input.limit ?? 1000),
			),
			matched: matched.length,
			undated: candidates.filter((t) => t.data[field] === undefined).length,
			coverage: collection.coverage.filter((c) => keys.has(c.accountKey)),
			banks: collection.banks.filter(
				(b) =>
					(input.bank === undefined || input.bank === b.bank) &&
					(input.country === undefined || input.country === b.country),
			),
		};
	});

function counts(
	collection: Collection,
	accounts: readonly import("./contract").Account[],
) {
	const keys = new Set(accounts.map((a) => a.key));
	const rows = collection.transactions.filter(
		(t) => keys.has(t.accountKey) && !t.supersededBy,
	);
	return {
		accounts: accounts.length,
		transactions: rows.length,
		uncertain: rows.filter((t) => t.uncertain).length,
	};
}

function collectBank(
	collection: Collection,
	feed: BankFeed,
	input: SyncInput,
	startedAt: string,
) {
	return Effect.gen(function* () {
		const accounts = (yield* feed.accounts()).filter((a) => selected(a, input));
		let next: Collection = {
			...collection,
			accounts: [
				...collection.accounts.filter(
					(a) => !accounts.some((n) => n.key === a.key),
				),
				...accounts,
			],
		};
		for (const account of accounts) {
			const window = collectionWindow(collection, account, input, startedAt);
			const observations: import("./contract").TransactionData[] = [];
			const signatures = new Set<string>();
			const cursors = new Set<string>();
			let cursor: string | undefined;
			let pages = 0;
			let duplicates = 0;
			do {
				const page = yield* feed.page(account, window, cursor);
				pages++;
				if (
					pages > 1000 ||
					observations.length + page.transactions.length > 200000
				)
					return yield* Effect.fail(
						new CollectionError({
							kind: "Limit",
							message:
								"Collection limit reached; prior transactions preserved.",
						}),
					);
				const signature = JSON.stringify(page.transactions.map(content));
				if (
					signatures.has(signature) &&
					page.transactions.every((t) => t.entryReference !== undefined)
				)
					duplicates += page.transactions.length;
				else {
					signatures.add(signature);
					observations.push(...page.transactions);
				}
				cursor = page.next;
				if (cursor !== undefined) {
					if (cursors.has(cursor))
						return yield* Effect.fail(
							new CollectionError({
								kind: "Limit",
								message:
									"Provider repeated a pagination cursor; prior transactions preserved.",
							}),
						);
					cursors.add(cursor);
				}
			} while (cursor !== undefined);
			const dates = observations
				.flatMap((r) => (r.bookingDate ? [r.bookingDate] : []))
				.sort();
			const completedAt = new Date(
				yield* Clock.currentTimeMillis,
			).toISOString();
			const coverage: Coverage = {
				accountKey: account.key,
				providerAccountId: account.providerAccountId,
				sourceIdentity: account.sourceIdentity,
				authorizationRevision: account.authorizationRevision,
				completedAt,
				incrementalCheckpoint:
					input.from || input.to ? undefined : startedAt.slice(0, 10),
				window,
				pages,
				observations: observations.length,
				duplicates,
				history: "provider-limited",
				observedFrom: dates[0],
				observedTo: dates.at(-1),
			};
			next = {
				...next,
				transactions: reconcile(
					next.transactions,
					account,
					observations,
					completedAt,
					window,
				),
				coverage: [...next.coverage, coverage],
			};
		}
		return { next, accounts };
	});
}
