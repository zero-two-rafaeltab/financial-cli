# Financial CLI

A personal, authentication-only Enable Banking CLI built with TypeScript, Bun, and Effect. It does not fetch transactions, generate reports, or initiate payments.

## Setup

Install Bun 1.4.2 and OpenSSL, then run:

```sh
bun install --frozen-lockfile
bun run start --help
```

## Registration and authorization

Generate a signing key locally:

```sh
bun run start auth keygen > /path/outside/checkout/public-certificate.pem
```

The command prints only the public certificate. The private key stays in the application's restricted local configuration directory. Upload the public certificate when registering a production application with Enable Banking. Activate restricted access by linking every personal account you want to authorize. Account linking and the API authorization below are separate steps.

Configure the application's assigned ID and its exact registered HTTPS callback URL:

```sh
bun run start auth configure \
  --application-id YOUR_APPLICATION_UUID \
  --callback-url https://YOUR_PRIVATE_HOST/financial-cli/callback \
  --port 8787
```

The callback listener binds only to `127.0.0.1`. Forward the registered path to that listener through a private HTTPS reverse proxy such as Tailscale Serve. The authorizing browser must have access to the private endpoint, including on a phone if the bank returns authorization there. Public port forwarding is not required for a browser redirect. Do not replace unrelated existing proxy routes.

### Private HTTPS callback setup and verification

Inspect `tailscale serve status --json` before making changes. If the exact callback path already proxies to the configured loopback port and path, keep it. Otherwise, save the current configuration outside the checkout in an owner-only directory, then add only the dedicated route. These example values must match the registered callback URL and `auth configure` settings:

```sh
umask 077
route_dir="$(mktemp -d "$HOME/.financial-cli-serve.XXXXXX")"
tailscale serve status --json > "$route_dir/before.json"
callback_path=/financial-cli/callback
callback_port=8787
https_port=443
tailscale serve --bg --https="$https_port" --set-path="$callback_path" \
  "http://127.0.0.1:$callback_port$callback_path"
tailscale serve status --json > "$route_dir/after.json"
```

Read back both snapshots and confirm that every unrelated handler, HTTPS port, and exposure mode is unchanged. Include the callback path in the proxy target so the CLI receives the expected path. Keep deployment hostnames and snapshots local. Use private Serve only; do not enable Funnel or router port forwarding. See the [Tailscale Serve command reference](https://tailscale.com/docs/reference/tailscale-cli/serve) for route flags and removal.

Keep required privacy and terms pages in a separately managed loopback service with dedicated private HTTPS routes. Their files, service definition, and deployment configuration belong outside this repository. Verify that the service remains enabled and responds while no CLI login is running; the callback listener does not host these pages.

Verify the exact HTTPS URL with normal certificate validation. While a login is waiting, opening its callback URL without query parameters should display `Invalid callback.` (HTTP 400). Ask the owner to check that response in browsers on both desktop and phone with Tailscale connected, and to check the policy pages without certificate errors. A successful request from the deployment host does not establish access from either device.

For a synthetic verification, use disposable keys, application configuration, and state in explicit owner-only XDG roots outside the checkout. Set `FINANCIAL_CLI_TEST_MODE=1` and `FINANCIAL_CLI_TEST_API_URL` to a local loopback provider fixture, and configure the same registered HTTPS callback URL and loopback port. Run the actual `auth login` command against that fixture. Have the fixture capture the authorization request in memory, then send a mismatched-state callback through the HTTPS route: expect HTTP 400, no exchange, and no saved session. Send a valid callback with the captured state and a disposable code: expect the complete HTTP 200 response, exactly one fixture exchange, a saved synthetic session, successful fixture-backed `auth status`, and CLI termination. Verify that the loopback port and authentication locks are released. Never send synthetic codes to Enable Banking or use real bank sessions for this check. Record only sanitized outcomes, then stop the fixture and remove its disposable credentials.

### Login and consent renewal

```sh
bun run start auth login --transactions consent --country NL
bun run start auth status
bun run start auth status --country NL --bank EXACT_PROVIDER_BANK_NAME
```

`--transactions consent` acknowledges read-only transaction access for local reporting. Balances remain disabled; no payments or transaction retrieval are implemented. Select a bank, open its authorization link privately, and complete the provider/bank consent screens yourself. Keep links, callback queries and session identifiers out of chat and issues.

Login requests the selected personal AIS connector's current validated `maximum_consent_validity`; the provider-returned expiry is saved exactly. Duration is not fixed at 180 days. The 300-second application signing JWT authenticates API requests independently of session expiry. Bank strong customer authentication (SCA), consent and revocation remain bank-controlled; access may end earlier.

`auth status` reports expiry/source, verification, requested/reported permissions and renewal guidance. Omitted permission flags are unknown. `provider-unavailable` means validity could not be verified. Existing authentication-only sessions require fresh transaction consent; never extend expiry or permissions by editing local records.

Renew with `auth login --transactions consent --country CC --bank EXACT_PROVIDER_BANK_NAME`, using the existing signing key and registered callback. Expired sessions require [fresh owner authorization](https://enablebanking.com/docs/faq/#how-should-re-authorisation-be-performed-and-how-to-match-accounts-across-sessions). Unsuccessful renewal, including denied transaction access, preserves all prior local records; the bank may independently revoke an earlier session.

See the [TypeScript/Effect API](docs/authentication-api.md) for programmatic use and [live acceptance](docs/consent-acceptance.md) for the owner-assisted verification checklist and results.

### Callback and deployment cleanup

The callback listener exists only during `auth login`. Success, denial, timeout, or interruption releases it and its locks. Cancel a waiting login with Ctrl-C and verify the configured loopback port is free. Leave the private Serve route in place for the next login; an HTTP 502 while the listener is stopped is expected and does not imply that the route is missing. Policy pages remain available independently.

When retiring this deployment, stop any active login and remove only its dedicated callback route. Set the example path and HTTPS port to the values used during setup, even in a fresh shell:

```sh
callback_path=/financial-cli/callback
https_port=443
tailscale serve --bg --https="$https_port" --set-path="$callback_path" off
tailscale serve status --json
```

Compare the final configuration with the saved snapshot and preserve unrelated routes and exposure modes. Do not use `tailscale serve reset`. Retire policy routes and their local service only when no registered application still needs them. Remove verification snapshots and disposable fixture storage after review. Remove real local credentials only as an intentional retirement step; deleting local session files does not revoke provider or bank consent, which must be withdrawn through their supported controls.

## Local data and security

Default storage roots are `~/.financial-cli/config` and `~/.financial-cli/state`, so application directories are `~/.financial-cli/config/financial-cli` and `~/.financial-cli/state/financial-cli`. No XDG exports are needed. Explicit `$XDG_CONFIG_HOME` and `$XDG_STATE_HOME` override their respective roots independently, with `financial-cli` appended to each. The defaults avoid relying on permissions of `~/.config` or `~/.local`. Files are restricted to the current user and directories must be private. Storage rejects repository locations and symbolic links. Protect and back up local credentials separately from source control. Storage is permission-protected, not encrypted at rest.

Treat this repository as public even when its GitHub visibility is private. Never commit real keys, configuration, bank data, session identifiers, authorization URLs, or captured provider responses. Tests use disposable synthetic credentials and local HTTP fixtures. Provider error bodies are not printed.

Sessions are retained separately for each bank and country and bound to application, provider endpoint, environment, callback configuration, and signing-key identity. Reconfiguration does not make old credentials valid for the new identity. `auth status` checks all matching sessions; optional bank/country filters select a subset.

Authentication commands take exclusive local `.auth-lock` files in the application's configuration and state directories, acquired in a consistent order. Identical directories need only one lock. A second command fails immediately instead of changing configuration or replacing sessions mid-login. Retry after the active command finishes. If a crashed process left a lock, confirm that no authentication command remains running before removing that lock manually. Locks are never automatically stolen. Failed, denied, cancelled, and timed-out login attempts must leave existing sessions unchanged.

Permission or path failures report unsafe storage access, not lock contention. Check the selected roots and their parent directories rather than deleting a lock.

All storage ancestry must be owned by the current user or root and must not be group/world-writable. Tests need an owner-only scratch location with trusted ancestry. If your default temporary directory fails that check, create a private directory beneath your home and run checks with `TMPDIR` set to it. Do not relax credential security to accommodate a shared scratch path.

Writes are atomic replacements with temporary-file cleanup. This CLI does not claim power-loss durability or encryption at rest.

The CLI requests account-information authorization only. It exposes no payment command.

## Development

```sh
bun run format
bun run check
```

The complete check runs TypeScript, formatting/lint, module boundary checks, and Bun tests. `make ci` runs the same gate. Read [coding standards](CODING_STANDARDS.md), [domain context](CONTEXT.md), and the repository-local [do-work](.agents/skills/do-work/SKILL.md) and [TDD](.agents/skills/tdd/SKILL.md) skills before changes. Track unfinished work in repository GitHub Issues.
