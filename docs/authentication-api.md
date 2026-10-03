# Authentication capability API

Import from `src/capabilities/authentication/index.ts`; `src/auth/index.ts` remains a compatible entry point with the same Effect service identities. The CLI uses these operations. Private contract/workflow files are not public import paths.

| Operation | Result | Required services |
| --- | --- | --- |
| `login(input: LoginInput)` | `LoginResult` | `Store`, `Provider`, `State`, `Callback` |
| `status(query: StatusQuery)` | `readonly StatusEntry[]` | `Store`, `Provider` |

Both use typed `AuthError` failures (`Input`, `Storage`, `Provider`, `Timeout`). Login maps callback denial to `{ outcome: "denied" }`; interruption remains Effect interruption. The caller supplies service Layers and owns execution. Login bounds the whole attempt and scopes exclusive storage access and callback cleanup.

## Login

`LoginInput` requires `endpoint`, `timeoutSeconds` (positive, at most 600), effectful `select` and `publishUrl` callbacks, with optional exact `country`/`bank` filters. Set `transactionConsent: "consent"` only after the owner acknowledges the purpose; omission returns `consent-required` without starting authorization. The CLI accepts timeouts of 10–600 seconds.

```ts
import { Effect } from "effect";
import { login, status } from "../src/capabilities/authentication";

const query = Effect.gen(function* () {
  const result = yield* login({
    endpoint: "https://api.enablebanking.com",
    country: "NL",
    timeoutSeconds: 180,
    transactionConsent: "consent",
    select: selectBank,
    publishUrl: openPrivately,
  });
  if (result.outcome !== "authorized") return result;
  return yield* status({
    endpoint: "https://api.enablebanking.com",
    country: result.country,
    bank: result.bank,
  });
}).pipe(Effect.provide(services));
```

`selectBank`, `openPrivately` and `services` are caller-supplied UI adapters and Layers. Live callers must obtain informed owner consent first. `publishUrl` receives a sensitive authorization link: show it privately to the owner; do not log it or automate bank consent.

An `authorized` result contains bank/country, `maximumConsentValidity` in seconds, `requestedAccess` (`validUntil`, transactions=true, balances=false), exact provider-returned `validUntil` and nullable `reportedAccess`. Current personal AIS metadata determines the request; no fixed duration is assumed. Requested access is not proof of a grant; omitted reported flags remain unknown. Results exclude credentials, session IDs and authorization links.

`consent-required` and `denied` are expected outcomes. Only successful fresh authorization replaces the matching bank record. Denial, explicit transaction refusal, failure, timeout and interruption preserve prior local sessions.

## Status

`StatusQuery` accepts `endpoint` and optional exact country/bank filters. It includes only records bound to the current identity; no match returns `[]`. Status never rewrites expiry or permissions.

| Fields | Interpretation |
| --- | --- |
| `bank`, `country`, `status`, `validUntil` | Safe identity, state and expiry summary. |
| `expirySource` | `provider`: current response; `saved`: prior exchange, preserved exactly. |
| `verification` | `provider`: current check; `local`: saved expiry passed; `unavailable`: check failed. |
| `renewal` | `required`: expired/inactive, missing transaction-request provenance or explicit refusal; `check-provider`: verification failed; `not-required`: currently authorized with fresh request provenance and no renewal signal. |
| `requestedAccess`, `reportedAccess` | Request provenance and actually reported booleans, respectively; nullable. Missing flags are unknown, including when renewal is not required. |
| `accessSource` | Reported flags came from `provider`, `saved` exchange, or are `unknown`. |

CLI status exits 0 for authorized (including legacy sessions needing transaction consent), 2 for missing, 3 for other states, 4 for provider unavailability and 1 for technical/input failure.

## Compatibility for transaction collection (#17)

- Match `LoginResult.outcome`; login previously returned a terminal message.
- `BankingProvider.authorize` now takes a fourth `AuthorizationAccess` argument. The capability decides expiry/rights; adapters encode them.
- `BankingProvider.status` returns `RemoteSessionStatus` with status and optional expiry/permissions. Exchange returns `AuthorizedSession` with optional reported flags.
- `StoredSession` adds optional `requestedAccess` and `reportedAccess`. Old files remain readable without migration; preserve these fields when extending storage.
- Fresh consent is required for legacy records. Neither request provenance nor a status check guarantees permission or validity at collection time.

Transaction/account retrieval, pagination, account provenance and collection storage remain owned by #17.
