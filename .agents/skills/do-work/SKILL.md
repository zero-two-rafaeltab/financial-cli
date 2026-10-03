---
name: do-work
description: Use when implementing a task or fixing CLI behavior. Deliver small tested increments with verified evidence.
---

# Do work

## 1. Understand

Read [CONTEXT.md](../../../CONTEXT.md), the assigned specification or issue, and relevant existing code. Use [CODING_STANDARDS.md](../../../CODING_STANDARDS.md) to select rules for the responsibilities touched. Respect concurrent file ownership and explicit restrictions.

Identify acceptance criteria, approved test seams, and side effects. The initial authentication seams are already approved in the context. Ask only about genuinely unresolved scope or new seams. Done when every requirement has an owning interface and an observable check.

## 2. Plan

Plan small behavior slices and their checks. Discover actual Bun scripts and Make targets; do not copy monorepo commands. Use [validation and delivery](validation-and-delivery.md) when choosing the complete gate and publication evidence.

Done when each slice can be tested and reviewed independently, and the full validation command is known or its absence reported as a blocker.

## 3. Implement incrementally

Load [tdd](../tdd/SKILL.md). For each code behavior change, run one meaningful red test, implement the minimum change, run green, and refactor only while green. Use the agreed public interface and preserve port guarantees.

Run relevant checks and configured formatting after each increment. Commit a small tested increment only when the task authorizes commits. If commits are prohibited, leave focused uncommitted changes and report them. Do not stage others' work.

Documentation-only changes need consistency and link validation, not artificial behavioral tests. A task limited to docs must not create package or code files merely to add a check gate.

## 4. Validate

Run the full existing `bun run check`, or `make ci` if it delegates to the same gate. Confirm the gate covers all configured type, lint, architecture, test, and artifact checks. Fix failures or report exact blockers; a narrower passing test is not a substitute.

Exercise the changed CLI path using synthetic inputs and isolated storage. For login, use a local provider fixture, never a real account by default. Done when acceptance criteria are exercised and the executed commands, results, and remaining limits are recorded.

## 5. Deliver within authorization

After an authorized commit and before publication, invoke [code-review](../code-review/SKILL.md) with the assigned issue and an explicit fixed point recorded before the work (for example, the starting commit or PR base). Review the committed diff on separate Standards and Spec axes. If commits are prohibited, report the excluded uncommitted work instead of claiming it was reviewed. Address findings within the task's scope and rerun affected checks.

Follow [validation and delivery](validation-and-delivery.md). Report changed files, verified behavior, actual checks, and blockers. Publish only when authorized. PR evidence is a redacted terminal transcript or automated CLI result, not a browser video.
