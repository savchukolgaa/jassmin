---
name: implement
description: Implement a GitHub issue by following its implementation plan in docs/plans, working in the issue's own git worktree and committing to branch issue/<number>, then push. Use when the user asks to implement an issue, e.g. "/implement 12".
argument-hint: "<issue number>"
---

# Implement Issue From Plan

Implement GitHub issue `#$ARGUMENTS` by following its plan in `docs/plans/` and the workflow in [docs/skills/implement.md](../../docs/skills/implement.md).

If no issue number is given, ask for one.

**Worktree rule (mandatory):** all work for issue `<n>` happens on branch `issue/<n>` in its own git worktree at `<main checkout>/.claude/worktrees/issue-<n>`. Follow [docs/skills/worktree.md](../../docs/skills/worktree.md). Never edit, build, stage or commit in the main checkout, and never switch the main checkout's branch.

## Procedure

1. **Enter the issue's worktree**: Follow [docs/skills/worktree.md](../../docs/skills/worktree.md) to locate or initialize `$MAIN/.claude/worktrees/issue-$N` on branch `issue/$N`. If neither the local nor remote branch exists, stop and suggest `/create-plan $N`. Link `$WT/.env` and `$WT/cms/.env` to the main checkout's if missing (`node "$WT/scripts/link-env.mjs" "$WT"`, see worktree.md) and run `pnpm install` in `$WT`.
2. **Load the plan and issue**: Find the plan at `$WT/docs/plans/$N-*.md`. Read the whole plan, then the issue (`gh issue view $N --json title,body,comments`) to check nothing changed. Handle open questions as specified in [docs/skills/implement.md](../../docs/skills/implement.md).
3. **Implement step by step**: For each unchecked step in the plan, follow the implementation and verification loop in [docs/skills/implement.md](../../docs/skills/implement.md):
   - Adhere to codebase conventions (React Router SSR, `app/.server/`, strict TS, zod input validation, transactions, tests).
   - Verify the step with `pnpm typecheck`, `pnpm lint`, `pnpm test`.
   - Tick the step's checkbox (`- [x]`).
   - Commit the step's files together with the updated plan on `issue/$N` in `$WT`.
4. **Final verification**: In `$WT`, run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Tick verified acceptance criteria, set the plan's `Status:` line to `Implemented`, and commit the plan.
5. **Push and report**:
   - Push the branch: `git -C "$WT" push -u origin "issue/$N"`.
   - Report to the user: what was implemented, commits made, worktree path, check results, unverified criteria, and deviations. Suggest `/open-pr $N` as the next step.
