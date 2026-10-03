import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { Effect, Layer, Schema } from "effect";
import {
	CollectionError,
	query,
	Source,
	Store,
	sync,
} from "./capabilities/transactions";
import { enableBankingSource } from "./provider";
import { localStore, localTransactionStore } from "./storage";

const safe = (value: string) =>
	Array.from(value)
		.filter((c) => {
			const n = c.codePointAt(0) ?? 0;
			return n >= 32 && (n < 127 || n > 159);
		})
		.join("")
		.slice(0, 200);
const inputError = () =>
	new CollectionError({
		kind: "Input",
		message: "Invalid transaction command, options or environment. See --help.",
	});
const QuerySchema = Schema.Struct({
	bank: Schema.optionalKey(Schema.NonEmptyString),
	country: Schema.optionalKey(Schema.String),
	accountKeys: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
	from: Schema.optionalKey(Schema.String),
	to: Schema.optionalKey(Schema.String),
	status: Schema.optionalKey(
		Schema.Literals([
			"booked",
			"pending",
			"cancelled",
			"hold",
			"other",
			"rejected",
			"scheduled",
		]),
	),
	currency: Schema.optionalKey(
		Schema.String.check(Schema.makeFilter((s) => /^[A-Z]{3}$/.test(s))),
	),
	direction: Schema.optionalKey(Schema.Literals(["credit", "debit"])),
	text: Schema.optionalKey(Schema.String),
	dateField: Schema.optionalKey(
		Schema.Literals(["bookingDate", "valueDate", "transactionDate"]),
	),
	limit: Schema.optionalKey(Schema.Int),
	offset: Schema.optionalKey(Schema.Int),
	overlapDays: Schema.optionalKey(Schema.Int),
});

export async function runTransactions(args: readonly string[]) {
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	const program = Effect.gen(function* () {
		const parsed = yield* Effect.try({
			try: () => {
				const command = args[0];
				if (command !== "sync" && command !== "query" && command !== "accounts")
					throw new Error("Command");
				const allowed = [
					"--bank",
					"--country",
					"--account",
					...(command === "accounts" ? [] : ["--from", "--to"]),
					...(command === "sync"
						? ["--overlap-days"]
						: command === "query"
							? [
									"--status",
									"--currency",
									"--direction",
									"--text",
									"--date-field",
									"--limit",
									"--offset",
								]
							: []),
				];
				const flags: Record<string, string> = {};
				for (let i = 1; i < args.length; i += 2) {
					const flag = args[i];
					const value = args[i + 1];
					if (
						!flag ||
						!allowed.includes(flag) ||
						value === undefined ||
						value.startsWith("--") ||
						flags[flag] !== undefined
					)
						throw new Error("Option");
					flags[flag] = value;
				}
				const input = Schema.decodeUnknownSync(QuerySchema)({
					...(flags["--bank"] === undefined ? {} : { bank: flags["--bank"] }),
					...(flags["--country"] === undefined
						? {}
						: { country: flags["--country"] }),
					...(flags["--account"] === undefined
						? {}
						: { accountKeys: [flags["--account"]] }),
					...Object.fromEntries(
						[
							["--from", "from"],
							["--to", "to"],
							["--status", "status"],
							["--currency", "currency"],
							["--direction", "direction"],
							["--text", "text"],
							["--date-field", "dateField"],
						].flatMap(([flag, field]) =>
							flag && field && flags[flag] !== undefined
								? [[field, flags[flag]]]
								: [],
						),
					),
					...Object.fromEntries(
						[
							["--limit", "limit"],
							["--offset", "offset"],
							["--overlap-days", "overlapDays"],
						].flatMap(([flag, field]) =>
							flag && field && flags[flag] !== undefined
								? [[field, Number(flags[flag])]]
								: [],
						),
					),
				});
				const env = process.env;
				const testMode = env.FINANCIAL_CLI_TEST_MODE === "1";
				if (
					(testMode && (!env.XDG_CONFIG_HOME || !env.XDG_STATE_HOME)) ||
					(env.FINANCIAL_CLI_TEST_API_URL && !testMode) ||
					[env.XDG_CONFIG_HOME, env.XDG_STATE_HOME].some(
						(p) => p !== undefined && !isAbsolute(p),
					)
				)
					throw new Error("Unsafe environment");
				return {
					command,
					input,
					testMode,
					baseUrl: env.FINANCIAL_CLI_TEST_API_URL,
					locations: {
						configHome:
							env.XDG_CONFIG_HOME ??
							resolve(homedir(), ".financial-cli/config"),
						stateHome:
							env.XDG_STATE_HOME ?? resolve(homedir(), ".financial-cli/state"),
						checkout: resolve(import.meta.dir, ".."),
					},
				};
			},
			catch: inputError,
		});
		const storage = Layer.succeed(
			Store,
			localTransactionStore(parsed.locations),
		);
		if (parsed.command === "sync") {
			const source = Layer.succeed(
				Source,
				enableBankingSource(localStore(parsed.locations), {
					testMode: parsed.testMode,
					...(parsed.baseUrl === undefined ? {} : { baseUrl: parsed.baseUrl }),
				}),
			);
			const result = yield* sync(parsed.input).pipe(
				Effect.provide(Layer.mergeAll(storage, source)),
			);
			yield* Effect.sync(() => {
				if (result.outcome !== "attempted") {
					console.error(
						result.outcome === "no-sessions"
							? "No matching saved bank sessions. Collection never initiates consent."
							: "No matching transaction accounts were resolved.",
					);
					process.exitCode = 1;
				}
				for (const bank of result.banks)
					console.log(
						`${safe(bank.country)} ${safe(bank.bank)}: ${bank.outcome}${bank.failureKind ? ` (${bank.failureKind})` : ""}; accounts: ${bank.accounts}; retained active transactions: ${bank.transactions}; uncertain: ${bank.uncertain}`,
					);
				if (result.banks.some((b) => b.outcome === "failed"))
					process.exitCode = 4;
			});
		} else {
			const result = yield* query(parsed.input).pipe(Effect.provide(storage));
			yield* Effect.sync(() => {
				if (parsed.command === "accounts") {
					console.log(`Accounts: ${result.accounts.length}`);
					for (const account of result.accounts)
						console.log(
							`${safe(account.country)} ${safe(account.bank)} ${safe(account.currency)} --account ${safe(account.key)}`,
						);
				} else {
					console.log(
						`Transactions: ${result.matched}; returned: ${result.transactions.length}; undated matching other filters: ${result.undated}; uncertain returned: ${result.transactions.filter((t) => t.uncertain).length}`,
					);
					const counts = new Map<string, number>();
					for (const t of result.transactions) {
						const group = `${t.data.currency} ${t.data.direction} ${t.data.status}`;
						counts.set(group, (counts.get(group) ?? 0) + 1);
					}
					for (const [group, count] of counts)
						console.log(`${safe(group)}: ${count} returned`);
				}
				for (const bank of result.banks)
					console.log(
						`${safe(bank.country)} ${safe(bank.bank)}: latest attempt ${bank.outcome}; scope ${bank.selection ?? "unknown"}; last all-account unbounded completion ${bank.lastCompletedAt ?? "never"}`,
					);
				const latest = new Map(result.coverage.map((c) => [c.accountKey, c]));
				for (const account of result.accounts) {
					const coverage = latest.get(account.key);
					console.log(
						`${safe(account.bank)} ${safe(account.currency)}: ${coverage ? `provider-limited; completed ${coverage.completedAt}; ${coverage.pages} pages; observed booking dates ${coverage.observedFrom ?? "unknown"} to ${coverage.observedTo ?? "unknown"}` : "never collected"}`,
					);
				}
			});
		}
	});
	try {
		await Effect.runPromise(
			program.pipe(
				Effect.catch((error: CollectionError) =>
					Effect.sync(() => {
						console.error(error.message);
						process.exitCode = 1;
					}),
				),
			),
			{ signal: controller.signal },
		);
	} catch {
		console.error(
			controller.signal.aborted
				? "Transaction command interrupted; prior transactions retained. Latest attempt may remain running."
				: "Transaction command failed.",
		);
		process.exitCode = 1;
	} finally {
		process.off("SIGINT", cancel);
		process.off("SIGTERM", cancel);
	}
}
