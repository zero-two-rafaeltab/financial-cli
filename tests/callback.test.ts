import { expect, test } from "bun:test";
import { connect } from "node:net";
import { Effect } from "effect";
import { callback } from "../src/callback";

test("callback ignores invalid state, accepts once, rejects duplicate and closes on scope exit", async () => {
	let port = 0;
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const listener = yield* callback({
					port: 0,
					path: "/callback",
					state: "s".repeat(64),
					timeoutSeconds: 2,
				});
				port = listener.port;
				const url = `http://127.0.0.1:${port}/callback`;
				expect(
					(yield* Effect.promise(() =>
						fetch(`${url}?state=invalid&code=SECRET`),
					)).status,
				).toBe(400);
				expect(
					(yield* Effect.promise(() =>
						fetch(`${url}?state=${"s".repeat(64)}&code=FIXTURE`),
					)).status,
				).toBe(200);
				expect(
					(yield* Effect.promise(() =>
						fetch(`${url}?state=${"s".repeat(64)}&code=SECOND`),
					)).status,
				).toBe(409);
				expect(yield* listener.wait).toBe("FIXTURE");
			}),
		),
	);
	await expect(fetch(`http://127.0.0.1:${port}/callback`)).rejects.toThrow();
});
test("callback denial delivers HTTP 400 while its waiting scope closes", async () => {
	let port = 0;
	let response: Promise<Response> = Promise.resolve(new Response());
	const result = await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const listener = yield* callback({
					port: 0,
					path: "/callback",
					state: "d".repeat(64),
					timeoutSeconds: 2,
				});
				port = listener.port;
				response = fetch(
					`http://127.0.0.1:${port}/callback?state=${"d".repeat(64)}&error=access_denied`,
				);
				return yield* listener.wait;
			}),
		).pipe(Effect.exit),
	);
	expect(result._tag).toBe("Failure");
	const denied = await response;
	expect(denied.status).toBe(400);
	expect(await denied.text()).toBe(
		"Authorization was not completed. Return to the terminal.",
	);
	await expect(fetch(`http://127.0.0.1:${port}/callback`)).rejects.toThrow();
});

test("callback scope teardown is bounded with an unfinished HTTP request", async () => {
	let port = 0;
	let socket: ReturnType<typeof connect> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const listener = yield* callback({
							port: 0,
							path: "/callback",
							state: "s".repeat(64),
							timeoutSeconds: 2,
						});
						port = listener.port;
						yield* Effect.promise(
							() =>
								new Promise<void>((resolve, reject) => {
									socket = connect(port, "127.0.0.1", () => {
										socket?.write(
											"GET /callback HTTP/1.1\r\nHost: localhost\r\n",
										);
										resolve();
									});
									socket.on("error", reject);
								}),
						);
					}),
				),
			),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Callback cleanup did not terminate")),
					1000,
				);
			}),
		]);
		await expect(fetch(`http://127.0.0.1:${port}/callback`)).rejects.toThrow();
	} finally {
		clearTimeout(timer);
		socket?.destroy();
	}
});

test("callback timeout closes listener", async () => {
	let port = 0;
	await expect(
		Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const listener = yield* callback({
						port: 0,
						path: "/callback",
						state: "x".repeat(64),
						timeoutSeconds: 0.02,
					});
					port = listener.port;
					return yield* listener.wait;
				}),
			),
		),
	).rejects.toThrow();
	await expect(fetch(`http://127.0.0.1:${port}/callback`)).rejects.toThrow();
});
