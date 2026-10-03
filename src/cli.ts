import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Effect, Layer, Schema } from "effect";
import { callbackLayer } from "./callback";
import { type Bank, login, status } from "./capabilities/authentication";
import { enableBankingLayer } from "./provider";
import { type AuthError, attempt, decode, failure } from "./shared";
import { stateLayer } from "./state";
import { localStore, storeLayer } from "./storage";

import { runTransactions } from "./transaction-cli";

const help = `financial-cli — private local account information

  auth keygen                         Create a local RSA key; print public certificate only
  auth configure --application-id ID --callback-url HTTPS_URL [--port 8787]
  auth login --transactions consent [--country CC --bank NAME] [--timeout 180]
  auth status [--country CC --bank NAME] Validate saved sessions with Enable Banking

  transactions sync [--country CC --bank NAME --account KEY] [--from YYYY-MM-DD --to YYYY-MM-DD] [--overlap-days 7]
  transactions accounts [--country CC --bank NAME]
  transactions query [--country CC --bank NAME --account KEY] [--from YYYY-MM-DD --to YYYY-MM-DD]
                     [--status booked|pending|cancelled|hold|other|rejected|scheduled]
                     [--currency EUR --direction debit|credit --text TEXT]
                     [--date-field bookingDate|valueDate|transactionDate --limit 1000 --offset 0]

Transaction queries are offline sanitized counts/freshness summaries. Use the typed
Effect API for private transaction results. Sync never renews consent. Initial and
new-authorization history requests are provider-limited; subsequent runs overlap.

Without --bank, select from Enable Banking's /aspsps list in the terminal.
--transactions consent acknowledges read-only transaction access for local reporting.
Complete fresh owner/bank consent; balances and payments are not requested.
Consent expiry comes from the provider; renewal requires new bank authorization.
Register the exact HTTPS callback URL and forward its path with Tailscale Serve
to the configured loopback listener port. Credentials remain outside checkout
in ~/.financial-cli/config/financial-cli and ~/.financial-cli/state/financial-cli.
Override either root with XDG_CONFIG_HOME or XDG_STATE_HOME; financial-cli is
appended to each root. HTTPS callback required; no hostname assumed.
Endpoint overrides require FINANCIAL_CLI_TEST_MODE=1, isolated explicit XDG
roots, test-only configuration and a loopback FINANCIAL_CLI_TEST_API_URL.
`;
const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) console.log(help);
else if (args[0] === "transactions") await runTransactions(args.slice(1));
else {
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	const program = Effect.gen(function* () {
		const command = yield* attempt(
			"Input",
			"Invalid command or options. See --help.",
			() => {
				if (
					args[0] !== "auth" ||
					!["keygen", "configure", "login", "status"].includes(args[1] ?? "")
				)
					throw new Error("Invalid command");
				const name = args[1] ?? "";
				const allowed =
					name === "configure"
						? ["--application-id", "--callback-url", "--port"]
						: name === "login"
							? ["--country", "--bank", "--timeout", "--transactions"]
							: name === "status"
								? ["--country", "--bank"]
								: [];
				const options: Record<string, string> = {};
				for (let i = 2; i < args.length; i += 2) {
					const key = args[i];
					const value = args[i + 1];
					if (
						!key ||
						!allowed.includes(key) ||
						options[key] !== undefined ||
						value === undefined ||
						value.startsWith("--")
					)
						throw new Error("Invalid option");
					options[key] = value;
				}
				return { name, options };
			},
		);
		const env = process.env;
		const testMode = env.FINANCIAL_CLI_TEST_MODE === "1";
		yield* attempt(
			"Input",
			"Test mode requires isolated absolute XDG locations.",
			() => {
				if (testMode && (!env.XDG_CONFIG_HOME || !env.XDG_STATE_HOME))
					throw new Error("Test isolation required");
				for (const path of [env.XDG_CONFIG_HOME, env.XDG_STATE_HOME])
					if (path !== undefined && !isAbsolute(path))
						throw new Error("Absolute path required");
				if (env.FINANCIAL_CLI_TEST_API_URL && !testMode)
					throw new Error("Override prohibited");
			},
		);
		const credentials = localStore({
			configHome:
				env.XDG_CONFIG_HOME ?? resolve(homedir(), ".financial-cli/config"),
			stateHome:
				env.XDG_STATE_HOME ?? resolve(homedir(), ".financial-cli/state"),
			checkout: resolve(import.meta.dir, ".."),
		});
		const storage = storeLayer(credentials);
		const provider = enableBankingLayer({
			testMode,
			...(env.FINANCIAL_CLI_TEST_API_URL === undefined
				? {}
				: { baseUrl: env.FINANCIAL_CLI_TEST_API_URL }),
		});
		const endpoint =
			env.FINANCIAL_CLI_TEST_API_URL ?? "https://api.enablebanking.com";
		const services = Layer.mergeAll(
			storage,
			provider,
			callbackLayer,
			stateLayer,
		);
		if (command.name === "keygen") {
			const certificate = yield* credentials.keygen();
			yield* Effect.sync(() => process.stdout.write(certificate));
		} else if (command.name === "configure") {
			const config = {
				applicationId: command.options["--application-id"],
				callbackUrl: command.options["--callback-url"],
				port: Number(command.options["--port"] ?? 8787),
				testOnly: testMode,
			};
			yield* credentials.configure(
				yield* decode(
					Schema.Struct({
						applicationId: Schema.String.check(Schema.isUUID()),
						callbackUrl: Schema.String,
						port: Schema.Int,
						testOnly: Schema.Boolean,
					}),
					config,
				),
			);
			yield* Effect.sync(() => console.log("Configuration saved."));
		} else if (command.name === "login") {
			const transactionConsent =
				command.options["--transactions"] === undefined
					? undefined
					: yield* decode(
							Schema.Literal("consent"),
							command.options["--transactions"],
						);
			const timeout = yield* decode(
				Schema.Number.check(
					Schema.makeFilter(
						(n) =>
							Number.isFinite(n) && n >= (testMode ? 0.02 : 10) && n <= 600,
					),
				),
				Number(command.options["--timeout"] ?? 180),
			);
			const country = command.options["--country"];
			if (country !== undefined)
				yield* decode(
					Schema.String.check(Schema.makeFilter((s) => /^[A-Z]{2}$/.test(s))),
					country,
				);
			const result = yield* login({
				transactionConsent,
				endpoint,
				country,
				bank: command.options["--bank"],
				timeoutSeconds: timeout,
				select: selectBank,
				publishUrl: (url) =>
					Effect.sync(() =>
						console.log(
							`Open this authorization link in your browser:\n${url}`,
						),
					),
			}).pipe(Effect.provide(services));
			yield* Effect.sync(() => {
				switch (result.outcome) {
					case "authorized":
						console.log(
							`Authorization saved. Valid until: ${result.validUntil}. Run auth status to validate it.`,
						);
						console.log(
							`Maximum consent validity: ${result.maximumConsentValidity} seconds. Requested until: ${result.requestedAccess.validUntil}.`,
						);
						console.log(
							"Transaction access: requested; balances: not requested; provider/bank grant governs.",
						);
						console.log(
							`Provider-reported transaction access: ${result.reportedAccess?.transactions ?? "unknown"}; balances: ${result.reportedAccess?.balances ?? "unknown"}.`,
						);
						break;
					case "consent-required":
						console.error(
							"Read-only transaction access requires acknowledgement. Use --transactions consent, then complete fresh bank consent. Balances and payments are not requested.",
						);
						process.exitCode = 1;
						break;
					case "denied":
						console.error("Authorization was not completed.");
						process.exitCode = 1;
						break;
				}
			});
		} else {
			const result = yield* status({
				endpoint,
				country: command.options["--country"],
				bank: command.options["--bank"],
			}).pipe(Effect.provide(services));
			yield* Effect.sync(() => {
				if (result.length === 0) console.log("Session: missing");
				for (const entry of result) {
					console.log(
						`${entry.country} ${Array.from(entry.bank)
							.filter((char) => {
								const n = char.codePointAt(0) ?? 0;
								return n >= 32 && (n < 127 || n > 159);
							})
							.join("")}: ${entry.status}`,
					);
					console.log(`  Expiry: ${entry.validUntil} (${entry.expirySource})`);
					console.log(
						`  Verification: ${entry.verification}; Renewal: ${entry.renewal}`,
					);
					console.log(
						entry.requestedAccess === null
							? "  Transaction access: unknown; fresh consent required"
							: "  Transaction access: requested; balances: not requested; provider/bank grant governs",
					);
					console.log(
						`  Provider-reported transaction access: ${entry.reportedAccess?.transactions ?? "unknown"}; balances: ${entry.reportedAccess?.balances ?? "unknown"} (${entry.accessSource})`,
					);
				}
				const states = result.map((s) => s.status);
				process.exitCode = states.includes("provider-unavailable")
					? 4
					: states.length === 0 || states.includes("missing")
						? 2
						: states.some((s) => s !== "authorized")
							? 3
							: 0;
			});
		}
	});
	await Effect.runPromise(
		program.pipe(
			Effect.catch((error: AuthError) =>
				Effect.sync(() => {
					console.error(error.message);
					process.exitCode = 1;
				}),
			),
		),
		{ signal: controller.signal },
	).catch(() => {
		console.error(
			controller.signal.aborted
				? "Authorization cancelled."
				: "Authentication failed.",
		);
		process.exitCode = 1;
	});
	process.off("SIGINT", cancel);
	process.off("SIGTERM", cancel);
}
function selectBank(banks: readonly Bank[]): Effect.Effect<Bank, AuthError> {
	return Effect.scoped(
		Effect.gen(function* () {
			if (!process.stdin.isTTY)
				return yield* Effect.fail(
					failure(
						"Input",
						"Non-interactive login requires --country and --bank from the provider list.",
					),
				);
			yield* Effect.sync(() => {
				for (const [index, bank] of banks.entries())
					console.log(
						`${index + 1}. ${bank.country} ${Array.from(bank.name)
							.filter((char) => {
								const n = char.codePointAt(0) ?? 0;
								return n >= 32 && (n < 127 || n > 159);
							})
							.join("")}`,
					);
			});
			const input = yield* Effect.acquireRelease(
				Effect.sync(() =>
					createInterface({ input: process.stdin, output: process.stdout }),
				),
				(rl) => Effect.sync(() => rl.close()),
			);
			const answer = yield* Effect.tryPromise({
				try: (signal) => input.question("Select bank number: ", { signal }),
				catch: () => failure("Input", "Bank selection cancelled."),
			});
			const selected = banks[Number(answer) - 1];
			if (!/^\d+$/.test(answer) || !selected)
				return yield* Effect.fail(failure("Input", "Invalid bank selection."));
			return selected;
		}),
	);
}
