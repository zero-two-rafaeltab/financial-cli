import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey, randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	lstatSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Schema } from "effect";
import type { AuthError, CredentialStore } from "../auth";
import {
	attempt,
	ConfigSchema,
	decode,
	failure,
	SessionSchema,
	Timestamp,
	validateConfig,
} from "../shared";
import { lstatExists, privateFiles } from "./files";
import type { StorageLocations } from "./index";

const StoredSessionSchema = Schema.Struct({
	sessionId: SessionSchema.fields.sessionId,
	validUntil: SessionSchema.fields.validUntil,
	identity: Schema.String.check(
		Schema.makeFilter((s) => /^[a-f0-9]{64}$/.test(s)),
	),
	bank: Schema.NonEmptyString,
	country: Schema.String.check(Schema.makeFilter((s) => /^[A-Z]{2}$/.test(s))),
	requestedAccess: Schema.optional(
		Schema.Struct({
			validUntil: Timestamp,
			transactions: Schema.Literal(true),
			balances: Schema.Literal(false),
		}),
	),
	reportedAccess: Schema.optional(
		Schema.Struct({
			transactions: Schema.optional(Schema.Boolean),
			balances: Schema.optional(Schema.Boolean),
		}),
	),
});
const SessionsSchema = Schema.Array(StoredSessionSchema);

export function localStore(locations: StorageLocations): CredentialStore {
	const configDir = join(locations.configHome, "financial-cli");
	const stateDir = join(locations.stateHome, "financial-cli");
	const { directory, read, write } = privateFiles(
		locations.checkout,
		1024 * 1024,
	);

	let held = false;
	const exclusive = () =>
		Effect.gen(function* () {
			// Lock both mutable roots in canonical order; identical roots need one lock.
			// Each acquisition is scoped so a later collision releases earlier locks.
			for (const dir of [
				...new Set([resolve(configDir), resolve(stateDir)]),
			].sort()) {
				const accessMessage =
					"Unable to access authentication storage safely. Check config/state paths, ownership and permissions, including their parent directories.";
				yield* attempt("Storage", accessMessage, () => directory(dir));
				const lock = join(dir, ".auth-lock");
				yield* Effect.acquireRelease(
					Effect.try({
						try: () => {
							const fd = openSync(
								lock,
								constants.O_WRONLY |
									constants.O_CREAT |
									constants.O_EXCL |
									constants.O_NOFOLLOW,
								0o600,
							);
							return { fd, lock };
						},
						catch: (error) => {
							if (
								error instanceof Error &&
								"code" in error &&
								error.code === "EEXIST"
							) {
								try {
									if (lstatSync(lock).isFile())
										return failure(
											"Storage",
											"Authentication storage is locked. Retry after the active command finishes; if it crashed, verify no auth command is running before removing .auth-lock from the config or state directory.",
										);
								} catch {
									// Report only the safe access diagnostic, never filesystem causes.
								}
							}
							return failure("Storage", accessMessage);
						},
					}),
					({ fd, lock }) =>
						Effect.sync(() => {
							try {
								closeSync(fd);
							} finally {
								held = false;
								rmSync(lock, { force: true });
							}
						}),
				);
			}
			held = true;
		});
	const locked = <A>(effect: Effect.Effect<A, AuthError>) =>
		Effect.scoped(Effect.andThen(exclusive(), effect));
	const service: CredentialStore = {
		exclusive,
		keygen: () =>
			attempt(
				"Storage",
				"Unable to create credentials safely (existing keys are never overwritten).",
				() => {
					directory(configDir);

					const key = join(configDir, `.key.${randomUUID()}`);
					const cert = join(configDir, `.cert.${randomUUID()}`);
					try {
						if (
							lstatExists(join(configDir, "private.pem")) ||
							lstatExists(join(configDir, "certificate.pem"))
						)
							throw new Error("Existing keys");
						writeFileSync(key, "", { mode: 0o600, flag: "wx" });
						writeFileSync(cert, "", { mode: 0o600, flag: "wx" });
						const generated = spawnSync(
							"openssl",
							[
								"req",
								"-x509",
								"-newkey",
								"rsa:2048",
								"-nodes",
								"-keyout",
								key,
								"-out",
								cert,
								"-days",
								"365",
								"-subj",
								"/CN=financial-cli",
							],
							{ stdio: "ignore", timeout: 30_000 },
						);
						if (generated.status !== 0)
							throw new Error("Key generation failed");
						const publicCertificate = readFileSync(cert, "utf8");
						write(configDir, "private.pem", readFileSync(key, "utf8"));
						write(configDir, "certificate.pem", publicCertificate);
						return publicCertificate;
					} finally {
						rmSync(key, { force: true });
						rmSync(cert, { force: true });
					}
				},
			),
		configure: (config) =>
			decode(ConfigSchema, config).pipe(
				Effect.flatMap((value) =>
					attempt(
						"Input",
						"Configuration requires an HTTPS callback and port 1024–65535.",
						() => validateConfig(value),
					),
				),
				Effect.flatMap((value) =>
					attempt("Storage", "Unable to save configuration safely.", () =>
						write(configDir, "config.json", JSON.stringify(value)),
					),
				),
			),
		config: () =>
			attempt(
				"Storage",
				"Configuration missing or unsafe. Run auth configure.",
				() => JSON.parse(read(configDir, "config.json") ?? ""),
			).pipe(
				Effect.flatMap((input) => decode(ConfigSchema, input)),
				Effect.flatMap((value) =>
					attempt("Input", "Invalid configuration.", () =>
						validateConfig(value),
					),
				),
			),
		privateKey: () =>
			attempt(
				"Storage",
				"Private key missing or unsafe. Run auth keygen.",
				() => read(configDir, "private.pem") ?? "",
			),
		snapshot: (endpoint) =>
			Effect.gen(function* () {
				const config = yield* service.config();
				const privateKey = yield* service.privateKey();
				return yield* attempt(
					"Storage",
					"Unable to bind credential identity safely.",
					() => {
						if (!held) throw new Error("Exclusive scope required");
						const parsed = createPrivateKey(privateKey);
						const fingerprint = createHash("sha256")
							.update(parsed.export({ format: "der", type: "pkcs8" }))
							.digest("hex");
						const identity = createHash("sha256")
							.update(
								JSON.stringify([
									config.applicationId,
									config.testOnly,
									config.callbackUrl,
									config.port,
									endpoint,
									fingerprint,
								]),
							)
							.digest("hex");
						return Object.freeze({
							config: Object.freeze({ ...config }),
							privateKey,
							identity,
							endpoint,
						});
					},
				);
			}),
		sessions: () =>
			attempt("Storage", "Unable to read sessions safely.", () => {
				const text = read(stateDir, "sessions.json", true);
				return text === undefined ? [] : JSON.parse(text);
			}).pipe(Effect.flatMap((value) => decode(SessionsSchema, value))),
		saveSession: (session, deadline) =>
			Effect.gen(function* () {
				const value = yield* decode(StoredSessionSchema, session);
				const sessions = yield* service.sessions();
				yield* attempt("Storage", "Unable to save session safely.", () => {
					if (!held) throw new Error("Exclusive scope required");
					const records = sessions.filter(
						(s) =>
							s.identity !== value.identity ||
							s.bank !== value.bank ||
							s.country !== value.country,
					);
					write(
						stateDir,
						"sessions.json",
						JSON.stringify([...records, value]),
						deadline,
					);
				});
			}),
	};
	return {
		...service,
		keygen: () => locked(service.keygen()),
		configure: (config) => locked(service.configure(config)),
	};
}
