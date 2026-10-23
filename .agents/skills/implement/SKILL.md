---
name: implement
description: >-
  Implement a GitHub issue by following its implementation plan in docs/plans,
  working in the issue's own git worktree and committing to branch issue/<number>, then push.
  Use when the user asks to implement an issue, e.g. "/implement 12".
---

# Implement Issue From Plan

Implement a GitHub issue by following its plan in `docs/plans/` and the workflow in [docs/skills/implement.md](../../docs/skills/implement.md).

If no issue number is provided in the prompt, ask for one.

**Worktree rule (mandatory):** All work for issue `<n>` happens on branch `issue/<n>` in its own git worktree at `<main checkout>/.claude/worktrees/issue-<n>`. Follow [docs/skills/worktree.md](../../docs/skills/worktree.md). Never edit, build, stage or commit in the main checkout, and never switch the main checkout's branch.

## Procedure

1. **Enter worktree**: Resolve and prepare the worktree at `$MAIN/.claude/worktrees/issue-$N` following [docs/skills/worktree.md](../../docs/skills/worktree.md). Verify `$WT/.env` exists (copy from `$MAIN/.env` if missing) and install dependencies (`pnpm install`).
2. **Load plan and issue**: Find `$WT/docs/plans/$N-*.md` (if none exists, stop and suggest `/create-plan $N`). Read the plan and latest issue on GitHub (`gh issue view $N`). Address open questions per [docs/skills/implement.md](../../docs/skills/implement.md).
3. **Implement step by step**: Execute each unchecked step in the plan, adhering to the architectural standards and step verification loop in [docs/skills/implement.md](../../docs/skills/implement.md):
   - Strict TypeScript, route loaders/actions, server isolation (`app/.server/`), zod validation, DB transactions, Vitest tests.
   - Run verification per step (`pnpm typecheck`, `pnpm lint`, `pnpm test`).
   - Tick the plan step checkbox (`- [x]`).
   - Commit step files together with the updated plan on `issue/$N` in `$WT`.
4. **Final verification**: In `$WT`, run full checks (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`), verify acceptance criteria, set plan status to `Status: Implemented`, and commit the plan.
5. **Push and report**: Push the branch (`git -C "$WT" push -u origin "issue/$N"`), report commits and check results, and suggest `/open-pr $N` as the next step.
