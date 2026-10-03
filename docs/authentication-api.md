# Authentication capability API

Import the public interface from `src/capabilities/authentication/index.ts`. `src/auth/index.ts` re-exports the same operations, types and service keys for existing consumers, including #17. Private contract and workflow files are not import paths. The CLI calls this interface; it does not calculate consent durations or renewal decisions.

## Operations

| Operation | Typed result | Effect dependencies |
| --- | --- | --- |
| `login(input: LoginInput)` | `LoginResult` | `Store`, `Provider`, `State`, `Callback` |
| `status(query: StatusQuery)` | `readonly StatusEntry[]` | `Store`, `Provider` |

Both operations use `AuthError` in the typed technical error channel (`Input`, `Storage`, `Provider`, `Timeout`). Callback ports can report `Denied`; login translates it into the expected `denied` outcome. Interruption remains Effect interruption, rather than a fabricated successful result. The caller owns runtime execution and interruption. Login scopes its exclusive store access and temporary callback listener and bounds the whole attempt. Publication additionally checks the absolute monotonic deadline under the store's atomic replacement contract.

`LoginInput` has a provider endpoint, optional exact country/bank selection, a positive timeout up to 600 seconds, `transactionConsent: "consent"`, an effectful bank selector, and a deliberate `publishUrl` driving-adapter callback. Missing acknowledgement returns `{ outcome: "consent-required" }` without opening authorization. The CLI enforces its existing production timeout range of 10–600 seconds. Selection uses only current personal AIS connectors. There is no consent-duration override or arbitrary query language.

The successful result has `outcome: "authorized"`, bank/country, `maximumConsentValidity` in seconds, `requestedAccess` (`validUntil`, `transactions: true`, `balances: false`), the exact returned `validUntil`, and nullable `reportedAccess`. The other outcome is `{ outcome: "denied" }`, including an explicitly returned refusal of transaction access. A denied result leaves old local records intact. Results never contain session IDs, credentials, private keys, account records or authorization URLs. The URL goes only to the caller's deliberately supplied adapter; keep it private.

## Compose a query

```ts
import { Effect, Layer } from "effect";
import { login, status } from "../src/capabilities/authentication";
import { callbackLayer } from "../src/callback";
import { enableBankingLayer } from "../src/provider";
import { stateLayer } from "../src/state";
import { localStore, storeLayer } from "../src/storage";

// These application-specific locations and UI adapters are supplied by the caller.
const services = Layer.mergeAll(
  storeLayer(localStore(locations)),
  enableBankingLayer({ testMode: false }),
  callbackLayer,
  stateLayer,
);

const query = Effect.gen(function* () {
  const authorization = yield* login({
    endpoint: "https://api.enablebanking.com",
    country: "NL",
    bank: selectedBankName,
    timeoutSeconds: 180,
    transactionConsent: "consent", // Only after the owner acknowledges the purpose.
    select: selectBank,
    publishUrl: openPrivately,
  });
  if (authorization.outcome !== "authorized") return authorization;
  return yield* status({
    endpoint: "https://api.enablebanking.com",
    country: authorization.country,
    bank: authorization.bank,
  });
}).pipe(Effect.provide(services));

// Execute `query` at the caller's runtime boundary; no terminal parsing is needed.
```

The example's `locations`, `selectedBankName`, `selectBank` and `openPrivately` are caller-supplied values, not exported globals. Programmatic callers can return an input decision or open a private owner-facing browser flow; they must not log URLs or automate bank consent.

## Status semantics

`StatusQuery` filters by exact bank and/or country. Only sessions bound to the current identity are included; an empty array means no matching local record. `StatusEntry` has bank/country, `status`, `validUntil`, `expirySource`, `verification`, `renewal`, nullable `requestedAccess`, nullable `reportedAccess` and `accessSource`.

| Field | Meaning |
| --- | --- |
| `expirySource: "provider"` | Expiry from the current successful provider status response, preserved exactly. |
| `expirySource: "saved"` | Expiry from the previously saved exchange; not a current expiry verification. |
| `verification: "local"` | Saved expiry already passed; no provider request is needed. |
| `verification: "provider"` | Current provider response establishes the reported state, including missing/revoked sessions. |
| `verification: "unavailable"` | Provider check failed; the saved expiry alone does not prove validity. |
| `renewal: "required"` | Session needs fresh authorization, legacy transaction-consent provenance is missing, or the provider explicitly refuses transaction access. |
| `renewal: "not-required"` | Authorized, unexpired session from a fresh transaction-access request; no current renewal signal. This does not promise perpetual access or prove omitted permission flags. |
| `renewal: "check-provider"` | Provider verification failed; investigate access before deciding to renew. |
| `requestedAccess: null` | Legacy record without evidence of a fresh transaction-access request. |
| `reportedAccess` | Only permission booleans actually reported by the provider; omitted fields remain unknown. |
| `accessSource` | `provider` for current reported flags, `saved` for exchange flags, `unknown` if neither response reported flags. |

Status is read-only and never updates saved expiry or permissions. CLI status keeps existing exit mappings: 0 for authorized sessions (including legacy records requiring new transaction consent), 2 for missing, 3 for other session states, 4 for provider unavailability, and 1 for technical/input failure.

## Handoff to #17

- Existing imports from `src/auth` remain supported, with the same Effect service identities. Prefer the canonical capability entry point for new code.
- `login` now returns a discriminated typed value instead of a CLI message and requires explicit transaction acknowledgement. Match `outcome` before using successful fields.
- `BankingProvider.authorize` receives a fourth `AuthorizationAccess` argument. The capability owns the requested expiry and rights; provider adapters only encode them.
- `BankingProvider.status` returns `RemoteSessionStatus` (`status`, optional exact `validUntil`, optional `reportedAccess`) instead of a status string. Exchange returns `AuthorizedSession`, adding optional reported flags to the existing session shape.
- `StoredSession` and the private storage decoder add optional `requestedAccess` and `reportedAccess`. Old files remain readable and unchanged. Only a successful fresh authorization writes request provenance; no bulk migration occurs.
- `requestedAccess` proves the application's request, not a bank grant. Require owner-assisted acceptance and handle provider permission denial. Never promote legacy sessions by editing local rights. Current validity may change between status and collection.
- This change supplies no transaction/account retrieval operation, pagination, account provenance, collection store, or collection-storage schema. Those changes remain owned by #17, including privacy-policy updates and its independently agreed seams.

The necessary shared-file edits are limited to CLI consumption/rendering, provider contract translation, optional authentication-record fields, architecture enforcement, README and domain context. #17 should preserve these authentication fields when extending session/account contracts. Tests continue using synthetic sessions and private, isolated storage.
