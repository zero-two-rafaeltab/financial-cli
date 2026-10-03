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
  --callback-url https://YOUR_PRIVATE_HOST/auth/callback \
  --port 8787
```

The callback listener binds only to `127.0.0.1`. Forward the registered path to that listener through a private HTTPS reverse proxy such as Tailscale Serve. The authorizing browser must have access to the private endpoint, including on a phone if the bank returns authorization there. Public port forwarding is not required for a browser redirect. Do not replace unrelated existing proxy routes.

```sh
bun run start auth login --country NL
bun run start auth status
bun run start auth status --country NL --bank EXACT_PROVIDER_BANK_NAME
```

Login displays available banks for selection and prints a browser authorization link. Open that link and complete the provider and bank consent flow. Do not paste callback URLs, authorization codes, or session identifiers into chat or issues. Keep terminal output containing an authorization link private.

A synthetic authorization test is not proof that a live account is connected. Validate registration, exact callback compatibility, linked-account availability, and the saved session with a real consent flow before relying on this CLI.

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
