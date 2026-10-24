# Worktree Management

This document defines how git worktrees are used in this repository for issue isolation, branch setup, environment preparation, and cleanup.

## The Worktree Rule

All work for issue `<n>` happens on branch `issue/<n>` in its own dedicated git worktree at `.claude/worktrees/issue-<n>`.

- **Never create branches using `git switch` or `git checkout` in the main checkout.**
- **Never edit, build, stage, or commit files in the main checkout for an issue.**
- Worktrees live inside the repo at `.claude/worktrees/issue-<number>` (git-ignored, and excluded from Biome, `tsc`, and Vite watching).

## Path Resolution

Set `N` to the issue number. Resolve paths relative to the main checkout (the first entry in `git worktree list`) so commands work regardless of the current working directory:

```bash
MAIN=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
WT="$MAIN/.claude/worktrees/issue-$N"
git -C "$MAIN" fetch origin
git -C "$MAIN" worktree list
```

## Preparing or Entering a Worktree

Resolve or initialize `$WT` following this priority order:

1. **Worktree for `issue/$N` already exists** (displayed as `[issue/$N]` in `git worktree list`):
   Use that existing worktree path as `WT`.
2. **Local branch `issue/$N` exists** (`git -C "$MAIN" branch --list "issue/$N"`):
   ```bash
   git -C "$MAIN" worktree add "$WT" "issue/$N"
   ```
3. **Only remote branch exists** (`git -C "$MAIN" ls-remote --heads origin "issue/$N"`):
   ```bash
   git -C "$MAIN" worktree add --track -b "issue/$N" "$WT" "origin/issue/$N"
   ```
4. **Neither exists (new worktree from latest main)**:
   ```bash
   git -C "$MAIN" worktree add -b "issue/$N" "$WT" origin/main
   ```

## Worktree Setup & Verification

Once the worktree is created or entered:

1. **Verify branch**: Run `git -C "$WT" branch --show-current` to confirm it outputs `issue/$N`.
2. **Verify status**: Run `git -C "$WT" status` to verify there are no unexpected staged or modified changes.
3. **Environment setup**: If `$WT/.env` is missing, copy it from `$MAIN/.env`:
   - Never commit `.env`!
4. **Install dependencies**: If packages or node_modules need updating, run:
   ```bash
   pnpm --dir "$WT" install
   ```

## Command Execution Rules

From this point on, all file edits and command executions must target `$WT`:
- Use absolute paths under `$WT` for all file operations (reading, writing, editing).
- Run git commands targeting `$WT` (e.g. `git -C "$WT" <command>`).
- Run pnpm commands targeting `$WT` (e.g. `pnpm --dir "$WT" <command>`).

## Worktree Cleanup (Post-Merge Only)

**Do not remove a worktree before its pull request is merged into `main`.**

Once the PR is merged, delete the worktree, the local branch and the remote branch from the main checkout. Squash merges don't count as merged for git, so the local branch needs `-D`:

```bash
git worktree remove .claude/worktrees/issue-<n>
git branch -D issue/<n>
git push origin --delete issue/<n>
```

Stop any dev or preview server still running from the worktree first; on Windows it keeps the folder locked.
