# Validation evidence

Sanitized evidence for [issue #10](https://github.com/zero-two-rafaeltab/financial-cli/issues/10), recorded 2026-10-03. Repository-relative paths replace host paths. No credentials, private identifiers, or raw agent/session logs are included.

## Packaging and discovery

- Ran skill-creator's `quick_validate.py .agents/skills/code-review`: exit 0, `Skill is valid!`.
- Parsed YAML frontmatter and `agents/openai.yaml`; confirmed the skill name and description, display name, and supported short-description length. Compared upstream bytes: frontmatter, UI metadata, MIT license, all twelve smell heuristics, parallel reviewer prompts, and separate aggregation are preserved.
- Checked Markdown relative destinations and heading anchors in the imported skill's documents and the modified do-work entrypoint. External source links identify the pinned upstream and public issues.
- Used installed `codex-cli 0.160.0`, starting a temporary stdio app-server process, sending `initialize`, `initialized`, then `skills/list` with `cwds: [<repository>]` and `forceReload: true`. No model turn, installation, profile edit, or credential change was needed. Terminated the process after the response. This exercises the native discovery API described in [Codex App Server](https://learn.chatgpt.com/docs/app-server).

Selected response fields, with the path normalized relative to the repository:

```json
{
  "name": "code-review",
  "path": ".agents/skills/code-review/SKILL.md",
  "scope": "repo",
  "enabled": true,
  "interface": {
    "displayName": "Code Review",
    "shortDescription": "Review a diff on standards and spec"
  },
  "errors": []
}
```

The local discovery result verifies the installed Codex tooling, not every coding agent. [Issue #6](https://github.com/zero-two-rafaeltab/financial-cli/issues/6) still owns adding the protected `AGENTS.md` links; [do-work](../do-work/SKILL.md) now links this skill directly.

## Real diff exercise boundary

Read the imported instructions before using them. Chose the existing single-commit storage fix and supplied [issue #8](https://github.com/zero-two-rafaeltab/financial-cli/issues/8) as its spec; fetched its body using `gh issue view 8 --json title,body,url`.

```text
fixed point: a5a1139f07d21416bcbd5c9cd713be10f72e64d2
head:        0e4df33445384923570b0eb32a253a3202214736
merge-base:  a5a1139f07d21416bcbd5c9cd713be10f72e64d2
git diff a5a1139f07d21416bcbd5c9cd713be10f72e64d2...0e4df33445384923570b0eb32a253a3202214736
git log a5a1139f07d21416bcbd5c9cd713be10f72e64d2..0e4df33445384923570b0eb32a253a3202214736 --oneline
0e4df33 fix: use private default storage without XDG exports
files: README.md, src/cli.ts, src/storage/local.ts, tests/cli.test.ts
4 files changed, 225 insertions(+), 21 deletions(-)
diff SHA-256: d56b1df9c4e519d8c69f76489564522705e63241dbfe1613217bb60c969abfcf
```

Validated the refs and non-empty diff before launching two parallel reviewers with fresh contexts. Both received the same immutable diff command and commit list. The Standards reviewer received authoritative standards paths and the complete smell baseline; the Spec reviewer received the assigned issue body. Both were instructed to remain read-only, exclude uncommitted skill work, and avoid recursive delegation. Findings are recorded independently below, without merging or ranking across axes.

## Standards

- **Documented-standard breach, `tests/cli.test.ts:125`:** `run()` awaits stdout, stderr, and `proc.exited` without a bounded subprocess deadline or cleanup on failure. A stalled command can leave its child running after the test runner times out. The shared testing principles in `docs/coding-standards/project-organization.md` require bounded deadlines when awaiting observable conditions; composition testing requires executable termination. Add a bounded deadline and terminate/reap the child in cleanup.
- **Heuristic — Repeated Switches, `tests/cli.test.ts:16`:** The `override` discriminator controls config paths, state paths, environment fields, and absence assertions. Consider explicit table rows with overrides and expected locations, preserving independent expectations. This is a readability judgement, not a hard violation.
- **Heuristic — Mysterious Name, `tests/cli.test.ts:18`, `:57`, `:88`, `:168`:** `f` does not describe its isolated home/environment fixture. `homeFixture` would clarify setup and cleanup. This is a naming judgement, not a documented prohibition.

No substantiated breach or smell in the storage translation, composition default selection, help, or README changes. Filesystem error translation stays inside the storage adapter with typed safe failures and scoped acquisition. The committed snapshot cannot establish red-green workflow history; no workflow violation is inferred.

## Spec

- **Partial acceptance evidence — certificate discovery:** Issue #8 asks that the “existing certificate is discoverable without touching the private key.” The fixture at `tests/cli.test.ts:146` seeds only `private.pem`; the no-XDG test checks unchanged key contents without creating or discovering a certificate. README documents directories but does not identify `certificate.pem` or retrieving an existing certificate. Its certificate instructions still use `auth keygen`, which rejects existing credentials. Document certificate discovery and cover it with synthetic credentials. This is a documentation/coverage gap, not evidence that the stored certificate is inaccessible.
- **External acceptance remains unverified:** Issue #8 asks to “Reuse the already-generated signing key without regeneration or migration.” Synthetic fixtures prove preservation of a key already placed at the new default location, but cannot establish the location of the operational key. No real credentials or machine configuration were inspected. This is unverified external acceptance, not a confirmed implementation defect.

No scope creep or confirmed wrongly implemented requirement was found. Defaults, independent overrides, ancestry checks, and access/lock diagnostics match the spec. The Spec reviewer independently verified the pinned commit's successful [Check workflow](https://github.com/zero-two-rafaeltab/financial-cli/actions/runs/37144625249).

Standards: 3 findings, worst is unbounded subprocess cleanup; Spec: 2 findings, worst implementation evidence gap is certificate discovery. The external acceptance limit remains separate from implementation defects.

## Integrity and checks

Re-read cited hunks and standards before recording the reports. Findings are review leads; no changes to the reviewed implementation or other issues were made. Compared SHA-256 hashes of all four reviewed working-tree files before and after review: identical. Recomputed the pinned diff hash: identical.

Exercised preflight checks separately: an invalid commit reference was rejected, and `git diff 0e4df33...0e4df33` was empty. Neither case launched reviewers. This verifies boundary checks, not a new automated skill runner.

Executed `bun install --frozen-lockfile` using existing dependencies, then `bun run check` with Bun 1.4.2. TypeScript, Biome (22 files), and architecture checks passed; Bun reported **42 pass, 0 fail, 402 assertions across 5 files**. No Markdown formatter is configured. Also ran `git diff --check` and relative-link validation. CI status for this import belongs in its PR; the older workflow above pertains only to the exercise snapshot.
