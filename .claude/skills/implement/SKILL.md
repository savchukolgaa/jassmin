---
name: implement
description: Implement a GitHub issue by following its implementation plan in docs/plans, then commit and push the work. Use when the user asks to implement an issue, e.g. "/implement 12".
argument-hint: "<issue number>"
---

# Implement Issue From Plan

Implement GitHub issue `#$ARGUMENTS` by following its plan in `docs/plans/`.

If no issue number is given, ask for one.

## 1. Load the plan and issue

1. Find the plan: `docs/plans/$ARGUMENTS-*.md`. If none exists, stop and suggest running `/create-plan $ARGUMENTS` first.
2. Read the whole plan, then the issue (`gh issue view $ARGUMENTS --json title,body,comments`) to check nothing changed since the plan was written. If the issue now contradicts the plan, tell the user and update the plan before coding.
3. Check the plan's **Open questions**. First check whether the code, the issue comments or the user have answered any of them since the plan was written; if so, move them to **Resolved questions** with the source. For questions still open that materially change the implementation, ask the user before starting; otherwise proceed with the recommended default and say so in your final report. Record every answer in the plan.

## 2. Switch to the branch

1. Switch to the branch named in the plan (`git switch issue-<number>-<slug>`). If it only exists on the remote, check it out from `origin`; if it doesn't exist at all, create it from an up-to-date `main`.
2. Make sure the working tree is clean apart from files that are intentionally untracked. Never stage or commit files that are not part of this work (for example local notes like `Project Overview & Guidelines for Claude.md`).

## 3. Implement step by step

For each unchecked step in the plan, in order:

1. Implement it, following the codebase's existing conventions and the project guidelines:
   - Full-stack SSR with React Router (framework mode): `loader`s for reads, `action`s for writes, server-only code under `app/.server/`, generated route types (`./+types/<route>`).
   - Strict TypeScript, no `any`.
   - Validate all `action` input (zod) and use DB transactions where data integrity matters.
   - Add or update tests for the behaviour you add.
2. Verify the step as the plan describes (typecheck, lint, tests, or running the app).
3. Tick the step's checkbox in the plan file (`- [ ]` → `- [x]`).
4. Commit the step's files together with the updated plan, staging paths explicitly (never `git add -A` / `git add .`). Use a clear imperative message that references the issue, e.g. `Add catalog loader with gender filter (#8)`. Include any commit attribution trailer your instructions require.

If you have to deviate from the plan (a step is wrong, missing or needs splitting), update the plan file to match what you actually did and note why under "Decisions & assumptions". Don't silently diverge.

If you get blocked (missing dependency, failing test you can't fix, decision only the user can make), stop, commit the completed work, and tell the user exactly what is blocking.

## 4. Final verification

1. Run the full checks the project provides (e.g. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`). All must pass; fix failures before finishing.
2. Go through the plan's **Acceptance criteria** and tick each one you have verified. Leave unverified ones unticked and say why.
3. Set the plan's `Status:` line to `Implemented` and commit the plan.

## 5. Push and report

1. Push the branch: `git push -u origin <branch>`.
2. Report to the user: what was implemented, the commits made, the results of the checks (with any failures quoted exactly), any acceptance criteria not verified, and any deviations from the plan. Suggest `/open-pr $ARGUMENTS` as the next step. Do not open the PR yourself unless asked.
