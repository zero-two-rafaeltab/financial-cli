# Maintaining guidelines

Scope: authority, organization, and maintenance of this collection.

## Authority and applicability

[CODING_STANDARDS.md](../../CODING_STANDARDS.md) indexes the authoritative semantic coding rules. All applicable rules bind the required end state, including existing code touched by a change. Applicability follows responsibility, not directory alone.

Repository-local [do-work](../../.agents/skills/do-work/SKILL.md) and [tdd](../../.agents/skills/tdd/SKILL.md) govern execution workflow. Examples and historical plans do not add standards unless explicitly adopted here. Read only the topics needed for the task, while checking all applicable rules before finishing.

## Maintenance

- Keep the root document an index. Give each rule one authoritative home and use contextual links elsewhere.
- State each document's scope. Keep testing guidance beside the behavior it tests, with shared principles in project organization.
- Split documents for cohesive groups of substantial rules, not merely for every architectural label.
- Put formatting, imports, and mechanically checkable TypeScript settings in tool configuration. Document semantic constraints here even when tools enforce them.
- Identify substantive policy changes explicitly. Reorganization must not silently weaken a rule.
- Keep relative links and heading anchors valid. Examples must use synthetic data and portable repository-relative paths.

## Provenance and adaptation

This collection adapts an existing TypeScript application's capability-oriented hexagonal coding standards and repository-local implementation and TDD workflows. It retains deep public modules, inward dependencies, application-owned Effect ports, typed failures, boundary validation, scoped resource ownership, and behavior-first testing.

The target is one Bun CLI, not a distributed monorepo. Workspace orchestration becomes one meaningful package-level check gate. Broker delivery, stream retention, event-fed projections, web UI testing, and browser video attachments are outside scope. Their underlying ownership and reliability concerns become local credential integrity, bounded authorization requests, and callback cleanup.

CLI output replaces public web API response conventions. Diagnostics remain secret-safe and telemetry is opt-in, with no collector or monitoring deployment requirement. Complexity and coverage checks apply when configured; this adaptation does not invent a numeric CRAP threshold.

The source workflow disagreed about whether refactoring belongs in TDD. Here small behavior-preserving refactors are allowed after green; larger interface changes belong to review and renewed seam agreement. Existing approved seams are reused rather than re-requested for every test. PR publication remains subject to task authorization, and terminal evidence replaces browser recordings.
