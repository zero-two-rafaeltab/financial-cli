import { Layer } from "effect";
import { type CredentialStore, Store } from "../auth";
export type StorageLocations = {
	readonly configHome: string;
	readonly stateHome: string;
	readonly checkout: string;
};
export { localStore } from "./local";
export const storeLayer = (store: CredentialStore) =>
	Layer.succeed(Store, store);
export { localTransactionStore } from "./transactions";
