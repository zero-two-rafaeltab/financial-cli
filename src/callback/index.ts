import { Layer } from "effect";
import { Callback } from "../auth";
import { callback } from "./http";

export { callback } from "./http";
export const callbackLayer = Layer.succeed(Callback, { open: callback });
