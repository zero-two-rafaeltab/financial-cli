# Upstream provenance

Imported for [issue #10](https://github.com/zero-two-rafaeltab/financial-cli/issues/10) on 2026-10-03.

- Canonical repository: [mattpocock/skills](https://github.com/mattpocock/skills), owned by [Matt Pocock](https://github.com/mattpocock).
- Pinned revision: [`d81f3a183412e71a5b1e84ca21bc1a35eea03a60`](https://github.com/mattpocock/skills/commit/d81f3a183412e71a5b1e84ca21bc1a35eea03a60), committed 2026-09-29.
- Source directory: [`skills/engineering/code-review`](https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/code-review).
- License: upstream MIT notice retained in [LICENSE](LICENSE).

## Verification and inventory

Verified the public GitHub owner profile identifies Matt Pocock, and the pinned repository README links its code-review entry directly to the source directory above. Enumerated that directory using GitHub's recursive Git tree and checked out the pinned revision in a temporary clone. The directory contains exactly two files; both were imported. No installer or global/profile configuration was used.

Original byte hashes (SHA-256, before adaptation):

| Upstream file | SHA-256 |
| --- | --- |
| `skills/engineering/code-review/SKILL.md` | `47f4e52c21694def9c7c11cbfbf891ca35eac7a93e395797515be3c8a409ae50` |
| `skills/engineering/code-review/agents/openai.yaml` | `8229ca854e11dc8e6aef2131ee03f31fb1561cf905fab9ccc325180cf3331352` |
| `LICENSE` | `0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5` |

The upstream skill instructions, UI metadata, license, and upstream explanatory code-review document were inspected before invocation. The original skill has no bundled scripts or further relative resources. Its external setup dependency on `docs/agents/issue-tracker.md` is replaced locally below.

## Repository adaptations

- Replace the upstream tracker/setup reference with this repository's assigned GitHub issue and `gh issue view`; no setup skill or unrelated tracker integration is installed.
- Resolve standards through [CODING_STANDARDS.md](../../../CODING_STANDARDS.md), its [authority rules](../../../docs/coding-standards/maintaining-guidelines.md), and [CONTEXT.md](../../../CONTEXT.md). Link local [do-work](../do-work/SKILL.md) and [tdd](../tdd/SKILL.md) without duplicating their rules.
- Specify the committed boundary for do-work: pin both endpoints, retain three-dot merge-base semantics, exclude uncommitted changes, and give both read-only reviewers the same scope. Prevent recursive review delegation and incidental publication.
- Add a single do-work delivery paragraph invoking the imported skill after an authorized commit and before publication.

Frontmatter, UI metadata, all twelve smell heuristics, separate parallel Standards/Spec prompts, and separate aggregation remain upstream's. [EVIDENCE.md](EVIDENCE.md) records validation; these provenance and evidence files are local additions.

## Entrypoint coordination

[Issue #6](https://github.com/zero-two-rafaeltab/financial-cli/issues/6) owns the protected `AGENTS.md` entrypoint. Its authorized owner should link `.agents/skills/code-review/SKILL.md` alongside the existing do-work/TDD links. This import does not create or edit that entrypoint. Native repository skill discovery and the do-work link provide invocation independently of that follow-up.
