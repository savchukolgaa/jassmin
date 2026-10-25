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
3. **Environment setup**: Link the worktree's `.env` and `cms/.env` to the main checkout's, so they never go stale:
   ```bash
   node "$WT/scripts/link-env.mjs" "$WT"
   ```
   It creates a symlink for each file when the OS allows it. On Windows that needs Developer Mode (or elevated rights); without it the script makes a hard link instead, which stays in sync as long as editors save the file in place, and copies the file only if linking fails too. It prints a notice for each fallback; a copy has to be refreshed by hand when the main checkout's file changes. Files that already exist in the worktree are left alone. `pnpm herdr:plans` does this for you.
   - Never commit `.env`! Git ignores the links like the files.
4. **Install dependencies**: If packages or node_modules need updating, run:
   ```bash
   pnpm --dir "$WT" install
   ```
   pnpm uses its global virtual store (`enableGlobalVirtualStore` in `pnpm-workspace.yaml`): every checkout's `node_modules` is a small tree of links (junctions on Windows) into one shared store under the pnpm store, so installing in a worktree is fast and takes almost no disk space. A worktree's install only changes that worktree's links and adds new package versions to the shared store; it never changes the main checkout's dependencies.

## Command Execution Rules

From this point on, all file edits and command executions must target `$WT`:
- Use absolute paths under `$WT` for all file operations (reading, writing, editing).
- Run git commands targeting `$WT` (e.g. `git -C "$WT" <command>`).
- Run pnpm commands targeting `$WT` (e.g. `pnpm --dir "$WT" <command>`).

## Worktree Cleanup (Post-Merge Only)

**Do not remove a worktree before its pull request is merged into `main`.**

Once the PR is merged, delete the worktree, the local branch and the remote branch from the main checkout. Squash merges don't count as merged for git, so the local branch needs `-D`:

```bash
pnpm worktree:remove <n>
git branch -D issue/<n>
git push origin --delete issue/<n>
```

Stop any dev or preview server still running from the worktree first; on Windows it keeps the folder locked.

**Never run plain `git worktree remove` (or `git clean -x`) on a worktree that still has `node_modules`.** Its `node_modules` folders are trees of junctions into pnpm's shared virtual store, and Git for Windows follows junctions when it deletes a directory: it deletes files inside the shared store, which every checkout uses, and then fails with "Directory not empty". `pnpm worktree:remove <n>` (`scripts/remove-worktree.mjs`) refuses a worktree with uncommitted or untracked changes, deletes every `node_modules` in it without following links, and then runs `git worktree remove`.

To do the same by hand, delete the dependency folders with a tool that unlinks junctions instead of following them, then run `git worktree remove`:

```powershell
Remove-Item .claude/worktrees/issue-<n>/node_modules, .claude/worktrees/issue-<n>/cms/node_modules, .claude/worktrees/issue-<n>/aspire-apphost/node_modules -Recurse -Force -ErrorAction SilentlyContinue
git worktree remove .claude/worktrees/issue-<n>
```

PowerShell 7's `Remove-Item -Recurse -Force`, `cmd /c rmdir /s /q`, Git Bash's `rm -rf` and Node's `fs.rmSync` delete a junction without touching what it points to. Never delete anything under the pnpm store (`pnpm store path`) by hand; `pnpm store prune` cleans it up safely. If the shared store was damaged anyway (a package folder in it is missing files), `pnpm install --force` in any checkout re-imports every package and repairs it.
