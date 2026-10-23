---
name: create-issue
description: >-
  Create well-defined GitHub issues in this repo using a fixed template (user story, TLDR, Context, Technical).
  Use when the user asks to create, file, or open a GitHub issue, or to turn a spec/notes/markdown file into issues.
---

# Create GitHub Issue

Create one or more GitHub issues for the current repository using the shared issue template and guidelines in [docs/skills/create-issue.md](../../docs/skills/create-issue.md).

**Worktree rule:** This skill only talks to GitHub. It never creates branches or worktrees and never writes files inside the repository or any worktree (temporary files go to the scratchpad or system temp directory). Branch `issue/<number>` and its worktree are created later by `/create-plan <number>` (see [docs/skills/worktree.md](../../docs/skills/worktree.md)).

## Input

The user will provide either:
- A free-text description of a single piece of work, or
- A path to a spec/notes file that should be split into several issues.

If the input is too vague to write a meaningful user story and acceptance criteria, ask the user for clarification before creating anything.

## Procedure

1. Read [docs/skills/create-issue.md](../../docs/skills/create-issue.md) for the mandatory issue body template, authoring rules, and guidelines for splitting spec files into issues.
2. Check available labels (`gh label list`) and existing issues (`gh issue list --state all`) to avoid duplicates and choose appropriate labels.
3. Write the issue body to a temporary file outside the repository (in the scratchpad or temp directory) to avoid shell-quoting issues.
4. Run:
   ```bash
   gh issue create --title "<title>" --body-file <tmp-file> --label "<label1>,<label2>"
   ```
5. Report the created issue URL(s) and titles back to the user as a list.
