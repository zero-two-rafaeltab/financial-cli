---
name: tdd
description: Use when adding CLI behavior or regression coverage. Run one public-interface red-green-refactor slice at a time.
---

# Test-driven development

## Establish the seam

Read [CONTEXT.md](../../../CONTEXT.md) and select applicable [coding standards](../../../CODING_STANDARDS.md). A seam is the public interface at which behavior can be observed without importing private implementation.

Record the owning seam for each behavior before writing the test. Reuse the initial approved CLI, HTTP authorization and callback, failure, timeout, and storage boundaries. Ask for confirmation when introducing a new seam or materially changing an approved interface, not for each additional test at an agreed seam.

Use [tests](tests.md) for boundary selection and examples, and [controlled adapters](mocking.md) for dependencies. These local references replace dependencies on separate testing or module-design skills.

## Run the loop

1. Write one behavior test through the approved public interface. Choose an independent expected result from the specification or a known fixture.
2. Run the focused test. Confirm it fails for the missing behavior, not a broken import, runner, fixture, or unrelated setup issue. Record the observed red result.
3. Implement only enough behavior to make that test pass. Run it and record green.
4. Refactor small private details while green, rerunning relevant tests. Interface redesign or broad restructuring requires review and renewed seam agreement where applicable.
5. Repeat for the next behavior. Before delivering, run the complete repository gate under [do-work](../do-work/SKILL.md).

## Keep tests useful

Test outcomes and declared port effects, never private method calls or implementation-specific ordering. A refactor with unchanged behavior should not require rewritten assertions.

Avoid tautological assertions that repeat the production algorithm. Avoid writing all tests before all implementation. One vertical slice teaches the next; adding future features to satisfy imagined tests defeats that feedback.

One test may assert multiple observations of the same behavior, such as rejection plus unchanged credentials. Cover each specified failure and invariant at its owning boundary without duplicating the full matrix at wider boundaries.

A bug fix starts with a reproduction that fails before the fix. Documentation-only work validates links and consistency instead of inventing runtime tests.
