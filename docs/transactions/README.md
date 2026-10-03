# Collection and local queries

Collect transactions from freshly consented sessions with current provider-reported transaction access, then query private local records offline. Collection never initiates or renews consent. See [policy deployment and live acceptance](data-processing.md) before live use.

## TypeScript API

Import `sync`, `query`, `Source`, `Store` and their types from [the public entry point](../../src/capabilities/transactions/index.ts).

| Operation | Result | Services |
| --- | --- | --- |
| `sync(input?: SyncInput)` | Overall `attempted`, `no-sessions` or `no-accounts`; per-bank complete/failed/skipped outcomes and retained counts. | `Source`, `Store` |
| `query(input?: QueryInput)` | Transactions, accounts, coverage, bank attempts, matched and undated counts. | `Store` |

Both return typed Effects with `CollectionError` kinds `Input`, `Access`, `Provider`, `Storage` or `Limit`. Sync captures bank failures in results: inspect each bank even when the Effect succeeds. Global failures use the error channel; interruption follows Effect cancellation.

Both inputs support bank/country/account selection and inclusive dates. Query also supports status, currency, direction, case-insensitive literal text, date field and pagination. Text searches parties, references, remittance and notes. Booking date is the default; bounded queries exclude undated rows. `undated` counts otherwise-matching rows lacking the selected date. Results sort by date then key; `matched` precedes pagination. Limit defaults to 1,000 (maximum 10,000); offset cannot exceed 1,000,000. Set `includeSuperseded: true` to inspect superseded observations.

Amounts are exact decimal strings with separate currency and direction. Use decimal or integer arithmetic for totals. Results, keys and provenance are private data.

Run [the synthetic composition example](../../examples/synthetic-transactions.ts):

```sh
bun run example:transactions
```

It composes public Effects without credentials, files or network access. Production composition supplies `Source` and `Store` with `Layer.succeed`, using `enableBankingSource(credentials, options)` from `src/provider` and `localTransactionStore(locations)` from `src/storage`. Provider, filesystem and runtime dependencies stay in adapters.

## CLI

```sh
bun run start transactions sync --country NL --bank EXACT_PROVIDER_BANK_NAME
bun run start transactions accounts
bun run start transactions query --from 2026-09-01 --to 2026-09-30 --status booked
```

`accounts` prints selection keys for `--account KEY`; use `--help` for other filters. Queries and account listings are offline sanitized summaries. Group counts describe the returned page; `Transactions` counts all matches. Use the TypeScript API for records.

Exit codes: 0 completed (including empty queries), 4 any failed bank, 1 invalid input, global failure, interruption or no matching sessions/accounts.

## Synchronization and freshness

Initial sync and a changed authorization revision request the broadest provider history with `longest`. Invoke sync promptly after consent; collection has no scheduler. Later runs overlap the last completed checkpoint by seven days (`overlapDays`: 1–365). Older unresolved pending dates extend the window; undated pending rows trigger broad retrieval. Explicit ranges use `default` and never advance the incremental checkpoint. [Provider contracts](provider-contract.md) define wire behavior.

All pages for a bank's selected accounts must finish before publishing its transactions. Failures preserve previous data and coverage; retries restart the window. Earlier banks may already be committed. Failed/interrupted attempts never advance completed freshness; an interrupted attempt can remain `running`.

Coverage records requested windows, completion time, observed booking-date bounds and pagination counts. `provider-limited` never promises complete or gap-free history. `BankState.lastCompletedAt` means the last unbounded, all-account completion; account subsets and explicit ranges have separate coverage.

## Reconciliation

- Account identity uses provider/environment/application, bank/country and the primary identification hash. Session UIDs are retrieval addresses; secondary hashes never trigger fuzzy merges.
- Stable entry references update one account-scoped record and preserve changed data as revisions. Booked records retain pending regressions as uncertain revisions. Mutable detail IDs are excluded from identity.
- Missing references use canonical content plus occurrence ordinals. Numeric formatting is normalized only for identity; exact observed strings survive. Multiplicity remains stable on reruns. Identical stable-reference pages are suppressed; identical ID-less pages remain possibly distinct, uncertain payments. Changed content may retain separate observations.
- Inferred pending/booked links require a unique pair with matching nonempty reference/scheme, numeric amount, currency, direction, parties and value or transaction date. Both records survive; the superseded pending row and inference remain uncertain. Ambiguous candidates stay visible.
- Missing rows are never deleted. Unmatched pending rows within the fetched window and plausible monetary/party matches are flagged uncertain. Inspect uncertainty, revisions, origins and superseded observations before aggregating.

## Storage and limits

Snapshots use `financial-cli/transactions.json` beneath the [private state root](../../README.md#local-data-and-security), with versioned validation, 0700 directories and 0600 files. Sync holds `.transactions-lock` and the authentication lock; concurrent writers fail immediately. Queries read atomic snapshots during sync. Remove stale locks only after confirming no corresponding command is active.

Limits: 1,000 pages and 200,000 observations per account, 15 seconds/2 MiB per HTTP response, 64 MiB per snapshot. Limit failures preserve committed data. Storage provides neither encryption nor power-loss durability. Retention and deletion are described in [data processing](data-processing.md#retention).
