import type { Account, Transaction, TransactionData, Window } from "./contract";
import { dated } from "./policy";

// Deliberate content identity excludes the provider's mutable detail ID. Full canonical
// content avoids hash collisions and is private data; never render these keys in summaries.
export const content = (data: TransactionData): string =>
	JSON.stringify([
		decimalIdentity(data.amount),
		data.currency,
		data.direction,
		data.status,
		data.bookingDate,
		data.valueDate,
		data.transactionDate,
		data.creditor,
		data.debtor,
		data.merchantCategoryCode,
		data.referenceNumber,
		data.referenceScheme,
		data.remittance,
		data.note,
		data.entryReference,
	]);

export function reconcile(
	previous: readonly Transaction[],
	account: Account,
	observations: readonly TransactionData[],
	now: string,
	window: Window,
): readonly Transaction[] {
	const accountKey = account.key;
	const origin = {
		providerAccountId: account.providerAccountId,
		authorizationRevision: account.authorizationRevision,
		sourceIdentity: account.sourceIdentity,
	};
	const records = new Map(previous.map((t) => [t.key, t]));
	const occurrences = new Map<string, number>();
	const observed = new Set<string>();
	for (const data of observations) {
		const signature = content(data);
		const ordinal = (occurrences.get(signature) ?? 0) + 1;
		occurrences.set(signature, ordinal);
		const stable = data.entryReference !== undefined;
		const key = stable
			? JSON.stringify([accountKey, "entry-reference", data.entryReference])
			: JSON.stringify([accountKey, "content", signature, ordinal]);
		const old = records.get(key);
		observed.add(key);
		if (old?.data.status === "booked" && data.status === "pending") {
			const last = old.revisions.at(-1);
			records.set(key, {
				...old,
				uncertain: true,
				revisions:
					last && content(last.data) === signature
						? old.revisions
						: [...old.revisions, { observedAt: now, data, origin }],
			});
			continue;
		}
		records.set(key, {
			...old,
			key,
			accountKey,
			data,
			identity: stable ? "entry-reference" : "content",
			origin: old?.origin ?? origin,
			latestOrigin: origin,
			firstSeenAt: old?.firstSeenAt ?? now,
			lastSeenAt: now,
			revisions: old
				? content(old.data) === signature && old.data.amount === data.amount
					? old.revisions
					: [
							...old.revisions,
							{
								observedAt: old.lastSeenAt,
								data: old.data,
								origin: old.latestOrigin,
							},
						]
				: [],
			uncertain: !stable || (old?.uncertain ?? false),
		});
	}
	// Inference requires one old pending and one observed booked candidate, a structured
	// reference, exact amount/direction/currency and a matching value/transaction date.
	// Both observations survive; inference is marked uncertain and can be inspected.
	const candidates = [...records.values()];
	const missingPending = candidates.filter(
		(t) =>
			t.accountKey === accountKey &&
			t.data.status === "pending" &&
			!observed.has(t.key) &&
			!t.supersededBy &&
			dated(
				t.data.bookingDate ?? t.data.valueDate ?? t.data.transactionDate,
				window,
			),
	);
	for (const pending of missingPending)
		records.set(pending.key, { ...pending, uncertain: true });
	const pendingIndex = indexed(missingPending);
	const bookedIndex = indexed(
		candidates.filter(
			(t) =>
				t.accountKey === accountKey &&
				t.data.status === "booked" &&
				!t.supersededBy,
		),
	);
	const plausibleKeys = new Set(
		missingPending.flatMap((t) => partyKeys(t.data)),
	);
	for (const booked of candidates.filter(
		(t) =>
			t.accountKey === accountKey &&
			t.data.status === "booked" &&
			observed.has(t.key) &&
			!t.supersedes,
	)) {
		const keys = transitionKeys(booked.data);
		const matches = lookup(pendingIndex, keys);
		if (partyKeys(booked.data).some((key) => plausibleKeys.has(key)))
			records.set(booked.key, { ...booked, uncertain: true });
		if (matches.length === 1) {
			const pending = matches[0];
			if (
				pending &&
				!records.get(pending.key)?.supersededBy &&
				lookup(bookedIndex, transitionKeys(pending.data)).length === 1
			) {
				records.set(pending.key, {
					...pending,
					supersededBy: booked.key,
					uncertain: true,
				});
				records.set(booked.key, {
					...booked,
					supersedes: pending.key,
					uncertain: true,
				});
			}
		}
	}
	return [...records.values()];
}

function transitionKeys(data: TransactionData): readonly string[] {
	if (!data.referenceNumber?.trim() || !data.referenceScheme?.trim()) return [];
	const base = [
		data.referenceNumber,
		data.referenceScheme,
		decimalIdentity(data.amount),
		data.currency,
		data.direction,
		data.creditor,
		data.debtor,
	];
	return [
		["transaction", data.transactionDate],
		["value", data.valueDate],
	].flatMap(([field, date]) =>
		date ? [JSON.stringify([...base, field, date])] : [],
	);
}
function indexed(
	rows: readonly Transaction[],
): ReadonlyMap<string, readonly Transaction[]> {
	const index = new Map<string, Transaction[]>();
	for (const row of rows)
		for (const key of transitionKeys(row.data)) {
			const values = index.get(key) ?? [];
			values.push(row);
			index.set(key, values);
		}
	return index;
}
function lookup(
	index: ReadonlyMap<string, readonly Transaction[]>,
	keys: readonly string[],
): readonly Transaction[] {
	return [
		...new Map(
			keys.flatMap((key) => index.get(key) ?? []).map((row) => [row.key, row]),
		).values(),
	];
}
function partyKeys(data: TransactionData): readonly string[] {
	return [
		["creditor", data.creditor],
		["debtor", data.debtor],
	].flatMap(([field, name]) =>
		name
			? [
					JSON.stringify([
						decimalIdentity(data.amount),
						data.currency,
						data.direction,
						field,
						name,
					]),
				]
			: [],
	);
}

function decimalIdentity(value: string): string {
	const negative = value.startsWith("-");
	const [whole = "0", fraction = ""] = value.replace(/^-/, "").split(".");
	const integer = whole.replace(/^0+(?=\d)/, "");
	const decimals = fraction.replace(/0+$/, "");
	const result = decimals ? `${integer}.${decimals}` : integer;
	return negative && result !== "0" ? `-${result}` : result;
}
