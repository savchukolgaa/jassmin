# Create Implementation Plan Guidelines

This document defines the process, requirements, and markdown template for creating implementation plans for GitHub issues.

## Location & Naming

Implementation plans are saved as:
`$WT/docs/plans/<number>-<short-kebab-slug>.md`

- Plans live in `docs/plans/` **inside the issue's own git worktree** on branch `issue/<number>`.
- See [worktree.md](./worktree.md) for worktree preparation rules.
- If a plan already exists for the issue in the worktree, read and update it rather than creating a duplicate.

## Context Gathering

Before drafting the plan:

1. **Inspect the issue**:
   Run `gh issue view <number> --json number,title,body,labels,state,comments`.
   - If closed, alert the user and ask whether to proceed.
   - Read all comments; they may refine scope or answer assumptions.
2. **Inspect dependencies**:
   Read issues referenced in the `Context` section (`#<n>`, "Depends on #<n>"). Verify whether required code exists on `origin/main`. If an open dependency is missing, explicitly flag it in the plan.
3. **Explore the codebase**:
   Review files and conventions (`AGENTS.md`, scoped `AGENTS.md` files, `README.md`, existing routes/services/schema). Follow current codebase patterns:
   - React Router v8 (framework mode): reads in `loader`s, writes in `action`s, route module types from `./+types/<route>`.
   - Server isolation: all server-only code (DB, services, sessions, env) belongs in `app/.server/`. Never import from client code.
   - Data validation: validate all `action` inputs with zod; return typed errors instead of throwing.
   - Transactions: wrap multi-table writes in `db.transaction(async (tx) => ...)`.
   - Strict TypeScript: no `any` (Biome `noExplicitAny` is an error).
   - Test conventions: Vitest unit/integration tests (`*.test.ts`) next to code.
   - Base exploration on `origin/main` or the issue worktree, not uncommitted changes in the main checkout.
4. **Collect and resolve open questions**:
   - Distinguish between questions answered by repo conventions/code/comments and genuinely open questions.
   - Record answered questions under **Resolved questions** with citations (file path / issue number).
   - Only genuinely unresolvable questions remain in **Open questions**, each with an impact explanation and a recommended default.

## Plan Markdown Template

Every plan must follow this template:

```markdown
# Plan: <issue title> (#<number>)

Issue: <issue URL>
Branch: `issue/<number>`
Worktree: `.claude/worktrees/issue-<number>`
Status: Planned

## Goal
<The issue's user story and TLDR, restated in 2–3 sentences.>

## Dependencies & prerequisites
<Issues/features this relies on and whether they exist yet; env vars, packages, migrations needed.>

## Decisions & assumptions
<Design choices made for this plan and why. Mark anything that depends on an open question with **(unconfirmed)**.>

## Open questions
<Questions that could not be answered from the source code or issues. Omit the section if there are none.>
- [ ] **Q1: <question>** — Why it matters: <impact on the design>. Recommended default: <what the plan assumes until answered>. Affects steps: <n>.

## Resolved questions
<Questions answered from the codebase or issues. Omit if none.>
- **<question>** — <answer> (source: `<file path>` / #<issue>)

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
<Automated tests to add (unit/integration), commands to run (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`), and manual checks in the running app.>

## Acceptance criteria
<Copy each acceptance criterion from the issue as a checkbox and note which step(s) satisfy it.>
- [ ] <criterion> — steps 2, 4

## Out of scope
<What this plan deliberately does not do.>
```

## Plan Authoring Guidelines

- **Concrete details**: Explicitly reference files, functions, route modules, database tables, and schema columns. Prefer extending existing patterns over introducing new paradigms.
- **Traceability**: Every acceptance criterion from the issue must be covered by at least one implementation step.
- **Standards**: Strictly adhere to repo rules (Biome formatting, pnpm scripts, zod validation, strict TypeScript).

## Committing the Plan

Commit only the plan file in the issue's worktree:

```bash
git -C "$WT" add docs/plans/<number>-<slug>.md
git -C "$WT" commit -m "Add implementation plan for #<number>"
```

- Confirm the commit is on `issue/<number>` via `git -C "$WT" branch --show-current`.
- Do not push at this stage unless explicitly instructed.
