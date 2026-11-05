# Plan: Run typecheck, lint, tests and build on every pull request with GitHub Actions (#142)

Issue: https://github.com/savchukolgaa/jassmin/issues/142
Branch: `issue/142`
Worktree: `.claude/worktrees/issue-142`
Status: Planned (Q1, Q2 answered)

## Goal
Every pull request and every push to `main` runs `pnpm typecheck`, `pnpm lint`, `pnpm test` (against
a real PostgreSQL service, so the database tests run instead of being skipped) and `pnpm build` on
GitHub Actions, and the results show on the PR. `main` is then protected so a PR can only merge when
it's green. The README shows a CI badge, and the PR workflow docs wait for green checks before merging.

## Dependencies & prerequisites
- No issue dependencies. Nothing exists yet: there is no `.github/` folder on `origin/main`.
- **Scope limit (from the user):** issues #125 and #126 are being implemented in parallel in other
  worktrees, so this issue **must not touch app code**. Allowed paths: `.github/**`, `docs/**` and
  `README.md` (the badge, plus a pointer to `docs/ci.md`). No changes to `app/`, `cms/`,
  `scripts/`, `package.json`, `vitest.config.ts`, `biome.json` or the lockfile.
- No new packages, env vars or migrations. CI uses dummy values only (no secrets).
- The owner makes the repo public and then turns on branch protection by hand, following
  `docs/ci.md` (see resolved Q1).

## Decisions & assumptions
- **One workflow file**, `.github/workflows/ci.yml`, with two jobs: `check` (always) and `cms`
  (only when `cms/**` or the lockfile changed).
- **Triggers:** `pull_request` (all branches) and `push: branches: [main]`. `concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}`,
  `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`, so outdated PR runs are cancelled
  but every `main` push finishes.
- **Permissions:** top-level `permissions: contents: read` only.
- **Actions pinned to a major version** (`actions/checkout@v7`, `actions/setup-node@v7`,
  `pnpm/action-setup@v6`, `dorny/paths-filter@v4`: the latest majors on 2026-11-05, checked with `gh api repos/<action>/releases/latest`; the plan first guessed older majors
  ). Pinning to SHAs is not needed for a solo-owner repo.
- **Node from `.nvmrc`** (`node-version-file: .nvmrc`, currently `24`), not a hard-coded 22 (resolved
  Q2): it's what the developer runs locally and satisfies `engines` (`>=22`) of the app and `cms/`.
- **pnpm from `packageManager`** (`pnpm@12.15.0`): `pnpm/action-setup` without a `version` input
  reads it. Then `actions/setup-node` with `cache: pnpm`. Install with `pnpm install --frozen-lockfile`.
  `pnpm-workspace.yaml` has `enableGlobalVirtualStore: true`; if that breaks the cache or install on
  the runner, set `PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false` as a job env var (no repo-file change).
- **PostgreSQL 18** as a service container (`postgres:18`, the image Aspire pulls locally:
  `postgres:18.3` in the local Docker images), with a `pg_isready` health check,
  `POSTGRES_PASSWORD=postgres`, port `5432:5432`. Job env
  `DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres`. `test-utils.ts` creates and
  drops a throwaway database per test file on that server, so the `postgres` superuser is required
  (it is, by default).
- **Skipped-test guard without touching app code.** The issue suggests making `hasDatabase === false`
  an error under `CI=true`, but that is a change to `app/.server/db/test-utils.ts`, which is off limits.
  Instead the workflow runs vitest with an extra JSON reporter from the CLI (no config change):
  `pnpm test --reporter=default --reporter=json --outputFile.json=vitest-report.json`,
  and a step runs `node .github/scripts/assert-no-skipped-tests.mjs vitest-report.json`, which fails
  the job when **any** test was skipped (`status` `skipped`/`pending`/`todo`), listing the file and test
  names. On Linux nothing is skipped legitimately today: the only other `skip` is
  `scripts/link-env.test.mjs` (Windows without Developer Mode), and symlinks work on Ubuntu. Failing
  on any skip (rather than on a hard-coded list of DB files) stays correct as DB test files are added.
  `docs/ci.md` documents the rule; a future test that must be skipped in CI needs an allowlist entry
  in the script.
- The guard script is plain `.mjs` (Node built-ins only), so it is formatted and linted by
  `pnpm lint` (`biome.json` includes `**`) but not type-checked (`tsc` has no `allowJs`) and not run by
  vitest (`vitest.config.ts` only includes `app/`, `cms/src/` and `scripts/`). It is verified by hand
  (step 3) instead of a Vitest test, because adding it to the vitest `include` would change
  `vitest.config.ts`.
- **Build env:** `react-router build` reads no env at build time (`vite.config.ts`,
  `react-router.config.ts`), so the `check` job sets only `DATABASE_URL`, `NODE_ENV` is left unset for
  tests, and `pnpm build` needs nothing else. If the build turns out to need `PUBLIC_SITE_URL`, set a
  dummy `https://example.com` on that step.
- **`cms` job:** `dorny/paths-filter` in a small `changes` job (needs `pull-requests: read` on that job
  only, for PR file lists) outputs `cms` when `cms/**`, `pnpm-lock.yaml` or `pnpm-workspace.yaml`
  changed; the `cms` job runs `pnpm install --frozen-lockfile` and `pnpm cms:build` with the dummy
  Strapi variables from `cms/.env.example` (`APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`,
  `TRANSFER_TOKEN_SALT`, `JWT_SECRET`, `ENCRYPTION_KEY`) set as job env. `strapi build` builds the
  admin only and needs no database.
- **The required status check is only `check`**, because a path-filtered job that is skipped would
  block merging if it were required. A failing `cms` job still shows red on the PR.
- **Job time limit:** `timeout-minutes: 15` on each job, so a hung service can't eat the minute budget.
- **README badge:** `[![CI](https://github.com/savchukolgaa/jassmin/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/savchukolgaa/jassmin/actions/workflows/ci.yml)`
  directly under the `# Jassmin` heading. The repo is going public, so the badge renders for everyone.
- **Public repo:** PRs from forks run with a read-only token and no secrets; CI needs no secrets, so
  that's fine. `docs/ci.md` recommends keeping "Require approval for first-time contributors" (the
  default) for workflow runs from forks.
- **Parallel issues #125/#126:** this change touches no file they edit, so merges won't conflict.
  `pull_request` runs check out GitHub's merge ref (PR head merged into `main`), so once this PR is
  merged, the next push to their PRs runs CI automatically, without merging `main` first. They then
  have to pass CI before merging, which is intended.

## Resolved questions
- **Q1: Branch protection isn't available on a private repo with a free plan** (`gh api
  repos/savchukolgaa/jassmin/branches/main/protection` → HTTP 403 "Upgrade to GitHub Pro or make this
  repository public"). — The owner makes the repo **public** (done by the owner in GitHub settings, not
  by this issue). Then branch protection works, Actions minutes are free and unlimited, and the badge
  renders for everyone. `docs/ci.md` documents the protection steps for a public repo. (source: user
  answer)
- **Q2: Node 22 or 24 in CI?** — `.nvmrc` (24), the version used locally; it satisfies `engines`
  (`>=22`). (source: user answer, `.nvmrc`)
- **Which PostgreSQL version does Aspire use?** 18 (`addPostgres` default in Aspire 13.6.3; the local
  Docker images are `postgres:18` / `postgres:18.3`). (source: `aspire.config.json`, `docker images`)
- **How do DB tests find the server?** `getDatabaseUrl` reads `JASSMINDB_URI`, then `DATABASE_URL`;
  `test-utils.ts` creates a database per test file on it, runs migrations through the migrator, and
  only loads `.env` when the file exists (it doesn't in CI). (source: `app/.server/env.ts`,
  `app/.server/db/test-utils.ts`)
- **Do tests need other env vars?** No: tests that need `SESSION_SECRET` stub it with `vi.stubEnv`.
  (source: `app/.server/services/*.test.ts`)
- **How are DB tests skipped?** `describe.skipIf(!hasDatabase)` in ~31 files, plus a local
  `hasDatabase` in `app/.server/db/queries/health.test.ts`; all of them show as skipped in the vitest
  JSON report, which is what the guard checks. (source: `git grep hasDatabase`)
- **Do Windows-only details break on Linux?** `scripts/link-env.mjs` isn't run in CI; its test uses
  symlinks, which work on Linux, and only skips on Windows without Developer Mode. Paths in configs
  use `/` or `[\\/]` regexes (`vite.config.ts`). Nothing to change; the implementer confirms with the
  first CI run. (source: `scripts/link-env.test.mjs:40`, `vite.config.ts`)
- **Is `cms/` in the same lockfile?** Yes, `pnpm-workspace.yaml` lists `.` and `cms`, so one
  `pnpm install --frozen-lockfile` installs both; `aspire-apphost/` has its own lockfile and is not
  needed in CI. (source: `pnpm-workspace.yaml`, `aspire-apphost/pnpm-lock.yaml`)
- **Does a `.github/scripts/*.mjs` file affect `pnpm typecheck`?** No, `tsconfig.json` includes
  `**/*` but has no `allowJs`, so `.mjs` files aren't checked. Biome does lint it. (source:
  `tsconfig.json`, `biome.json`)
- **Free Actions minutes?** Once public, standard GitHub-hosted runners are free and unlimited.
  (source: resolved Q1)

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `.github/workflows/ci.yml` | `changes`, `check` and `cms` jobs |
| create | `.github/scripts/assert-no-skipped-tests.mjs` | Fails CI when the vitest JSON report has skipped tests |
| create | `docs/ci.md` | What CI runs, the skipped-test rule, running it locally, branch protection setup, troubleshooting |
| modify | `README.md` | CI badge under the title; link to `docs/ci.md` near the commands section |
| modify | `docs/skills/open-pr.md` | Wait for green checks (`gh pr checks --watch`) before merging; never bypass them |
| modify | `docs/skills/implement.md` | Only if it describes "checks pass" before pushing: mention CI re-runs them on the PR (check while implementing; skip if nothing fits) |

## Steps
- [x] **1. Worktree setup** — In `.claude/worktrees/issue-142`, run `pnpm --dir "$WT" install` and
  confirm `pnpm typecheck`, `pnpm lint`, `pnpm test` pass locally first (baseline). Run
  `pnpm test --reporter=default --reporter=json --outputFile.json=<scratchpad>/vitest-report.json`
  once with the local DB and once with `DATABASE_URL`/`JASSMINDB_URI` unset, and look at the JSON
  shape (`testResults[].assertionResults[].status`, `numPendingTests`, `numTodoTests`) to write the
  guard against the real output of vitest 5.
- [x] **2. `.github/workflows/ci.yml`, `check` job** — `name: CI`; triggers, `concurrency` and
  `permissions: contents: read` as in Decisions. `check` on `ubuntu-latest`, `timeout-minutes: 15`,
  `services.postgres` (`postgres:18`, health check `pg_isready -U postgres`, interval 5s, retries 10),
  env `DATABASE_URL`. Steps: checkout → `pnpm/action-setup` → `actions/setup-node` (`node-version-file:
  .nvmrc`, `cache: pnpm`) → `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` →
  `pnpm test --reporter=default --reporter=json --outputFile.json=vitest-report.json` →
  `node .github/scripts/assert-no-skipped-tests.mjs vitest-report.json` → `pnpm build`. Each command is
  its own step so the PR shows which one failed. Name the job `check` (`name: check`) so the status
  check is literally `check`.
- [x] **3. `.github/scripts/assert-no-skipped-tests.mjs`** — Reads the report path from `argv[2]`,
  exits 1 with a clear message if the file is missing or unparsable (vitest crashed before writing it),
  collects every assertion with status `skipped`, `pending` or `todo` (and suites reported as skipped)
  and, if any, prints `::error::`-annotated lines `<relative file> › <full test name>` plus a hint ("is
  the PostgreSQL service up and DATABASE_URL set?"), then exits 1. Otherwise prints the number of tests
  checked. Small `ALLOWED_SKIPS` array (empty) documented at the top for future exceptions. Biome style
  (2 spaces, double quotes, width 100). Verify by hand: green against the report with a DB, red (listing
  the DB tests) against the report without one, red on a missing file. Run `pnpm lint`.
- [x] **4. `cms` job** — `changes` job with `dorny/paths-filter` (`permissions: contents: read,
  pull-requests: read`) and a `cms` filter (`cms/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`). `cms`
  job `needs: changes`, `if: needs.changes.outputs.cms == 'true'`, same setup steps, env with the dummy
  Strapi secrets, `pnpm install --frozen-lockfile`, `pnpm cms:build`. On `push` to `main` the filter
  compares to the previous commit, which is fine.
- [ ] **5. `docs/ci.md`** — What runs and when (jobs, triggers, cancel rule); the database service and
  the "no skipped tests in CI" rule with how to add an exception; how to reproduce a CI run locally
  (same commands, a throwaway Postgres via `docker run postgres:18`); dependency caching; the
  fork-PR note; **branch protection, step by step**: Settings → Branches → Add classic branch
  protection rule (or Settings → Rules → Rulesets) for `main`: require a pull request before merging,
  require status checks to pass → add `check`, require branches to be up to date before merging, block
  force pushes, no bypass (the setting needs the repo to be public, or GitHub Pro). Troubleshooting: service not healthy, skipped
  tests, frozen lockfile errors.
- [ ] **6. `docs/skills/open-pr.md`** (+ `implement.md` if it fits) — In the merge section, before
  `gh pr merge`: `gh pr checks <pr-number> --watch --fail-fast`; merge only when every check is green;
  never `--admin` or any other bypass; a red check is fixed in the worktree, committed and pushed, then
  waited for again. After "bring the branch up to date" (step 1), the push re-runs CI, so wait again.
  In the PR description's verification section, mention CI. Mention `docs/ci.md` in
  `docs/skills/README.md` if that index lists related docs.
- [ ] **7. `README.md`** — Badge line under `# Jassmin`; one line in the commands/contributing section
  pointing to `docs/ci.md`.
- [ ] **8. First CI run** — Commit (explicit paths only), push `issue/142`, open the PR with `/open-pr
  142`, and watch the run with `gh pr checks --watch`: all of `check` green, the guard reporting 0
  skipped tests, run time under 10 minutes; a second run (push an empty fix-up or re-run) shows a pnpm
  cache hit. To prove the guard, temporarily push a commit that points `DATABASE_URL` at a wrong port
  in `ci.yml`, see `check` fail on the guard (or on the DB tests), then revert it. Since the PR touches
  `.github/` only, the `cms` job is skipped; prove it once by temporarily adding
  `.github/workflows/ci.yml` to the `cms` filter in a commit, see the job pass, and revert.

## Testing & verification
- No Vitest tests: the change adds no app code, and testing the guard script with Vitest would need a
  `vitest.config.ts` change (out of scope). The guard is verified by hand in step 3 and in CI in step 8.
- Locally in the worktree: `pnpm typecheck`, `pnpm lint` (also lints the new `.mjs`), `pnpm test`,
  `pnpm build` all pass.
- Optional: validate the workflow syntax with `actionlint` if installed (not added to the repo).
- In GitHub (step 8): the PR shows the `check` (and skipped `cms`) checks; the guard fails when the DB is
  unreachable; the run takes under 10 minutes; the second run restores the pnpm cache; the README badge
  renders on the repo page.

## Acceptance criteria
- [ ] Every PR and push to `main` runs typecheck, lint, tests and build on GitHub, and the results show
  on the PR — steps 2, 8
- [ ] The database tests run in CI against a PostgreSQL service, and CI fails if they're skipped —
  steps 2, 3, 8
- [ ] A PR with a failing check can't be merged once branch protection is on (`docs/ci.md` explains the
  setup) — steps 5, 6 (enforced once the owner turns protection on in the public repo)
- [ ] A normal run finishes in under 10 minutes, with dependency caching — steps 2, 8
- [ ] The README shows the CI badge — step 7

## Out of scope
- Any change to app code, `cms/`, `scripts/`, `package.json`, `vitest.config.ts` or the lockfile
  (parallel work on #125/#126), including the `CI=true` guard inside `test-utils.ts` the issue suggests.
- Deploying (the hosting issue), browser/E2E tests, Dependabot.
- Making the repo public and turning on branch protection in GitHub settings (done by the owner,
  following `docs/ci.md`).
- Building or testing `aspire-apphost/` in CI.
