import { expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	symlinkSync,
} from "node:fs";

test("credential storage rejects group/world-writable directory ancestry", async () => {
	const base = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-ancestry-"),
	);
	try {
		for (const mode of [0o770, 0o777, 0o1777]) {
			const parent = join(base, `untrusted-${mode}`);
			mkdirSync(parent, { mode });
			chmodSync(parent, mode);
			const store = localStore({
				configHome: join(parent, "config"),
				stateHome: join(base, "state"),
				checkout,
			});
			await expect(
				Effect.runPromise(
					store.configure({
						applicationId: "497f6eca-6276-4993-bfeb-53cbbbba6f08",
						callbackUrl: "https://example.test/callback",
						port: 8787,
						testOnly: true,
					}),
				),
			).rejects.toThrow();
		}
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

import { join } from "node:path";
import { Effect } from "effect";
import { localStore } from "../src/storage";

const checkout = join(import.meta.dir, "..");
test("credential storage supports identical config and state roots without locking itself out", async () => {
	const base = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-shared-root-"),
	);
	const store = localStore({ configHome: base, stateHome: base, checkout });
	try {
		await Effect.runPromise(
			store.configure({
				applicationId: "497f6eca-6276-4993-bfeb-53cbbbba6f08",
				callbackUrl: "https://example.test/callback",
				port: 8787,
				testOnly: true,
			}),
		);
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					yield* store.exclusive();
					expect(yield* store.sessions()).toEqual([]);
				}),
			),
		);
		// A subsequent command proves scoped release as well as root deduplication.
		await Effect.runPromise(Effect.scoped(store.exclusive()));
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});
test("credential storage rejects checkout and symlink paths", async () => {
	const base = mkdtempSync(
		join(process.env.TMPDIR ?? "/tmp", "financial-storage-"),
	);
	try {
		const unsafe = localStore({
			configHome: checkout,
			stateHome: base,
			checkout,
		});
		await expect(Effect.runPromise(unsafe.privateKey())).rejects.toThrow();
		mkdirSync(join(base, "real"));
		symlinkSync(join(base, "real"), join(base, "link"));
		const linked = localStore({
			configHome: join(base, "link"),
			stateHome: base,
			checkout,
		});
		await expect(Effect.runPromise(linked.privateKey())).rejects.toThrow();
		const safe = localStore({
			configHome: join(base, "config"),
			stateHome: join(base, "state"),
			checkout,
		});
		await Effect.runPromise(
			safe.configure({
				applicationId: "497f6eca-6276-4993-bfeb-53cbbbba6f08",
				callbackUrl: "https://example.test/callback",
				port: 8787,
				testOnly: true,
			}),
		);
		expect(statSync(join(base, "config/financial-cli")).mode & 0o777).toBe(
			0o700,
		);
		expect(
			statSync(join(base, "config/financial-cli/config.json")).mode & 0o777,
		).toBe(0o600);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});
