// Executable composition example. No filesystem, credentials, provider access or CLI parsing.
import { Effect, Layer } from "effect";
import {
	type Account,
	type BankFeed,
	type Collection,
	CollectionError,
	query,
	Source,
	Store,
	sync,
	type TransactionData,
	type TransactionStore,
} from "../src/capabilities/transactions";

const account = (bank: string, currency: string): Account => ({
	provider: "synthetic",
	bankKey: `synthetic-feed-${bank}`,
	key: `synthetic-${bank}`,
	bank,
	country: "NL",
	currency,
	providerAccountId: `synthetic-${bank}-uid`,
	identificationHash: `synthetic-${bank}-hash`,
	sourceIdentity: "synthetic-application",
	authorizationRevision: "synthetic-consent",
});
const ing = account("ING Synthetic", "EUR");
const revolut = account("Revolut Synthetic", "GBP");
let pending = true;
const transaction = (account: Account): TransactionData => ({
	amount: account.currency === "EUR" ? "9007199254740993.0010" : "7.50",
	currency: account.currency,
	direction: "debit",
	status: account.currency === "EUR" && pending ? "pending" : "booked",
	bookingDate: "2026-10-02",
	valueDate: "2026-10-01",
	creditor: "Synthetic shop",
	referenceNumber: "synthetic-reference",
	remittance: ["synthetic purchase"],
	entryReference: "synthetic-archive",
});
const feeds: readonly BankFeed[] = [ing, revolut].map((a) => ({
	key: `synthetic-feed-${a.bank}`,
	bank: a.bank,
	country: a.country,
	accounts: () => Effect.succeed([a]),
	page: (_account, _window, cursor) =>
		Effect.succeed({
			transactions: [transaction(a)],
			...(a === ing && cursor === undefined
				? { next: "synthetic-duplicate-page" }
				: {}),
		}),
}));
let collection: Collection = {
	accounts: [],
	transactions: [],
	coverage: [],
	banks: [],
};
let held = false;
const contention = () =>
	new CollectionError({
		kind: "Storage",
		message: "Synthetic store requires an exclusive writer.",
	});
const memory: TransactionStore = {
	exclusive: () =>
		Effect.acquireRelease(
			Effect.try({
				try: () => {
					if (held) throw contention();
					held = true;
				},
				catch: contention,
			}),
			() =>
				Effect.sync(() => {
					held = false;
				}),
		),
	read: () => Effect.sync(() => structuredClone(collection)),
	replace: (value) =>
		Effect.try({
			try: () => {
				if (!held) throw contention();
				collection = structuredClone(value);
			},
			catch: contention,
		}),
};
const services = Layer.mergeAll(
	Layer.succeed(Source, { open: () => Effect.succeed(feeds) }),
	Layer.succeed(Store, memory),
);
const program = Effect.gen(function* () {
	yield* sync();
	pending = false;
	const synchronized = yield* sync();
	const booked = yield* query({
		status: "booked",
		from: "2026-10-01",
		to: "2026-10-03",
	});
	// Consumers compose typed values and effects, never terminal strings.
	const exactAmounts = booked.transactions.map((t) => t.data.amount);
	return {
		synthetic: true,
		synchronizedBanks: synchronized.banks.length,
		bookedCount: booked.matched,
		exactAmounts,
		history: booked.coverage.at(-1)?.history,
	};
});
console.log(
	JSON.stringify(
		await Effect.runPromise(program.pipe(Effect.provide(services))),
		null,
		2,
	),
);
