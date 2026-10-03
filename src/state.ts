import { randomBytes } from "node:crypto";
import { Effect, Layer } from "effect";
import { State } from "./auth";
export const stateLayer = Layer.succeed(State, {
	generate: () => Effect.sync(() => randomBytes(32).toString("hex")),
});
