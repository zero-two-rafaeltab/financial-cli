# Synthetic validation for #16

Executed on 2026-10-03 using Bun 1.4.2, synthetic credentials, loopback provider fixtures and isolated private storage. No authenticated live provider calls or production credential reads were performed. The owner approved the capability/CLI/HTTP/storage seams before new tests.

## Red-green evidence

Each behavior slice ran its focused test before and after implementation. Observed red results included:

| Slice | Observed red result | Green check |
| --- | --- | --- |
| Safe typed login result | Login returned a terminal message instead of an object. | `bun test tests/authentication.test.ts` |
| Capability boundary enforcement | An outward capability import exited successfully. | `bun test tests/architecture.test.ts` |
| Required transaction acknowledgement | Missing acknowledgement saved a session. | `bun test tests/authentication.test.ts` |
| Explicit CLI consent | Help omitted `--transactions consent`. | `bun test tests/cli.test.ts -t 'CLI help'` |
| Capability-owned request | Provider port received no explicit access request. | `bun test tests/authentication.test.ts` |
| Validated metadata | Fractional consent seconds were accepted. | `bun test tests/provider.test.ts` |
| Typed provider metadata failure | Invalid provider metadata appeared as an input failure. | `bun test tests/provider.test.ts` |
| Request provenance persistence | Capability and stored record omitted `requestedAccess`. | Capability test followed by executable complete-login test. |
| Safe expiry/status | CLI output omitted current provider expiry. | `bun test tests/flow.test.ts -t 'current provider expiry'` |
| Bounded programmatic login | A TypeScript caller could request a 601-second attempt. | `bun test tests/authentication.test.ts` |
| Reported permissions | CLI discarded explicit provider permission flags. | `bun test tests/flow.test.ts -t 'current provider expiry'` |
| Refused transaction grant | Explicit `transactions: false` replaced the old record. | `bun test tests/authentication.test.ts` |
| Renewal guidance | A reported refusal still said renewal was not required. | `bun test tests/authentication.test.ts` |

Green refactoring moved the implementation to the canonical capability directory, preserved the compatibility entry point, and used a controlled Effect clock to assert the exact 110-day synthetic request. This duration deliberately differs from the historical 180-day announcements. Returned expiry is independently supplied, including an unchanged timezone offset.

The retained executable tests verify the unchanged 300-second signing JWT, personal AIS discovery, explicit transaction access with balances false, multiple-bank retention, state/replay rejection, whole-attempt deadlines, provider/storage failure, interruption, secure storage, exact exit mappings and redaction. Capability tests additionally verify typed denial/failure results, invalid metadata bounds, transaction-grant refusal, safe status and interruption cleanup through public Effect operations.

## Complete gate

`bun install --frozen-lockfile`, configured `bun run format`, `git diff --check` and local documentation-link validation passed. `bun run check` passed TypeScript, Biome, architecture enforcement and all **60 tests** across seven files (548 assertions). GitHub's required `check` job is verified on the published PR separately; local checks alone are not CI evidence.

## Executable demonstration

A disposable local fixture drove the actual `src/cli.ts` executable through configuration, two consented logins and aggregate status. The fixture advertised 9,504,000 and 7,776,000 seconds and returned shorter expiries. Synthetic private storage was removed afterward. Authorization-link lines were omitted before capturing stdout; no real bank data was used. Selected actual output:

```text
Authorization saved. Valid until: 2026-10-20T10:00:00+02:00. Run auth status to validate it.
Maximum consent validity: 9504000 seconds. Requested until: 2027-01-21T20:17:33.192Z.
Transaction access: requested; balances: not requested; provider/bank grant governs.
Provider-reported transaction access: true; balances: false.
Authorization saved. Valid until: 2026-11-15T10:00:00+02:00. Run auth status to validate it.
Maximum consent validity: 7776000 seconds. Requested until: 2027-01-01T20:17:33.259Z.
NL Synthetic ING: authorized
  Expiry: 2026-10-20T10:00:00+02:00 (provider)
  Verification: provider; Renewal: not-required
  Transaction access: requested; balances: not requested; provider/bank grant governs
  Provider-reported transaction access: true; balances: false (provider)
LT Synthetic Revolut: authorized
  Expiry: 2026-11-15T10:00:00+02:00 (provider)
  Verification: provider; Renewal: not-required
  Transaction access: requested; balances: not requested; provider/bank grant governs
  Provider-reported transaction access: true; balances: false (provider)
```

Maintained reproduction coverage is in `tests/flow.test.ts` (actual subprocesses and loopback HTTP), `tests/authentication.test.ts` (public capability and controlled ports) and `tests/provider.test.ts` (provider wire validation). This demonstration is not live acceptance. [Both real bank checks](consent-acceptance.md) remain owner-assisted requirements, and issue #16 must remain open until verified.
