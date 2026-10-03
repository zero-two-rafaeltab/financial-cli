import { Schema } from "effect";

const optional = Schema.optional;
const text = Schema.String;
const nonempty = Schema.NonEmptyString;
const timestamp = Schema.String.check(
	Schema.makeFilter(
		(s) =>
			/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(s) &&
			Number.isFinite(Date.parse(s)),
	),
);
const date = Schema.String.check(
	Schema.makeFilter(
		(s) =>
			/^\d{4}-\d{2}-\d{2}$/.test(s) &&
			Number.isFinite(Date.parse(s)) &&
			new Date(s).toISOString().slice(0, 10) === s,
	),
);
const natural = Schema.Int.check(Schema.makeFilter((n) => n >= 0));
const data = Schema.Struct({
	amount: Schema.String.check(
		Schema.makeFilter((s) => /^-?\d+(?:\.\d+)?$/.test(s)),
	),
	currency: Schema.String.check(Schema.makeFilter((s) => /^[A-Z]{3}$/.test(s))),
	direction: Schema.Literals(["credit", "debit"]),
	status: Schema.Literals([
		"booked",
		"pending",
		"cancelled",
		"hold",
		"other",
		"rejected",
		"scheduled",
	]),
	bookingDate: optional(date),
	valueDate: optional(date),
	transactionDate: optional(date),
	creditor: optional(text),
	debtor: optional(text),
	merchantCategoryCode: optional(text),
	referenceNumber: optional(text),
	referenceScheme: optional(text),
	remittance: Schema.Array(text),
	note: optional(text),
	entryReference: optional(nonempty),
	detailId: optional(text),
});
const origin = Schema.Struct({
	providerAccountId: nonempty,
	authorizationRevision: nonempty,
	sourceIdentity: nonempty,
});
export const CollectionSchema = Schema.Struct({
	accounts: Schema.Array(
		Schema.Struct({
			key: nonempty,
			provider: nonempty,
			bankKey: nonempty,
			bank: nonempty,
			country: Schema.String.check(
				Schema.makeFilter((s) => /^[A-Z]{2}$/.test(s)),
			),
			currency: nonempty,
			providerAccountId: nonempty,
			identificationHash: nonempty,
			sourceIdentity: nonempty,
			authorizationRevision: nonempty,
		}),
	),
	transactions: Schema.Array(
		Schema.Struct({
			key: nonempty,
			accountKey: nonempty,
			data,
			origin,
			latestOrigin: origin,
			identity: Schema.Literals(["entry-reference", "content"]),
			firstSeenAt: timestamp,
			lastSeenAt: timestamp,
			revisions: Schema.Array(
				Schema.Struct({ observedAt: timestamp, data, origin }),
			),
			supersededBy: optional(nonempty),
			supersedes: optional(nonempty),
			uncertain: Schema.Boolean,
		}),
	),
	coverage: Schema.Array(
		Schema.Struct({
			accountKey: nonempty,
			providerAccountId: nonempty,
			sourceIdentity: nonempty,
			authorizationRevision: nonempty,
			completedAt: timestamp,
			incrementalCheckpoint: optional(date),
			window: Schema.Struct({
				from: optional(date),
				to: optional(date),
				strategy: Schema.Literals(["longest", "default"]),
			}),
			observedFrom: optional(date),
			observedTo: optional(date),
			pages: natural,
			observations: natural,
			duplicates: natural,
			history: Schema.Literal("provider-limited"),
		}),
	),
	banks: Schema.Array(
		Schema.Struct({
			key: nonempty,
			bank: nonempty,
			country: text,
			lastAttemptAt: timestamp,
			selection: optional(
				Schema.Literals(["all-accounts", "selected-accounts"]),
			),
			outcome: Schema.Literals(["running", "complete", "failed"]),
			failureKind: optional(
				Schema.Literals(["Input", "Access", "Provider", "Storage", "Limit"]),
			),
			lastCompletedAt: optional(timestamp),
		}),
	),
});
export const RecordSchema = Schema.Struct({
	version: Schema.Literal(1),
	collection: CollectionSchema,
});
