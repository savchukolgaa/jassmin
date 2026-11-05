# Continuous integration

GitHub Actions runs the checks from `AGENTS.md` on every pull request and every push to `main`
(#142). The workflow is `.github/workflows/ci.yml`; its runs are under the repo's **Actions** tab and
on each PR's **Checks** section.

## What runs

| Job | When | Steps |
|-----|------|-------|
| `check` | Every PR and push to `main` | `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (with PostgreSQL), skipped-test check, `pnpm build` |
| `changes` | Every run | Decides whether `cms` has to run |
| `cms` | Only when `cms/**`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` changed | `pnpm install --frozen-lockfile`, `pnpm cms:build` |

- **Runner:** `ubuntu-latest`. Node comes from `.nvmrc`, pnpm from `packageManager` in
  `package.json`, so CI uses the same versions as local development.
- **Caching:** `actions/setup-node` caches the pnpm store, keyed on `pnpm-lock.yaml`. A normal run
  takes a few minutes; every job has a 15-minute time limit.
- **Cancelling:** a new push to a PR cancels that PR's run still in progress. Runs for pushes to `main`
  are never cancelled.
- **Permissions:** the workflow token can only read the repo (`contents: read`; the `changes` job also
  reads the PR's file list). CI uses no secrets: the Strapi build gets dummy values.
- **Required check:** only `check` is required for merging (see below). `cms` is skipped on most PRs,
  and a skipped required check would block them; when it runs and fails, it still shows red on the PR.

## The database tests

`check` starts a `postgres:18` service container, the same major version Aspire runs locally, and sets
`DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres`. Each DB test file creates and drops
its own throwaway database on that server (`app/.server/db/test-utils.ts`).

Without a database those tests skip themselves (`describe.skipIf(!hasDatabase)`), which is fine on a
laptop but would hide them in CI. So vitest also writes a JSON report, and
`.github/scripts/assert-no-skipped-tests.mjs` **fails the run if any test was skipped**, listing each
one. A broken service, a wrong `DATABASE_URL` or a stray `it.skip` all turn the run red.

If a test genuinely can't run on the Linux runner, add it to `ALLOWED_SKIPS` in that script as
`<file> › <full test name>`, with a comment saying why. Prefer fixing the test.

## Running the same checks locally

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test --reporter=default --reporter=json --outputFile.json=vitest-report.json
node .github/scripts/assert-no-skipped-tests.mjs vitest-report.json
pnpm build
```

Use the database from `.env` (or `pnpm aspire run`), or a throwaway one like CI's:

```bash
docker run --rm -d --name ci-postgres -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:18
DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres pnpm test
docker stop ci-postgres
```

On Windows without Developer Mode, `scripts/link-env.test.mjs` skips its symlink test, so the
skipped-test check reports it locally. On the Linux runner it runs.

## Protecting `main`

Branch protection makes GitHub refuse to merge a PR until `check` is green. It needs a **public** repo
(or GitHub Pro for a private one); on a private repo with a free plan the settings page and the API
answer "Upgrade to GitHub Pro or make this repository public".

The owner sets it up once, after the workflow has run at least once (so GitHub knows the `check`
status):

1. Open the repo on GitHub → **Settings** → **Branches** → **Add classic branch protection rule**.
   (**Settings** → **Rules** → **Rulesets** → **New branch ruleset** works too, with the same options
   under different names.)
2. **Branch name pattern:** `main`.
3. Tick **Require a pull request before merging**. Leave "Require approvals" off: the repo has one
   developer, and GitHub doesn't let you approve your own PR.
4. Tick **Require status checks to pass before merging**, then:
   - tick **Require branches to be up to date before merging**;
   - in the search box, type `check` and add the `check` job (shown as `check` with GitHub Actions as
     its source). Don't add `cms`.
5. Tick **Do not allow bypassing the above settings**, so the rule applies to admins too.
6. Leave **Allow force pushes** and **Allow deletions** unticked.
7. **Create** (or **Save changes**).

To check it: `gh api repos/savchukolgaa/jassmin/branches/main/protection --jq
'.required_status_checks.contexts'` prints `["check"]`.

With the rule on, `gh pr merge` waits for or refuses a PR whose `check` isn't green, and a PR behind
`main` has to merge `main` first (`docs/skills/open-pr.md` already does). Never merge with `--admin`
or switch the rule off to get a PR in: fix the check instead.

### Public repo notes

- PRs from forks run CI with a read-only token and no secrets, which this workflow doesn't need. Keep
  the default **Settings** → **Actions** → **General** → "Require approval for first-time
  contributors", so a stranger's PR doesn't run workflows until you approve it.
- `.env` files are git-ignored and never committed; check `git log` for secrets before making a repo
  public.

## Troubleshooting

- **Skipped tests:** the job log lists every skipped test. If it's all the DB tests, the `postgres`
  service didn't start or `DATABASE_URL` is wrong: open the "Initialize containers" step. If it's one
  test, look for an `it.skip`, `describe.skip` or a `skipIf` condition that is true on Linux.
- **`ERR_PNPM_OUTDATED_LOCKFILE`:** `package.json` changed without `pnpm install`. Run it locally and
  commit `pnpm-lock.yaml`.
- **Works locally, fails in CI:** CI starts from a clean checkout, without `.env`, on Linux. Look for
  files that exist only locally, case-sensitive import paths, and `\` in paths.
- **Re-running:** the run's page → **Re-run jobs**, or `gh run rerun <run-id> --failed`.
