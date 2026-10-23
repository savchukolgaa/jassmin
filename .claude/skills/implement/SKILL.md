---
name: implement
description: Implement a GitHub issue by following its implementation plan in docs/plans, working in the issue's own git worktree and committing to branch issue/<number>, then push. Use when the user asks to implement an issue, e.g. "/implement 12".
argument-hint: "<issue number>"
---

# Implement Issue From Plan

Implement GitHub issue `#$ARGUMENTS` by following its plan in `docs/plans/`.

If no issue number is given, ask for one.

**Worktree rule (mandatory):** all work for issue `<n>` happens on branch `issue/<n>` in its own git worktree at `<main checkout>/.claude/worktrees/issue-<n>`. Never edit, build, stage or commit in the main checkout, and never switch the main checkout's branch. See `AGENTS.md` → "Workflow".

## 1. Enter the issue's worktree

Set `N` to the issue number and resolve the paths from the main checkout (first entry of `git worktree list`):

```bash
MAIN=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
WT="$MAIN/.claude/worktrees/issue-$N"
git -C "$MAIN" fetch origin
git -C "$MAIN" worktree list
```

1. If a worktree for `issue/$N` already exists, use its path as `WT`.
2. Otherwise create one: from the local branch `issue/$N` if it exists (`git -C "$MAIN" worktree add "$WT" "issue/$N"`), else from the remote branch (`git -C "$MAIN" worktree add --track -b "issue/$N" "$WT" "origin/issue/$N"`). If neither exists, there is no plan yet — stop and suggest `/create-plan $N`.
3. Check `git -C "$WT" branch --show-current` prints `issue/$N`, and that `git -C "$WT" status` is clean apart from intentionally untracked/ignored files.
4. Prepare the worktree once: if `$WT/.env` is missing, copy it from `$MAIN/.env` (never commit it); run `pnpm install` in `$WT`.

From here on, run every command with `$WT` as the working directory (or `git -C "$WT"`, `pnpm --dir "$WT"`), and use absolute paths under `$WT` for every file you read or edit.

## 2. Load the plan and issue

1. Find the plan: `$WT/docs/plans/$N-*.md`. If none exists, stop and suggest running `/create-plan $N` first.
2. Read the whole plan, then the issue (`gh issue view $N --json title,body,comments`) to check nothing changed since the plan was written. If the issue now contradicts the plan, tell the user and update the plan before coding.
3. Check the plan's **Open questions**. First check whether the code, the issue comments or the user have answered any of them since the plan was written; if so, move them to **Resolved questions** with the source. For questions still open that materially change the implementation, ask the user before starting; otherwise proceed with the recommended default and say so in your final report. Record every answer in the plan.

## 3. Implement step by step

For each unchecked step in the plan, in order:

1. Implement it in `$WT`, following the codebase's conventions (`AGENTS.md` and the scoped `AGENTS.md` of the folders you touch):
   - Full-stack SSR with React Router (framework mode): `loader`s for reads, `action`s for writes, server-only code under `app/.server/`, generated route types (`./+types/<route>`).
   - Strict TypeScript, no `any`.
   - Validate all `action` input (zod) and use DB transactions where data integrity matters.
   - Add or update tests for the behaviour you add.
   - Use pnpm only (`pnpm add`, `pnpm <script>`); install new dependencies at their latest version unless the plan says otherwise.
2. Verify the step as the plan describes (`pnpm typecheck`, `pnpm lint`, `pnpm test`, or running the app).
3. Tick the step's checkbox in the plan file (`- [ ]` → `- [x]`).
4. Commit the step's files together with the updated plan **on `issue/$N` in the worktree**, staging paths explicitly (never `git add -A` / `git add .`). Use a clear imperative message that references the issue, e.g. `Add catalog loader with gender filter (#8)`. Include any commit attribution trailer your instructions require.

If you have to deviate from the plan (a step is wrong, missing or needs splitting), update the plan file to match what you actually did and note why under "Decisions & assumptions". Don't silently diverge.

If you get blocked (missing dependency, failing test you can't fix, decision only the user can make), stop, commit the completed work to `issue/$N`, and tell the user exactly what is blocking.

## 4. Final verification

1. In `$WT`, run the full checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. All must pass; fix failures before finishing.
2. Go through the plan's **Acceptance criteria** and tick each one you have verified. Leave unverified ones unticked and say why.
3. Set the plan's `Status:` line to `Implemented` and commit the plan.

## 5. Push and report

1. Push the branch: `git -C "$WT" push -u origin "issue/$N"`.
2. Report to the user: what was implemented, the commits made on `issue/$N`, the worktree path, the results of the checks (with any failures quoted exactly), any acceptance criteria not verified, and any deviations from the plan. Suggest `/open-pr $N` as the next step. Do not open the PR yourself unless asked.
