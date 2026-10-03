# Consent acceptance for issue #16

Automated synthetic checks cannot establish real bank consent. Owner-assisted acceptance was verified on 2026-10-03 for ING NL and the selected personal Revolut NL connector. Issue #16 remains open for the required GitHub approval and merge. Historical 180-day announcements are an expectation, not a constant: [ING NL](https://enablebanking.com/blog/2024/03/11/changelog-february-2024), [Revolut EU](https://enablebanking.com/blog/2024/12/05/changelog-november-2024). The current [metadata and access contract](https://enablebanking.com/docs/api/reference/#access) governs each attempt.

## Owner-assisted steps

1. Use the reviewed branch with passing checks. Keep the existing signing key, application registration, private callback routing and restricted storage. Do not regenerate keys or copy production state into the checkout.
2. In a private terminal, inspect `auth status` for each current bank. Keep any private backup outside Git. Local preservation is guaranteed on unsuccessful renewal; the bank can independently invalidate a prior session when starting new authorization.
3. Confirm the purpose is read-only transaction access for the approved local reporting feature. Review the provider/bank disclosures. This implementation does not collect transactions, request balances or initiate payments.
4. Run `bun run start auth login --transactions consent --country CC --bank EXACT_PROVIDER_BANK_NAME` for ING NL, then for the correct Revolut personal EU connector. Every attempt discovers current personal AIS metadata; do not infer the Revolut country from the publication's EU label. Omit `--bank` and use the private selector if the exact connector name is uncertain.
5. Open the displayed authorization URL privately and complete owner/bank consent. Never paste the URL, callback query, code, session ID, key, private hostname, account details or raw response into chat or GitHub.
6. Retain only safe summaries: connector name/country, selected maximum in seconds, requested expiry, exchange-returned expiry, observed duration, transactions requested and balances not requested, permission flags actually reported, and the owner-confirmed bank consent selection. When flags are omitted, record that explicitly; do not treat omission as proof. Investigate a returned expiry shorter than the metadata maximum; do not edit it or promise six months.
7. Run `auth status` separately for each connector. Record its safe expiry/source, verification, state and renewal indication. Verify the other bank's record is retained. If a bank explicitly refuses transactions, the CLI must not replace the old local record.
8. Confirm callback/listener and lock cleanup. Use an owner-agreed cancellation/denial check if needed; avoid unnecessary live authorization attempts that may invalidate bank sessions. Automated tests already exercise denial, provider/storage failure, timeout and interruption preservation.

Production flows run through the existing CLI on explicit owner instruction; the owner alone completes bank consent. The CLI uses existing signing material and credential storage internally. The agent must not inspect production key/session files or disclose keys, saved session IDs, callback queries or raw provider responses. Share authorization links only with the owner when explicitly requested, never in public evidence. No transaction retrieval is part of this acceptance.

## Acceptance record

| Check | ING NL | Revolut EU personal connector |
| --- | --- | --- |
| Current connector identity and maximum verified | ING / NL; 15,552,000 seconds | Revolut / NL; 15,552,000 seconds |
| Informed owner consent; transactions requested, balances false | Owner-assisted fresh consent succeeded; returned transactions=true, balances=false | Owner-assisted fresh consent succeeded; returned transactions=true, balances=false |
| Returned expiry and actual duration verified | 180 days; exact provider value preserved, same expiry instant as request | 180 days; exact provider value preserved, same expiry instant as request |
| Returned permission flags or explicit omission recorded | Explicit transactions=true, balances=false | Explicit transactions=true, balances=false |
| Provider-verified status and cleanup | authorized; provider verification; renewal not required; CLI exited 0 and next command acquired locks | authorized; provider verification; renewal not required; CLI exited 0 and subsequent status acquired locks |

Both flows used the final reviewed implementation after PR CI passed. The owner explicitly requested that the agent start the CLI and supply each browser authorization link, then completed the bank flows personally. Before Revolut renewal, safe status showed its prior authorized authentication-only session with transactions=false while the renewed ING record remained present. The final aggregate status retained both banks and reported transactions=true, balances=false for each. No account or transaction retrieval occurred.

Absolute session timestamps, authorization links, callback queries, session IDs, keys and private deployment settings are excluded from this public record. Only sanitized connector metadata, durations, rights and status are recorded. These current 180-day results do not become implementation constants or guarantees against earlier revocation.

Signing JWT lifetime remains 300 seconds. Bank SCA and consent renewal are provider-controlled; [expired sessions require fresh authorization](https://enablebanking.com/docs/faq/#how-should-re-authorisation-be-performed-and-how-to-match-accounts-across-sessions). No refresh workaround, scraping or bank-password storage is introduced. Mark required live checks complete only after actual safe evidence, and do not close #16 while required acceptance is pending.
