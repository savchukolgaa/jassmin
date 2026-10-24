---
name: open-pr
description: Open a GitHub pull request for an implemented issue branch issue/<number>, working from the issue's git worktree, using the issue and its plan in docs/plans for the description. Use when the user asks to open/create a PR, e.g. "/open-pr 12" or "/open-pr".
argument-hint: "[issue number]"
allowed-tools: Bash(gh issue view:*), Bash(gh pr list:*), Bash(gh pr view:*), Bash(gh pr create:*), Bash(gh label list:*), Bash(gh repo view:*), Bash(git rm:*), Bash(git commit:*), Bash(git status:*), Bash(git branch:*), Bash(git log:*), Bash(git diff:*), Bash(git fetch:*), Bash(git push:*), Bash(git rev-parse:*), Bash(git worktree:*), Bash(git -C:*), Bash(git ls-remote:*), Read, Glob, Write
---

# Open Pull Request

Open a pull request against `main` for the work on issue `#$ARGUMENTS`, following [docs/skills/open-pr.md](../../docs/skills/open-pr.md).

**Worktree rule (mandatory):** the PR branch is `issue/<n>`, and all git operations for it run in the issue's worktree at `<main checkout>/.claude/worktrees/issue-<n>`. Follow [docs/skills/worktree.md](../../docs/skills/worktree.md). Never switch branches or commit in the main checkout.

## Procedure

1. **Find the worktree, branch and issue**: Follow [docs/skills/worktree.md](../../docs/skills/worktree.md) to locate `$WT` for `issue/$N`. Refuse to open a PR from `main`. Check for an existing PR (`gh pr list --head "issue/$N" --state open`).
2. **Check the branch is ready & remove plan**:
   - Check `git -C "$WT" status` has no uncommitted changes.
   - Review log and diff against `origin/main` (`git -C "$WT" fetch origin`, `git -C "$WT" log --oneline origin/main..HEAD`).
   - Read the plan `$WT/docs/plans/$N-*.md` and verify `Status: Implemented`.
   - Remove the plan file (`git -C "$WT" rm docs/plans/<number>-<slug>.md`), commit removal, record the hash of `HEAD~1`, and push (`git -C "$WT" push -u origin "issue/$N"`).
3. **Write the PR**: Use the PR body template in [docs/skills/open-pr.md](../../docs/skills/open-pr.md), linking to the removed plan at `HEAD~1`. Write to a temporary file outside the repository.
4. **Create the PR**: Run `gh pr create --base main --head "issue/$N" --title "#$N: <title>" --body-file <tmp-file>`, where the title starts with the issue number (see [docs/skills/open-pr.md](../../docs/skills/open-pr.md)). Add labels matching the issue.
5. **Report**: Report the PR URL and worktree path to the user. Remind them of the post-merge cleanup commands from [docs/skills/worktree.md](../../docs/skills/worktree.md).
