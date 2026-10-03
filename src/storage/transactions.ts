import { closeSync, constants, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import {
	type Collection,
	CollectionError,
	type TransactionStore,
} from "../capabilities/transactions";
import { privateFiles } from "./files";
import type { StorageLocations } from "./index";
import { CollectionSchema, RecordSchema } from "./transaction-schema";

export function localTransactionStore(
	locations: Pick<StorageLocations, "stateHome" | "checkout">,
): TransactionStore {
	const dir = join(locations.stateHome, "financial-cli");
	const maxBytes = 64 * 1024 * 1024;
	const files = privateFiles(locations.checkout, maxBytes);
	let held = false;
	const safely = <A>(body: () => A) =>
		Effect.try({
			try: body,
			catch: () =>
				new CollectionError({
					kind: "Storage",
					message:
						"Unable to access transaction storage safely. Check private paths, permissions and .transactions-lock; never remove a lock while a sync is active.",
				}),
		});
	const validated = (input: unknown): Collection => {
		const value = Schema.decodeUnknownSync(CollectionSchema)(input);
		const accounts = new Set(value.accounts.map((a) => a.key));
		const transactions = new Set(value.transactions.map((t) => t.key));
		if (
			accounts.size !== value.accounts.length ||
			transactions.size !== value.transactions.length ||
			new Set(value.banks.map((b) => b.key)).size !== value.banks.length ||
			value.transactions.some(
				(t) =>
					!accounts.has(t.accountKey) ||
					(t.supersededBy !== undefined && !transactions.has(t.supersededBy)) ||
					(t.supersedes !== undefined && !transactions.has(t.supersedes)),
			) ||
			value.coverage.some((c) => !accounts.has(c.accountKey))
		)
			throw new Error("Invalid collection references");
		return value;
	};
	return {
		exclusive: () =>
			Effect.gen(function* () {
				yield* Effect.acquireRelease(
					safely(() => {
						files.directory(dir);
						const lock = join(dir, ".transactions-lock");
						const fd = openSync(
							lock,
							constants.O_WRONLY |
								constants.O_CREAT |
								constants.O_EXCL |
								constants.O_NOFOLLOW,
							0o600,
						);
						held = true;
						return { fd, lock };
					}),
					({ fd, lock }) =>
						Effect.sync(() => {
							try {
								closeSync(fd);
							} finally {
								held = false;
								rmSync(lock, { force: true });
							}
						}),
				);
			}),
		read: () =>
			safely(() => {
				const text = files.read(dir, "transactions.json", true);
				return text === undefined
					? { accounts: [], transactions: [], coverage: [], banks: [] }
					: validated(
							Schema.decodeUnknownSync(RecordSchema)(JSON.parse(text))
								.collection,
						);
			}),
		replace: (collection) =>
			safely(() => {
				if (!held) throw new Error("Exclusive scope required");
				const text = JSON.stringify({
					version: 1,
					collection: validated(collection),
				});
				if (Buffer.byteLength(text) > maxBytes)
					throw new Error("Collection exceeds storage bound");
				files.write(dir, "transactions.json", text);
			}),
	};
}
