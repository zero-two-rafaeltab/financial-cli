# Composition and operations

Scope: executable startup, configuration, Effect Layers and runtime ownership, resource lifetime, diagnostics, and integration tests.

## Configuration and lifecycle

- The composition root selects adapters, constructs Layers, and owns shared lifetimes. The executable entry point owns process execution and exit behavior. Capabilities never create runtimes.
- Parse external configuration once and pass typed capability-named values inward. Application code does not read environment variables or raw files. Secrets reach only adapters that need them. Validate required configuration before beginning the protected operation; help and safe status must not require a live provider.
- Adapters own resource acquisition and release mechanics. Use scoped Effect acquisition for callback servers, requests, fibers, file resources, and any managed runtime. The composition root coordinates shared resources without moving infrastructure lifecycles into domain code.
- On partial startup failure, release everything already acquired. On completion, timeout, or interruption, stop accepting callbacks, bound in-flight work, and attempt remaining cleanup even if an earlier finalizer fails.
- Timeouts bound underlying resource use, not just the caller's wait. Propagate interruption to requests and background fibers. If an API cannot cancel, bound outstanding work and prevent late completion from mutating a closed login attempt. Do not retry ambiguous side effects blindly.
- Do not start detached tasks that outlive their owning scope. A command must terminate without a callback server or background login task keeping the process alive.

## Diagnostics and observability

Use capability language for structured outcomes and technical detail only at adapters. Domain code remains independent of telemetry libraries. Telemetry must not affect the command outcome.

Record actionable safe diagnostics for translated technical failures through the configured mechanism. Avoid duplicate logging. Redact secrets before formatting or export, including tokens, codes, private keys, sensitive URLs, and provider response bodies. Opaque causes are not automatically safe to stringify.

Telemetry export is opt-in. Authentication must work without a collector, network telemetry, dashboards, or alerts. If tracing is introduced, propagate context through ports and adapters without exporting secrets or unnecessary personal data. stdout remains the command result channel, not a telemetry stream.

## Testing

Composition tests use the real composition root and adapters through a small representative path. Executable tests run the actual Bun command or built artifact in an isolated environment and assert exit status, stdout, stderr, and termination. These tests prove wiring and process behavior, not the entire capability decision matrix.

Exercise the auth-only commands and a complete synthetic login with a local provider fixture, then inspect safe status. Prove startup failure, timeout, and interruption release the listener and do not persist late credentials. Control child environments and storage directories so tests never touch a user's credentials.

If telemetry is present, test its mechanism and opt-in behavior rather than asserting every trace or log. Secret disclosure checks remain security contract tests even when no telemetry is enabled. Apply [shared testing principles](project-organization.md#shared-testing-principles).
