# Application and domain

Scope: authentication capabilities, policy, application-owned ports, and their tests.

## Effect and dependencies

- Use Effect for effectful application operations, typed dependencies, composition, and lifetimes. Pure values and calculations remain ordinary TypeScript.
- Each injected port has an application-owned TypeScript interface and a colocated, namespaced Effect service key. Use the public service declaration API of the installed Effect version consistently. Adapters explicitly implement the interface. Do not add unrelated dependency containers, separate global tokens, or property injection.
- Layers construct implementations and resolve their dependencies. Port operations expose their semantic contract, not adapter construction requirements. Application and domain code neither create nor run runtimes, read environment variables, nor resolve global service locators.
- Composition selects implementations; driving adapters execute application effects at the external boundary. Do not add a service for a pure calculation just to use dependency injection.

## Outcomes and failures

Represent expected decisions as explicit values, including missing configuration, no stored credential, provider denial, and rejected callback correlation. Use a discriminated union when callers must distinguish outcomes, not a redundant result wrapper.

Technical failures that prevent completion use application-owned tagged errors in Effect's typed error channel. Unexpected programmer defects remain defects. Retain underlying causes only as opaque diagnostic context. Application policy must not branch on vendor errors, schema-library internals, or error message text.

## Ports and guarantees

Ports describe purposeful operations in the consuming capability's language at genuine external-effect or technology boundaries. Keep provider wire DTOs, HTTP objects, filesystem handles, and storage formats out of them.

State observable guarantees explicitly: credential replacement atomicity, collision and overwrite behavior, callback correlation and single consumption, request deadlines, cancellation, and safe status disclosure. Production and controlled adapters satisfy the same contract.

The application declares required atomicity; adapters implement write, locking, and transaction mechanics. Never assume independent ports share a transaction or claim atomicity between provider exchange and local persistence. Report a storage failure honestly when exchange succeeded but storage did not. Decide recovery from the protocol's retry rules, not an assumed replay-safe code exchange.

## Domain policy

- Choose language-only DDD unless an entity, value object, or aggregate protects a real invariant. [CONTEXT.md](../../CONTEXT.md) records language rather than implementation patterns.
- Construction and transitions enforce policy invariants. Defaults and normalization have one owner; use resolved values instead of reimplementing them in callers.
- Accept authorization only for the active correlated attempt. Provider identity and credential claims require validation under the documented protocol. A callback parameter alone never establishes an authenticated principal.
- Failures and rejected callbacks must not overwrite existing valid credentials. Key replacement and destructive reconfiguration require an explicit policy.
- Bound caller-controlled durations, sizes, and outstanding work at the owner of the constrained operation. Adapters additionally enforce protocol-specific limits.
- Prefer explicit calls and transition results. No internal event bus to conceal login control flow; event sourcing is a separate decision.

## Testing

Capability tests call the public driving port and observe results and declared driven-port effects through controlled adapters. Test the whole capability, not private classes. Cover configuration absence, successful authentication, denial, invalid state, deadline handling, and storage or provider failures where that policy lives.

Focused tests of substantial pure policy decision tables are appropriate through deliberate public interfaces. Do not export implementation details for tests or repeat the same matrix at every boundary. Apply [shared testing principles](project-organization.md#shared-testing-principles).
