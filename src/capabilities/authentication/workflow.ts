import { Clock, Effect } from "effect";
import { type AuthError, failure } from "../../shared";
import {
	type AuthorizationAccess,
	Callback,
	type LoginInput,
	type LoginResult,
	Provider,
	type ReportedAccess,
	State,
	type StatusEntry,
	type StatusQuery,
	Store,
} from "./contract";
export function login(
	options: LoginInput,
): Effect.Effect<LoginResult, AuthError, Store | Provider | State | Callback> {
	return Effect.suspend(() => {
		if (options.transactionConsent !== "consent")
			return Effect.succeed<LoginResult>({ outcome: "consent-required" });
		if (
			!Number.isFinite(options.timeoutSeconds) ||
			options.timeoutSeconds <= 0 ||
			options.timeoutSeconds > 600
		)
			return Effect.fail(
				failure(
					"Input",
					"Login timeout must be positive and at most 600 seconds.",
				),
			);
		const deadline = performance.now() + options.timeoutSeconds * 1000;
		return Effect.scoped(
			Effect.gen(function* () {
				const store = yield* Store;
				yield* store.exclusive();
				const snapshot = yield* store.snapshot(options.endpoint);
				const provider = yield* (yield* Provider).connect(snapshot);
				const available = yield* provider.banks();
				const candidates = available.filter(
					(b) =>
						(options.country === undefined || b.country === options.country) &&
						(options.bank === undefined || b.name === options.bank),
				);
				if (candidates.length === 0)
					return yield* Effect.fail(
						failure("Input", "No matching bank is available."),
					);
				const bank =
					options.bank !== undefined && candidates.length === 1
						? candidates[0]
						: yield* options.select(candidates);
				if (!bank || !candidates.includes(bank))
					return yield* Effect.fail(
						failure("Input", "Select a bank from the provider list."),
					);
				const now = yield* Clock.currentTimeMillis;
				const requestedExpiry = now + bank.maximumConsentValidity * 1000;
				if (
					!Number.isSafeInteger(bank.maximumConsentValidity) ||
					bank.maximumConsentValidity <= 0 ||
					// RFC3339 timestamps use a four-digit year (through 9999).
					requestedExpiry > 253402300799999
				)
					return yield* Effect.fail(
						failure(
							"Provider",
							"The selected connector has invalid maximum consent validity.",
						),
					);
				const requestedAccess: AuthorizationAccess = {
					validUntil: new Date(requestedExpiry).toISOString(),
					transactions: true,
					balances: false,
				};
				const state = yield* (yield* State).generate();
				const listener = yield* (yield* Callback).open({
					port: snapshot.config.port,
					path: new URL(snapshot.config.callbackUrl).pathname,
					state,
					timeoutSeconds: options.timeoutSeconds,
				});
				const url = yield* provider.authorize(
					snapshot.config,
					bank,
					state,
					requestedAccess,
				);
				yield* options.publishUrl(url);
				const code = yield* listener.wait;
				const session = yield* provider.exchange(code);
				if (session.reportedAccess?.transactions === false)
					return { outcome: "denied" as const };
				if (performance.now() >= deadline)
					return yield* Effect.fail(
						failure("Timeout", "Authorization timed out."),
					);
				yield* store.saveSession(
					{
						...session,
						identity: snapshot.identity,
						bank: bank.name,
						country: bank.country,
						requestedAccess,
					},
					deadline,
				);
				return {
					outcome: "authorized" as const,
					bank: bank.name,
					country: bank.country,
					validUntil: session.validUntil,
					maximumConsentValidity: bank.maximumConsentValidity,
					requestedAccess,
					reportedAccess: session.reportedAccess ?? null,
				};
			}),
		).pipe(
			Effect.timeoutOrElse({
				duration: `${options.timeoutSeconds} seconds`,
				orElse: () =>
					Effect.fail(failure("Timeout", "Authorization timed out.")),
			}),
			Effect.catch((error) =>
				error.kind === "Denied"
					? Effect.succeed({ outcome: "denied" as const })
					: Effect.fail(error),
			),
		);
	});
}
export function status(
	options: StatusQuery,
): Effect.Effect<readonly StatusEntry[], AuthError, Store | Provider> {
	return Effect.scoped(
		Effect.gen(function* () {
			const store = yield* Store;
			yield* store.exclusive();
			const snapshot = yield* store.snapshot(options.endpoint);
			const sessions = (yield* store.sessions()).filter(
				(s) =>
					s.identity === snapshot.identity &&
					(options.bank === undefined || s.bank === options.bank) &&
					(options.country === undefined || s.country === options.country),
			);
			const result: StatusEntry[] = [];
			if (sessions.length === 0) return result;
			const provider = yield* (yield* Provider).connect(snapshot);
			for (const session of sessions) {
				const locallyExpired =
					Date.parse(session.validUntil) <= (yield* Clock.currentTimeMillis);
				const remote: {
					readonly status: StatusEntry["status"];
					readonly validUntil?: string;
					readonly reportedAccess?: ReportedAccess;
				} = locallyExpired
					? { status: "expired" }
					: yield* provider.status(session).pipe(
							Effect.catch((error) =>
								error.kind === "Provider"
									? Effect.succeed({
											status: "provider-unavailable" as const,
										})
									: Effect.fail(error),
							),
						);
				const validUntil = remote.validUntil ?? session.validUntil;
				const reportedAccess =
					remote.reportedAccess ?? session.reportedAccess ?? null;
				const state =
					remote.status === "authorized" &&
					Date.parse(validUntil) <= (yield* Clock.currentTimeMillis)
						? "expired"
						: remote.status;
				result.push({
					bank: session.bank,
					country: session.country,
					status: state,
					validUntil,
					expirySource: remote.validUntil === undefined ? "saved" : "provider",
					verification: locallyExpired
						? "local"
						: state === "provider-unavailable"
							? "unavailable"
							: "provider",
					renewal:
						state === "provider-unavailable"
							? "check-provider"
							: state !== "authorized" ||
									!session.requestedAccess ||
									reportedAccess?.transactions === false
								? "required"
								: "not-required",
					requestedAccess: session.requestedAccess ?? null,
					reportedAccess,
					accessSource:
						remote.reportedAccess !== undefined
							? "provider"
							: session.reportedAccess !== undefined
								? "saved"
								: "unknown",
				});
			}
			return result;
		}),
	);
}
