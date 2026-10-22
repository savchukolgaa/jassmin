---
name: create-plan
description: Create a markdown implementation plan for a GitHub issue and save it in docs/plans. Use when the user asks to plan an issue, e.g. "/create-plan 12" or "make a plan for issue #12".
argument-hint: "<issue number>"
allowed-tools: Bash(gh issue view:*), Bash(gh issue list:*), Bash(git status:*), Bash(git fetch:*), Bash(git switch:*), Bash(git checkout:*), Bash(git pull:*), Bash(git branch:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Read, Glob, Grep, Write
---

# Create Implementation Plan

Turn GitHub issue `#$ARGUMENTS` into a concrete, step-by-step implementation plan saved as markdown in `docs/plans/`.

If no issue number is given, ask for one. Do not write any application code in this skill — only the plan.

## 1. Gather context

1. Read the issue: `gh issue view $ARGUMENTS --json number,title,body,labels,state,comments`.
   - If the issue is closed, tell the user and ask whether to continue.
   - Read the comments too; they may change the scope or answer the issue's open assumptions.
2. Read every issue referenced in its Context section (`#<n>`, "Depends on #<n>") so you know what already exists and what the dependencies provide. If a dependency is still open and its work is not in the codebase, flag it in the plan.
3. Explore the codebase (Glob/Grep/Read) to find the files, patterns and conventions the work must follow. Read `CLAUDE.md` / `README.md` if present. The app is a full-stack SSR app built with React Router (framework mode): data is loaded in route `loader`s, mutations go through route `action`s, and server-only code lives under `app/.server/`. Follow what the code actually does if it differs.
4. If something essential is ambiguous (an unconfirmed assumption in the issue that changes the design), ask the user before writing the plan rather than guessing.

## 2. Prepare the branch

1. Make sure the working tree has no staged changes that would get mixed in (`git status`).
2. Update main and create a feature branch named `issue-<number>-<short-kebab-slug>`:
   ```bash
   git fetch origin
   git switch main && git pull --ff-only
   git switch -c issue-<number>-<slug>
   ```
   If the branch already exists, switch to it instead.

## 3. Write the plan

Save it as `docs/plans/<number>-<slug>.md` (same slug as the branch). If a plan already exists for this issue, read it and update it instead of creating a second one.

Use this structure:

```markdown
# Plan: <issue title> (#<number>)

Issue: <issue URL>
Branch: `issue-<number>-<slug>`
Status: Planned

## Goal
<The issue's user story and TLDR, restated in 2–3 sentences.>

## Dependencies & prerequisites
<Issues/features this relies on and whether they exist yet; env vars, packages, migrations needed.>

## Decisions & assumptions
<Design choices made for this plan and why; issue assumptions and how they are resolved. Mark anything still unconfirmed with **(unconfirmed)**.>

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `app/routes/...` | ... |
| modify | `app/routes.ts` | ... |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [ ] **1. <step title>** — <what to do, key functions/types/queries, and how to check it works>
- [ ] **2. ...**

## Testing & verification
<Automated tests to add (unit/integration), commands to run (typecheck, lint, test, build), and manual checks in the running app.>

## Acceptance criteria
<Copy each acceptance criterion from the issue as a checkbox and note which step(s) satisfy it.>
- [ ] <criterion> — steps 2, 4

## Out of scope
<What this plan deliberately does not do.>
```

Guidelines:
- Be specific: name real files, functions, route modules, tables and columns. Prefer extending existing code over inventing new patterns.
- Every acceptance criterion in the issue must be covered by at least one step.
- Keep strict TypeScript (no `any`), validation of all `action` input, and transactions where data integrity matters (see the project guidelines).

## 4. Commit and report

1. Commit only the plan file — never use `git add -A` or `git add .`:
   ```bash
   git add docs/plans/<number>-<slug>.md
   git commit -m "Add implementation plan for #<number>"
   ```
   Include any commit attribution trailer your instructions require.
2. Do not push unless the user asks; `/implement` and `/open-pr` push later.
3. Report to the user: the plan path, the branch, a short summary of the steps, and any **(unconfirmed)** decisions they should review. Suggest `/implement <number>` as the next step.
