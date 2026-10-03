# Behavior tests and test boundaries

## Choose the owner

| Behavior | Public test boundary |
| --- | --- |
| Missing configuration, denial policy, invalid-state decision, credential replacement policy | Capability driving port with controlled adapters |
| Argument parsing, safe output, exit mappings | CLI driving adapter |
| Callback method, path, parameters, responses, and correlation translation | Real loopback HTTP listener |
| Authorization URL and exchange encoding, response schemas, provider failure translation | Production provider adapter against local HTTP fixtures |
| Permissions, atomic writes, corrupt reads, concurrency | Production credential-store port with isolated real storage |
| Layer wiring, process termination, full synthetic login | Composition root or actual executable |

Follow [shared testing principles](../../../docs/coding-standards/project-organization.md#shared-testing-principles) and the subject-specific sections of [adapters](../../../docs/coding-standards/adapters.md#testing) and [application](../../../docs/coding-standards/application-and-domain.md#testing).

## Useful specifications

- "A mismatched callback state leaves the existing credential unchanged." Observe the rejected result and the controlled store's declared state, not a private correlation helper.
- "The authorization request contains the documented redirect URI and state." Parse the outgoing request independently at a local provider fixture. Do not build the expected URL using the production encoder.
- "Status omits stored credential contents." Seed a synthetic credential with a recognizable marker and assert the marker appears in neither stdout nor stderr.
- "Login timeout releases its listener and ignores a late callback." Await listener readiness, trigger a controlled deadline, then observe cleanup and unchanged storage. Do not sleep for a guessed startup duration.
- "Credential replacement preserves the old record when writing fails." Exercise the storage port's documented failure case and read through that port after the failure. Inspect filesystem permissions in the storage contract test because permissions are the guarantee under test.

These are scenario descriptions, not claims that particular helper APIs or fixtures already exist.

## Weak tests to replace

Tests named "calls helper twice" or assertions against private classes couple tests to structure. Assert the public effect instead. Ordering is valid only when the port explicitly promises it.

Computing expected state with the same production normalization or encoding function makes an assertion incapable of detecting that function's defect. Use a known literal or independently decoded protocol fixture.

Avoid whole-output snapshots containing dynamic paths, timestamps, or secrets. Assert stable documented output and disclosure restrictions. Wider executable tests cover a few wiring risks, not every policy branch already covered at capability level.
