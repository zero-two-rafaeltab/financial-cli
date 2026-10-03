import { Context, type Effect, type Scope } from "effect";
import type { AuthError, Config, Session } from "../shared";

export type { AuthError, Config, Session } from "../shared";
export type Bank = {
	readonly name: string;
	readonly country: string;
	readonly maximumConsentValidity: number;
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
export type Snapshot = {
	readonly config: Config;
	readonly privateKey: string;
	readonly identity: string;
	readonly endpoint: string;
};
export type StoredSession = Session & {
	readonly identity: string;
	readonly bank: string;
	readonly country: string;
};
export interface BankingProvider {
	readonly banks: () => Effect.Effect<readonly Bank[], AuthError>;
	readonly authorize: (
		config: Config,
		bank: Bank,
		state: string,
	) => Effect.Effect<string, AuthError>;
	readonly exchange: (code: string) => Effect.Effect<Session, AuthError>;
	readonly status: (session: Session) => Effect.Effect<RemoteStatus, AuthError>;
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
};
