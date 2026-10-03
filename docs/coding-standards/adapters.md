# Adapters

Scope: CLI and callback driving adapters, provider and local storage driven adapters, cryptography, and contract tests.

## Boundary translation

Parse untrusted command arguments, environment-derived settings, files, callback parameters, and provider responses with runtime schemas before translating them into application-owned types. Use Effect Schema where appropriate. Type assertions, non-null assertions, and unchecked JSON casts do not validate input.

Structural validation belongs to adapters; semantic policy belongs to capabilities. Translate validation and vendor failures into declared outcomes or application-owned tagged errors. Library causes may remain opaque diagnostics, never inward decision inputs.

Wrap Promise and callback APIs in Effect with cancellation and cleanup support. Honor the consuming port's guarantees, not just its TypeScript signature.

## CLI driving adapter

- Obtain public driving ports, not concrete handlers. Parse arguments and render each declared outcome and typed error exhaustively.
- Define stable exit behavior. Success and expected status absence must follow the command contract; invalid input, denied login, timeout, and technical failures must have deliberate non-success handling when specified. Test exact mappings rather than inventing undocumented exit codes.
- Keep requested results on stdout and diagnostics on stderr. Help and status are safe to display. Do not print credential contents, private keys, authorization codes, raw provider payloads, or diagnostic causes.
- Secrets must not travel through flags that expose them in shell history or process listings. Use an approved protected input mechanism or secure reference. Private key export, if deliberately supported, needs explicit handling and must never appear as incidental logging.
- Browser launching is an outbound adapter concern. Provide a documented manual authorization path when supported; do not make browser automation or recordings part of CI.

## Authorization and callback HTTP

- Encode authorization and exchange requests according to provider documentation, including required redirect binding, state, and protocol-specific protections such as PKCE when applicable. Do not invent endpoints, algorithms, scopes, or protocol fields.
- Bind the temporary listener to loopback, never all interfaces. Validate the expected method, path, parameter shape, and attempt state before exchanging a code. Reject unsolicited, malformed, mismatched, duplicate, and late responses without replacing credentials.
- Correlate attempts with cryptographically secure unpredictable state. Consume a valid response at most once, including under concurrent callbacks. Apply browser-origin or host checks where required by the chosen callback contract; they do not replace state validation.
- Return minimal safe HTTP responses. The listener is not a general public API and does not inherit a requirement for a hosted Problem Details catalog.
- Bound request sizes and time. Remove the listener and stop outstanding work on completion, interruption, startup failure, and timeout. Timeout must not leave a port bound or permit a late credential write.
- Keep provider endpoints and redirect settings validated. Authentication material goes only to the intended endpoint. Retry only when the protocol makes the operation safe; a timed-out exchange may have succeeded remotely.

## Secure local persistence

Keep shareable configuration separate from secret records. Validate stored schemas on read. Treat corrupt, inaccessible, or insecure storage as explicit failures rather than silently claiming an unauthenticated state.

Use an OS credential store or documented restrictive local storage. Filesystem-backed secrets require owner-only access, restrictive directories and files on POSIX, and equivalent protections on supported platforms. Create secure permissions before writing bytes, including temporary files. Do not fall back silently to insecure storage.

Replacement must be atomic for the reader's observable record and preserve the previous valid record on failure. Define concurrent-writer behavior and enforce it, rather than allowing silent corruption or lost updates. Avoid unsafe symlink traversal and accidental overwrite of unrelated files. Clean temporary secret files on failure. Claim crash durability only if the implementation and tests establish it.

Cryptographic generation belongs to a production crypto adapter using supported algorithms and cryptographically secure randomness. Deterministic fixtures belong only in tests.

## Testing

Driving-adapter contract tests exercise real CLI parsing and rendering, and real HTTP requests to the callback listener. Prove correct driving-port inputs and external outputs for each declared outcome and failure.

Driven-adapter contract tests exercise production implementations against local HTTP provider fixtures, real cryptographic primitives, and isolated real storage. Check request encoding and schema failures. Check permissions, atomic replacement, corrupt reads, write failures, and concurrency through the storage port's declared behavior. Reading permissions or file state here is legitimate evidence of a storage guarantee, not permission for capability tests to inspect private implementation state.

Use synthetic secrets with distinct markers to detect disclosure in stdout, stderr, and HTTP responses. Test invalid state, replay, timeout, late completion, and cleanup without live credentials or fixed sleeps. Apply [shared testing principles](project-organization.md#shared-testing-principles).
