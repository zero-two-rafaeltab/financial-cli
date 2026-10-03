import { expect, test } from "bun:test";
import { Clock, Effect, Layer } from "effect";
import {
	type Account,
	type BankFeed,
	type Collection,
	CollectionError,
	type Page,
	query,
	Source,
	Store,
	sync,
	type TransactionData,
	type Window,
} from "../src/capabilities/transactions";
import { deadline } from "./runtime-fixture";

const empty: Collection = {
	accounts: [],
	transactions: [],
	coverage: [],
	banks: [],
};
const account: Account = {
	provider: "synthetic",
	bankKey: "synthetic-ing",
	key: "synthetic-ing-account",
	bank: "ING Synthetic",
	country: "NL",
	currency: "EUR",
	providerAccountId: "synthetic-uid",
	identificationHash: "synthetic-primary-hash",
	sourceIdentity: "synthetic-app",
	authorizationRevision: "synthetic-consent-one",
};
const row: TransactionData = {
	amount: "9007199254740993.001",
	currency: "EUR",
	direction: "debit",
	status: "booked",
	bookingDate: "2026-10-02",
	valueDate: "2026-10-01",
	creditor: "Synthetic shop",
	referenceNumber: "synthetic-reference",
	referenceScheme: "INTL",
	remittance: ["synthetic groceries"],
	entryReference: "archive-one",
};
function fixture(
	pages: (
		cursor: string | undefined,
		window: Window,
	) => Effect.Effect<
		Page,
		import("../src/capabilities/transactions").CollectionError
	>,
	initial = empty,
	getAccounts: () => readonly Account[] = () => [account],
	clockNow: () => number = () => Date.parse("2026-10-20T12:00:00Z"),
) {
	let state = structuredClone(initial);
	let held = false;
	const feed: BankFeed = {
		key: "synthetic-ing",
		bank: account.bank,
		country: account.country,
		accounts: () => Effect.succeed(getAccounts()),
		page: (_account, window, cursor) => pages(cursor, window),
	};
	const services = Layer.mergeAll(
		Layer.succeed(Clock.Clock, {
			...Effect.runSync(Clock.Clock),
			currentTimeMillis: Effect.sync(clockNow),
			currentTimeMillisUnsafe: clockNow,
		}),
		Layer.succeed(Source, { open: () => Effect.succeed([feed]) }),
		Layer.succeed(Store, {
			exclusive: () =>
				Effect.acquireRelease(
					Effect.suspend(() =>
						held
							? Effect.fail(
									new CollectionError({
										kind: "Storage",
										message: "Contention",
									}),
								)
							: Effect.sync(() => {
									held = true;
								}),
					),
					() =>
						Effect.sync(() => {
							held = false;
						}),
				),
			read: () => Effect.sync(() => structuredClone(state)),
			replace: (next) =>
				Effect.suspend(() =>
					!held
						? Effect.fail(
								new CollectionError({
									kind: "Storage",
									message: "Lock required",
								}),
							)
						: Effect.sync(() => {
								state = structuredClone(next);
							}),
				),
		}),
	);
	return { services, read: () => state };
}

test("public Effect sync follows every page and typed query retains exact money and provenance", async () => {
	const seen: (string | undefined)[] = [];
	const f = fixture((cursor, window) => {
		seen.push(cursor);
		expect(window).toEqual({ strategy: "longest" });
		return Effect.succeed(
			cursor === undefined
				? { transactions: [row], next: "page-two" }
				: {
						transactions: [
							{
								...row,
								entryReference: "archive-two",
								amount: "0.010",
								status: "pending",
							},
						],
					},
		);
	});
	const result = await Effect.runPromise(
		sync().pipe(Effect.provide(f.services)),
	);
	expect(result.banks).toEqual([
		{
			bank: "ING Synthetic",
			country: "NL",
			outcome: "complete",
			accounts: 1,
			transactions: 2,
			uncertain: 0,
		},
	]);
	expect(seen).toEqual([undefined, "page-two"]);
	const found = await Effect.runPromise(
		query({ status: "booked", from: "2026-10-02", currency: "EUR" }).pipe(
			Effect.provide(f.services),
		),
	);
	expect(found.matched).toBe(1);
	expect(found.transactions[0]?.data).toEqual(row);
	expect(found.transactions[0]?.accountKey).toBe(account.key);
	expect(found.coverage[0]).toMatchObject({
		pages: 2,
		history: "provider-limited",
		observedFrom: "2026-10-02",
	});
});

test("one pending matching two booked candidates through different dates remains visible", async () => {
	let booked = false;
	const f = fixture(() =>
		Effect.succeed({
			transactions: booked
				? [
						{
							...row,
							entryReference: "booked-transaction",
							transactionDate: "2026-10-01",
							valueDate: "2026-10-03",
						},
						{
							...row,
							entryReference: "booked-value",
							transactionDate: "2026-10-03",
							valueDate: "2026-10-02",
						},
					]
				: [
						{
							...row,
							entryReference: "pending",
							status: "pending",
							transactionDate: "2026-10-01",
							valueDate: "2026-10-02",
						},
					],
		}),
	);
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	booked = true;
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	const result = await Effect.runPromise(
		query().pipe(Effect.provide(f.services)),
	);
	expect(result.matched).toBe(3);
	expect(
		result.transactions.every(
			(t) => t.uncertain && !t.supersedes && !t.supersededBy,
		),
	).toBe(true);
});

test("overlapping reruns reconcile stable IDs, duplicate pages and pending-to-booked changes without floating point", async () => {
	let run = 0;
	const windows: Window[] = [];
	const f = fixture((cursor, window) => {
		windows.push(window);
		const data = {
			...row,
			amount: "12.3400",
			status: run === 0 ? ("pending" as const) : ("booked" as const),
			detailId: `unstable-${run}-${cursor}`,
		};
		return Effect.succeed({
			transactions: [data],
			...(cursor === undefined ? { next: "duplicate" } : {}),
		});
	});
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	run++;
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	const state = f.read();
	expect(state.transactions).toHaveLength(1);
	expect(state.transactions[0]?.data.status).toBe("booked");
	expect(state.transactions[0]?.data.amount).toBe("12.3400");
	expect(state.transactions[0]?.revisions[0]?.data.status).toBe("pending");
	expect(state.coverage.at(-1)?.duplicates).toBe(1);
	expect(windows[2]?.strategy).toBe("default");
	expect(windows[2]?.from).toBe("2026-10-02"); // oldest unresolved pending precedes the seven-day overlap only when older
});

test("late page failure preserves the previous bank snapshot and completed freshness", async () => {
	let fail = false;
	const f = fixture((cursor) =>
		fail
			? cursor
				? Effect.fail(
						new CollectionError({
							kind: "Provider",
							message: "Synthetic failure",
						}),
					)
				: Effect.succeed({
						transactions: [{ ...row, amount: "99" }],
						next: "failure",
					})
			: Effect.succeed({ transactions: [row] }),
	);
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	const before = structuredClone(f.read());
	fail = true;
	const result = await Effect.runPromise(
		sync().pipe(Effect.provide(f.services)),
	);
	expect(result.banks[0]).toMatchObject({
		outcome: "failed",
		failureKind: "Provider",
		accounts: 1,
		transactions: 1,
	});
	expect(f.read().transactions).toEqual(before.transactions);
	expect(f.read().coverage).toEqual(before.coverage);
	expect(f.read().banks[0]).toMatchObject({
		outcome: "failed",
		lastCompletedAt: before.banks[0]?.lastCompletedAt,
	});
});

test("ID-less multiplicity survives unstable detail IDs; unique reference transition retains a supersession trail", async () => {
	let booked = false;
	const f = fixture(() =>
		Effect.succeed({
			transactions: [
				{
					...row,
					entryReference: undefined,
					referenceNumber: "unique-reference",
					detailId: booked ? "changed-detail" : undefined,
					status: booked ? "booked" : "pending",
					bookingDate: booked ? "2026-10-03" : "2026-10-02",
				},
				...Array.from({ length: 2 }, () => ({
					...row,
					entryReference: undefined,
					referenceNumber: undefined,
					amount: "1.00",
					detailId: booked ? "changed" : "old",
				})),
			],
		}),
	);
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	booked = true;
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	const found = await Effect.runPromise(
		query().pipe(Effect.provide(f.services)),
	);
	expect(found.transactions).toHaveLength(3);
	expect(found.transactions.every((t) => t.uncertain)).toBe(true);
	expect(
		found.transactions.filter((t) => t.data.amount === "1.00"),
	).toHaveLength(2);
	const all = await Effect.runPromise(
		query({ includeSuperseded: true }).pipe(Effect.provide(f.services)),
	);
	expect(all.transactions).toHaveLength(4);
	const prior = all.transactions.find((t) => t.data.status === "pending");
	const successor = all.transactions.find(
		(t) =>
			t.data.referenceNumber === "unique-reference" &&
			t.data.status === "booked",
	);
	expect(prior?.supersededBy).toBe(successor?.key);
	expect(successor?.supersedes).toBe(prior?.key);
});

test("pending and booked observations without a nonempty reference scheme remain visible", async () => {
	for (const referenceScheme of [undefined, "", " "]) {
		let booked = false;
		const f = fixture(() =>
			Effect.succeed({
				transactions: [
					{
						...row,
						referenceScheme,
						entryReference: booked ? "new-booked" : "old-pending",
						status: booked ? "booked" : "pending",
					},
				],
			}),
		);
		await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
		booked = true;
		await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
		const result = await Effect.runPromise(
			query().pipe(Effect.provide(f.services)),
		);
		expect(result.matched).toBe(2);
		expect(
			result.transactions.every(
				(t) => t.uncertain && !t.supersedes && !t.supersededBy,
			),
		).toBe(true);
	}
});

test("a repeated cursor fails the bank instead of claiming partial success", async () => {
	let calls = 0;
	const f = fixture(() =>
		++calls > 3
			? Effect.fail(
					new CollectionError({
						kind: "Provider",
						message: "Fixture safety stop",
					}),
				)
			: Effect.succeed({ transactions: [row], next: "same-cursor" }),
	);
	const result = await Effect.runPromise(
		sync().pipe(Effect.provide(f.services)),
	);
	expect(result.banks[0]?.failureKind).toBe("Limit");
	expect(calls).toBe(2);
	expect(f.read().transactions).toEqual([]);
});

test("typed queries apply text, date field and stable pagination, reporting undated rows and rejecting invalid ranges", async () => {
	const f = fixture(() =>
		Effect.succeed({
			transactions: [
				row,
				{ ...row, entryReference: "undated", bookingDate: undefined },
				{ ...row, entryReference: "later", bookingDate: "2026-10-04" },
			],
		}),
	);
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	const result = await Effect.runPromise(
		query({ text: "groceries", from: "2026-10-01", limit: 1, offset: 1 }).pipe(
			Effect.provide(f.services),
		),
	);
	expect(result.matched).toBe(2);
	expect(result.undated).toBe(1);
	expect(result.transactions).toHaveLength(1);
	expect(result.transactions[0]?.data.bookingDate).toBe("2026-10-04");
	expect(
		(
			await Effect.runPromise(
				query({
					dateField: "valueDate",
					to: "2026-10-01",
					text: "absent",
				}).pipe(Effect.provide(f.services)),
			)
		).matched,
	).toBe(0);
	for (const input of [
		{ from: "2026-02-30" },
		{ from: "2026-10-03", to: "2026-10-01" },
		{ limit: 0 },
		{ offset: -1 },
	])
		await expect(
			Effect.runPromise(query(input).pipe(Effect.provide(f.services))),
		).rejects.toMatchObject({ kind: "Input" });
	await expect(
		Effect.runPromise(
			sync({ overlapDays: 0 }).pipe(Effect.provide(f.services)),
		),
	).rejects.toMatchObject({ kind: "Input" });
});

test("account selection cannot claim full-bank freshness; explicit old ranges do not advance the incremental checkpoint", async () => {
	const windows: Window[] = [];
	const f = fixture((_cursor, window) => {
		windows.push(window);
		return Effect.succeed({ transactions: [row] });
	});
	await Effect.runPromise(
		sync({ from: "2020-01-01", to: "2020-02-01" }).pipe(
			Effect.provide(f.services),
		),
	);
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	expect(windows[1]).toEqual({ strategy: "longest" });
	await Effect.runPromise(
		sync({ accountKeys: [account.key] }).pipe(Effect.provide(f.services)),
	);
	expect(f.read().banks[0]?.selection).toBe("selected-accounts");
	expect(
		await Effect.runPromise(
			sync({ bank: "Unknown synthetic bank" }).pipe(Effect.provide(f.services)),
		),
	).toEqual({ outcome: "no-sessions", banks: [] });
	expect(
		await Effect.runPromise(
			sync({ accountKeys: ["unknown-account"] }).pipe(
				Effect.provide(f.services),
			),
		),
	).toMatchObject({ outcome: "no-accounts", banks: [{ outcome: "skipped" }] });
});

test("interruption retains prior data and running attempt metadata, releases its lock and publishes no late rows", async () => {
	let hanging = false;
	let ready: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		ready = resolve;
	});
	let finish: (page: Page) => void = () => {};
	const f = fixture(() =>
		hanging
			? Effect.tryPromise({
					try: () => {
						ready();
						return new Promise<Page>((resolve) => {
							finish = resolve;
						});
					},
					catch: () =>
						new CollectionError({
							kind: "Provider",
							message: "Synthetic interruption",
						}),
				})
			: Effect.succeed({ transactions: [row] }),
	);
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	const before = structuredClone(f.read());
	hanging = true;
	const controller = new AbortController();
	const pending = Effect.runPromise(sync().pipe(Effect.provide(f.services)), {
		signal: controller.signal,
	});
	const settled = pending.then(
		() => undefined,
		() => undefined,
	);
	try {
		await deadline(started);
		controller.abort();
		await expect(deadline(pending)).rejects.toThrow();
		finish({ transactions: [{ ...row, amount: "999" }] });
		expect(f.read().transactions).toEqual(before.transactions);
		expect(f.read().coverage).toEqual(before.coverage);
		expect(f.read().banks[0]?.outcome).toBe("running");
		hanging = false;
		await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
		expect(f.read().banks[0]?.outcome).toBe("complete");
	} finally {
		controller.abort();
		finish({ transactions: [] });
		await deadline(settled);
	}
});

test("renewed authorization requests broad history again and preserves original and latest collection provenance", async () => {
	let active = account;
	const windows: Window[] = [];
	const f = fixture(
		(_cursor, window) => {
			windows.push(window);
			return Effect.succeed({ transactions: [row] });
		},
		empty,
		() => [active],
	);
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	active = {
		...account,
		providerAccountId: "synthetic-renewed-uid",
		authorizationRevision: "synthetic-consent-two",
	};
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	expect(windows).toEqual([{ strategy: "longest" }, { strategy: "longest" }]);
	expect(f.read().transactions).toHaveLength(1);
	expect(f.read().transactions[0]?.origin).toMatchObject({
		providerAccountId: "synthetic-uid",
		authorizationRevision: "synthetic-consent-one",
	});
	expect(f.read().transactions[0]?.latestOrigin).toMatchObject({
		providerAccountId: "synthetic-renewed-uid",
		authorizationRevision: "synthetic-consent-two",
	});
	expect(f.read().coverage[0]?.providerAccountId).toBe("synthetic-uid");
});

test("ambiguous pending transitions are retained and flagged; repeated ID-less pages preserve possible real multiplicity", async () => {
	let booked = false;
	const f = fixture(() =>
		Effect.succeed({
			transactions: booked
				? [{ ...row, entryReference: "booked-new" }]
				: ["pending-one", "pending-two"].map((entryReference) => ({
						...row,
						entryReference,
						status: "pending" as const,
					})),
		}),
	);
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	booked = true;
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	const result = await Effect.runPromise(
		query().pipe(Effect.provide(f.services)),
	);
	expect(result.matched).toBe(3);
	expect(result.transactions.every((t) => t.uncertain && !t.supersededBy)).toBe(
		true,
	);
	const idless = fixture((cursor) =>
		Effect.succeed({
			transactions: [{ ...row, entryReference: undefined }],
			...(cursor === undefined ? { next: "identical-content-next-page" } : {}),
		}),
	);
	await Effect.runPromise(sync().pipe(Effect.provide(idless.services)));
	await Effect.runPromise(sync().pipe(Effect.provide(idless.services)));
	expect(idless.read().transactions).toHaveLength(2);
	expect(idless.read().transactions.every((t) => t.uncertain)).toBe(true);
});

test("ID-less amount formatting changes preserve numeric identity and exact observed decimal strings", async () => {
	let amount = "001.2300";
	const f = fixture(() =>
		Effect.succeed({
			transactions: [{ ...row, amount, entryReference: undefined }],
		}),
	);
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	amount = "1.23";
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	expect(f.read().transactions).toHaveLength(1);
	expect(f.read().transactions[0]?.data.amount).toBe("1.23");
	expect(f.read().transactions[0]?.revisions[0]?.data.amount).toBe("001.2300");
});

test("coverage records completion time rather than the time before slow pagination", async () => {
	let time = Date.parse("2026-10-20T12:00:00Z");
	const f = fixture(
		() => {
			time += 600000;
			return Effect.succeed({ transactions: [row] });
		},
		empty,
		() => [account],
		() => time,
	);
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	expect(f.read().banks[0]?.lastAttemptAt).toBe("2026-10-20T12:00:00.000Z");
	expect(f.read().banks[0]?.lastCompletedAt).toBe("2026-10-20T12:10:00.000Z");
	expect(f.read().coverage[0]?.completedAt).toBe("2026-10-20T12:10:00.000Z");
});

test("a regressing pending observation never demotes booked data and remains visible as an uncertain revision", async () => {
	let pending = false;
	const f = fixture(() =>
		Effect.succeed({
			transactions: [{ ...row, status: pending ? "pending" : "booked" }],
		}),
	);
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	pending = true;
	await Effect.runPromise(sync().pipe(Effect.provide(f.services)));
	expect(f.read().transactions[0]?.data.status).toBe("booked");
	expect(f.read().transactions[0]?.revisions.at(-1)?.data.status).toBe(
		"pending",
	);
	expect(f.read().transactions[0]?.uncertain).toBe(true);
});
