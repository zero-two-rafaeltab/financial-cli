import { expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { key } from "./key-fixture";

const root = join(import.meta.dir, "..");

test("explicit XDG overrides replace each default independently", async () => {
	for (const override of ["config", "state", "both"]) {
		const f = fixture();
		try {
			const configHome = join(
				f.home,
				override === "state" ? ".financial-cli/config" : "custom-config",
			);
			const stateHome = join(
				f.home,
				override === "config" ? ".financial-cli/state" : "custom-state",
			);
			const env = {
				...f.env,
				...(override === "state" ? {} : { XDG_CONFIG_HOME: configHome }),
				...(override === "config" ? {} : { XDG_STATE_HOME: stateHome }),
			};
			f.seed(configHome);
			expect((await run(configureArgs, env)).exit).toBe(0);
			expect(await run(["auth", "status"], env)).toEqual({
				out: "Session: missing\n",
				err: "",
				exit: 2,
			});
			expect(existsSync(join(configHome, "financial-cli/config.json"))).toBe(
				true,
			);
			expect(existsSync(join(stateHome, "financial-cli"))).toBe(true);
			if (override !== "state")
				expect(existsSync(join(f.home, ".financial-cli/config"))).toBe(false);
			if (override !== "config")
				expect(existsSync(join(f.home, ".financial-cli/state"))).toBe(false);
		} finally {
			f.cleanup();
		}
	}
});

test("unsafe XDG ancestry and non-directory paths fail without claiming lock contention", async () => {
	for (const location of ["XDG_CONFIG_HOME", "XDG_STATE_HOME"]) {
		for (const problem of ["permissions", "path"]) {
			const f = fixture();
			try {
				const unsafe = join(f.home, "unsafe");
				if (problem === "permissions") {
					mkdirSync(unsafe, { mode: 0o770 });
					chmodSync(unsafe, 0o770);
				} else writeFileSync(unsafe, "not a directory", { mode: 0o600 });
				const result = await run(configureArgs, {
					...f.env,
					[location]: unsafe,
				});
				expect(result.exit).toBe(1);
				expect(result.out).toBe("");
				expect(result.err).toContain(
					"Unable to access authentication storage safely",
				);
				expect(result.err).not.toContain("storage is locked");
				expect(
					existsSync(
						join(f.home, ".financial-cli/config/financial-cli/config.json"),
					),
				).toBe(false);
			} finally {
				f.cleanup();
			}
		}
	}
});

test("an existing auth lock reports contention but a non-file lock reports a path failure", async () => {
	for (const problem of ["contention", "path"]) {
		const f = fixture();
		try {
			const configHome = join(f.home, ".financial-cli/config");
			f.seed(configHome);
			const lock = join(configHome, "financial-cli/.auth-lock");
			if (problem === "contention") writeFileSync(lock, "", { mode: 0o600 });
			else mkdirSync(lock, { mode: 0o700 });
			const result = await run(configureArgs, f.env);
			expect(result.exit).toBe(1);
			expect(result.out).toBe("");
			if (problem === "contention")
				expect(result.err).toContain("storage is locked");
			else {
				expect(result.err).toContain(
					"Unable to access authentication storage safely",
				);
				expect(result.err).not.toContain("storage is locked");
			}
			expect(existsSync(lock)).toBe(true);
			expect(existsSync(join(configHome, "financial-cli/config.json"))).toBe(
				false,
			);
		} finally {
			f.cleanup();
		}
	}
});

for (const firstRoot of ["config", "state"] as const) {
	test(`second-lock contention releases the first ${firstRoot} lock and preserves the competing lock and sessions`, async () => {
		const f = orderedLockFixture(firstRoot);
		try {
			const competing = "SYNTHETIC-COMPETING-LOCK";
			writeFileSync(f.secondLock, competing, { mode: 0o600 });
			const before = statSync(f.secondLock);
			const result = await run(configureArgs, f.env);
			expect(result.exit).toBe(1);
			expect(result.out).toBe("");
			expect(result.err).toContain("storage is locked");
			expect(existsSync(f.firstLock)).toBe(false);
			expect(readFileSync(f.secondLock, "utf8")).toBe(competing);
			const after = statSync(f.secondLock);
			expect([after.ino, after.mode, after.mtimeMs]).toEqual([
				before.ino,
				before.mode,
				before.mtimeMs,
			]);
			expect(readFileSync(f.sessionsPath, "utf8")).toBe(f.sessions);

			// Only the test owner removes the competing lock before retrying.
			rmSync(f.secondLock);
			expect(await run(configureArgs, f.env)).toEqual({
				out: "Configuration saved.\n",
				err: "",
				exit: 0,
			});
			expect(existsSync(f.firstLock)).toBe(false);
			expect(existsSync(f.secondLock)).toBe(false);
			expect(readFileSync(f.sessionsPath, "utf8")).toBe(f.sessions);
		} finally {
			f.cleanup();
		}
	});

	test(`later-directory validation releases the first ${firstRoot} lock and preserves sessions`, async () => {
		const f = orderedLockFixture(firstRoot);
		try {
			chmodSync(f.secondDir, 0o770);
			const result = await run(configureArgs, f.env);
			expect(result.exit).toBe(1);
			expect(result.out).toBe("");
			expect(result.err).toContain(
				"Unable to access authentication storage safely",
			);
			expect(result.err).not.toContain("storage is locked");
			expect(existsSync(f.firstLock)).toBe(false);
			expect(existsSync(f.secondLock)).toBe(false);
			expect(readFileSync(f.sessionsPath, "utf8")).toBe(f.sessions);

			chmodSync(f.secondDir, 0o700);
			expect(await run(configureArgs, f.env)).toEqual({
				out: "Configuration saved.\n",
				err: "",
				exit: 0,
			});
			expect(existsSync(f.firstLock)).toBe(false);
			expect(existsSync(f.secondLock)).toBe(false);
			expect(readFileSync(f.sessionsPath, "utf8")).toBe(f.sessions);
		} finally {
			f.cleanup();
		}
	});
}

function orderedLockFixture(firstRoot: "config" | "state") {
	const f = fixture();
	// One private parent and explicit names force acquisition before the failure.
	const firstHome = join(f.home, "00-first");
	const secondHome = join(f.home, "99-second");
	const configHome = firstRoot === "config" ? firstHome : secondHome;
	const stateHome = firstRoot === "state" ? firstHome : secondHome;
	f.seed(configHome);
	mkdirSync(join(stateHome, "financial-cli"), {
		recursive: true,
		mode: 0o700,
	});
	const sessionsPath = join(stateHome, "financial-cli/sessions.json");
	const sessions = JSON.stringify([
		{
			sessionId: "11111111-1111-4111-8111-111111111111",
			validUntil: "2099-01-01T00:00:00Z",
			identity: "a".repeat(64),
			bank: "Fixture Bank",
			country: "FI",
		},
	]);
	writeFileSync(sessionsPath, sessions, { mode: 0o600 });
	return {
		...f,
		env: {
			...f.env,
			XDG_CONFIG_HOME: configHome,
			XDG_STATE_HOME: stateHome,
			FINANCIAL_CLI_TEST_MODE: "1",
		},
		firstLock: join(firstHome, "financial-cli/.auth-lock"),
		secondDir: join(secondHome, "financial-cli"),
		secondLock: join(secondHome, "financial-cli/.auth-lock"),
		sessionsPath,
		sessions,
	};
}

const configureArgs = [
	"auth",
	"configure",
	"--application-id",
	"00000000-0000-4000-8000-000000000001",
	"--callback-url",
	"https://fixture.test/callback",
];

async function run(args: string[], env: Record<string, string | undefined>) {
	const proc = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
		cwd: root,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, exit] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(out + err).not.toContain(key);
	return { out, err, exit };
}

function fixture() {
	const home = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-cli-home-"),
	);
	const env = { HOME: home, PATH: process.env.PATH };
	const seed = (configHome: string) => {
		const dir = join(configHome, "financial-cli");
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		writeFileSync(join(dir, "private.pem"), key, { mode: 0o600 });
	};
	return {
		home,
		env,
		seed,
		cleanup: () => rmSync(home, { recursive: true, force: true }),
	};
}

test("CLI help exposes only authentication commands", async () => {
	const result = await run(["--help"], {});
	expect(result.exit).toBe(0);
	for (const command of ["keygen", "configure", "login", "status"])
		expect(result.out).toContain(`auth ${command}`);
	expect(result.out).not.toContain("auth transactions");
	expect(result.out).toContain("--transactions consent");
	expect(result.out).toContain("read-only transaction access");
});

test("CLI requires transaction acknowledgement before accessing credentials", async () => {
	const f = fixture();
	try {
		const result = await run(["auth", "login"], f.env);
		expect(result.exit).toBe(1);
		expect(result.out).toBe("");
		expect(result.err).toContain("requires acknowledgement");
		expect(result.err).toContain("--transactions consent");
		expect(existsSync(join(f.home, ".financial-cli"))).toBe(false);
		const invalid = await run(
			["auth", "login", "--transactions", "yes"],
			f.env,
		);
		expect(invalid.exit).toBe(1);
		expect(invalid.out).toBe("");
		expect(existsSync(join(f.home, ".financial-cli"))).toBe(false);
	} finally {
		f.cleanup();
	}
});

test("without XDG overrides commands reuse private defaults despite writable conventional roots", async () => {
	const f = fixture();
	try {
		for (const path of [".config", ".local"]) {
			mkdirSync(join(f.home, path), { mode: 0o770 });
			chmodSync(join(f.home, path), 0o770);
		}
		const configHome = join(f.home, ".financial-cli/config");
		f.seed(configHome);
		const configured = await run(configureArgs, f.env);
		expect(configured).toEqual({
			out: "Configuration saved.\n",
			err: "",
			exit: 0,
		});
		const status = await run(["auth", "status"], f.env);
		expect(status).toEqual({ out: "Session: missing\n", err: "", exit: 2 });
		expect(
			readFileSync(join(configHome, "financial-cli/private.pem"), "utf8"),
		).toBe(key);
		expect(existsSync(join(configHome, "financial-cli/config.json"))).toBe(
			true,
		);
		expect(existsSync(join(f.home, ".financial-cli/state/financial-cli"))).toBe(
			true,
		);
		expect(existsSync(join(f.home, ".config/financial-cli"))).toBe(false);
		expect(existsSync(join(f.home, ".local/state"))).toBe(false);
	} finally {
		f.cleanup();
	}
});
