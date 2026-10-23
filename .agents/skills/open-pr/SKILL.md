---
name: open-pr
description: >-
  Open a GitHub pull request for an implemented issue branch issue/<number>,
  working from the issue's git worktree, using the issue and its plan in docs/plans for the description.
  Use when the user asks to open/create a PR, e.g. "/open-pr 12" or "/open-pr".
---

# Open Pull Request

Open a pull request against `main` for the work on an issue, following [docs/skills/open-pr.md](../../docs/skills/open-pr.md).

If no issue number is provided in the prompt, determine it from the current worktree branch (`issue/<n>`) or ask the user.

**Worktree rule (mandatory):** The PR branch is `issue/<n>`, and all git operations for it run in the issue's worktree at `<main checkout>/.claude/worktrees/issue-<n>`. Follow [docs/skills/worktree.md](../../docs/skills/worktree.md). Never switch branches or commit in the main checkout.

## Procedure

1. **Find worktree and branch**: Locate or prepare `$WT` for `issue/$N` per [docs/skills/worktree.md](../../docs/skills/worktree.md). Check for existing PRs (`gh pr list --head "issue/$N"`). Refuse to open a PR from `main`.
2. **Check readiness & remove plan**:
   - Ensure clean working tree in `$WT` and review log/diff against `origin/main`.
   - Verify plan is marked `Status: Implemented`.
   - Remove the plan file (`git -C "$WT" rm docs/plans/<number>-<slug>.md`), commit removal, note the hash of `HEAD~1`, and push (`git -C "$WT" push -u origin "issue/$N"`). See [docs/skills/open-pr.md](../../docs/skills/open-pr.md).
3. **Write PR body**: Use the template in [docs/skills/open-pr.md](../../docs/skills/open-pr.md) linking to the removed plan at `HEAD~1`. Write to a temporary file outside the repository.
4. **Create PR**: Run `gh pr create --base main --head "issue/$N" --title "<title>" --body-file <tmp-file>`. Add labels matching the issue.
5. **Report**: Report the PR URL and worktree path to the user, reminding them of the post-merge cleanup commands in [docs/skills/worktree.md](../../docs/skills/worktree.md).
