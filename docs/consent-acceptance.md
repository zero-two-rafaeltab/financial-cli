# Live consent verification

Synthetic tests cannot establish real bank consent. Use this checklist to verify ING NL and the owner's selected personal Revolut EU connector after implementation changes. Historical [ING NL](https://enablebanking.com/blog/2024/03/11/changelog-february-2024) and [Revolut EU](https://enablebanking.com/blog/2024/12/05/changelog-november-2024) announcements describe 180 days; current [connector metadata](https://enablebanking.com/docs/api/reference/#access) governs.

## Checklist

1. Use a reviewed revision with passing checks, existing keys/registration/callback and private storage. Check current `auth status`; do not regenerate keys or edit session rights/expiry.
2. Explain read-only transaction access for local reporting. The owner reviews disclosures and completes bank consent; balances and payments are not requested, and no transactions are retrieved here.
3. Run `bun run start auth login --transactions consent --country CC --bank EXACT_PROVIDER_BANK_NAME` for each connector. Use NL for ING; use the actual Revolut connector country/name, or omit `--bank` to select it. Open the authorization link privately.
4. Record safe name/country, current maximum seconds, requested and returned expiry, actual duration, requested rights, returned permission booleans or explicit omission, and owner-confirmed consent. Investigate shorter expiry; never overwrite it locally.
5. Run `auth status` for both banks. Confirm provider verification, expiry/source, permissions and renewal guidance, with both records retained. Check listener/lock cleanup. Synthetic tests cover unsuccessful renewal; avoid unnecessary live denial attempts that could revoke bank sessions.

An agent may run the CLI on explicit owner instruction and share a link privately when requested; only the owner completes bank consent. Never inspect production key/session files or publish links, callbacks, keys, session IDs, private configuration or raw responses. Local record preservation does not prevent bank-side revocation.

## Verified 2026-10-03 — [PR #21](https://github.com/zero-two-rafaeltab/financial-cli/pull/21)

| Connector | Current maximum | Returned duration | Reported permissions | Provider status |
| --- | --- | --- | --- | --- |
| ING / NL | 15,552,000 seconds | 180 days; same expiry instant as requested | transactions=true; balances=false | authorized; renewal not required |
| Revolut / NL | 15,552,000 seconds | 180 days; same expiry instant as requested | transactions=true; balances=false | authorized; renewal not required |

The owner completed fresh informed consent for both after passing PR checks. Exact provider expiry values were preserved, both records remained present, and CLI exits/subsequent commands confirmed listener and lock cleanup. Public evidence excludes absolute session timestamps and sensitive values. These observations do not guarantee future validity or define a fixed duration.
