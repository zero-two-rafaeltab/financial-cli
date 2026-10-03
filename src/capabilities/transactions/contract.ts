import { Context, Data, type Effect, type Scope } from "effect";

export class CollectionError extends Data.TaggedError("CollectionError")<{
	readonly kind: "Input" | "Access" | "Provider" | "Storage" | "Limit";
	readonly message: string;
}> {}

export type Selection = {
	readonly bank?: string;
	readonly country?: string;
	readonly accountKeys?: readonly string[];
};
export type DateRange = { readonly from?: string; readonly to?: string };
export type SyncInput = Selection &
	DateRange & { readonly overlapDays?: number };
export type TransactionStatus =
	| "booked"
	| "pending"
	| "cancelled"
	| "hold"
	| "other"
	| "rejected"
	| "scheduled";
export type TransactionData = {
	readonly amount: string;
	readonly currency: string;
	readonly direction: "credit" | "debit";
	readonly status: TransactionStatus;
	readonly bookingDate?: string;
	readonly valueDate?: string;
	readonly transactionDate?: string;
	readonly creditor?: string;
	readonly debtor?: string;
	readonly merchantCategoryCode?: string;
	readonly referenceNumber?: string;
	readonly referenceScheme?: string;
	readonly remittance: readonly string[];
	readonly note?: string;
	readonly entryReference?: string;
	readonly detailId?: string;
};
export type Account = {
	readonly provider: string;
	readonly bankKey: string;
	readonly key: string;
	readonly bank: string;
	readonly country: string;
	readonly currency: string;
	readonly providerAccountId: string;
	readonly identificationHash: string;
	readonly sourceIdentity: string;
	// Opaque authorization revision, never the credential. A change requests broad history again.
	readonly authorizationRevision: string;
};
export type Window = DateRange & { readonly strategy: "longest" | "default" };
export type Page = {
	readonly transactions: readonly TransactionData[];
	readonly next?: string;
};
export interface BankFeed {
	readonly key: string;
	readonly bank: string;
	readonly country: string;
	readonly accounts: () => Effect.Effect<readonly Account[], CollectionError>;
	readonly page: (
		account: Account,
		window: Window,
		cursor?: string,
	) => Effect.Effect<Page, CollectionError>;
}
// Holds a stable authentication snapshot until scope release; never initiates/renews consent.
// Each bank's resolution/page failures are isolated. Responses are validated, bounded and cancellable.
export interface CollectionSource {
	readonly open: (
		selection: Selection,
	) => Effect.Effect<readonly BankFeed[], CollectionError, Scope.Scope>;
}
export class Source extends Context.Service<Source, CollectionSource>()(
	"financial/transactions/Source",
) {}

export type ObservationOrigin = {
	readonly providerAccountId: string;
	readonly authorizationRevision: string;
	readonly sourceIdentity: string;
};
export type Transaction = {
	readonly origin: ObservationOrigin;
	readonly latestOrigin: ObservationOrigin;
	readonly key: string;
	readonly accountKey: string;
	readonly data: TransactionData;
	readonly identity: "entry-reference" | "content";
	readonly firstSeenAt: string;
	readonly lastSeenAt: string;
	readonly revisions: readonly {
		readonly observedAt: string;
		readonly origin: ObservationOrigin;
		readonly data: TransactionData;
	}[];
	readonly supersededBy?: string;
	readonly supersedes?: string;
	readonly uncertain: boolean;
};
export type Coverage = ObservationOrigin & {
	readonly accountKey: string;
	readonly authorizationRevision: string;
	readonly completedAt: string;
	readonly incrementalCheckpoint?: string;
	readonly window: Window;
	readonly observedFrom?: string;
	readonly observedTo?: string;
	readonly pages: number;
	readonly observations: number;
	readonly duplicates: number;
	// Provider pagination was exhausted; this does not assert complete bank history.
	readonly history: "provider-limited";
};
export type BankState = {
	readonly key: string;
	readonly bank: string;
	readonly country: string;
	readonly lastAttemptAt: string;
	readonly selection?: "all-accounts" | "selected-accounts";
	readonly outcome: "running" | "complete" | "failed";
	readonly failureKind?: CollectionError["kind"];
	readonly lastCompletedAt?: string;
};
export type Collection = {
	readonly accounts: readonly Account[];
	readonly transactions: readonly Transaction[];
	readonly coverage: readonly Coverage[];
	readonly banks: readonly BankState[];
};
// Exclusive scope fails fast on contention and never steals a lock. read observes one complete
// validated snapshot. replace requires exclusive scope and publishes atomically or preserves
// the prior snapshot. Cancellation must not publish a late replacement. Data stays private.
export interface TransactionStore {
	readonly exclusive: () => Effect.Effect<void, CollectionError, Scope.Scope>;
	readonly read: () => Effect.Effect<Collection, CollectionError>;
	readonly replace: (
		collection: Collection,
	) => Effect.Effect<void, CollectionError>;
}
export class Store extends Context.Service<Store, TransactionStore>()(
	"financial/transactions/Store",
) {}
export type BankSyncResult = {
	readonly bank: string;
	readonly country: string;
	readonly outcome: "complete" | "failed" | "skipped";
	readonly failureKind?: CollectionError["kind"];
	readonly accounts: number;
	readonly transactions: number;
	readonly uncertain: number;
};
export type SyncResult = {
	readonly outcome: "attempted" | "no-sessions" | "no-accounts";
	readonly banks: readonly BankSyncResult[];
};
export type QueryInput = Selection &
	DateRange & {
		readonly dateField?: "bookingDate" | "valueDate" | "transactionDate";
		readonly status?: TransactionStatus;
		readonly currency?: string;
		readonly direction?: "credit" | "debit";
		readonly text?: string;
		readonly includeSuperseded?: boolean;
		readonly limit?: number;
		readonly offset?: number;
	};
export type QueryResult = {
	readonly transactions: readonly Transaction[];
	readonly matched: number;
	readonly undated: number;
	readonly accounts: readonly Account[];
	readonly coverage: readonly Coverage[];
	readonly banks: readonly BankState[];
};
