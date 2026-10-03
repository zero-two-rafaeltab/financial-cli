import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runChild } from "./runtime-fixture";

test("architecture check rejects outward application and cross-adapter imports", async () => {
	const root = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-architecture-"),
	);
	try {
		for (const module of ["auth", "storage", "provider"])
			mkdirSync(join(root, module));
		for (const [from, to] of [
			["auth", "storage"],
			["provider", "storage"],
		]) {
			writeFileSync(join(root, from ?? "", "index.ts"), `import "../${to}";`);
			const { err, code } = await runChild(
				["bun", "src/architecture.ts", root],
				{
					cwd: join(import.meta.dir, ".."),
					env: { PATH: process.env.PATH },
				},
			);
			expect(code).toBe(1);
			expect(err).toContain("Dependency must point inward");
			rmSync(join(root, from ?? "", "index.ts"));
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("architecture enforces nested capability dependency direction and public entry points", async () => {
	const root = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-capability-architecture-"),
	);
	try {
		mkdirSync(join(root, "capabilities/transactions"), { recursive: true });
		mkdirSync(join(root, "capabilities/authentication"), { recursive: true });
		mkdirSync(join(root, "provider"));
		mkdirSync(join(root, "tests"));
		mkdirSync(join(root, "examples"));
		for (const [path, source] of [
			["capabilities/authentication/workflow.ts", 'import "../../provider";'],
			["capabilities/authentication/workflow.ts", 'import "node:fs";'],
			["cli.ts", 'import "./capabilities/authentication/workflow";'],
			[
				"provider/index.ts",
				'import "../capabilities/authentication/contract";',
			],
			["capabilities/transactions/index.ts", 'import "node:fs";'],
			["provider/index.ts", 'import "../capabilities/transactions/workflow";'],
			["capabilities/transactions/index.ts", 'import "../../provider";'],
			["cli.ts", 'import "./capabilities/transactions/workflow";'],
			["tests/consumer.ts", 'import "../capabilities/transactions/contract";'],
			[
				"examples/demo.ts",
				'import "../capabilities/transactions/reconciliation";',
			],
		]) {
			writeFileSync(join(root, path ?? ""), source ?? "");
			const { code } = await runChild(["bun", "src/architecture.ts", root], {
				cwd: join(import.meta.dir, ".."),
				env: { PATH: process.env.PATH },
			});
			expect(code).toBe(1);
			rmSync(join(root, path ?? ""));
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
