import { Effect } from "effect";
import {
	type Account,
	type Collection,
	CollectionError,
	type DateRange,
	type QueryInput,
	type Selection,
	type SyncInput,
	type Window,
} from "./contract";

export const validate = (input: SyncInput & QueryInput) =>
	Effect.try({
		try: () => {
			const date = (value: string) =>
				/^\d{4}-\d{2}-\d{2}$/.test(value) &&
				Number.isFinite(Date.parse(value)) &&
				new Date(value).toISOString().slice(0, 10) === value;
			if (
				(input.from !== undefined && !date(input.from)) ||
				(input.to !== undefined && !date(input.to)) ||
				(input.from && input.to && input.from > input.to)
			)
				throw new Error("Invalid dates");
			if (
				(input.bank !== undefined &&
					(!input.bank.trim() || input.bank.length > 200)) ||
				(input.country !== undefined && !/^[A-Z]{2}$/.test(input.country))
			)
				throw new Error("Invalid selection");
			if (
				input.accountKeys !== undefined &&
				(!input.accountKeys.length ||
					input.accountKeys.length > 100 ||
					input.accountKeys.some((k) => !k || k.length > 256))
			)
				throw new Error("Invalid accounts");
			for (const [key, minimum, maximum] of [
				["overlapDays", 1, 365],
				["limit", 1, 10000],
				["offset", 0, 1000000],
			] as const) {
				if (key in input) {
					const value = input[key];
					if (
						value !== undefined &&
						(!Number.isInteger(value) || value < minimum || value > maximum)
					)
						throw new Error("Invalid bound");
				}
			}
			if (
				"text" in input &&
				input.text !== undefined &&
				(!input.text || input.text.length > 512)
			)
				throw new Error("Invalid text");
		},
		catch: () =>
			new CollectionError({
				kind: "Input",
				message: "Invalid collection/query selection, date range or bound.",
			}),
	});

export const selected = (
	account: {
		readonly bank: string;
		readonly country: string;
		readonly key: string;
	},
	input: Selection,
) =>
	(input.bank === undefined || account.bank === input.bank) &&
	(input.country === undefined || account.country === input.country) &&
	(input.accountKeys === undefined || input.accountKeys.includes(account.key));
export const dated = (date: string | undefined, range: DateRange) =>
	(!range.from || (date !== undefined && date >= range.from)) &&
	(!range.to || (date !== undefined && date <= range.to));

export function collectionWindow(
	collection: Collection,
	account: Account,
	input: SyncInput,
	now: string,
): Window {
	if (input.from || input.to)
		return { strategy: "default", from: input.from, to: input.to };
	const latest = collection.coverage
		.filter(
			(c) =>
				c.accountKey === account.key &&
				c.authorizationRevision === account.authorizationRevision &&
				c.incrementalCheckpoint !== undefined,
		)
		.at(-1);
	if (!latest?.incrementalCheckpoint) return { strategy: "longest" };
	const overlap = new Date(
		Date.parse(latest.incrementalCheckpoint) -
			(input.overlapDays ?? 7) * 86400000,
	)
		.toISOString()
		.slice(0, 10);
	const pending = collection.transactions.filter(
		(t) =>
			t.accountKey === account.key &&
			t.data.status === "pending" &&
			!t.supersededBy,
	);
	// Undated unresolved pending observations require another broad fetch.
	if (
		pending.some(
			(t) =>
				!t.data.bookingDate && !t.data.valueDate && !t.data.transactionDate,
		)
	)
		return { strategy: "longest" };
	const pendingDates = pending
		.flatMap((t) => [
			t.data.bookingDate ??
				t.data.valueDate ??
				t.data.transactionDate ??
				overlap,
		])
		.sort();
	return {
		strategy: "default",
		from:
			pendingDates[0] && pendingDates[0] < overlap ? pendingDates[0] : overlap,
		to: now.slice(0, 10),
	};
}
