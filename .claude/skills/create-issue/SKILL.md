---
name: create-issue
description: Create well-defined GitHub issues in this repo using a fixed template (user story, TLDR, Context, Technical). Use when the user asks to create, file, or open a GitHub issue, or to turn a spec/notes/markdown file into issues.
argument-hint: "[description of the issue, or a path to a spec file to split into issues]"
allowed-tools: Bash(gh issue create:*), Bash(gh issue list:*), Bash(gh label list:*), Bash(gh label create:*), Bash(gh repo view:*), Read, Write
---

# Create GitHub Issue

Create one or more GitHub issues for the current repository with `gh`, using the shared issue template and guidelines in [docs/skills/create-issue.md](../../docs/skills/create-issue.md).

**Worktree rule:** this skill only talks to GitHub. It never creates branches or worktrees and never writes files inside the repository or any worktree (temporary files go to the scratchpad/temp directory). Branch `issue/<number>` and its worktree are created later by `/create-plan <number>` (see [docs/skills/worktree.md](../../docs/skills/worktree.md)).

## Input

`$ARGUMENTS` is either:
- a free-text description of a single piece of work, or
- a path to a spec/notes file that should be split into several issues.

If the input is too vague to write a meaningful user story and acceptance criteria, ask the user for the missing details before creating anything.

## Procedure

1. Read [docs/skills/create-issue.md](../../docs/skills/create-issue.md) for the mandatory issue body template, authoring rules, and spec-splitting guidelines.
2. Check available labels with `gh label list` and existing issues with `gh issue list --state all` to avoid duplicates. Apply fitting existing labels (e.g. `enhancement`, `documentation`), and only create a new label if it clearly adds value with `gh label create`.
3. Write the issue body to a temporary file (in the scratchpad/temp directory, never inside the repo) to avoid shell-quoting problems, then run:

   ```bash
   gh issue create --title "<title>" --body-file <tmp-file> --label "<label1>,<label2>"
   ```

4. Report the created issue URL(s) back to the user as a list with their titles.
