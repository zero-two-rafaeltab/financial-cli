# Collection data processing

Use this notice to update the separately hosted privacy and terms pages before live acceptance. It records actual processing; deployment requires owner approval.

## Data and purpose

Owner-initiated synchronization reads account information through Enable Banking and the selected bank. Local queries filter the saved records without provider access. The CLI prints sanitized summaries; the TypeScript API returns private records to its caller.

Stored data includes:

- Accounts: provider, bank/country, currency, identification hashes and session-bound account UID.
- Transactions: exact amount/currency, direction, status, available dates, party names, merchant category, references, remittance, notes and provider IDs.
- Collection metadata: original/latest provenance, timestamps, revisions, inferred links, uncertainty, requested windows, observed date bounds, pagination and attempt/completion records. Authorization revisions are digests, not session credentials.

Authentication credentials use a separate store. Collection retains no raw responses, counterparty account numbers, addresses or balances. It initiates no payments and performs no telemetry export or background sync. Bank/provider processing is governed by their own policies.

## Retention

Records remain in permission-restricted local storage outside Git; they are not encrypted. The owner controls access and private backups. Consent expiry or revocation does not delete history, revisions or metadata.

To delete collected data, stop synchronization and remove the private transaction file and its backups. Deletion does not revoke bank/provider consent. Keep records and credentials out of Git, GitHub, chat and acceptance evidence.

## Deployment and acceptance

1. Approve privacy/terms text covering purpose, data categories, provider/bank involvement, local protections and retention/deletion. Record its revision and effective date.
2. Explicitly authorize and deploy the separately managed policy pages outside this repository. Preserve unrelated services and proxy routes; collection requires no Hermes change. Verify HTTPS access from owner devices using the [deployment guidance](../../README.md#private-https-callback-setup-and-verification).
3. Confirm fresh consent through the [authentication API](../authentication-api.md) and current provider-reported transaction access. Legacy authentication-only sessions are rejected. Rerun full checks/CI before live acceptance.
4. Agree a small account/date window with the owner, run read-only sync/query, and verify completed pagination and private storage. Record only bank outcomes, sanitized counts, coverage/freshness, policy revision and checks.

[#17](https://github.com/zero-two-rafaeltab/financial-cli/issues/17) remains open until deployed policies and owner-approved live acceptance are verified. Synthetic fixtures and CI establish development behavior only.
