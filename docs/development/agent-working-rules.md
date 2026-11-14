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
- Keep task worktrees with uncommitted work under the repository's `.worktrees/`
  (or another persistent authorized workspace), not `/tmp`. Checkpoint validated
  changes before long verification; temporary artifacts may stay in ignored caches.
- An untouched test can exercise changed runtime behavior. Confirm the relevant
  failure on the base before labelling it pre-existing.
- For state machines and hysteresis, describe the invariant first and test
  multi-step sequences. For pass/fail gates, check that empty output, missing
  inputs, and malformed results cannot silently earn a pass.
- Use bounded rg searches and relevant file spans. Consult configured tools and
  applicable skills (`npm run wt:new`, `npm run pr:arc`, `npm run pr:mac`,
  `scripts/lib/browserHarness.mjs`) before inventing a new operational script or
  polling ports/PRs in a shell loop.
- Do not retry the same failing approach or browser script past two attempts without
  isolating the cause in a small reproducer. Keep transient screenshots and JSON
  dumps in ignored directories (`.tmp/`, `.cache/`, `review-artifacts/`).
- Give potentially long commands both per-step and overall deadlines where
  supported. A starting budget for a bounded browser probe is 30 s for GPU
  preflight, 20 s per CDP command and 180 s overall; increase only for a measured,
  named stage and explain the reason. For example on Linux:
  `timeout --signal=TERM --kill-after=10s 180s env GPU_ANGLE=vulkan CHROME_PATH=/home/stlim/.local/bin/chrome-headless node scripts/verify-missile-seeker.mjs`.
  A timeout is incomplete evidence, never a pass. Inspect logs, reduce the probe
  and diagnose before retrying; do not repeatedly extend the deadline blindly.
- Keep processes task-owned and clean them up on normal completion and failure.
  Save stage/result logs to the worktree cache so an interrupted tool session
  does not erase the evidence. Inspect partial effects before restarting.
- During active work, send a meaningful update at least once per minute, including
  slow checks and recovery. Use short tool yields; an overall process deadline
  does not justify a long silent wait. Report timeout/blocker and next action.
- Locate before reading: `rg -n '<symbol>'` then read only the matching span. Do not
  `cat` files beyond roughly 200 lines; oversized tool output is summarized into
  artifacts and then paid for a second time when it is read back.
- A new browser probe should return its raw shape or diagnostics on the first run,
  so the second run is the assertion run and GPU minutes are not spent guessing.
- `npm run pr:mac` waits for pending checks and merges in one call. Do not poll
  `gh pr checks` from separate turns.
- Verify the behavior affected by the change. Avoid running the long full test suite
  (`npm test`) locally when almost identical tests run in remote CI. Run fast focused unit
  tests (`node --test tests/<name>.test.js`) and syntax checks (`npm run check`) locally,
  and boldly push to let CI test verify it. Reuse completed checks unless new edits, failures,
  or unresolved questions justify another run.
- Keep commands and task routing current when moving files or changing scripts.
  Document reusable lessons in repository files, without credentials or transient
  session details. Verify live PR, CI, and deployment state before reporting it.
- For missile realism, maintain Done / In progress / Todo in GitHub issue #713.
  Update it when implementation starts and after merge; link PRs, detailed docs,
  actual checks and limits. Mark bounded delivered scope done, not the full S3/S4
  milestone when only one part is implemented. Keep roadmap status authoritative
  in that issue rather than duplicating unchecked lists across documents.
- Before browser verification, follow [hardware GPU setup](browser-gpu.md).
  Pass its browser/device/renderer/drawing requirements to delegated agents;
  do not infer GPU absence from sandbox visibility or use silent software fallback.
