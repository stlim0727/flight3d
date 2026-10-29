# Agent working rules

Adapted from Keepory's CLAUDE.md and docs/development/agent-working-rules.md.

- State material assumptions and resolve ambiguity that changes the deliverable;
  continue independent work while waiting for clarification.
- Prefer the simplest scoped implementation. Avoid speculative dependencies,
  abstractions, adjacent cleanup, and unrelated formatting changes.
- Define observable success before editing. Diagnose failures with a small
  reproducer and evidence before applying another guessed fix.
- Preserve existing edits, recent commits, and local conventions. Never copy whole files across worktrees or checkouts—apply only targeted diffs so that intermediate commits from other PRs are never clobbered. Inspect `git diff origin/main` before committing to verify zero accidental deletions of existing features.
- Never reset a shared worktree to investigate a baseline; use an isolated checkout if a baseline comparison is necessary.
- An untouched test can exercise changed runtime behavior. Confirm the relevant
  failure on the base before labelling it pre-existing.
- For state machines and hysteresis, describe the invariant first and test
  multi-step sequences. For pass/fail gates, check that empty output, missing
  inputs, and malformed results cannot silently earn a pass.
- Use bounded rg searches and relevant file spans. Consult configured tools and
  applicable skills before inventing a new operational script.
- Verify the behavior affected by the change. Reuse completed checks unless new
  edits, failures, or unresolved questions justify another run.
- Keep commands and task routing current when moving files or changing scripts.
  Document reusable lessons in repository files, without credentials or transient
  session details. Verify live PR, CI, and deployment state before reporting it.
- Before browser verification, follow [hardware GPU setup](browser-gpu.md).
  Pass its browser/device/renderer/drawing requirements to delegated agents;
  do not infer GPU absence from sandbox visibility or use silent software fallback.
