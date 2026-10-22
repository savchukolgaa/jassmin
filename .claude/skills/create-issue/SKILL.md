---
name: create-issue
description: Create well-defined GitHub issues in this repo using a fixed template (user story, TLDR, Context, Technical). Use when the user asks to create, file, or open a GitHub issue, or to turn a spec/notes/markdown file into issues.
argument-hint: "[description of the issue, or a path to a spec file to split into issues]"
allowed-tools: Bash(gh issue create:*), Bash(gh issue list:*), Bash(gh label list:*), Bash(gh label create:*), Bash(gh repo view:*), Read, Write
---

# Create GitHub Issue

Create one or more GitHub issues for the current repository with `gh`, following the body template below exactly.

**Worktree rule:** this skill only talks to GitHub. It never creates branches or worktrees and never writes files inside the repository or any worktree (temporary files go to the scratchpad/temp directory). Branch `issue/<number>` and its worktree are created later by `/create-plan <number>` (see `AGENTS.md` → "Workflow").

## Input

`$ARGUMENTS` is either:
- a free-text description of a single piece of work, or
- a path to a spec/notes file that should be split into several issues.

If the input is too vague to write a meaningful user story and acceptance criteria, ask the user for the missing details before creating anything.

## Issue body template

Every issue body MUST follow this structure, in this order, with no other sections before the user story:

```markdown
As a <user/role>, I want to <functionality> so that <reason>.

## TLDR
<1–3 sentences summarizing what this issue delivers.>

## Context
<Why this is needed, how it fits into the product, related pages/features,
dependencies on other issues (reference them as #<number> when known),
and anything that is explicitly out of scope.>

## Technical
<Implementation details: files/modules, data models, endpoints, components,
libraries, constraints. End with an acceptance-criteria checklist:>

### Acceptance criteria
- [ ] ...
- [ ] ...
```

Rules:
- The first line is always a single user story sentence: `As a <role>, I want to <functionality> so that/because <reason>.` Pick the role that actually benefits (e.g. customer, guest shopper, store admin, developer, data analyst).
- Title: short, imperative, specific (e.g. `Add product catalog page for women's perfumes`). No prefixes like "Issue:".
- Keep each issue small enough to be completed and reviewed on its own. Split large work into several issues rather than one huge one.
- Acceptance criteria must be concrete and testable.
- Do not invent requirements that contradict the source; if you add a reasonable assumption, say so in Context.

## Splitting a spec file into issues

1. Read the whole file.
2. Identify independent, deliverable units of work (setup/infrastructure, database, backend endpoints, frontend pages, admin features, analytics, etc.).
3. Order them so foundational work comes first; create them in that order so later issues can reference earlier ones by number in their Context section.
4. Before creating, run `gh issue list --state all` and skip anything that already exists.

## Creating the issue

1. Check available labels with `gh label list`. Apply fitting existing labels (e.g. `enhancement`, `documentation`). Only create a new label if it clearly adds value (e.g. area labels like `frontend`, `backend`, `database`), using `gh label create`.
2. Write the body to a temporary file (in the scratchpad/temp directory, never inside the repo) to avoid shell-quoting problems, then run:

   ```bash
   gh issue create --title "<title>" --body-file <tmp-file> --label "<label1>,<label2>"
   ```

3. Report the created issue URL(s) back to the user as a list with their titles.
