# Validation and delivery

## Discover and run checks

Read package scripts and any Makefile before choosing commands. Bun is the runtime and package manager. Use the lockfile and existing dependency setup; do not introduce pnpm, Turbo, Docker, or a workspace graph for a single CLI.

Run focused tests through the existing runner, normally `bun test <test-file>`, then the complete gate. The target contract is `bun run check`. An existing `make ci` is acceptable when it delegates to the same checks. If neither exists, report the missing gate and run the available relevant checks without claiming full CI success.

Formatting commands come from repository configuration. Do not invent a formatter invocation. Record what actually ran and its exit result. A code change needs the full gate after the final edit, not only before it.

## Demonstrate behavior safely

Run CLI demonstrations in isolated storage with synthetic configuration and a local provider fixture. Capture relevant command output and exit status. Redact secret-like values, home paths, and identifiers before including evidence in an issue or PR. Never upload a token-bearing authorization URL or credential file.

A complete login demonstration may include launching or displaying an authorization request, receiving a local callback, storing a synthetic credential, and checking safe status. Browser recordings, real provider access, and screenshots are not required. A transcript is evidence only if it came from an actual run.

## Commits and publication

Keep each authorized commit coherent and tested. Check the diff and working tree before staging; include only owned changes. User restrictions override workflow defaults. Do not commit or publish a docs-only delegated task when prohibited.

When publication is authorized, push the intended branch and create or update a PR with a summary, issue reference when available, exact checks, redacted CLI evidence, and known limitations. Supply multiline Markdown using a body file or a proper JSON encoder. Read the resulting body back to verify content and accessible evidence.

For stacked work, fetch the actual trunk and verify each layer against its immediate published base. The base must be an ancestor and the layer must contain no merge commits. Rebase only when authorized; restack descendants and rerun full validation for layers whose trees changed. Verify the hosting service's stack readiness before reporting a stack merge-ready. Do not create a stack for a single isolated change.

A final report distinguishes completed checks from blockers. Never equate a successful write, push, or PR creation with successful validation.
