# Create GitHub Issue Guidelines

This document defines the issue template, quality standards, and procedures for filing GitHub issues in this repository.

## Worktree Rule

This workflow only interacts with GitHub via `gh`. It never creates branches or worktrees, and never writes files inside the repository or any worktree. Any temporary files created must be placed in a system temp or scratchpad directory outside the repo.

Branch `issue/<number>` and its worktree are created during planning (see [worktree.md](./worktree.md)).

## Issue Body Template

Every issue body MUST follow this structure, in this exact order, with no additional sections before the user story:

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

## Issue Authoring Rules

- **User Story**: The very first line must be a single user story sentence: `As a <role>, I want to <functionality> so that/because <reason>.` Pick the role that actually benefits (e.g., `customer`, `guest shopper`, `store admin`, `developer`, `data analyst`).
- **Title**: Short, imperative, specific (e.g. `Add product catalog page for women's perfumes`). Never include prefixes like `Issue:` or `Feature:`.
- **Granularity & Scope**: Keep each issue small enough to be completed and reviewed independently. Split large epics or features into multiple distinct issues.
- **Acceptance Criteria**: Concrete, measurable, and testable criteria.
- **Assumptions**: Do not invent requirements that contradict source material. If a reasonable technical assumption is made, explicitly document it under `Context`.

## Splitting a Spec File into Issues

When turning a specification or notes document into multiple issues:

1. **Read the whole file** to understand end-to-end architecture and requirements.
2. **Identify independent units of work**:
   - Infrastructure & foundation (schema, database migrations, base types)
   - Backend services and route actions/loaders
   - Frontend components and route UI
   - Admin features, CMS integration, or analytics
3. **Order topologically**: Create foundational issues first so subsequent issues can cite their dependencies by issue number (`#<n>`) in their `Context` section.
4. **Avoid duplicates**: Run `gh issue list --state all` before creating to verify work has not already been filed.

## Creating the Issue via GitHub CLI

1. **Check labels**: Run `gh label list`. Apply fitting existing labels (e.g. `enhancement`, `documentation`). Only create a new label if it clearly adds value (e.g. area labels like `frontend`, `backend`, `database`) with `gh label create`.
2. **Use temporary body file**: Write the body markdown to a temporary file outside the repository (to avoid shell-quoting issues on Windows / POSIX shells).
3. **Run command**:
   ```bash
   gh issue create --title "<title>" --body-file <tmp-file> --label "<label1>,<label2>"
   ```
4. **Report**: Output the created issue URL(s) and titles back to the user.
