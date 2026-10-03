import { expect, test } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import type { Collection } from "../src/capabilities/transactions";
import { localTransactionStore } from "../src/storage";
import { runChild } from "./runtime-fixture";

const checkout = join(import.meta.dir, "..");
const saved: Collection = {
	accounts: [],
	transactions: [],
	coverage: [],
	banks: [
		{
			key: "synthetic-bank",
			bank: "Synthetic",
			country: "NL",
			lastAttemptAt: "2026-10-03T12:00:00Z",
			outcome: "running",
		},
	],
};

test("transaction store atomically persists validated snapshots privately and rejects concurrent writers", async () => {
	const base = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-transactions-"),
	);
	const locations = { stateHome: base, checkout };
	const store = localTransactionStore(locations);
	try {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					yield* store.exclusive();
					yield* store.replace(saved);
					expect(yield* store.read()).toEqual(saved);
					const competing = yield* Effect.scoped(
						localTransactionStore(locations).exclusive(),
					).pipe(
						Effect.match({
							onFailure: (e) => e.kind,
							onSuccess: () => "unexpected",
						}),
					);
					expect(competing).toBe("Storage");
				}),
			),
		);
		expect(
			await Effect.runPromise(localTransactionStore(locations).read()),
		).toEqual(saved);
		expect(statSync(join(base, "financial-cli")).mode & 0o777).toBe(0o700);
		expect(
			statSync(join(base, "financial-cli/transactions.json")).mode & 0o777,
		).toBe(0o600);
		expect(readdirSync(join(base, "financial-cli"))).toEqual([
			"transactions.json",
		]);
		await expect(Effect.runPromise(store.replace(saved))).rejects.toMatchObject(
			{ kind: "Storage" },
		);
		await Effect.runPromise(Effect.scoped(store.exclusive()));
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("transaction storage rejects repository/symlink paths, unsafe permissions and corrupt records", async () => {
	const base = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-tx-unsafe-"),
	);
	try {
		await expect(
			Effect.runPromise(
				localTransactionStore({ stateHome: checkout, checkout }).read(),
			),
		).rejects.toMatchObject({ kind: "Storage" });
		symlinkSync(base, join(base, "link"));
		await expect(
			Effect.runPromise(
				localTransactionStore({
					stateHome: join(base, "link"),
					checkout,
				}).read(),
			),
		).rejects.toMatchObject({ kind: "Storage" });
		const store = localTransactionStore({ stateHome: base, checkout });
		await Effect.runPromise(
			Effect.scoped(Effect.andThen(store.exclusive(), store.replace(saved))),
		);
		const path = join(base, "financial-cli/transactions.json");
		const original = readFileSync(path, "utf8");
		chmodSync(path, 0o644);
		await expect(Effect.runPromise(store.read())).rejects.toMatchObject({
			kind: "Storage",
		});
		chmodSync(path, 0o600);
		writeFileSync(path, '{"version": 999, "collection": {}}');
		await expect(Effect.runPromise(store.read())).rejects.toMatchObject({
			kind: "Storage",
		});
		writeFileSync(path, original);
		chmodSync(base, 0o777);
		await expect(Effect.runPromise(store.read())).rejects.toMatchObject({
			kind: "Storage",
		});
		chmodSync(base, 0o700);
		rmSync(path);
		symlinkSync(join(base, "missing"), path);
		await expect(Effect.runPromise(store.read())).rejects.toMatchObject({
			kind: "Storage",
		});
	} finally {
		chmodSync(base, 0o700);
		rmSync(base, { recursive: true, force: true });
	}
});

test("write, fsync and rename failures preserve the previous transaction snapshot and remove temporary files", async () => {
	const base = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-tx-fault-"),
	);
	const store = localTransactionStore({ stateHome: base, checkout });
	try {
		await Effect.runPromise(
			Effect.scoped(Effect.andThen(store.exclusive(), store.replace(saved))),
		);
		for (const phase of ["write", "fsync", "rename"]) {
			const { out, err, code } = await runChild(
				[
					"bun",
					"--preload",
					"./tests/fs-fault.ts",
					"--eval",
					`
import { Effect } from "effect";
import { localTransactionStore } from "./src/storage";
const store = localTransactionStore({ stateHome: process.env.FINANCIAL_CLI_TEST_STORE_ROOT ?? "", checkout: process.cwd() });
await Effect.runPromise(Effect.scoped(Effect.andThen(store.exclusive(), store.replace({ accounts: [], transactions: [], coverage: [], banks: [] })))).then(() => { process.exitCode = 2; }, () => console.log("Expected storage failure"));
`,
				],
				{
					cwd: checkout,
					env: {
						PATH: process.env.PATH,
						FINANCIAL_CLI_TEST_STORE_ROOT: base,
						FINANCIAL_CLI_TEST_FS_FAULT: phase,
					},
				},
			);
			expect(code).toBe(0);
			expect(out).toContain("Expected storage failure");
			expect(err).toBe("");
			expect(await Effect.runPromise(store.read())).toEqual(saved);
			expect(readdirSync(join(base, "financial-cli"))).toEqual([
				"transactions.json",
			]);
		}
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("successful transaction publication has no fallible temporary-file cleanup afterwards", async () => {
	const base = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-tx-publication-"),
	);
	try {
		const { out, err, code } = await runChild(
			[
				"bun",
				"--preload",
				"./tests/fs-fault.ts",
				"--eval",
				`
import { Effect } from "effect";
import { localTransactionStore } from "./src/storage";
const store = localTransactionStore({ stateHome: process.env.FINANCIAL_CLI_TEST_STORE_ROOT ?? "", checkout: process.cwd() });
await Effect.runPromise(Effect.scoped(Effect.andThen(store.exclusive(), store.replace({ accounts: [], transactions: [], coverage: [], banks: [] })))).then(() => console.log("Published"), () => { console.log("Reported failure after publication"); process.exitCode = 2; });
`,
			],
			{
				cwd: checkout,
				env: {
					PATH: process.env.PATH,
					FINANCIAL_CLI_TEST_STORE_ROOT: base,
					FINANCIAL_CLI_TEST_FS_FAULT: "post-rename-cleanup",
				},
			},
		);
		expect(out).toBe("Published\n");
		expect(err).toBe("");
		expect(code).toBe(0);
		expect(readdirSync(join(base, "financial-cli"))).toEqual([
			"transactions.json",
		]);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});
