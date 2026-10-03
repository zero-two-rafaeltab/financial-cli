import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { localStore } from "../src/storage";
import { key } from "./key-fixture";
import { runChild } from "./runtime-fixture";

const checkout = join(import.meta.dir, "..");
const ids = [
	"497f6eca-6276-4993-bfeb-53cbbbba6f08",
	"507f6eca-6276-4993-bfeb-53cbbbba6f08",
];
const uids = [
	"617f6eca-6276-4993-bfeb-53cbbbba6f08",
	"627f6eca-6276-4993-bfeb-53cbbbba6f08",
];
const banks = ["ING Synthetic", "Revolut Synthetic"];

test("actual CLI synchronizes two banks, queries privately and reports partial failures with retained freshness", async () => {
	const base = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-tx-cli-"),
	);
	let failure = false;
	const seen: URL[] = [];
	const marker = "SYNTHETIC-PRIVATE-MERCHANT";
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			seen.push(url);
			const i =
				url.pathname.includes(ids[1] ?? "never") ||
				url.pathname.includes(uids[1] ?? "never")
					? 1
					: 0;
			const uid = uids[i];
			const primary = `synthetic-${i}`;
			if (url.pathname.startsWith("/sessions/"))
				return Response.json({
					status: "AUTHORIZED",
					access: { transactions: true, valid_until: "2099-01-01T00:00:00Z" },
					aspsp: { name: banks[i], country: "NL" },
					accounts: [uid],
					accounts_data: [
						{
							uid,
							identification_hash: primary,
							identification_hashes: [primary],
						},
					],
				});
			if (url.pathname.endsWith("/details"))
				return Response.json({
					uid,
					currency: "EUR",
					cash_account_type: "CACC",
					identification_hash: primary,
					identification_hashes: [primary],
				});
			if (failure && i === 1 && url.searchParams.has("continuation_key"))
				return new Response(marker, { status: 500 });
			return Response.json({
				transactions: [
					{
						entry_reference: "same-reference-different-accounts",
						transaction_amount: { amount: "12.3400", currency: "EUR" },
						credit_debit_indicator: "DBIT",
						status: "BOOK",
						booking_date: "2026-10-02",
						creditor: { name: marker },
					},
				],
				continuation_key: url.searchParams.has("continuation_key")
					? null
					: "next",
			});
		},
	});
	const env = {
		PATH: process.env.PATH,
		XDG_CONFIG_HOME: join(base, "config"),
		XDG_STATE_HOME: join(base, "state"),
		FINANCIAL_CLI_TEST_MODE: "1",
		FINANCIAL_CLI_TEST_API_URL: server.url.origin,
	};
	const run = async (...args: string[]) => {
		const { out, err, code } = await runChild(
			["bun", "src/cli.ts", "transactions", ...args],
			{
				cwd: checkout,
				env,
			},
		);

		expect(`${out}${err}`).not.toContain(marker);
		for (const id of ids) expect(`${out}${err}`).not.toContain(id);
		return { out, err, code };
	};
	try {
		const auth = localStore({
			configHome: env.XDG_CONFIG_HOME,
			stateHome: env.XDG_STATE_HOME,
			checkout,
		});
		await Effect.runPromise(
			auth.configure({
				applicationId: "717f6eca-6276-4993-bfeb-53cbbbba6f08",
				callbackUrl: "https://example.test/callback",
				port: 8787,
				testOnly: true,
			}),
		);
		writeFileSync(join(env.XDG_CONFIG_HOME, "financial-cli/private.pem"), key, {
			mode: 0o600,
		});
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					yield* auth.exclusive();
					const snapshot = yield* auth.snapshot(server.url.origin);
					for (const [i, sessionId] of ids.entries())
						yield* auth.saveSession(
							{
								sessionId,
								validUntil: "2099-01-01T00:00:00Z",
								requestedAccess: {
									validUntil: "2099-01-01T00:00:00Z",
									transactions: true,
									balances: false,
								},
								identity: snapshot.identity,
								bank: banks[i] ?? "missing",
								country: "NL",
							},
							Infinity,
						);
				}),
			),
		);
		const first = await run("sync");
		expect(first.err).toBe("");
		expect(first.code).toBe(0);
		expect(first.out).toContain("ING Synthetic: complete");
		expect(first.out).toContain("Revolut Synthetic: complete");
		const q = await run("query", "--from", "2026-10-01", "--status", "booked");
		expect(q.code).toBe(0);
		expect(q.out).toContain("Transactions: 2");
		expect(q.out).toContain("provider-limited");
		failure = true;
		const failed = await run("sync");
		expect(failed.code).toBe(4);
		expect(failed.out).toContain("Revolut Synthetic: failed (Provider)");
		const retained = await run("query", "--bank", "Revolut Synthetic");
		expect(retained.out).toContain("Transactions: 1");
		expect(retained.out).toContain("failed");
		const accountList = await run("accounts");
		expect(accountList.code).toBe(0);
		expect(accountList.out).toContain("Accounts: 2");
		const invalid = await run("query", "--from", "2026-02-30");
		expect(invalid.code).toBe(1);
		expect(invalid.err).toContain("Invalid");
		const absent = await run("sync", "--bank", "Unknown Synthetic");
		expect(absent.code).toBe(1);
		expect(absent.err).toContain("No matching saved bank sessions");
		const noAccounts = await run(
			"sync",
			"--account",
			"unknown-synthetic-account",
		);
		expect(noAccounts.code).toBe(1);
		expect(noAccounts.err).toContain("No matching transaction accounts");
		rmSync(env.XDG_CONFIG_HOME, { recursive: true, force: true });
		await server.stop(true);
		const offline = await run("query");
		expect(offline.code).toBe(0);
		expect(offline.out).toContain("Transactions: 2");
		expect(
			seen.filter((u) => u.pathname.endsWith("/transactions")),
		).toHaveLength(8);
	} finally {
		await server.stop(true);
		rmSync(base, { recursive: true, force: true });
	}
});

test("executable TypeScript example composes public Effects without credentials or terminal parsing", async () => {
	const { out, err, code } = await runChild(
		["bun", "examples/synthetic-transactions.ts"],
		{
			cwd: checkout,
			env: { PATH: process.env.PATH },
		},
	);

	expect(code).toBe(0);
	expect(err).toBe("");
	expect(out).toContain('"bookedCount": 2');
	expect(out).toContain('"exactAmounts": [');
	expect(out).toContain('"9007199254740993.0010"');
	expect(out).toContain('"history": "provider-limited"');
});
