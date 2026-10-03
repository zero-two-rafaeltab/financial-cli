import { Effect } from "effect";
import { type AuthError, failure } from "../shared";
import {
	type Bank,
	Callback,
	Provider,
	State,
	type StatusEntry,
	Store,
} from "./contract";
export function login(options: {
	readonly endpoint: string;
	readonly country?: string;
	readonly bank?: string;
	readonly timeoutSeconds: number;
	readonly select: (banks: readonly Bank[]) => Effect.Effect<Bank, AuthError>;
	readonly publishUrl: (url: string) => Effect.Effect<void>;
}) {
	return Effect.suspend(() => {
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
				const state = yield* (yield* State).generate();
				const listener = yield* (yield* Callback).open({
					port: snapshot.config.port,
					path: new URL(snapshot.config.callbackUrl).pathname,
					state,
					timeoutSeconds: options.timeoutSeconds,
				});
				const url = yield* provider.authorize(snapshot.config, bank, state);
				yield* options.publishUrl(url);
				const code = yield* listener.wait;
				const session = yield* provider.exchange(code);
				if (performance.now() >= deadline)
					return yield* Effect.fail(
						failure(
							"Timeout",
							"Authorization timed out. Try auth login again.",
						),
					);
				yield* store.saveSession(
					{
						...session,
						identity: snapshot.identity,
						bank: bank.name,
						country: bank.country,
					},
					deadline,
				);
				return "Authorization saved. Run auth status to validate it.";
			}),
		).pipe(
			Effect.timeoutOrElse({
				duration: `${options.timeoutSeconds} seconds`,
				orElse: () =>
					Effect.fail(
						failure(
							"Timeout",
							"Authorization timed out. Try auth login again.",
						),
					),
			}),
		);
	});
}
export function status(options: {
	readonly endpoint: string;
	readonly country?: string;
	readonly bank?: string;
}) {
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
				const state =
					Date.parse(session.validUntil) <= Date.now()
						? "expired"
						: yield* provider
								.status(session)
								.pipe(
									Effect.catch((error) =>
										error.kind === "Provider"
											? Effect.succeed("provider-unavailable" as const)
											: Effect.fail(error),
									),
								);
				result.push({
					bank: session.bank,
					country: session.country,
					status: state,
				});
			}
			return result;
		}),
	);
}
