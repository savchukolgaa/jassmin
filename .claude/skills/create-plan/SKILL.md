---
name: create-plan
description: Create a markdown implementation plan for a GitHub issue and save it in docs/plans, inside the issue's own git worktree on branch issue/<number>. Use when the user asks to plan an issue, e.g. "/create-plan 12" or "make a plan for issue #12".
argument-hint: "<issue number>"
allowed-tools: Bash(gh issue view:*), Bash(gh issue list:*), Bash(git status:*), Bash(git fetch:*), Bash(git branch:*), Bash(git log:*), Bash(git worktree:*), Bash(git rev-parse:*), Bash(git -C:*), Bash(git ls-remote:*), Read, Glob, Grep, Write
---

# Create Implementation Plan

Turn GitHub issue `#$ARGUMENTS` into a concrete, step-by-step implementation plan saved as markdown in `docs/plans/`.

If no issue number is given, ask for one. Do not write any application code in this skill — only the plan.

**Worktree rule (mandatory):** all work for issue `<n>` happens on branch `issue/<n>` in its own git worktree at `<main checkout>/.claude/worktrees/issue-<n>`. Never create branches with `git switch`/`git checkout` and never write or commit files in the main checkout. See `AGENTS.md` → "Workflow".

## 1. Gather context

1. Read the issue: `gh issue view $ARGUMENTS --json number,title,body,labels,state,comments`.
   - If the issue is closed, tell the user and ask whether to continue.
   - Read the comments too; they may change the scope or answer the issue's open assumptions.
2. Read every issue referenced in its Context section (`#<n>`, "Depends on #<n>") so you know what already exists and what the dependencies provide. If a dependency is still open and its work is not in the codebase, flag it in the plan.
3. Explore the codebase (Glob/Grep/Read) to find the files, patterns and conventions the work must follow. Read `AGENTS.md` (and scoped `AGENTS.md` files in the folders you will touch) and `README.md`. The app is a full-stack SSR app built with React Router (framework mode): data is loaded in route `loader`s, mutations go through route `action`s, and server-only code lives under `app/.server/`. Follow what the code actually does if it differs. Explore the code as it is on `origin/main` (or in the issue's worktree once it exists), not uncommitted state in the main checkout.
4. Collect open questions: anything ambiguous, unconfirmed or missing in the issue (including its "Assumption:" notes), conflicts between the issue and the code, and choices the issue leaves open.
5. Try to answer each open question yourself before asking anyone:
   - Search the source code, config, migrations, existing plans in `docs/plans/`, and `AGENTS.md` / `README.md` for an existing answer or convention.
   - Check related issues and their comments (`gh issue view <n> --comments`).
   - If you find the answer, record it in the plan under **Resolved questions** with where you found it (file path / issue), and design the plan accordingly.
   - Only questions you genuinely cannot answer from the repo or issues stay **open**. For each, propose a recommended default so the plan is still complete.

## 2. Prepare the worktree

Set `N` to the issue number. Resolve the paths from the main checkout (the first entry of `git worktree list`), so this works no matter which worktree you are in:

```bash
MAIN=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
WT="$MAIN/.claude/worktrees/issue-$N"
git -C "$MAIN" fetch origin
git -C "$MAIN" worktree list            # is issue/$N already checked out somewhere?
```

Then, in this order:

1. **Worktree for `issue/$N` already exists** (shown as `[issue/$N]` in `git worktree list`): use that path as `WT`.
2. **Local branch `issue/$N` exists** (`git -C "$MAIN" branch --list "issue/$N"`): `git -C "$MAIN" worktree add "$WT" "issue/$N"`.
3. **Only the remote branch exists** (`git -C "$MAIN" ls-remote --heads origin "issue/$N"`): `git -C "$MAIN" worktree add --track -b "issue/$N" "$WT" "origin/issue/$N"`.
4. **Otherwise** create it from the latest main: `git -C "$MAIN" worktree add -b "issue/$N" "$WT" origin/main`.

Check `git -C "$WT" status` has no staged changes that would get mixed in. From here on, every file path you write and every git command targets `$WT` (absolute paths, or `git -C "$WT" …`).

## 3. Write the plan

Save it as `$WT/docs/plans/<number>-<short-kebab-slug>.md`. If a plan already exists for this issue in the worktree, read it and update it instead of creating a second one.

Use this structure:

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

Guidelines:
- Be specific: name real files, functions, route modules, tables and columns. Prefer extending existing code over inventing new patterns.
- Every acceptance criterion in the issue must be covered by at least one step.
- Keep strict TypeScript (no `any`), validation of all `action` input, and transactions where data integrity matters (see `AGENTS.md`).
- The project uses pnpm and Biome — write commands as `pnpm <script>`.

## 4. Commit and report

1. Commit only the plan file, on `issue/<number>` in the worktree — never use `git add -A` or `git add .`:
   ```bash
   git -C "$WT" add docs/plans/<number>-<slug>.md
   git -C "$WT" commit -m "Add implementation plan for #<number>"
   ```
   Include any commit attribution trailer your instructions require. Confirm with `git -C "$WT" branch --show-current` that the commit landed on `issue/<number>`.
2. Do not push unless the user asks; `/implement` and `/open-pr` push later.
3. Report to the user: the plan path, the branch `issue/<number>` and the worktree path, a short summary of the steps, the questions you resolved yourself (with sources), and the remaining **open questions** with their recommended defaults so the user can answer them. Suggest `/implement <number>` as the next step.
