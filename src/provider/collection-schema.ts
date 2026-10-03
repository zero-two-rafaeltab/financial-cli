import { Schema } from "effect";

const optional = Schema.optionalKey;
const text = Schema.String;
const nonempty = Schema.NonEmptyString;
const uuid = Schema.String.check(Schema.isUUID());
const nullableText = optional(Schema.NullOr(text));
const date = Schema.String.check(
	Schema.makeFilter(
		(s) =>
			/^\d{4}-\d{2}-\d{2}$/.test(s) &&
			Number.isFinite(Date.parse(s)) &&
			new Date(s).toISOString().slice(0, 10) === s,
	),
);
const timestamp = Schema.String.check(
	Schema.makeFilter(
		(s) => /T.*(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s)),
	),
);
const accountHashes = {
	identification_hash: nonempty,
	identification_hashes: Schema.Array(nonempty),
};
export const SessionData = Schema.Struct({
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
	access: Schema.Struct({
		valid_until: timestamp,
		transactions: optional(Schema.Boolean),
	}),
	aspsp: Schema.Struct({ name: nonempty, country: text }),
	accounts: Schema.Array(uuid),
	accounts_data: Schema.Array(Schema.Struct({ uid: uuid, ...accountHashes })),
});
export const Details = Schema.Struct({
	uid: optional(uuid),
	currency: Schema.String.check(Schema.makeFilter((s) => /^[A-Z]{3}$/.test(s))),
	cash_account_type: nonempty,
	...accountHashes,
});
export const Transactions = Schema.Struct({
	transactions: Schema.Array(
		Schema.Struct({
			entry_reference: optional(Schema.NullOr(nonempty)),
			transaction_id: nullableText,
			transaction_amount: Schema.Struct({
				amount: Schema.String.check(
					Schema.makeFilter(
						(s) => s.length <= 128 && /^-?\d+(?:\.\d+)?$/.test(s),
					),
				),
				currency: Schema.String.check(
					Schema.makeFilter((s) => /^[A-Z]{3}$/.test(s)),
				),
			}),
			credit_debit_indicator: Schema.Literals(["CRDT", "DBIT"]),
			status: Schema.Literals([
				"BOOK",
				"PDNG",
				"CNCL",
				"HOLD",
				"OTHR",
				"RJCT",
				"SCHD",
			]),
			booking_date: optional(Schema.NullOr(date)),
			value_date: optional(Schema.NullOr(date)),
			transaction_date: optional(Schema.NullOr(date)),
			creditor: optional(Schema.NullOr(Schema.Struct({ name: nullableText }))),
			debtor: optional(Schema.NullOr(Schema.Struct({ name: nullableText }))),
			merchant_category_code: nullableText,
			reference_number: nullableText,
			reference_number_schema: nullableText,
			remittance_information: optional(Schema.NullOr(Schema.Array(text))),
			note: nullableText,
		}),
	),
	continuation_key: optional(Schema.NullOr(nonempty)),
});
