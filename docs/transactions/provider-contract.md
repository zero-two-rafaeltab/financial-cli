# Enable Banking collection contract

Verified against the [official API reference](https://enablebanking.com/docs/api/reference/) on 2026-10-03 before selecting wire schemas. Synthetic fixtures represent protocol variations, not verified ING/Revolut live behavior.

Session data supplies status, access and session account UIDs with identification hashes. Resolve only authorized, unexpired sessions with explicit transaction access and fresh request provenance from the [authentication API](../authentication-api.md). Fetch account details for currency and verify the primary hash. Match accounts by provider/environment, bank/country and primary hash; do not fuzzy-match secondary hashes. UIDs expire with their session.

Transaction collection uses `GET /accounts/{account_id}/transactions`. Date bounds are inclusive UTC dates. Follow `continuation_key` until absent/null; cursors are session-local. `longest` requests the broadest available history and ignores `date_to`. Use `default` for explicit ranges and incremental overlap.

Amounts are decimal strings plus currency and a separate credit/debit indicator. Retain optional booking/value/transaction dates, parties, merchant category, reference, remittance and note. Preserve every documented status. `entry_reference` is immutable within an account; `transaction_id` is mutable and unsuitable for identity.

Optional transaction fields may be returned as JSON null. The adapter treats null dates, party names and text as absent, and null remittance as an empty list. Required money, currency, direction and status remain validated; malformed non-null dates and numeric money are rejected.

The adapter sends application-signed JWTs only to the configured provider. It sends no invented PSU headers, retrieves no balances, initiates no payments and never renews consent. Provider bodies and identifiers are excluded from diagnostics.
