# Repository Skills & Workflow Documentation

This directory contains reusable documentation, guidelines, templates, and procedures that govern development workflows in this repository.

These documents are referenced by both **Claude skills** (`.claude/skills/`) and **Antigravity skills** (`.agents/skills/`).

## Workflow Guides

1. **[Worktree Management](./worktree.md)**
   - Git worktree isolation rules and path conventions (`.claude/worktrees/issue-<n>`).
   - Initialization, branch creation, environment setup, and post-merge cleanup.

2. **[Create GitHub Issue](./create-issue.md)**
   - Standard issue body template (User story, TLDR, Context, Technical, Acceptance criteria).
   - Issue authoring rules, splitting specification files, and `gh issue create` CLI usage.

3. **[Create Implementation Plan](./create-plan.md)**
   - Gathering context from issues, dependencies, and codebase architecture.
   - Plan markdown template (`docs/plans/<number>-<slug>.md`), authoring standards, and commit conventions.

4. **[Implement Issue From Plan](./implement.md)**
   - Step-by-step implementation loop with per-step verification and commit requirements.
   - Architectural conventions (React Router SSR, `app/.server/`, strict TS, zod, DB transactions).
   - Final verification suite (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`).

5. **[Open Pull Request](./open-pr.md)**
   - Pre-PR verification and plan removal before merge.
   - Pull request body template and `gh pr create` CLI usage.
   - Post-merge cleanup reminders.

Related: **[Continuous integration](../ci.md)** describes the GitHub Actions checks every PR must pass before it is merged, and how `main` is protected.
