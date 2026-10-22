---
name: open-pr
description: Open a GitHub pull request for an implemented issue branch, using the issue and its plan in docs/plans for the description. Use when the user asks to open/create a PR, e.g. "/open-pr 12" or "/open-pr".
argument-hint: "[issue number]"
allowed-tools: Bash(gh issue view:*), Bash(gh pr list:*), Bash(gh pr view:*), Bash(gh pr create:*), Bash(gh label list:*), Bash(gh repo view:*), Bash(git rm:*), Bash(git commit:*), Bash(git status:*), Bash(git branch:*), Bash(git log:*), Bash(git diff:*), Bash(git fetch:*), Bash(git push:*), Bash(git switch:*), Bash(git rev-parse:*), Read, Glob, Write
---

# Open Pull Request

Open a pull request against `main` for the work on issue `#$ARGUMENTS`.

## 1. Find the branch and issue

- If an issue number is given, use the branch `issue-<number>-*` (check with `git branch --list "issue-<number>-*"`) and switch to it if needed.
- If no number is given, use the current branch and parse the issue number from its name (`issue-<number>-<slug>`). If that fails, ask the user which issue the PR is for.
- Refuse to open a PR from `main`.
- Check for an existing PR: `gh pr list --head <branch> --state open`. If one exists, give the user its URL instead of creating another (offer to update its description).

## 2. Check the branch is ready

1. `git status`: there must be no uncommitted changes that belong to this work. If there are, tell the user and ask whether to commit them first. Ignore intentionally untracked local files (e.g. `Project Overview & Guidelines for Claude.md`) — never commit them.
2. Review what the PR contains: `git fetch origin` then `git log --oneline origin/main..HEAD` and `git diff --stat origin/main...HEAD`. Make sure no unrelated files are included.
3. Read the plan `docs/plans/<number>-*.md`. If its status isn't `Implemented` or steps / acceptance criteria are unticked, tell the user and ask whether to open the PR anyway (as a draft with `--draft` if so). Keep its contents in mind — you need them for the PR description in step 3.
4. Remove the plan — it must not be merged into `main`:
   ```bash
   git rm docs/plans/<number>-<slug>.md
   git commit -m "Remove implementation plan for #<number>"
   ```
   Include any commit attribution trailer your instructions require. Note the hash of the last commit that still contained the plan (`git rev-parse HEAD~1`) so the PR can link to it.
5. Push the branch: `git push -u origin <branch>`.

## 3. Write the PR

Title: the issue title (without the `#<number>`), or a concise imperative summary of the change.

Write the body to a temporary file outside the repo, using this structure:

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
- <commands run and their results, e.g. `npm run typecheck` ✅>
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
gh pr create --base main --head <branch> --title "<title>" --body-file <tmp-file>
```

Add the same labels as the issue when they exist (`--label`). Use `--draft` if the user agreed to a draft.

Report the PR URL to the user.
