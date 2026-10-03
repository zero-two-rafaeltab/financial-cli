import { timingSafeEqual } from "node:crypto";
import { Effect, Schema } from "effect";
import type { CallbackOptions } from "../auth";
import { attempt, failure } from "../shared";

export function callback(options: CallbackOptions) {
	return Effect.acquireRelease(
		attempt("Input", "Unable to bind loopback callback listener.", () => {
			let claimed = false;
			let complete: (result: { code: string } | { denied: true }) => void =
				() => {};
			const received = new Promise<{ code: string } | { denied: true }>(
				(resolve) => {
					complete = resolve;
				},
			);
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: options.port,
				fetch(request) {
					const response = (text: string, status: number) =>
						new Response(text, {
							status,
							headers: {
								"Cache-Control": "no-store",
								"Referrer-Policy": "no-referrer",
								"Content-Type": "text/plain",
								"Content-Security-Policy": "default-src 'none'",
							},
						});
					const url = new URL(request.url);
					if (request.method !== "GET" || url.pathname !== options.path)
						return response("Not found.", 404);
					if (request.url.length > 8192)
						return response("Invalid callback.", 400);
					const params = url.searchParams;
					const state = params.get("state");
					const decoded = Schema.decodeUnknownOption(Schema.NonEmptyString)(
						state,
					);
					if (
						decoded._tag === "None" ||
						params.getAll("state").length !== 1 ||
						state === null ||
						Buffer.byteLength(state) !== Buffer.byteLength(options.state) ||
						!timingSafeEqual(Buffer.from(state), Buffer.from(options.state))
					)
						return response("Invalid callback.", 400);
					if (claimed) return response("Callback already received.", 409);
					const code = params.get("code");
					if (params.has("error")) {
						if (params.getAll("error").length !== 1 || params.has("code"))
							return response("Invalid callback.", 400);
						claimed = true;
						complete({ denied: true });
						return response(
							"Authorization was not completed. Return to the terminal.",
							400,
						);
					}
					if (
						code === null ||
						code.length === 0 ||
						code.length > 4096 ||
						params.getAll("code").length !== 1 ||
						/[\r\n\0]/.test(code)
					)
						return response("Invalid callback.", 400);
					claimed = true;
					complete({ code });
					return response(
						"Authorization received. Return to the terminal.",
						200,
					);
				},
			});
			const wait = Effect.tryPromise({
				try: () => received,
				catch: () => failure("Denied", "Authorization was not completed."),
			}).pipe(
				Effect.flatMap((result) =>
					"code" in result
						? Effect.succeed(result.code)
						: Effect.fail(
								failure("Denied", "Authorization was not completed."),
							),
				),
				Effect.timeoutOrElse({
					duration: `${options.timeoutSeconds} seconds`,
					orElse: () =>
						Effect.fail(
							failure(
								"Timeout",
								"Authorization timed out. Try auth login again.",
							),
						),
				}),
			);
			return {
				port: server.port ?? options.port,
				wait,
				stop: async () => {
					// Stop accepting callbacks, but let the terminal response drain.
					// A stalled connection must not keep the owning scope alive.
					let timer: ReturnType<typeof setTimeout> | undefined;
					try {
						await Promise.race([
							server.stop(false),
							new Promise<void>((resolve) => {
								timer = setTimeout(resolve, 250);
							}),
						]);
					} finally {
						clearTimeout(timer);
						await server.stop(true);
					}
				},
			};
		}),
		(listener) => Effect.promise(listener.stop),
	);
}
