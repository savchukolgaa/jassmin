---
name: create-plan
description: >-
  Create a markdown implementation plan for a GitHub issue and save it in docs/plans,
  inside the issue's own git worktree on branch issue/<number>.
  Use when the user asks to plan an issue, e.g. "/create-plan 12" or "make a plan for issue #12".
---

# Create Implementation Plan

Turn a GitHub issue into a concrete, step-by-step implementation plan saved as markdown in `docs/plans/`, following the guidelines in [docs/skills/create-plan.md](../../docs/skills/create-plan.md).

If no issue number is provided in the prompt, ask for one. Do not write any application code in this skill — only the plan.

**Worktree rule (mandatory):** All work for issue `<n>` happens on branch `issue/<n>` in its own git worktree at `<main checkout>/.claude/worktrees/issue-<n>`. Follow the worktree management procedure in [docs/skills/worktree.md](../../docs/skills/worktree.md). Never create branches with `git switch`/`git checkout` and never write or commit files in the main checkout.

## Procedure

1. **Gather context**: Read the issue and comments with `gh issue view`, check dependency issues, and explore codebase patterns and conventions as detailed in [docs/skills/create-plan.md](../../docs/skills/create-plan.md). Resolve open questions against the codebase before asking.
2. **Prepare the worktree**: Follow the worktree preparation steps in [docs/skills/worktree.md](../../docs/skills/worktree.md) to set up `$MAIN/.claude/worktrees/issue-$N` on branch `issue/<number>`.
3. **Write the plan**: Save the plan as `$WT/docs/plans/<number>-<short-kebab-slug>.md` using the template and guidelines in [docs/skills/create-plan.md](../../docs/skills/create-plan.md). If a plan already exists, update it.
4. **Commit and report**:
   - Commit only the plan file in the worktree:
     ```bash
     git -C "$WT" add docs/plans/<number>-<slug>.md
     git -C "$WT" commit -m "Add implementation plan for #<number>"
     ```
   - Report the plan path, branch, worktree path, step summary, resolved questions (with citations), and any open questions with recommended defaults. Suggest `/implement <number>` as the next step.
