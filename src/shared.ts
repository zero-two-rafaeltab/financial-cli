import { Data, Effect, Schema } from "effect";

export class AuthError extends Data.TaggedError("AuthError")<{
	readonly kind: "Input" | "Storage" | "Provider" | "Timeout" | "Denied";
	readonly message: string;
}> {}
export const failure = (kind: AuthError["kind"], message: string) =>
	new AuthError({ kind, message });
export const attempt = <A>(
	kind: AuthError["kind"],
	message: string,
	body: () => A,
) => Effect.try({ try: body, catch: () => failure(kind, message) });
export const Timestamp = Schema.String.check(
	Schema.makeFilter(
		(s) => Number.isFinite(Date.parse(s)) && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(s),
	),
);
export const ConfigSchema = Schema.Struct({
	applicationId: Schema.String.check(Schema.isUUID()),
	callbackUrl: Schema.String,
	port: Schema.Int,
	testOnly: Schema.Boolean,
});
export type Config = typeof ConfigSchema.Type;
export const SessionSchema = Schema.Struct({
	sessionId: Schema.String.check(Schema.isUUID()),
	validUntil: Timestamp,
});
export type Session = typeof SessionSchema.Type;
export const decode = <
	S extends Schema.Top & { readonly DecodingServices: never },
>(
	schema: S,
	input: unknown,
): Effect.Effect<S["Type"], AuthError> =>
	Schema.decodeUnknownEffect(schema)(input).pipe(
		Effect.mapError(() =>
			failure("Input", "Invalid input or provider response."),
		),
	);
export function validateConfig(config: Config): Config {
	const url = new URL(config.callbackUrl);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!url.pathname.startsWith("/") ||
		config.port < 1024 ||
		config.port > 65535
	)
		throw new Error("Invalid configuration");
	return config;
}
