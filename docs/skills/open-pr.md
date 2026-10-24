# Open Pull Request Guidelines

This document defines the process for opening a GitHub pull request from an implemented issue branch.

## Prerequisites & Worktree Isolation

- The pull request branch is `issue/<number>`.
- All git operations take place within the issue's worktree at `.claude/worktrees/issue-<number>`.
- See [worktree.md](./worktree.md) for path resolution.
- Never open a PR from `main`.
- Check if a PR already exists:
  ```bash
  gh pr list --head "issue/$N" --state open
  ```
  If one exists, return its URL to the user rather than creating a duplicate.

## Pre-PR Readiness & Plan Removal

1. **Verify working tree status**:
   Run `git -C "$WT" status`. Ensure there are no uncommitted changes. (Ignore `.env` or other git-ignored local files).
2. **Review diff and commits**:
   ```bash
   git -C "$WT" fetch origin
   git -C "$WT" log --oneline origin/main..HEAD
   git -C "$WT" diff --stat origin/main...HEAD
   ```
   Ensure no extraneous or unrelated files are included.
3. **Verify plan completion**:
   Read `$WT/docs/plans/$N-*.md`. Confirm `Status: Implemented` and all steps / acceptance criteria are satisfied. If incomplete, consult the user (or create a draft PR with `--draft`).
4. **Remove the implementation plan**:
   **Implementation plans must NOT be merged into `main`.**
   Remove the plan file and record the hash of the commit immediately before removal:
   ```bash
   git -C "$WT" rm docs/plans/<number>-<slug>.md
   git -C "$WT" commit -m "Remove implementation plan for #<number>"
   PREV_HASH=$(git -C "$WT" rev-parse HEAD~1)
   git -C "$WT" push -u origin "issue/$N"
   ```

## Pull Request Body Template

Write the PR body to a temporary file outside the repository using this structure:

```markdown
Closes #<number>

## Summary
<2–4 sentences: what this PR delivers and why, based on the issue's user story.>

## Changes
- <grouped list of the main changes, by area: routes, server/services, database, UI>

## Plan
<Key decisions and assumptions from the plan, and any deviations from it.>
The full plan was removed before merging; it is available at
https://github.com/<owner>/<repo>/blob/<commit-before-removal>/docs/plans/<file>.md

## Testing
- <commands run and their results, e.g. `pnpm typecheck` ✅>
- <manual verification steps a reviewer can follow>

## Acceptance criteria
- [x] <criterion from the issue>
- [ ] <criterion not yet verified — explain>

## Notes for reviewers
<Open questions, unconfirmed assumptions, follow-ups, migrations to run. Omit if none.>
```

## Creating the Pull Request

1. **Title**: `#<number>: <issue title>` (e.g. `#11: Build checkout with guest support and transactional order creation`), or `#<number>: <concise imperative summary>`. The squash merge then appends the PR number, e.g. `#11: Build checkout … (#48)`.
2. **Execute command**:
   ```bash
   gh pr create --base main --head "issue/$N" --title "#$N: <title>" --body-file <tmp-file>
   ```
   Add labels matching the issue (`--label "<label1>,<label2>"`). Use `--draft` if the user requested a draft PR.
3. **Report to user**:
   Provide the PR URL and worktree path. Remind the user of the post-merge cleanup commands (see [worktree.md](./worktree.md)):
   ```bash
   git worktree remove .claude/worktrees/issue-<n>
   git branch -D issue/<n>
   git push origin --delete issue/<n>
   ```

## Squash Merging the Pull Request

Only merge when the user asks for it. PRs are squash merged so each issue lands on `main` as one commit.

1. **Bring the branch up to date**: `git -C "$WT" fetch origin && git -C "$WT" merge origin/main` (merge, not rebase, so no force-push is needed). Resolve conflicts, re-run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, then commit and push.
2. **Merge with an explicit subject**: always pass `--subject`. Without it the squash commit's subject doesn't always match the PR title, and the `#<number>:` prefix can be lost (it was for #52):
   ```bash
   TITLE=$(gh pr view <pr-number> --json title -q .title)   # already starts with "#$N: "
   gh pr merge <pr-number> --squash --subject "$TITLE (#<pr-number>)"
   ```
   Don't pass `--delete-branch`: inside a worktree, `gh` tries to switch branches and fails. Delete the remote branch during cleanup instead.
3. **If the merge is refused** because `main` moved or the PR conflicts, repeat step 1 and try again.
4. **Clean up** the worktree and branches as in [worktree.md](./worktree.md#worktree-cleanup-post-merge-only).
