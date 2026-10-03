# Authentication context

## Scope and ownership

The CLI owns local authentication configuration, key material, login coordination, and the stored credential record. The provider owns authorization decisions, issued credentials, validity, and revocation. Local status cannot prove that a provider still accepts a credential unless the command explicitly performs and reports a provider check.

The initial commands are `keygen`, `configure`, `login`, and `status`. Account retrieval, balances, payments, background synchronization, and multi-service workflows are outside this scope. Adding them requires an explicit scope decision rather than incidental expansion of login.

One executable is one hexagon. Capabilities are deep modules inside the authentication bounded context, not separate services. A capability belongs to exactly one context. Use language-only DDD unless a concrete invariant justifies a tactical model.

## Ubiquitous language

| Term | Meaning |
| --- | --- |
| Key material | Cryptographic material used by the provider's authentication protocol. Private material is secret. |
| Configuration | Validated local settings needed to run authentication. Configuration does not itself establish a login. |
| Login attempt | One bounded authorization flow with its own state and cleanup responsibility. |
| Authorization request | Provider-directed request asking the user to grant access. Its encoding belongs to the provider adapter. |
| Callback | An inbound response to the active login attempt. Receiving a callback does not prove authorization succeeded. |
| State | Unpredictable, attempt-bound correlation value checked before accepting an authorization response. It is not a credential. |
| Authorization code | Short-lived provider value exchanged under the provider's protocol. Treat it as secret and prevent replay. |
| Credential | Provider-issued authentication material that the CLI stores only after successful validation and exchange. |
| Credential store | Port that owns safe local persistence and reports storage failures. |
| Status | Safe summary of local configuration and credential presence or known expiry. Never the credential itself. |
| Provider denial | Expected refusal or cancellation of authorization, distinct from a network or storage failure. |
| Timeout | A login deadline that stops the attempt and bounds the callback listener and outstanding requests. |

## Command responsibilities

- `keygen` creates provider-compatible key material through a cryptographic adapter. Existing private material must not be silently overwritten.
- `configure` validates and stores the settings required by the selected authentication protocol. Keep secret material separate from shareable configuration.
- `login` coordinates authorization, verifies callback correlation, exchanges the response, and stores the resulting credential. A failed attempt must not replace an existing valid record.
- `status` describes safe local state without printing keys, codes, tokens, or credential contents. Make the difference between local state and provider-verified validity explicit.

Exact flags, protocol fields, algorithms, storage formats, and provider endpoints come from the implementation specification and provider documentation. This context does not invent them.

## Agreed test boundaries

The initial work already authorizes CLI command tests, HTTP authorization and callback tests, invalid-state rejection, timeout behavior, provider failures, and secure credential storage. Test application decisions at capability interfaces; test wire formats, HTTP behavior, filesystem security, and subprocess behavior at the corresponding adapter or executable boundary. New boundaries or material scope changes need confirmation.

## Read-only consent (#16)

Authentication can request transaction access for the approved collection feature (#17), without retrieving transactions here. A fresh login requires explicit acknowledgement of that purpose and fresh owner/provider/bank consent; balances remain false and payments remain out of scope. Requested rights are distinct from provider-reported rights, and omitted provider flags remain unknown. Existing records have no new rights or duration through local migration.

The authentication capability owns connector-maximum duration policy, safe typed login outcomes, expiry and renewal decisions. The CLI parses and renders the same public Effect operations. Connector maxima are current metadata, not a fixed six-month guarantee. Signing JWT lifetime, provider session expiry, bank SCA and owner renewal are separate concepts. Existing bank records survive unsuccessful local renewal; bank-side revocation remains provider-controlled.

The owner approved the public `login(LoginInput)` and `status(StatusQuery)` seams, controlled capability ports and existing CLI/HTTP/storage boundaries for #16 on 2026-10-03. New collection and collection-storage seams belong to #17 and still require their own agreement. See [API contracts and compatibility](docs/authentication-api.md) and [live acceptance](docs/consent-acceptance.md).
