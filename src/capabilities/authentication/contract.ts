import { Context, type Effect, type Scope } from "effect";
import type { AuthError, Config, Session } from "../../shared";

export type { Config, Session } from "../../shared";
export { AuthError } from "../../shared";
export type Bank = {
	readonly name: string;
	readonly country: string;
	readonly maximumConsentValidity: number;
};
export type LoginInput = {
	// Acknowledges read-only transaction access; bank authorization remains mandatory.
	readonly transactionConsent?: "consent";
	readonly endpoint: string;
	readonly country?: string;
	readonly bank?: string;
	readonly timeoutSeconds: number;
	readonly select: (banks: readonly Bank[]) => Effect.Effect<Bank, AuthError>;
	// Sensitive authorization URLs belong only to this deliberate driving adapter.
	readonly publishUrl: (url: string) => Effect.Effect<void>;
};
export type LoginResult =
	| AuthorizedLogin
	| { readonly outcome: "consent-required" }
	| { readonly outcome: "denied" };
export type AuthorizedLogin = {
	readonly outcome: "authorized";
	readonly bank: string;
	readonly country: string;
	readonly validUntil: string;
	readonly maximumConsentValidity: number;
	readonly requestedAccess: AuthorizationAccess;
	readonly reportedAccess: ReportedAccess | null;
};
export type ReportedAccess = {
	readonly transactions?: boolean;
	readonly balances?: boolean;
};
export type AuthorizedSession = Session & {
	readonly reportedAccess?: ReportedAccess;
};
// Requested rights, not a claim that the provider granted them.
export type AuthorizationAccess = {
	readonly validUntil: string;
	readonly transactions: true;
	readonly balances: false;
};
export type StatusQuery = {
	readonly endpoint: string;
	readonly country?: string;
	readonly bank?: string;
};
export type RemoteStatus =
	| "authorized"
	| "expired"
	| "missing"
	| "cancelled"
	| "closed"
	| "invalid"
	| "pending-authorization"
	| "returned-from-bank"
	| "revoked";
export type RemoteSessionStatus = {
	readonly status: RemoteStatus;
	readonly validUntil?: string;
	readonly reportedAccess?: ReportedAccess;
};
export type Snapshot = {
	readonly config: Config;
	readonly privateKey: string;
	readonly identity: string;
	readonly endpoint: string;
};
export type StoredSession = AuthorizedSession & {
	readonly identity: string;
	readonly bank: string;
	readonly country: string;
	// Present only after a fresh, successful authorization; absent for legacy records.
	readonly requestedAccess?: AuthorizationAccess;
};
export interface BankingProvider {
	readonly banks: () => Effect.Effect<readonly Bank[], AuthError>;
	readonly authorize: (
		config: Config,
		bank: Bank,
		state: string,
		access: AuthorizationAccess,
	) => Effect.Effect<string, AuthError>;
	readonly exchange: (
		code: string,
	) => Effect.Effect<AuthorizedSession, AuthError>;
	readonly status: (
		session: Session,
	) => Effect.Effect<RemoteSessionStatus, AuthError>;
}
export interface ProviderPort {
	readonly connect: (
		snapshot: Snapshot,
	) => Effect.Effect<BankingProvider, AuthError>;
}
export class Provider extends Context.Service<Provider, ProviderPort>()(
	"financial/auth/Provider",
) {}
// An exclusive scope serializes configuration, key creation, snapshot and publication.
// Contention fails fast; adapters must never steal an existing lock.
export interface CredentialStore {
	readonly exclusive: () => Effect.Effect<void, AuthError, Scope.Scope>;
	readonly keygen: () => Effect.Effect<string, AuthError>;
	readonly configure: (config: Config) => Effect.Effect<void, AuthError>;
	readonly config: () => Effect.Effect<Config, AuthError>;
	readonly privateKey: () => Effect.Effect<string, AuthError>;
	readonly snapshot: (endpoint: string) => Effect.Effect<Snapshot, AuthError>;
	readonly sessions: () => Effect.Effect<readonly StoredSession[], AuthError>;
	// Requires exclusive scope; must check absolute deadline immediately before publication.
	readonly saveSession: (
		session: StoredSession,
		deadline: number,
	) => Effect.Effect<void, AuthError>;
}
export class Store extends Context.Service<Store, CredentialStore>()(
	"financial/auth/Store",
) {}
export type CallbackOptions = {
	readonly port: number;
	readonly path: string;
	readonly state: string;
	readonly timeoutSeconds: number;
};
export interface CallbackPort {
	readonly open: (
		options: CallbackOptions,
	) => Effect.Effect<
		{ readonly wait: Effect.Effect<string, AuthError> },
		AuthError,
		Scope.Scope
	>;
}
export class Callback extends Context.Service<Callback, CallbackPort>()(
	"financial/auth/Callback",
) {}
export interface StatePort {
	readonly generate: () => Effect.Effect<string>;
}
export class State extends Context.Service<State, StatePort>()(
	"financial/auth/State",
) {}
export type StatusEntry = {
	readonly bank: string;
	readonly country: string;
	readonly status: RemoteStatus | "provider-unavailable";
	readonly validUntil: string;
	readonly expirySource: "saved" | "provider";
	readonly verification: "local" | "provider" | "unavailable";
	readonly renewal: "required" | "not-required" | "check-provider";
	readonly requestedAccess: AuthorizationAccess | null;
	readonly reportedAccess: ReportedAccess | null;
	readonly accessSource: "provider" | "saved" | "unknown";
};
