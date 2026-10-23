---
name: open-pr
description: Open a GitHub pull request for an implemented issue branch issue/<number>, working from the issue's git worktree, using the issue and its plan in docs/plans for the description. Use when the user asks to open/create a PR, e.g. "/open-pr 12" or "/open-pr".
argument-hint: "[issue number]"
allowed-tools: Bash(gh issue view:*), Bash(gh pr list:*), Bash(gh pr view:*), Bash(gh pr create:*), Bash(gh label list:*), Bash(gh repo view:*), Bash(git rm:*), Bash(git commit:*), Bash(git status:*), Bash(git branch:*), Bash(git log:*), Bash(git diff:*), Bash(git fetch:*), Bash(git push:*), Bash(git rev-parse:*), Bash(git worktree:*), Bash(git -C:*), Bash(git ls-remote:*), Read, Glob, Write
---

# Open Pull Request

Open a pull request against `main` for the work on issue `#$ARGUMENTS`.

**Worktree rule (mandatory):** the PR branch is `issue/<n>`, and all git operations for it run in the issue's worktree at `<main checkout>/.claude/worktrees/issue-<n>`. Never switch branches or commit in the main checkout. See `AGENTS.md` → "Workflow".

## 1. Find the worktree, branch and issue

```bash
MAIN=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
git -C "$MAIN" worktree list
```

- If an issue number `N` is given, the branch is `issue/$N`. Use the worktree that has it checked out (shown as `[issue/$N]`). If none does but the branch exists locally or on `origin`, create the worktree at `$MAIN/.claude/worktrees/issue-$N` (`git -C "$MAIN" worktree add "$WT" "issue/$N"`, or `--track -b "issue/$N" "$WT" "origin/issue/$N"` for a remote-only branch). If the branch doesn't exist at all, stop and say so.
- If no number is given, use the current worktree's branch and parse `N` from `issue/<n>`. If that fails, ask the user which issue the PR is for.
- Refuse to open a PR from `main`.
- Check for an existing PR: `gh pr list --head "issue/$N" --state open`. If one exists, give the user its URL instead of creating another (offer to update its description).

Use `git -C "$WT" …` and absolute paths under `$WT` for everything below.

## 2. Check the branch is ready

1. `git -C "$WT" status`: there must be no uncommitted changes that belong to this work. If there are, tell the user and ask whether to commit them first (on `issue/$N`). Ignore intentionally untracked/ignored local files (e.g. `.env`, `Project Overview & Guidelines for Claude.md`) — never commit them.
2. Review what the PR contains: `git -C "$WT" fetch origin` then `git -C "$WT" log --oneline origin/main..HEAD` and `git -C "$WT" diff --stat origin/main...HEAD`. Make sure no unrelated files are included.
3. Read the plan `$WT/docs/plans/$N-*.md`. If its status isn't `Implemented` or steps / acceptance criteria are unticked, tell the user and ask whether to open the PR anyway (as a draft with `--draft` if so). Keep its contents in mind — you need them for the PR description in step 3.
4. Remove the plan — it must not be merged into `main`:
   ```bash
   git -C "$WT" rm docs/plans/<number>-<slug>.md
   git -C "$WT" commit -m "Remove implementation plan for #<number>"
   ```
   Include any commit attribution trailer your instructions require. Note the hash of the last commit that still contained the plan (`git -C "$WT" rev-parse HEAD~1`) so the PR can link to it.
5. Push the branch: `git -C "$WT" push -u origin "issue/$N"`.

## 3. Write the PR

Title: the issue title (without the `#<number>`), or a concise imperative summary of the change.

Write the body to a temporary file outside the repo and outside every worktree, using this structure:

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

Only claim checks you actually ran and their real outcome. Append any PR attribution line your instructions require.

## 4. Create and report

```bash
gh pr create --base main --head "issue/$N" --title "<title>" --body-file <tmp-file>
```

Add the same labels as the issue when they exist (`--label`). Use `--draft` if the user agreed to a draft.

Report the PR URL and the worktree path to the user. Remind them that once the PR is merged the worktree and branch can be cleaned up from the main checkout:

```bash
git worktree remove .claude/worktrees/issue-<n>
git branch -d issue/<n>
```

Do not remove the worktree yourself before the PR is merged.
