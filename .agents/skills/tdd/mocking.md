# Controlled adapters

## Replace external effects, not private modules

Capability tests supply stateful controlled adapters for application-owned ports through Effect Layers. Keep the capability implementation real. Control provider results, credential persistence, clock deadlines, and randomness only where the declared contract depends on them.

Do not mock internal classes, module imports, or private helpers. Do not introduce a public port solely for a test of pure implementation. A useful module interface hides policy and coordination rather than forwarding every collaborator method.

## Preserve the port contract

Controlled adapters must honor the production port's relevant observable guarantees, including absence semantics, atomic replacement, single callback consumption, and typed failures. Keep their state inspectable through declared operations or deliberate test observations of port effects. A fake that always reports success cannot establish failure behavior.

Inject purposeful operations such as credential persistence or authorization exchange, not a generic fetch wrapper that leaks URLs and wire formats into application tests. Service keys and Layers use the repository's installed Effect version. Resolve adapter dependencies at construction, not via a global locator.

## Use real local resources where they own the risk

A memory store cannot prove filesystem permission or rename semantics. A provider stub at capability level cannot prove HTTP encoding or response validation. Run production adapter contract tests against isolated real files and local HTTP fixtures for those guarantees.

Use real cryptographic primitives in crypto adapter tests. Deterministic randomness is only for controlled policy tests and synthetic fixtures, never the production generator. Live provider credentials are not needed for normal CI.

## Isolation and cleanup

Give tests separate storage roots and listener ports. Explicitly supply child-process environments; do not inherit real credential locations. Scope test servers, requests, and fibers and await their release even when assertions fail.

Use controlled clocks for application deadline decisions and bounded observable waits for real HTTP and subprocess behavior. Diagnose a hanging resource before increasing timeouts or adding retries.
