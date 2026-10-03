# Consent acceptance for issue #16

Automated synthetic checks cannot establish real bank consent. Issue #16 stays open until owner-assisted acceptance verifies both ING NL and the selected personal Revolut EU connector. Historical 180-day announcements are an expectation, not a constant: [ING NL](https://enablebanking.com/blog/2024/03/11/changelog-february-2024), [Revolut EU](https://enablebanking.com/blog/2024/12/05/changelog-november-2024). The current [metadata and access contract](https://enablebanking.com/docs/api/reference/#access) governs each attempt.

## Owner-assisted steps

1. Use the reviewed branch with passing checks. Keep the existing signing key, application registration, private callback routing and restricted storage. Do not regenerate keys or copy production state into the checkout.
2. In a private terminal, inspect `auth status` for each current bank. Keep any private backup outside Git. Local preservation is guaranteed on unsuccessful renewal; the bank can independently invalidate a prior session when starting new authorization.
3. Confirm the purpose is read-only transaction access for the approved local reporting feature. Review the provider/bank disclosures. This implementation does not collect transactions, request balances or initiate payments.
4. Run `bun run start auth login --transactions consent --country CC --bank EXACT_PROVIDER_BANK_NAME` for ING NL, then for the correct Revolut personal EU connector. Every attempt discovers current personal AIS metadata; do not infer the Revolut country from the publication's EU label. Omit `--bank` and use the private selector if the exact connector name is uncertain.
5. Open the displayed authorization URL privately and complete owner/bank consent. Never paste the URL, callback query, code, session ID, key, private hostname, account details or raw response into chat or GitHub.
6. Retain only safe summaries: connector name/country, selected maximum in seconds, requested expiry, exchange-returned expiry, observed duration, transactions requested and balances not requested, permission flags actually reported, and the owner-confirmed bank consent selection. When flags are omitted, record that explicitly; do not treat omission as proof. Investigate a returned expiry shorter than the metadata maximum; do not edit it or promise six months.
7. Run `auth status` separately for each connector. Record its safe expiry/source, verification, state and renewal indication. Verify the other bank's record is retained. If a bank explicitly refuses transactions, the CLI must not replace the old local record.
8. Confirm callback/listener and lock cleanup. Use an owner-agreed cancellation/denial check if needed; avoid unnecessary live authorization attempts that may invalidate bank sessions. Automated tests already exercise denial, provider/storage failure, timeout and interruption preservation.

The owner runs production flows locally and provides only these sanitized outcomes. The agent must not read production keys, saved session IDs, authorization links, callback queries or provider response bodies. No transaction retrieval is part of this acceptance.

## Acceptance record

| Check | ING NL | Revolut EU personal connector |
| --- | --- | --- |
| Current connector identity and maximum verified | Pending owner flow | Pending owner flow |
| Informed owner consent; transactions requested, balances false | Pending owner flow | Pending owner flow |
| Returned expiry and actual duration verified | Pending owner flow | Pending owner flow |
| Returned permission flags or explicit omission recorded | Pending owner flow | Pending owner flow |
| Provider-verified status and cleanup | Pending owner flow | Pending owner flow |

Signing JWT lifetime remains 300 seconds. Bank SCA and consent renewal are provider-controlled; [expired sessions require fresh authorization](https://enablebanking.com/docs/faq/#how-should-re-authorisation-be-performed-and-how-to-match-accounts-across-sessions). No refresh workaround, scraping or bank-password storage is introduced. Mark required live checks complete only after actual safe evidence, and do not close #16 while required acceptance is pending.
