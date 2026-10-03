import { expect, test } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
test("CLI help exposes only authentication commands", async () => {
	const proc = Bun.spawn(["bun", "src/cli.ts", "--help"], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	const text = await new Response(proc.stdout).text();
	expect(await proc.exited).toBe(0);
	expect(text).toContain("auth keygen");
	expect(text).toContain("auth configure");
	expect(text).toContain("auth login");
	expect(text).toContain("auth status");
	expect(text).not.toContain("transactions");
});
