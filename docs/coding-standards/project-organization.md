# Project organization

Scope: all maintained TypeScript, scripts, module interfaces, and shared test principles.

## Module organization

- Start with one Bun package. The root package owns executable code, tests, and repository tooling. Create packages only for real consumers with stable shared meaning; no empty workspace or build tasks.
- Each capability lives under `src/capabilities/<name>/` and exposes a small explicit interface through `index.ts`. External callers and tests import that entry point, never private files. Keep contract declarations in `contract.ts` and behavior and Layer construction in private implementation files. Export only deliberate types, service keys, errors, functions, and Layers. No wildcard exports or implementation in the entry point.
- A module is deep when its small interface hides meaningful policy and coordination. Do not introduce wrappers that merely forward calls or ports for pure internal collaborators.
- Keep CLI, HTTP, filesystem, crypto, and provider concerns in adapters. The composition root chooses implementations. Application and domain dependencies point inward, with no cycles and no concrete-adapter imports from capabilities.
- Enforce capability entry points, dependency direction, and acyclicity mechanically in the check gate. Do not claim an enforcement tool exists before it is configured. Package export maps protect published package interfaces when applicable.
- Shared modules have explicit ownership and stable meaning used by actual consumers. Context-specific domain and persistence models stay private. Filename rules must not require architectural suffixes.
- Meaningful type-check, lint, test, architecture, and artifact checks participate in one gate. Use `bun run check`; `make ci` may delegate to it. No passing no-op tasks or gate that silently skips required checks.

## Architecture

The executable is one hexagon. Capabilities are vertical modules inside it. Every capability belongs to one bounded context and uses the language in [CONTEXT.md](../../CONTEXT.md). Domain and persistence models are private to that context; adapters translate provider contracts into local concepts. A shared domain kernel needs a documented exception.

The CLI exclusively owns its mutable local configuration and credential state. Ports declare guarantees for concurrent commands; they do not assume that separate writes or independent resources share a transaction. Resource lifetimes follow [composition ownership](composition-and-operations.md#configuration-and-lifecycle).

## Shared testing principles

- Cover each specified behavior, expected failure, invariant, and port guarantee at the narrowest public interface that owns it. Repeat a case at a wider boundary only for a distinct translation, wiring, or executable risk.
- Prefer controlled stateful adapters to mocks of private collaborators. Assert declared port effects. Interaction order is asserted only when the contract requires it.
- Tests are deterministic, independently runnable, and parallel-safe. Control time and randomness at appropriate ports, isolate files and state, use loopback listeners with isolated ports, and await observable conditions with bounded deadlines instead of fixed sleeps.
- Treat flakiness as a defect. Retries must not conceal it. Inspect remaining fibers, listeners, requests, and file handles when teardown hangs.
- Coverage and configured complexity or CRAP limits are risk backstops, not evidence of complete behavior. Do not invent thresholds or duplicate internal tests solely to increase a percentage.
- Live provider access and real credentials are not prerequisites for CI. Use synthetic provider fixtures, controlled capability adapters, real local HTTP servers, and isolated storage for the guarantees they own.

Select [capability tests](application-and-domain.md#testing), [adapter tests](adapters.md#testing), or [composition tests](composition-and-operations.md#testing) by responsibility, not by a script named unit or integration.
