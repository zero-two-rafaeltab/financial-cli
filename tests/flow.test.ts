import { expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { Effect } from "effect";
import { localStore } from "../src/storage";

async function seed(
	f: Awaited<ReturnType<typeof fixture>>,
	endpoint: string,
	validUntil = "2099-01-01T00:00:00Z",
) {
	const store = localStore({
		configHome: join(f.base, "config"),
		stateHome: join(f.base, "state"),
		checkout,
	});
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				yield* store.exclusive();
				const snapshot = yield* store.snapshot(endpoint);
				yield* store.saveSession(
					{
						sessionId,
						validUntil,
						identity: snapshot.identity,
						bank: "Fixture Bank",
						country: "FI",
					},
					Infinity,
				);
			}),
		),
	);
}

for (const [remote, local] of [
	["AUTHORIZED", "authorized"],
	["CANCELLED", "cancelled"],
	["CLOSED", "closed"],
	["EXPIRED", "expired"],
	["INVALID", "invalid"],
	["PENDING_AUTHORIZATION", "pending-authorization"],
	["RETURNED_FROM_BANK", "returned-from-bank"],
	["REVOKED", "revoked"],
]) {
	test(`documented provider state ${remote} maps deliberately to ${local}`, async () => {
		const f = await fixture();
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () =>
				Response.json({
					status: remote,
					access: { valid_until: "2099-01-01T00:00:00Z" },
				}),
		});
		const endpoint = `http://127.0.0.1:${server.port}`;
		try {
			await seed(f, endpoint);
			const result = await f.run(["auth", "status"], {
				FINANCIAL_CLI_TEST_API_URL: endpoint,
			});
			expect(result.out).toContain(`: ${local}\n`);
			expect(result.exit).toBe(remote === "AUTHORIZED" ? 0 : 3);
		} finally {
			server.stop(true);
			f.cleanup();
		}
	});
}

test("bank discovery requests only personal AIS and rejects business-only banks", async () => {
	const f = await fixture();
	let query = "";
	let authorized = false;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === "/aspsps") {
				query = url.search;
				return Response.json({
					aspsps: [
						{
							name: "Business Only",
							country: "FI",
							maximum_consent_validity: 3600,
							psu_types: ["business"],
						},
					],
				});
			}
			authorized = true;
			return new Response(null, { status: 500 });
		},
	});
	try {
		const r = await f.run(
			[
				"auth",
				"login",
				"--bank",
				"Business Only",
				"--country",
				"FI",
				"--timeout",
				"1",
			],
			{ FINANCIAL_CLI_TEST_API_URL: `http://127.0.0.1:${server.port}` },
		);
		expect(query).toBe("?service=AIS&psu_type=personal");
		expect(authorized).toBe(false);
		expect(r.err).toContain("No matching bank");
		expect(r.exit).toBe(1);
	} finally {
		server.stop(true);
		f.cleanup();
	}
});

import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { key, publicKey } from "./key-fixture";

const checkout = join(import.meta.dir, "..");
const id = "497f6eca-6276-4993-bfeb-53cbbbba6f08";
const sessionId = "b9d6ceca-72e9-4c43-a2be-a5a12c2e88ef";
const secret = "FIXTURE-CODE-NEVER-LOG";
const leak = "FIXTURE-IBAN-TOKEN-NEVER-LOG";

test("multi-bank login retains isolated credentials and exposes aggregate and bank-specific status", async () => {
	const f = await fixture();
	const ids = {
		ING: sessionId,
		Revolut: "11111111-1111-4111-8111-111111111111",
	};
	const seen: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === "/aspsps")
				return Response.json({
					aspsps: Object.keys(ids).map((name) => ({
						name,
						country: "NL",
						maximum_consent_validity: 3600,
						psu_types: ["personal"],
					})),
				});
			if (url.pathname === "/auth") {
				const b = await request.json();
				await fetch(
					`http://127.0.0.1:${f.port}/callback?state=${b.state}&code=${b.aspsp.name}`,
				);
				return Response.json({ url: "https://fixture.test/authorize" });
			}
			if (url.pathname === "/sessions") {
				const b = await request.json();
				return Response.json({
					session_id: b.code === "ING" ? ids.ING : ids.Revolut,
					access: { valid_until: "2099-01-01T00:00:00Z" },
					accounts: [],
				});
			}
			seen.push(url.pathname);
			return Response.json({
				status: "AUTHORIZED",
				access: { valid_until: "2099-01-01T00:00:00Z" },
			});
		},
	});
	const extra = {
		FINANCIAL_CLI_TEST_API_URL: `http://127.0.0.1:${server.port}`,
	};
	try {
		for (const bank of ["ING", "Revolut"])
			expect(
				(
					await f.run(
						[
							"auth",
							"login",
							"--country",
							"NL",
							"--bank",
							bank,
							"--timeout",
							"2",
						],
						extra,
					)
				).exit,
			).toBe(0);
		const all = await f.run(["auth", "status"], extra);
		expect(all.exit).toBe(0);
		expect(all.out).toContain("ING");
		expect(all.out).toContain("Revolut");
		expect(seen).toEqual([`/sessions/${ids.ING}`, `/sessions/${ids.Revolut}`]);
		seen.length = 0;
		const single = await f.run(
			["auth", "status", "--country", "NL", "--bank", "ING"],
			extra,
		);
		expect(single.exit).toBe(0);
		expect(single.out).toContain("ING");
		expect(single.out).not.toContain("Revolut");
		expect(seen).toEqual([`/sessions/${ids.ING}`]);
	} finally {
		server.stop(true);
		f.cleanup();
	}
}, 15000);
async function bounded<A>(promise: Promise<A>): Promise<A> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Operation did not terminate")),
					3000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

for (const phase of ["discovery", "authorize", "callback", "exchange"]) {
	test(`whole-attempt deadline bounds ${phase} and cannot publish late credentials`, async () => {
		const f = await fixture();
		let release: (r: Response) => void = () => {};
		const pending = new Promise<Response>((r) => {
			release = r;
		});
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				const path = new URL(request.url).pathname;
				if (path === "/aspsps")
					return phase === "discovery"
						? pending
						: Response.json({
								aspsps: [
									{
										name: "Fixture Bank",
										country: "FI",
										maximum_consent_validity: 3600,
										psu_types: ["personal"],
									},
								],
							});
				if (path === "/auth") {
					if (phase === "authorize") return pending;
					if (phase !== "callback") {
						const b = await request.json();
						await fetch(
							`http://127.0.0.1:${f.port}/callback?state=${b.state}&code=${secret}`,
						);
					}
					return Response.json({ url: "https://fixture.test/authorize" });
				}
				if (path === "/sessions") return pending;
				return Response.json({
					status: "AUTHORIZED",
					access: { valid_until: "2099-01-01T00:00:00Z" },
				});
			},
		});
		const endpoint = `http://127.0.0.1:${server.port}`;
		try {
			await seed(f, endpoint);
			const old = readFileSync(
				join(f.base, "state/financial-cli/sessions.json"),
				"utf8",
			);
			const r = await bounded(
				f.run(
					[
						"auth",
						"login",
						"--bank",
						"Fixture Bank",
						"--country",
						"FI",
						"--timeout",
						"0.15",
					],
					{ FINANCIAL_CLI_TEST_API_URL: endpoint },
				),
			);
			expect(r.exit).toBe(1);
			expect(r.err).toContain("timed out");
			expect(r.out + r.err).not.toContain(secret);
			release(
				Response.json({
					session_id: "11111111-1111-4111-8111-111111111111",
					access: { valid_until: "2099-01-01T00:00:00Z" },
					accounts: [],
				}),
			);
			expect(
				(
					await f.run(["auth", "status"], {
						FINANCIAL_CLI_TEST_API_URL: endpoint,
					})
				).exit,
			).toBe(0);
			expect(
				readFileSync(join(f.base, "state/financial-cli/sessions.json"), "utf8"),
			).toBe(old);
			await expect(
				fetch(`http://127.0.0.1:${f.port}/callback`),
			).rejects.toThrow();
		} finally {
			release(new Response(null, { status: 500 }));
			server.stop(true);
			f.cleanup();
		}
	}, 6000);
}

for (const phase of ["write", "fsync", "rename", "slow-fsync"]) {
	test(`failed ${phase} persistence cleans temporary secrets and preserves previous credential`, async () => {
		const f = await fixture();
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				const path = new URL(request.url).pathname;
				if (path === "/aspsps")
					return Response.json({
						aspsps: [
							{
								name: "Fixture Bank",
								country: "FI",
								maximum_consent_validity: 3600,
								psu_types: ["personal"],
							},
						],
					});
				if (path === "/auth") {
					const b = await request.json();
					await fetch(
						`http://127.0.0.1:${f.port}/callback?state=${b.state}&code=${secret}`,
					);
					return Response.json({ url: "https://fixture.test/authorize" });
				}
				return Response.json({
					session_id: "11111111-1111-4111-8111-111111111111",
					access: { valid_until: "2099-01-01T00:00:00Z" },
					accounts: [],
				});
			},
		});
		const endpoint = `http://127.0.0.1:${server.port}`;
		try {
			await seed(f, endpoint);
			const path = join(f.base, "state/financial-cli/sessions.json");
			const old = readFileSync(path, "utf8");
			const r = await f.run(
				[
					"auth",
					"login",
					"--country",
					"FI",
					"--bank",
					"Fixture Bank",
					"--timeout",
					phase === "slow-fsync" ? "0.15" : "2",
				],
				{
					FINANCIAL_CLI_TEST_API_URL: endpoint,
					FINANCIAL_CLI_TEST_FS_FAULT: phase,
				},
			);
			expect(r.exit).toBe(1);
			expect(r.out + r.err).not.toContain(secret);
			expect(readFileSync(path, "utf8")).toBe(old);
			expect(readdirSync(join(f.base, "state/financial-cli"))).toEqual([
				"sessions.json",
			]);
			expect(readdirSync(join(f.base, "config/financial-cli"))).not.toContain(
				".auth-lock",
			);
		} finally {
			server.stop(true);
			f.cleanup();
		}
	});
}

const configureArgs = (
	f: Awaited<ReturnType<typeof fixture>>,
	applicationId = id,
) => [
	"auth",
	"configure",
	"--application-id",
	applicationId,
	"--callback-url",
	"https://fixture.test/callback",
	"--port",
	String(f.port),
];
const loginArgs = [
	"auth",
	"login",
	"--country",
	"FI",
	"--bank",
	"Fixture Bank",
	"--timeout",
	"10",
];
const sessionPath = (f: Awaited<ReturnType<typeof fixture>>) =>
	join(f.base, "state/financial-cli/sessions.json");

function loginProvider(f: Awaited<ReturnType<typeof fixture>>) {
	let mode = "wait";
	let resolveAuth: (state: string) => void = () => {};
	const ready = new Promise<string>((resolve) => {
		resolveAuth = resolve;
	});
	const routes: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			routes.push(`${request.method} ${path}`);
			if (path === "/aspsps")
				return Response.json({
					aspsps: [
						{
							name: "Fixture Bank",
							country: "FI",
							psu_types: ["personal"],
							maximum_consent_validity: 3600,
						},
					],
				});
			if (path === "/auth") {
				const body = await request.json();
				resolveAuth(body.state);
				if (mode === "authorize-error")
					return new Response(leak, { status: 503 });
				if (mode === "exchange-error")
					await fetch(
						`http://127.0.0.1:${f.port}/callback?state=${body.state}&code=${secret}`,
					);
				return Response.json({ url: "https://fixture.test/authorize" });
			}
			if (path === "/sessions") return new Response(leak, { status: 401 });
			if (path === `/sessions/${sessionId}`)
				return Response.json({
					status: "AUTHORIZED",
					access: { valid_until: "2099-01-01T00:00:00Z" },
				});
			return new Response(leak, { status: 500 });
		},
	});
	const endpoint = `http://127.0.0.1:${server.port}`;
	return {
		server,
		endpoint,
		ready,
		routes,
		extra: { FINANCIAL_CLI_TEST_API_URL: endpoint },
		setMode: (value: string) => {
			mode = value;
		},
	};
}

async function resultOf(
	child: ReturnType<Awaited<ReturnType<typeof fixture>>["spawn"]>,
) {
	const [out, err, exit] = await bounded(
		Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]),
	);
	return { out, err, exit };
}

async function preserved(f: Awaited<ReturnType<typeof fixture>>, old: string) {
	expect(readFileSync(sessionPath(f), "utf8")).toBe(old);
	expect(readdirSync(join(f.base, "config/financial-cli"))).not.toContain(
		".auth-lock",
	);
	await expect(fetch(`http://127.0.0.1:${f.port}/callback`)).rejects.toThrow();
}

// Production records are seeded locally, never by contacting a live provider.
test("production-to-test reconfiguration never sends the production session to the test endpoint", async () => {
	const f = await fixture();
	const p = loginProvider(f);
	try {
		expect(
			(await f.run(configureArgs(f), { FINANCIAL_CLI_TEST_MODE: "0" })).exit,
		).toBe(0);
		await seed(f, "https://api.enablebanking.com");
		const old = readFileSync(sessionPath(f), "utf8");
		const mismatched = await f.run(loginArgs, p.extra);
		expect(mismatched.exit).toBe(1);
		expect(mismatched.err).toContain("separate configuration");
		expect(p.routes).toEqual([]);
		expect((await f.run(configureArgs(f))).exit).toBe(0);
		const status = await f.run(["auth", "status"], p.extra);
		expect(status.exit).toBe(2);
		expect(status.out).toBe("Session: missing\n");
		expect(p.routes).toEqual([]);
		expect(status.out + status.err).not.toContain(sessionId);
		expect(readFileSync(sessionPath(f), "utf8")).toBe(old);
	} finally {
		p.server.stop(true);
		f.cleanup();
	}
}, 15000);

test("changed application, private key or endpoint refuses reuse of a saved session", async () => {
	for (const change of ["application", "key", "endpoint"]) {
		const f = await fixture();
		const p = loginProvider(f);
		try {
			await seed(f, p.endpoint);
			expect((await f.run(["auth", "status"], p.extra)).exit).toBe(0);
			expect(p.routes).toEqual([`GET /sessions/${sessionId}`]);
			p.routes.length = 0;
			const old = readFileSync(sessionPath(f), "utf8");
			let extra = p.extra;
			if (change === "application")
				expect(
					(
						await f.run(
							configureArgs(f, "11111111-1111-4111-8111-111111111111"),
						)
					).exit,
				).toBe(0);
			if (change === "key") {
				// Synthetic rotation key; all provider authentication uses the public RFC fixture.
				const rotated = generateKeyPairSync("rsa", {
					modulusLength: 2048,
				}).privateKey.export({ type: "pkcs8", format: "pem" });
				writeFileSync(
					join(f.base, "config/financial-cli/private.pem"),
					rotated,
				);
			}
			if (change === "endpoint")
				extra = {
					FINANCIAL_CLI_TEST_API_URL: p.endpoint.replace(
						"127.0.0.1",
						"localhost",
					),
				};
			const status = await f.run(["auth", "status"], extra);
			expect(status.exit).toBe(2);
			expect(status.out).toBe("Session: missing\n");
			expect(p.routes).toEqual([]);
			expect(readFileSync(sessionPath(f), "utf8")).toBe(old);
		} finally {
			p.server.stop(true);
			f.cleanup();
		}
	}
}, 15000);

test("an active login excludes concurrent configure and login without changing its snapshot", async () => {
	const f = await fixture();
	const p = loginProvider(f);
	try {
		await seed(f, p.endpoint);
		const old = readFileSync(sessionPath(f), "utf8");
		const configPath = join(f.base, "config/financial-cli/config.json");
		const config = readFileSync(configPath, "utf8");
		const child = f.spawn(loginArgs, p.extra);
		await bounded(p.ready);
		const configured = await bounded(
			f.run(configureArgs(f, "11111111-1111-4111-8111-111111111111")),
		);
		const other = await bounded(f.run(loginArgs, p.extra));
		for (const r of [configured, other]) {
			expect(r.exit).toBe(1);
			expect(r.err).toContain("storage is locked");
		}
		expect(readFileSync(configPath, "utf8")).toBe(config);
		expect(readFileSync(sessionPath(f), "utf8")).toBe(old);
		expect(p.routes).toEqual(["GET /aspsps", "POST /auth"]);
		expect(readdirSync(join(f.base, "config/financial-cli"))).toContain(
			".auth-lock",
		);
		child.kill("SIGINT");
		expect((await resultOf(child)).exit).toBe(1);
		await preserved(f, old);
		expect((await f.run(configureArgs(f))).exit).toBe(0);
		expect((await f.run(["auth", "status"], p.extra)).exit).toBe(0);
	} finally {
		p.server.stop(true);
		f.cleanup();
	}
}, 15000);

test("distinct config roots sharing state reject concurrent login and retain both sequential sessions", async () => {
	const first = await fixture();
	const second = await fixture();
	let ready: (state: string) => void = () => {};
	const authorized = new Promise<string>((resolve) => {
		ready = resolve;
	});
	let automatic = false;
	let authorizations = 0;
	let exchanges = 0;
	const secondId = "11111111-1111-4111-8111-111111111111";
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			if (path === "/aspsps")
				return Response.json({
					aspsps: [
						{
							name: "Fixture Bank",
							country: "FI",
							psu_types: ["personal"],
							maximum_consent_validity: 3600,
						},
					],
				});
			if (path === "/auth") {
				const body = await request.json();
				authorizations++;
				ready(body.state);
				if (automatic)
					await fetch(
						`http://127.0.0.1:${second.port}/callback?state=${body.state}&code=SECOND`,
					);
				return Response.json({ url: "https://fixture.test/authorize" });
			}
			if (path === "/sessions") {
				exchanges++;
				return Response.json({
					session_id: exchanges === 1 ? sessionId : secondId,
					access: { valid_until: "2099-01-01T00:00:00Z" },
					accounts: [],
				});
			}
			return Response.json({
				status: "AUTHORIZED",
				access: { valid_until: "2099-01-01T00:00:00Z" },
			});
		},
	});
	const extra = {
		FINANCIAL_CLI_TEST_API_URL: `http://127.0.0.1:${server.port}`,
	};
	const shared = { ...extra, XDG_STATE_HOME: join(first.base, "state") };
	try {
		const child = first.spawn(loginArgs, extra);
		const state = await bounded(authorized);
		// Fail fast on collision rather than allowing an independently configured writer.
		const collision = await bounded(
			second.run([...loginArgs.slice(0, -1), "0.3"], shared),
		);
		expect(collision.exit).toBe(1);
		expect(collision.err).toContain("storage is locked");
		expect(authorizations).toBe(1);
		expect(
			readdirSync(join(second.base, "config/financial-cli")),
		).not.toContain(".auth-lock");
		expect(
			(
				await fetch(
					`http://127.0.0.1:${first.port}/callback?state=${state}&code=FIRST`,
				)
			).status,
		).toBe(200);
		expect((await resultOf(child)).exit).toBe(0);
		automatic = true;
		expect((await bounded(second.run(loginArgs, shared))).exit).toBe(0);
		const store = localStore({
			configHome: join(first.base, "config"),
			stateHome: join(first.base, "state"),
			checkout,
		});
		const sessions = await Effect.runPromise(store.sessions());
		expect(sessions.map((session) => session.sessionId).sort()).toEqual(
			[secondId, sessionId].sort(),
		);
		expect(new Set(sessions.map((session) => session.identity)).size).toBe(2);
		for (const [f, env] of [
			[first, extra],
			[second, shared],
		] as const) {
			expect((await bounded(f.run(["auth", "status"], env))).exit).toBe(0);
			expect(readdirSync(join(f.base, "config/financial-cli"))).not.toContain(
				".auth-lock",
			);
			await expect(
				fetch(`http://127.0.0.1:${f.port}/callback`),
			).rejects.toThrow();
		}
		expect(readdirSync(join(first.base, "state/financial-cli"))).toEqual([
			"sessions.json",
		]);
		expect(exchanges).toBe(2);
	} finally {
		server.stop(true);
		first.cleanup();
		second.cleanup();
	}
}, 15000);

test("SIGINT cancels login, releases callback and lock, and preserves the existing session", async () => {
	const f = await fixture();
	const p = loginProvider(f);
	try {
		await seed(f, p.endpoint);
		const old = readFileSync(sessionPath(f), "utf8");
		const child = f.spawn(loginArgs, p.extra);
		await bounded(p.ready);
		child.kill("SIGINT");
		const r = await resultOf(child);
		expect(r.exit).toBe(1);
		expect(r.err).toContain("Authorization cancelled.");
		expect(r.out + r.err).not.toContain(sessionId);
		expect(p.routes).toEqual(["GET /aspsps", "POST /auth"]);
		await preserved(f, old);
		expect((await f.run(["auth", "status"], p.extra)).exit).toBe(0);
	} finally {
		p.server.stop(true);
		f.cleanup();
	}
}, 15000);

test("callback denial never exchanges a code or replaces an existing session", async () => {
	const f = await fixture();
	const p = loginProvider(f);
	try {
		await seed(f, p.endpoint);
		const old = readFileSync(sessionPath(f), "utf8");
		const child = f.spawn(loginArgs, p.extra);
		const state = await bounded(p.ready);
		// Observe both command cleanup and the complete denial HTTP response.
		const [denied] = await Promise.allSettled([
			fetch(
				`http://127.0.0.1:${f.port}/callback?state=${state}&error=access_denied&error_description=${leak}`,
			),
		]);
		const r = await resultOf(child);
		expect(r.exit).toBe(1);
		expect(r.err).toContain("Authorization was not completed.");
		expect(r.out + r.err).not.toContain(leak);
		expect(p.routes).toEqual(["GET /aspsps", "POST /auth"]);
		await preserved(f, old);
		expect((await f.run(["auth", "status"], p.extra)).exit).toBe(0);
		if (denied.status === "rejected") throw denied.reason;
		expect(denied.value.status).toBe(400);
		expect(await denied.value.text()).not.toContain(leak);
	} finally {
		p.server.stop(true);
		f.cleanup();
	}
}, 15000);

test("authorize and exchange HTTP errors preserve existing sessions and redact provider bodies", async () => {
	for (const mode of ["authorize-error", "exchange-error"]) {
		const f = await fixture();
		const p = loginProvider(f);
		p.setMode(mode);
		try {
			await seed(f, p.endpoint);
			const old = readFileSync(sessionPath(f), "utf8");
			const r = await bounded(f.run(loginArgs, p.extra));
			expect(r.exit).toBe(1);
			expect(r.err).toContain(
				"Enable Banking rejected the request or is unavailable.",
			);
			for (const marker of [leak, secret, sessionId])
				expect(r.out + r.err).not.toContain(marker);
			expect(p.routes).toEqual(
				mode === "authorize-error"
					? ["GET /aspsps", "POST /auth"]
					: ["GET /aspsps", "POST /auth", "POST /sessions"],
			);
			await preserved(f, old);
			expect((await f.run(["auth", "status"], p.extra)).exit).toBe(0);
		} finally {
			p.server.stop(true);
			f.cleanup();
		}
	}
}, 15000);

async function fixture() {
	const base = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-flow-"),
	);
	const env = {
		...process.env,
		XDG_CONFIG_HOME: join(base, "config"),
		XDG_STATE_HOME: join(base, "state"),
		FINANCIAL_CLI_TEST_MODE: "1",
	};
	const children: ReturnType<typeof Bun.spawn>[] = [];
	const spawn = (args: string[], extra: Record<string, string> = {}) => {
		// Existing synthetic flows explicitly acknowledge the new transaction scope.
		if (args[1] === "login") args = [...args, "--transactions", "consent"];
		const child = Bun.spawn(
			[
				"bun",
				...(extra.FINANCIAL_CLI_TEST_FS_FAULT
					? ["--preload", "./tests/fs-fault.ts"]
					: []),
				"src/cli.ts",
				...args,
			],
			{
				cwd: checkout,
				env: { ...env, ...extra },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		children.push(child);
		return child;
	};
	const run = async (args: string[], extra: Record<string, string> = {}) => {
		const child = spawn(args, extra);
		const [out, err, exit] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { out, err, exit };
	};
	mkdirSync(join(base, "config/financial-cli"), {
		recursive: true,
		mode: 0o700,
	});
	writeFileSync(join(base, "config/financial-cli/private.pem"), key, {
		mode: 0o600,
	});
	const certificate = { publicKey };
	const reserve = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(),
	});
	const port = reserve.port ?? 0;
	reserve.stop(true);
	const configured = await run([
		"auth",
		"configure",
		"--application-id",
		id,
		"--callback-url",
		"https://fixture.test/callback",
		"--port",
		String(port),
	]);
	expect(configured.exit).toBe(0);
	return {
		base,
		env,
		spawn,
		run,
		certificate,
		port,
		cleanup: () => {
			for (const child of children)
				if (child.exitCode === null) child.kill("SIGKILL");
			rmSync(base, { recursive: true, force: true });
		},
	};
}
test("subprocess complete login uses signed provider contracts, local persistence and remote status", async () => {
	const f = await fixture();
	let resolveAuth: (value: { state: string }) => void = () => {};
	const authReady = new Promise<{ state: string }>((resolve) => {
		resolveAuth = resolve;
	});
	let exchanges = 0;
	let statusMode = "ok";
	const routes: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			routes.push(`${request.method} ${path}`);
			const token = request.headers.get("authorization")?.slice(7) ?? "";
			const [header, payload, signature] = token.split(".");
			expect(header && payload && signature).toBeTruthy();
			expect(
				verify(
					"RSA-SHA256",
					Buffer.from(`${header}.${payload}`),
					f.certificate.publicKey,
					Buffer.from(signature ?? "", "base64url"),
				),
			).toBe(true);
			const h = JSON.parse(Buffer.from(header ?? "", "base64url").toString());
			const claims = JSON.parse(
				Buffer.from(payload ?? "", "base64url").toString(),
			);
			expect(h).toEqual({ typ: "JWT", alg: "RS256", kid: id });
			expect(claims.iss).toBe("enablebanking.com");
			expect(claims.aud).toBe("api.enablebanking.com");
			expect(claims.exp - claims.iat).toBe(300);
			expect(Math.abs(claims.iat - Math.floor(Date.now() / 1000))).toBeLessThan(
				10,
			);
			if (path === "/aspsps")
				return Response.json({
					aspsps: [
						{
							name: "Fixture Bank",
							psu_types: ["personal"],
							country: "FI",
							maximum_consent_validity: 9_504_000,
						},
					],
				});
			if (path === "/auth") {
				const body = await request.json();
				expect(body.aspsp).toEqual({ name: "Fixture Bank", country: "FI" });
				expect(body.psu_type).toBe("personal");
				expect(body.access.balances).toBe(false);
				expect(body.access.transactions).toBe(true);
				expect(
					Date.parse(body.access.valid_until) - Date.now(),
				).toBeLessThanOrEqual(9_504_000_000);
				expect(
					Date.parse(body.access.valid_until) - Date.now(),
				).toBeGreaterThan(86400_000);
				expect(body.redirect_url).toBe("https://fixture.test/callback");
				expect(body.state).toMatch(/^[a-f0-9]{64}$/);
				resolveAuth({ state: body.state });
				return Response.json({ url: "https://fixture.test/authorize" });
			}
			if (path === "/sessions" && request.method === "POST") {
				exchanges++;
				expect(await request.json()).toEqual({ code: secret });
				return Response.json({
					session_id: sessionId,
					access: {
						valid_until: new Date(Date.now() + 3600_000).toISOString(),
						transactions: true,
						balances: false,
					},
					accounts: [{ account_id: { iban: leak }, uid: id }],
				});
			}
			if (path === `/sessions/${sessionId}`) {
				if (statusMode === "fail") return new Response(leak, { status: 503 });
				if (statusMode === "missing")
					return new Response(leak, { status: 404 });
				if (statusMode === "expired")
					return Response.json({
						status: "EXPIRED",
						access: { valid_until: new Date().toISOString() },
					});
				return Response.json({
					status: "AUTHORIZED",
					access: {
						valid_until: new Date(Date.now() + 3600_000).toISOString(),
					},
					accounts_data: [{ iban: leak }],
				});
			}
			return new Response(leak, { status: 500 });
		},
	});
	const extra = {
		FINANCIAL_CLI_TEST_API_URL: `http://127.0.0.1:${server.port}`,
	};
	try {
		const proc = f.spawn(
			[
				"auth",
				"login",
				"--country",
				"FI",
				"--bank",
				"Fixture Bank",
				"--timeout",
				"3",
			],
			extra,
		);
		const received = await Promise.race([
			authReady,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("No auth request")), 5000),
			),
		]);
		const url = `http://127.0.0.1:${f.port}/callback`;
		const invalid = await fetch(`${url}?state=BAD&code=${secret}`);
		expect(invalid.status).toBe(400);
		expect(await invalid.text()).not.toContain(secret);
		expect(
			(await fetch(`${url}?state=${received.state}&state=OTHER&code=${secret}`))
				.status,
		).toBe(400);
		const valid = await fetch(`${url}?state=${received.state}&code=${secret}`);
		expect(valid.status).toBe(200);
		expect(await valid.text()).not.toContain(secret);
		const [out, err, exit] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(exit).toBe(0);
		expect(out).toContain("Authorization saved");
		expect(out + err).not.toContain(secret);
		expect(out + err).not.toContain(leak);
		expect(out + err).not.toContain(sessionId);
		expect(exchanges).toBe(1);
		const path = join(f.base, "state/financial-cli/sessions.json");
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(
			Object.keys(JSON.parse(readFileSync(path, "utf8"))[0]).sort(),
		).toEqual([
			"bank",
			"country",
			"identity",
			"reportedAccess",
			"requestedAccess",
			"sessionId",
			"validUntil",
		]);
		expect(JSON.parse(readFileSync(path, "utf8"))[0].reportedAccess).toEqual({
			transactions: true,
			balances: false,
		});
		expect(readFileSync(path, "utf8")).not.toContain(leak);
		expect((await f.run(["auth", "status"], extra)).out).toContain(
			"authorized",
		);
		statusMode = "fail";
		const unavailable = await f.run(["auth", "status"], extra);
		expect(unavailable.exit).toBe(4);
		expect(unavailable.out).toContain("provider-unavailable");
		expect(unavailable.out + unavailable.err).not.toContain(leak);
		statusMode = "missing";
		expect((await f.run(["auth", "status"], extra)).exit).toBe(2);
		statusMode = "expired";
		expect((await f.run(["auth", "status"], extra)).exit).toBe(3);
		expect(
			routes.every((route) =>
				/^(GET \/aspsps|POST \/auth|POST \/sessions|GET \/sessions\/)/.test(
					route,
				),
			),
		).toBe(true);
		await expect(fetch(url)).rejects.toThrow();
	} finally {
		server.stop(true);
		f.cleanup();
	}
}, 15000);

test("malformed provider status is unavailable, never a leaked validation detail", async () => {
	const f = await fixture();
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => Response.json({ status: leak, access: { valid_until: leak } }),
	});

	try {
		await seed(f, `http://127.0.0.1:${server.port}`);
		const result = await f.run(["auth", "status"], {
			FINANCIAL_CLI_TEST_API_URL: `http://127.0.0.1:${server.port}`,
		});
		expect(result.exit).toBe(4);
		expect(result.out).toContain("provider-unavailable");
		expect(result.out + result.err).not.toContain(leak);
	} finally {
		server.stop(true);
		f.cleanup();
	}
}, 15000);

test("CLI status shows current provider expiry and legacy consent without editing saved records", async () => {
	const f = await fixture();
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () =>
			Response.json({
				status: "AUTHORIZED",
				access: {
					valid_until: "2098-05-06T07:08:09+02:00",
					transactions: true,
					balances: false,
				},
			}),
	});
	const endpoint = `http://127.0.0.1:${server.port}`;
	try {
		await seed(f, endpoint);
		const before = readFileSync(sessionPath(f), "utf8");
		const result = await f.run(["auth", "status"], {
			FINANCIAL_CLI_TEST_API_URL: endpoint,
		});
		expect(result.exit).toBe(0);
		expect(result.out).toContain(
			"Expiry: 2098-05-06T07:08:09+02:00 (provider)",
		);
		expect(result.out).toContain("Verification: provider");
		expect(result.out).toContain("Renewal: required");
		expect(result.out).toContain(
			"Transaction access: unknown; fresh consent required",
		);
		expect(result.out).toContain(
			"Provider-reported transaction access: true; balances: false",
		);
		expect(result.out + result.err).not.toContain(sessionId);
		expect(readFileSync(sessionPath(f), "utf8")).toBe(before);
	} finally {
		server.stop(true);
		f.cleanup();
	}
});

test("CLI distinguishes absent and locally expired sessions without provider calls", async () => {
	const f = await fixture();
	try {
		const missing = await f.run(["auth", "status"]);
		expect(missing.exit).toBe(2);
		expect(missing.out).toContain("missing");
		await seed(f, "https://api.enablebanking.com", "2000-01-01T00:00:00Z");
		const expired = await f.run(["auth", "status"]);
		expect(expired.exit).toBe(3);
		expect(expired.out).toContain("expired");
		const existing = await f.run(["auth", "keygen"]);
		expect(existing.exit).toBe(1);
		expect(existing.out).toBe("");
	} finally {
		f.cleanup();
	}
}, 15000);

test("unsafe files, invalid inputs and endpoint override do not expose credentials", async () => {
	const f = await fixture();
	try {
		for (const args of [
			[
				"auth",
				"configure",
				"--application-id",
				id,
				"--callback-url",
				"http://unsafe.test",
			],
			[
				"auth",
				"configure",
				"--application-id",
				"not-a-uuid",
				"--callback-url",
				"https://fixture.test/callback",
			],
			[
				"auth",
				"configure",
				"--application-id",
				id,
				"--callback-url",
				"https://fixture.test/callback",
				"--port",
				"80",
			],
			["auth", "login", "--timeout", "0"],
			["auth", "status", "--oops", "value"],
		])
			expect((await f.run(args)).exit).toBe(1);
		const blocked = await f.run(["auth", "login", "--bank", "Fixture Bank"], {
			FINANCIAL_CLI_TEST_API_URL: "https://attacker.test",
		});
		expect(blocked.exit).toBe(1);
		expect(blocked.out).toBe("");
		const production = await f.run(["auth", "status"], {
			FINANCIAL_CLI_TEST_MODE: "0",
			FINANCIAL_CLI_TEST_API_URL: "http://127.0.0.1:1",
		});
		expect(production.exit).toBe(1);
		const config = join(f.base, "config/financial-cli/config.json");
		rmSync(config);
		symlinkSync(join(f.base, "config/financial-cli/private.pem"), config);
		const unsafe = await f.run(["auth", "login", "--bank", "Fixture Bank"]);
		expect(unsafe.exit).toBe(1);
		expect(unsafe.err).not.toContain("PRIVATE KEY");
	} finally {
		f.cleanup();
	}
}, 15000);
