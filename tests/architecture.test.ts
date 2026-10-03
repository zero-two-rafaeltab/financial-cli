import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
			const child = Bun.spawn(["bun", "src/architecture.ts", root], {
				cwd: join(import.meta.dir, ".."),
				stdout: "pipe",
				stderr: "pipe",
			});
			await new Response(child.stdout).text();
			const err = await new Response(child.stderr).text();
			expect(await child.exited).toBe(1);
			expect(err).toContain("Dependency must point inward");
			rmSync(join(root, from ?? "", "index.ts"));
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("capability entry points and CLI imports reject private and infrastructure dependencies", async () => {
	const root = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-capability-architecture-"),
	);
	try {
		for (const module of ["capabilities/authentication", "provider", "storage"])
			mkdirSync(join(root, module), { recursive: true });
		for (const [file, specifier] of [
			["capabilities/authentication/workflow.ts", "../../provider"],
			["capabilities/authentication/workflow.ts", "node:fs"],
			["cli.ts", "./capabilities/authentication/workflow"],
			["provider/index.ts", "../capabilities/authentication/contract"],
		]) {
			writeFileSync(join(root, file ?? ""), `import "${specifier}";`);
			const child = Bun.spawn(["bun", "src/architecture.ts", root], {
				stdout: "pipe",
				stderr: "pipe",
			});
			await new Response(child.stdout).text();
			await new Response(child.stderr).text();
			expect(await child.exited).toBe(1);
			rmSync(join(root, file ?? ""));
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
