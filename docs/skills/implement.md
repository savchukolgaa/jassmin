# Implementation Workflow Guidelines

This document defines the execution workflow for implementing a GitHub issue according to its plan in `docs/plans/`.

## Prerequisites

- Work happens exclusively in the issue's dedicated git worktree at `.claude/worktrees/issue-<number>`.
- See [worktree.md](./worktree.md) for worktree preparation and directory resolution.
- A plan must exist at `$WT/docs/plans/<number>-*.md`. If not found, stop and suggest running `/create-plan <number>`.

## Step-by-Step Implementation Loop

For each unchecked step in the plan (`- [ ]`), in order:

1. **Implement the step in `$WT`**:
   Follow project architectural standards (`AGENTS.md` and scoped guidelines):
   - **Full-stack SSR with React Router**: loaders for reads, actions for writes, generated route types (`import type { Route } from "./+types/<route>"`).
   - **Server Isolation**: server code exclusively in `app/.server/`. Never import server modules from client code.
   - **Type Safety**: strict TypeScript, no `any`, handle nullable types.
   - **Input Validation**: validate all route action inputs using zod; return typed action errors for invalid inputs instead of throwing unhandled exceptions.
   - **Data Integrity**: use transactions (`db.transaction(async (tx) => ...)`) whenever multiple writes must succeed together.
   - **Testing**: write or update Vitest tests (`*.test.ts`) alongside the implementation code.
   - **Dependencies**: use pnpm only (`pnpm add`, `pnpm --dir "$WT" <command>`).
2. **Verify the step**:
   Execute the verification checks outlined in the plan:
   ```bash
   pnpm --dir "$WT" typecheck
   pnpm --dir "$WT" lint
   pnpm --dir "$WT" test
   ```
3. **Update plan status**:
   Mark the step complete in the plan file (`- [ ]` → `- [x]`).
4. **Commit the step**:
   Stage only the step's files and the updated plan file (never use `git add -A` or `git add .`):
   ```bash
   git -C "$WT" add <changed-file-1> <changed-file-2> docs/plans/<number>-<slug>.md
   git -C "$WT" commit -m "<Imperative message referencing issue> (#<number>)"
   ```

## Handling Blockers & Plan Deviations

- **Plan Deviations**: If a step needs adjustments, additions, or splitting, update the plan file in the worktree to reflect reality and record the reasoning under `Decisions & assumptions`. Never silently diverge.
- **Blockers**: If blocked by missing dependencies, external requirements, or difficult failures, commit completed work to `issue/<number>` and report the blocking issue with exact details to the user.

## Final Verification Checklist

Before finishing:

1. In `$WT`, run all quality checks:
   ```bash
   pnpm --dir "$WT" typecheck
   pnpm --dir "$WT" lint
   pnpm --dir "$WT" test
   pnpm --dir "$WT" build
   ```
   All checks must pass cleanly. Fix any errors before proceeding.
2. Review the plan's **Acceptance criteria** checklist and tick each verified criterion. Leave unverified items unchecked and document why.
3. Update the plan status to `Status: Implemented` and commit the plan file.

## Pushing the Branch

Push the branch to origin:
```bash
git -C "$WT" push -u origin "issue/$N"
```

Once the branch has a pull request, every push runs the same checks in CI ([docs/ci.md](../ci.md)), including the database tests against PostgreSQL and a check that no test was skipped. Local checks still come first; CI doesn't replace them.

Report progress, commits made on `issue/<number>`, verification check results, and suggest `/open-pr <number>` as the next step.
