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
