import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
	AuthError,
	type AuthorizationAccess,
	type AuthorizedSession,
	type Bank,
	type BankingProvider,
	Callback,
	type CredentialStore,
	type LoginInput,
	login,
	Provider,
	type RemoteSessionStatus,
	State,
	Store,
	type StoredSession,
	status,
} from "../src/capabilities/authentication";

const bank = {
	name: "Synthetic Bank",
	country: "NL",
	maximumConsentValidity: 9_504_000,
};
const expiry = "2098-05-06T07:08:09+02:00";

function fixture(
	options: {
		banks?: readonly Bank[];
		initialSessions?: readonly StoredSession[];
		wait?: Effect.Effect<string, AuthError>;
		exchange?: Effect.Effect<AuthorizedSession, AuthError>;
		remote?: Effect.Effect<RemoteSessionStatus, AuthError>;
		saveError?: AuthError;
	} = {},
) {
	let held = false;
	let callbackClosed = true;
	let records: readonly StoredSession[] = options.initialSessions ?? [];
	let authorizations = 0;
	const requests: AuthorizationAccess[] = [];
	const provider: BankingProvider = {
		banks: () => Effect.succeed(options.banks ?? [bank]),
		authorize: (_config, _bank, _state, access) =>
			Effect.sync(() => {
				authorizations++;
				requests.push(access);
				return "https://fixture.test/authorize";
			}),
		exchange: () =>
			options.exchange ??
			Effect.succeed({ sessionId: "SYNTHETIC-SESSION", validUntil: expiry }),
		status: () => options.remote ?? Effect.succeed({ status: "authorized" }),
	};
	const store: CredentialStore = {
		exclusive: () =>
			Effect.acquireRelease(
				Effect.suspend(() =>
					held
						? Effect.fail(
								new AuthError({
									kind: "Storage",
									message: "Synthetic contention",
								}),
							)
						: Effect.sync(() => {
								held = true;
							}),
				),
				() =>
					Effect.sync(() => {
						held = false;
					}),
			),
		keygen: () => Effect.succeed("SYNTHETIC-CERTIFICATE"),
		configure: () => Effect.void,
		config: () => Effect.succeed(config),
		privateKey: () => Effect.succeed("SYNTHETIC-KEY"),
		snapshot: (endpoint) =>
			Effect.succeed({
				config,
				endpoint,
				privateKey: "SYNTHETIC-KEY",
				identity: "synthetic-identity",
			}),
		sessions: () => Effect.sync(() => records),
		saveSession: (session, deadline) =>
			Effect.suspend(() => {
				if (!held || performance.now() >= deadline)
					return Effect.fail(
						new AuthError({
							kind: "Storage",
							message: "Synthetic publication rejected",
						}),
					);
				if (options.saveError) return Effect.fail(options.saveError);
				return Effect.sync(() => {
					records = [
						...records.filter(
							(old) =>
								old.bank !== session.bank ||
								old.country !== session.country ||
								old.identity !== session.identity,
						),
						session,
					];
				});
			}),
	};
	const services = Layer.mergeAll(
		Layer.succeed(Store, store),
		Layer.succeed(Provider, { connect: () => Effect.succeed(provider) }),
		Layer.succeed(State, { generate: () => Effect.succeed("synthetic-state") }),
		Layer.succeed(Callback, {
			open: () =>
				Effect.acquireRelease(
					Effect.sync(() => {
						callbackClosed = false;
						let consumed = false;
						return {
							wait: Effect.suspend(() => {
								if (consumed)
									return Effect.fail(
										new AuthError({
											kind: "Input",
											message: "Synthetic callback consumed",
										}),
									);
								consumed = true;
								return options.wait ?? Effect.succeed("SYNTHETIC-CODE");
							}),
						};
					}),
					() =>
						Effect.sync(() => {
							callbackClosed = true;
						}),
				),
		}),
	);
	return {
		services,
		store,
		provider,
		requests,
		authorizations: () => authorizations,
		released: () => !held && callbackClosed,
	};
}
const config = {
	applicationId: "synthetic-app",
	callbackUrl: "https://fixture.test/callback",
	port: 8787,
	testOnly: true,
};
const input: LoginInput = {
	endpoint: "https://fixture.test",
	bank: bank.name,
	country: bank.country,
	timeoutSeconds: 1,
	select: () => Effect.succeed(bank),
	publishUrl: () => Effect.void,
};

test("login returns a composable safe result with the unchanged provider expiry", async () => {
	const f = fixture();
	const result = await Effect.runPromise(
		login({ ...input, transactionConsent: "consent" }).pipe(
			Effect.provide(f.services),
		),
	);
	expect(result).toMatchObject({
		bank: "Synthetic Bank",
		country: "NL",
		validUntil: expiry,
	});
	expect(JSON.stringify(result)).not.toMatch(
		/SYNTHETIC-(?:SESSION|KEY|CODE)|synthetic-identity|fixture\.test/,
	);
	expect((await Effect.runPromise(f.store.sessions()))[0]?.validUntil).toBe(
		expiry,
	);
});

test("login requires informed transaction acknowledgement and preserves existing records", async () => {
	const f = fixture();
	const old = {
		sessionId: "SYNTHETIC-OLD-SESSION",
		validUntil: expiry,
		identity: "synthetic-identity",
		bank: bank.name,
		country: bank.country,
	};
	await seed(f, old);
	const outcome = await Effect.runPromise(
		login(input).pipe(Effect.provide(f.services)),
	);
	expect(outcome).toEqual({ outcome: "consent-required" });
	expect(f.authorizations()).toBe(0);
	expect(await Effect.runPromise(f.store.sessions())).toEqual([old]);
});

test("consented login requests the connector maximum and only transaction access", async () => {
	const f = fixture();

	const result = await Effect.runPromise(
		Effect.gen(function* () {
			yield* TestClock.setTime(1767225600000);
			return yield* login({ ...input, transactionConsent: "consent" });
		}).pipe(Effect.provide(f.services), Effect.provide(TestClock.layer())),
	);
	if (result.outcome !== "authorized")
		throw new Error("Expected successful consent");

	expect(result.requestedAccess.validUntil).toBe("2026-04-21T00:00:00.000Z");
	expect(f.requests).toEqual([
		expect.objectContaining({
			transactions: true,
			balances: false,
			validUntil: expect.any(String),
		}),
	]);
	expect(result).toMatchObject({
		maximumConsentValidity: 9_504_000,
		requestedAccess: f.requests[0],
		validUntil: expiry,
	});
	expect(
		(await Effect.runPromise(f.store.sessions()))[0]?.requestedAccess,
	).toEqual(result.requestedAccess);
});

test("status safely exposes saved expiry and requires fresh consent for a legacy session", async () => {
	const f = fixture();
	await seed(f, {
		sessionId: "SYNTHETIC-OLD-SESSION",
		validUntil: expiry,
		identity: "synthetic-identity",
		bank: bank.name,
		country: bank.country,
	});
	const result = await Effect.runPromise(
		status({ endpoint: input.endpoint }).pipe(Effect.provide(f.services)),
	);
	expect(result).toEqual([
		{
			bank: bank.name,
			country: bank.country,
			status: "authorized",
			validUntil: expiry,
			expirySource: "saved",
			verification: "provider",
			renewal: "required",
			requestedAccess: null,
			reportedAccess: null,
			accessSource: "unknown",
		},
	]);
	expect(JSON.stringify(result)).not.toContain("SYNTHETIC-OLD-SESSION");
});

test("TypeScript callers cannot exceed the bounded login deadline", async () => {
	const f = fixture();
	const result = await Effect.runPromise(
		login({
			...input,
			transactionConsent: "consent",
			timeoutSeconds: 601,
		}).pipe(
			Effect.provide(f.services),
			Effect.match({
				onSuccess: () => "accepted",
				onFailure: (error) => error.kind,
			}),
		),
	);
	expect(result).toBe("Input");
	expect(f.authorizations()).toBe(0);
	expect(await Effect.runPromise(f.store.sessions())).toEqual([]);
});

async function seed(
	f: ReturnType<typeof fixture>,
	...records: readonly StoredSession[]
) {
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				yield* f.store.exclusive();
				for (const record of records)
					yield* f.store.saveSession(record, Infinity);
			}),
		),
	);
}

test("typed bank denial and provider failure preserve both banks and release the attempt", async () => {
	for (const kind of ["Denied", "Provider"] as const) {
		const error = new AuthError({ kind, message: "Synthetic failure" });
		const f = fixture(
			kind === "Denied"
				? { wait: Effect.fail(error) }
				: { exchange: Effect.fail(error) },
		);
		const old = {
			sessionId: "SYNTHETIC-OLD-SESSION",
			validUntil: expiry,
			identity: "synthetic-identity",
			bank: bank.name,
			country: bank.country,
		};
		const other = { ...old, bank: "Other Synthetic Bank" };
		await seed(f, old, other);
		const result = await Effect.runPromise(
			login({ ...input, transactionConsent: "consent" }).pipe(
				Effect.provide(f.services),
				Effect.match({
					onSuccess: (value) => value,
					onFailure: (failure) => ({ failure: failure.kind }),
				}),
			),
		);
		expect(result).toEqual(
			kind === "Denied" ? { outcome: "denied" } : { failure: "Provider" },
		);
		expect(await Effect.runPromise(f.store.sessions())).toEqual([old, other]);
		expect(f.released()).toBe(true);
	}
});

test("an explicitly refused transaction grant never replaces the prior session", async () => {
	const f = fixture({
		exchange: Effect.succeed({
			sessionId: "SYNTHETIC-NEW-SESSION",
			validUntil: expiry,
			reportedAccess: { transactions: false, balances: false },
		}),
	});
	const old = {
		sessionId: "SYNTHETIC-OLD-SESSION",
		validUntil: expiry,
		identity: "synthetic-identity",
		bank: bank.name,
		country: bank.country,
	};
	await seed(f, old);
	const result = await Effect.runPromise(
		login({ ...input, transactionConsent: "consent" }).pipe(
			Effect.provide(f.services),
		),
	);
	expect(result).toEqual({ outcome: "denied" });
	expect(await Effect.runPromise(f.store.sessions())).toEqual([old]);
	expect(f.released()).toBe(true);
});

test("interrupting a TypeScript login preserves prior sessions and releases its scope", async () => {
	let ready: () => void = () => {};
	const waiting = new Promise<void>((resolve) => {
		ready = resolve;
	});
	const f = fixture({ wait: Effect.andThen(Effect.sync(ready), Effect.never) });
	const old = {
		sessionId: "SYNTHETIC-OLD-SESSION",
		validUntil: expiry,
		identity: "synthetic-identity",
		bank: bank.name,
		country: bank.country,
	};
	await seed(f, old);
	const controller = new AbortController();
	const completed = Effect.runPromise(
		login({ ...input, transactionConsent: "consent" }).pipe(
			Effect.provide(f.services),
		),
		{ signal: controller.signal },
	);
	try {
		await boundedReadiness(waiting, completed);
		controller.abort();
		await expect(completed).rejects.toThrow();
		expect(await Effect.runPromise(f.store.sessions())).toEqual([old]);
		expect(f.released()).toBe(true);
	} finally {
		controller.abort();
		await completed.catch(() => {});
	}
});

test("failed capability persistence preserves both bank records after exchange", async () => {
	const old = {
		sessionId: "SYNTHETIC-OLD-SESSION",
		validUntil: expiry,
		identity: "synthetic-identity",
		bank: bank.name,
		country: bank.country,
	};
	const other = { ...old, bank: "Other Synthetic Bank" };
	const f = fixture({
		initialSessions: [old, other],
		saveError: new AuthError({
			kind: "Storage",
			message: "Synthetic write failure",
		}),
	});
	const result = await Effect.runPromise(
		login({ ...input, transactionConsent: "consent" }).pipe(
			Effect.provide(f.services),
			Effect.match({
				onSuccess: () => "saved",
				onFailure: (error) => error.kind,
			}),
		),
	);
	expect(result).toBe("Storage");
	expect(await Effect.runPromise(f.store.sessions())).toEqual([old, other]);
	expect(f.released()).toBe(true);
});

test("whole-attempt capability timeout preserves both banks and releases its scope", async () => {
	const old = {
		sessionId: "SYNTHETIC-OLD-SESSION",
		validUntil: expiry,
		identity: "synthetic-identity",
		bank: bank.name,
		country: bank.country,
	};
	const other = { ...old, bank: "Other Synthetic Bank" };
	const result = await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				yield* TestClock.setTime(1767225600000);
				const ready = yield* Deferred.make<void>();
				const f = fixture({
					initialSessions: [old, other],
					wait: Effect.andThen(
						Deferred.succeed(ready, undefined),
						Effect.never,
					),
				});
				const fiber = yield* Effect.forkChild(
					login({ ...input, transactionConsent: "consent" }).pipe(
						Effect.provide(f.services),
						Effect.match({
							onSuccess: () => "saved",
							onFailure: (error) => error.kind,
						}),
					),
				);
				yield* Effect.raceFirst(
					Deferred.await(ready),
					Fiber.join(fiber).pipe(
						Effect.flatMap(() =>
							Effect.die(
								new Error("Login completed before callback readiness"),
							),
						),
					),
				);
				yield* TestClock.adjust("1 second");
				return {
					kind: yield* Fiber.join(fiber),
					records: yield* f.store.sessions(),
					released: f.released(),
				};
			}),
		).pipe(Effect.provide(TestClock.layer())),
		{ signal: AbortSignal.timeout(3000) },
	);
	expect(result.kind).toBe("Timeout");
	expect(result.records).toEqual([old, other]);
	expect(result.released).toBe(true);
});

async function boundedReadiness<T>(
	ready: Promise<T>,
	completed: Promise<unknown>,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			ready,
			completed.then(() => {
				throw new Error("Login completed before callback readiness");
			}),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("No callback readiness")),
					3000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

test("invalid connector maximums cannot authorize or replace prior records", async () => {
	for (const maximumConsentValidity of [
		0,
		-1,
		1.5,
		NaN,
		Infinity,
		Number.MAX_SAFE_INTEGER + 1,
		253402300800,
	]) {
		const f = fixture({ banks: [{ ...bank, maximumConsentValidity }] });
		const old = {
			sessionId: "SYNTHETIC-OLD-SESSION",
			validUntil: expiry,
			identity: "synthetic-identity",
			bank: bank.name,
			country: bank.country,
		};
		await seed(f, old);
		const result = await Effect.runPromise(
			login({ ...input, transactionConsent: "consent" }).pipe(
				Effect.provide(f.services),
				Effect.match({
					onSuccess: () => "saved",
					onFailure: (error) => error.kind,
				}),
			),
		);
		expect(result).toBe("Provider");
		expect(f.authorizations()).toBe(0);
		expect(await Effect.runPromise(f.store.sessions())).toEqual([old]);
		expect(f.released()).toBe(true);
	}
});

test("status reports renewal and verification honestly for fresh consent", async () => {
	const cases: readonly {
		remote: Effect.Effect<RemoteSessionStatus, AuthError>;
		status: string;
		renewal: string;
		verification: string;
		expirySource: string;
		validUntil: string;
	}[] = [
		{
			remote: Effect.succeed({
				status: "authorized",
				validUntil: expiry,
				reportedAccess: { transactions: false },
			}),
			status: "authorized",
			renewal: "required",
			verification: "provider",
			expirySource: "provider",
			validUntil: expiry,
		},
		{
			remote: Effect.succeed({ status: "authorized", validUntil: expiry }),
			status: "authorized",
			renewal: "not-required",
			verification: "provider",
			expirySource: "provider",
			validUntil: expiry,
		},
		{
			remote: Effect.succeed({
				status: "authorized",
				validUntil: "2000-01-01T00:00:00Z",
			}),
			status: "expired",
			renewal: "required",
			verification: "provider",
			expirySource: "provider",
			validUntil: "2000-01-01T00:00:00Z",
		},
		{
			remote: Effect.succeed({ status: "revoked", validUntil: expiry }),
			status: "revoked",
			renewal: "required",
			verification: "provider",
			expirySource: "provider",
			validUntil: expiry,
		},
		{
			remote: Effect.fail(
				new AuthError({ kind: "Provider", message: "Synthetic unavailable" }),
			),
			status: "provider-unavailable",
			renewal: "check-provider",
			verification: "unavailable",
			expirySource: "saved",
			validUntil: expiry,
		},
	];
	for (const c of cases) {
		const f = fixture({ remote: c.remote });
		await Effect.runPromise(
			login({ ...input, transactionConsent: "consent" }).pipe(
				Effect.provide(f.services),
			),
		);
		const before = await Effect.runPromise(f.store.sessions());
		const result = await Effect.runPromise(
			status({ endpoint: input.endpoint }).pipe(Effect.provide(f.services)),
		);
		expect(result).toEqual([
			expect.objectContaining({
				status: c.status,
				renewal: c.renewal,
				verification: c.verification,
				expirySource: c.expirySource,
				validUntil: c.validUntil,
				requestedAccess: expect.objectContaining({
					transactions: true,
					balances: false,
				}),
			}),
		]);
		expect(await Effect.runPromise(f.store.sessions())).toEqual(before);
	}
});
