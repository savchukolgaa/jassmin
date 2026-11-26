# Plan: Show the owner a dashboard of real sales, products, customers and the AI perfumer (#183)

Issue: https://github.com/savchukolgaa/jassmin/issues/183
Branch: `issue/183`
Worktree: `.claude/worktrees/issue-183`
Status: Planned

## Goal
The owner wants a private dashboard of the shop's **real** numbers: sales, best-selling perfumes and
sizes, tester-to-bottle conversion, customers (new vs returning, cohorts, churn risk) and the AI
perfumer. Each night a read-only role copies the app's data, without personal details, into a
separate `jassmin_wh` database; the existing dbt warehouse (#132) builds its marts there with a
`prod` target, and an Evidence static site is rebuilt from them and served by Caddy on
`stats.<domain>` behind basic auth. The synthetic pipeline and the notebooks stay exactly as they are.

## Dependencies & prerequisites
- **#132 dbt warehouse** — on `main` (`analytics/warehouse/`). Its `prod` target exists but points at
  the app's `public` tables (`models/staging/_sources.yml`), which this issue changes to `raw` in
  `jassmin_wh`.
- **#131 generator** — on `main`; defines the raw shape (`analytics/generator/frames.py` → `COLUMNS`):
  every column `text`, generator column names. The extract reproduces it.
- **#133 notebooks** — on `main`; `analytics/notebooks/jassmin_ml/db.py` guard stays unchanged.
- **#166 `mart_perfumer_daily`**, **#180 saved chats** (`perfumer_threads` / `perfumer_messages`) — on `main`.
- **#176 production** — on `main`: `aspire-apphost/production.mts`, `deploy/caddy`, `deploy/pg-backup`,
  `deploy/crontab`, `docs/deploy.md`.
- **New tooling:** Evidence (`@evidence-dev/evidence`, `@evidence-dev/core-components`,
  `@evidence-dev/postgres`), pinned exactly, in a standalone pnpm package `analytics/dashboard/`.
- **New Aspire parameters:** `stats-password` (asked for), generated `wh-extract-password`,
  `wh-owner-password`, `wh-reader-password`, `wh-pseudonym-key`.
- **New DNS record:** `stats.<site-domain>` → the server (A/AAAA), documented in `docs/deploy.md`.
- No Drizzle migration: the roles and the database are created by an idempotent setup step (below),
  since they need passwords, which migrations must never hold.

## Decisions & assumptions
1. **Three Postgres roles, least privilege** (created by `analytics/warehouse/extract/setup.py`):
   - `wh_extract` — `LOGIN`, `CONNECT` on `jassmindb`, `USAGE` on `public`, and **column-level**
     `GRANT SELECT (<allow-listed columns>)` on the allow-listed tables only; `ALTER ROLE … SET
     default_transaction_read_only = on`. A column added by a later migration is unreadable to it
     until it's allow-listed, so the allow-list is enforced by Postgres as well as by the extract.
     It has no privilege on `jassmin_wh`.
   - `wh_owner` — `LOGIN`, owns `jassmin_wh` (writes `raw`, runs dbt). It has no table grants in
     `jassmindb` or `strapidb` (their tables belong to `postgres`), so it can't read the app's data.
     `CONNECT` isn't revoked from `PUBLIC` there, to leave the app's setup untouched.
   - `wh_reader` — `LOGIN`, `USAGE` + `SELECT` on schema `marts` and on `raw.extract_runs` only,
     read-only; used by Evidence.
2. **One allow-list, in one place:** `analytics/warehouse/extract/allowlist.py` maps each app table to
   `{generator column: transform}`, where a transform is `copy`, `null`, `pseudonym`, `presence`,
   `path_only`, `origin_only` or `event_properties`. `setup.py` derives the column grants from it, and
   `extract.py` builds its `SELECT` from it. Tables and columns not in it are never read.
3. **Personal columns** (never reach `jassmin_wh`):
   | Table | Column | Transform |
   |-------|--------|-----------|
   | users | `full_name`, `password_hash` | `null` (not granted, written as null so the raw shape holds) |
   | users | `email` | `pseudonym` (below) |
   | users | `phone` | `presence`: `'present'` or null, so `stg_users.has_phone` still works |
   | orders | `guest_full_name`, `guest_phone`, `shipping_address`, `waybill_number` | `null` |
   | orders | `guest_email` | `pseudonym` |
   | sessions, user_events | `anonymous_id` | `pseudonym` (a cookie id; consistent across tables, so joins hold) |
   | sessions | `landing_page` | `path_only` (drops the query string: reset/verify/unsubscribe tokens) |
   | user_events | `referrer` | `origin_only` (scheme + host) |
   | user_events | `event_properties` | `event_properties`: `page_view.path` → path only; `search.query` → null; everything else as is (the #129 contract has no other free text, and perfumer events never hold text, `docs/analytics-events.md` → AI perfumer events) |
   | inventory_movements | `note` | `null` (staff free text) |
   | payments | `provider_payment_id`, `last_callback` | not in the raw shape, never read (`last_callback` can hold card and payer details) |
   | — | `perfumer_threads`, `perfumer_messages`, `auth_tokens`, `gift_cards`, `gift_card_redemptions`, `order_emails`, `email_suppressions`, `newsletter_*`, `rate_limits`, `cms_outbox`, `product_slug_history`, `product_recommendations` | not allow-listed, never read |
   No IP address is stored anywhere in the app's tables (checked: `schema.ts`), so there's nothing to drop.
4. **Pseudonym** = `hmac_sha256(WH_PSEUDONYM_KEY, lower(trim(value)))`, first 32 hex chars. For emails
   it's `<hash>@example.com` when the real address is `@example.com` (test accounts, which staging
   recognises by that domain and every mart drops), else `<hash>@pseudonym.invalid`. This keeps
   `stg_users.is_test_account` and the guest `customer_key` (md5 of the normalised email, so a guest's
   repeat orders stay one customer) working, with staging unchanged. The key is a persisted generated
   Aspire secret, so customer keys are stable night to night **(unconfirmed, Q1)**.
5. **Raw shape:** the extract writes `jassmin_wh.raw.<table>` with exactly `frames.COLUMNS[table]`
   (imported from the generator's module list, copied into `allowlist.py` with a test that they match),
   every column `text`, via `COPY (SELECT …) TO STDOUT` → transform in Python → `COPY … FROM STDIN`.
   It loads into a fresh `raw_next` schema in one transaction, then swaps it for `raw`
   (`DROP SCHEMA raw CASCADE; ALTER SCHEMA raw_next RENAME TO raw`), so a failed extract leaves
   yesterday's raw untouched. It also writes `raw.extract_runs` (started/finished, git commit, row
   counts), which the dashboard reads for "data as of". `raw.customer_truth` and
   `raw.generation_runs` are never written in `jassmin_wh`.
6. **dbt `prod` target:** the source schema is `raw` on both targets (the `public` branch in
   `_sources.yml` goes away, and the `casts.sql` comment about typed tables is updated). `wh.py
   --target prod` resolves `WAREHOUSE_PROD_URL` and refuses any database not named `jassmin_wh` (or
   `jassmin_wh_<suffix>` for throwaway tests) and the app's database; `synth` keeps refusing anything
   but `jassmin_synth[_suffix]`. No model reads `raw.customer_truth` today (checked by grep), so the
   exclusion is a guard, not a change: a `prod` selector `--exclude source:raw.customer_truth+`, and a
   pytest that fails if a model ever reads it.
7. **New marts** (built on both targets, tested on the synth fixture):
   - `mart_sales_daily` — Kyiv day × revenue, orders, average order, items, from `fct_orders`
     (`is_revenue`), with `dim_date` for week/month roll-ups.
   - `fct_gift_card_sales` — gift card purchases: `stg_payments` rows with `order_id is null` and
     `status = 'succeeded'` (a gift card payment has no order, `schema.ts` → `payments_target_check`);
     redemptions come from `fct_orders.gift_card_amount`. On synth it's empty (the generator makes
     none); the fixture gets one such payment row.
   - `mart_tester_conversion` — one row per customer whose first "trio" revenue order is an order with
     `discount_slug = 'tester-trio'` or a `pack_size > 1` tester-set line; `converted_60d` = a later
     revenue order with a single 30/50/100 ml line within 60 days; `is_window_complete` when 60 days
     have passed before `int_data_window.data_end_at`.
   - `mart_customer_rfm` — each customer's latest RFM as of the data's end, with a segment
     (`new`, `active`, `at_risk`, `lost`, `one_time`) from fixed rules (Q4), no ML model.
   Stock running out: computed in the dashboard from `fct_inventory_daily` (last 28 days' average
   daily sales vs closing stock → days of cover), no new mart.
8. **Failing tests keep yesterday's dashboard:** the nightly script is `set -euo pipefail`:
   extract → `wh.py build --target prod` → Evidence `sources` + `build` into a new directory →
   atomic switch of the served `current` symlink. Any failure stops before the switch. dbt's tests
   stay errors, as in #132.
9. **Where it runs:** a new image `deploy/analytics/Dockerfile` (repo-root context, with its own
   `deploy/analytics/Dockerfile.dockerignore`, since the root `.dockerignore` excludes `analytics/`):
   Python 3.12 + uv (locked `analytics/warehouse` deps, `dbt deps` at build time), Node 24 + pnpm
   (Evidence), supercronic. Two Compose services from it:
   - `analytics-setup` — one-off per deploy, after `db-migrate`: `setup.py` with the `postgres`
     superuser creates `jassmin_wh`, the roles, passwords and grants (idempotent; re-run each deploy
     so a changed allow-list re-grants).
   - `analytics` — supercronic with `deploy/analytics/crontab`, nightly at **01:00 UTC** (03:00/04:00
     Kyiv, the Kyiv day is complete, before `pg-backup` at 02:00). It gets only the three role
     URLs and the pseudonym key, never the superuser password. It writes the site into the
     `jassmin-stats-site` volume, mounted read-only into `proxy`.
   Not the existing `scheduler`: that's the Node-only `jobs` image, and the app's jobs must not get
   analytics credentials or the other way round.
10. **Caddy:** `stats.{$SITE_DOMAIN}` (derived, no new domain parameter, Q2) serves
    `/srv/stats/current` with `file_server`, `basic_auth` user `owner` and a bcrypt hash computed at
    container start from `STATS_PASSWORD` (a small `deploy/caddy/entrypoint.sh` runs `caddy
    hash-password` and exports `STATS_PASSWORD_HASH`), plus `X-Robots-Tag: noindex` and
    `Cache-Control: no-store`. Until the first build exists it serves a static "no data yet" page.
11. **Backups:** `pg-backup` dumps only `BACKUP_DATABASES=jassmindb strapidb`, so `jassmin_wh` is
    already excluded; this is made explicit in `production.mts`'s comment, `backup.sh`'s header and
    `docs/deploy.md`.
12. **Evidence under pnpm:** `analytics/dashboard/` is a standalone pnpm package with its own lockfile
    (like `aspire-apphost/`), installed with `pnpm install --ignore-workspace`, not in
    `pnpm-workspace.yaml`; Biome and `tsc` already ignore `analytics/` **(unconfirmed, Q3)**.
13. **Dashboard copy is Ukrainian only** (owner-only page, not the shop's i18n system), with UAH
    formats (`#,##0 ₴`) and Kyiv dates. Each page starts with "Дані на <extract finished_at, Kyiv>"
    from `raw.extract_runs`, and a warning banner when it's older than 36 hours.
14. **CI:** the `analytics` job gains a step for `uv run --project analytics/warehouse --locked pytest
    analytics/warehouse` with `WAREHOUSE_TEST_SERVER_URL` pointed at its Postgres service, so the
    warehouse build test and the new extract privacy tests run on every analytics change. Evidence's
    build is checked in CI with a fixture source (step 12) if it fits the 15-minute job, else locally.

## Open questions
- [ ] **Q1: Pseudonymise emails and visitor ids with a keyed hash, or drop them?** — Why it matters:
  dropping `email` / `guest_email` breaks guest identity (each guest order becomes a new customer, so
  "returning customers" and cohorts undercount) and test-account filtering; a keyed hash with a secret
  key keeps both and is not reversible without the key. Recommended default: HMAC with the persisted
  `wh-pseudonym-key` secret, as in decision 4. Affects steps: 2, 3.
- [ ] **Q2: Is `stats.<site-domain>` right, or should the dashboard have its own domain parameter
  (like `admin-domain`)?** — Why it matters: DNS and Caddy config. Recommended default: derived
  `stats.{$SITE_DOMAIN}`, no new parameter. Affects steps: 13, 14.
- [ ] **Q3: Is Evidence allowed as a pnpm package with its own lockfile?** — Why it matters: Evidence's
  own docs use npm, and AGENTS.md forbids npm/yarn. Recommended default: pnpm with `--ignore-workspace`;
  if Evidence doesn't build under pnpm, stop and ask rather than switching tools. Affects steps: 10–12.
- [ ] **Q4: Churn-risk rules.** — Why it matters: segment counts on the customers page. Recommended
  default: `one_time` = 1 revenue order and last order > 90 days ago; `new` = first order ≤ 90 days
  ago; `active` = ≥ 2 orders and recency ≤ 1.5 × their median gap (min 60 days); `at_risk` = ≥ 2
  orders and recency between that and 180 days; `lost` = > 180 days. Thresholds as dbt vars so they
  can be tuned. Affects steps: 7, 11.
- [ ] **Q5: Basic-auth password: asked for on deploy, or generated?** — Why it matters: a generated
  one has to be looked up in Aspire's state. Recommended default: asked-for secret parameter
  `stats-password`, user name `owner`. Affects steps: 13, 14.

## Resolved questions
- **Does any model read `raw.customer_truth` or another generator-only table?** — No: only
  `_sources.yml` declares it, and `generation_runs` isn't read by any model (`grep` over
  `analytics/warehouse/models`). (source: `analytics/warehouse/README.md` → Layers)
- **Do perfumer events carry message text?** — No; text only lives in `perfumer_threads` /
  `perfumer_messages`, guarded by `app/.server/perfumer-privacy.guard.test.ts`. Those tables are not
  allow-listed. (source: `docs/analytics-events.md` → AI perfumer events, #180)
- **Is `jassmin_wh` already out of the backups?** — Yes, `pg-backup` dumps only `BACKUP_DATABASES`
  (`jassmindb strapidb`). (source: `aspire-apphost/production.mts`, `deploy/pg-backup/backup.sh`)
- **Is an IP stored anywhere?** — No IP column in the app schema. (source: `app/.server/db/schema.ts`)
- **Where are gift card sales?** — A gift card purchase is a `payments` row with `order_id` null and
  `gift_card_id` set; `raw.payments` already carries `order_id`, so no new raw table is needed.
  (source: `schema.ts` → `payments_target_check`; `frames.COLUMNS["payments"]`)
- **How is the tester trio sold?** — As the `tester-trio` discount rule (3 × single 10 ml) and a
  3 × 10 ml tester-set product (`pack_size` 3). (source: `app/.server/db/seed-data.ts`, #98)
- **Can the existing `scheduler` run the pipeline?** — No: it's the Node `jobs` image, built with
  `analytics/` excluded by `.dockerignore`. (source: `Dockerfile`, `.dockerignore`)
- **Do the notebooks need a change?** — No; `jassmin_ml/db.py` refuses everything but
  `jassmin_synth[_suffix]`, and this plan adds a test that `jassmin_wh` is refused too.
  (source: `analytics/notebooks/jassmin_ml/db.py`)

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `analytics/warehouse/extract/__init__.py` | Package |
| create | `analytics/warehouse/extract/allowlist.py` | Tables, generator columns and transforms (the single allow-list) |
| create | `analytics/warehouse/extract/transforms.py` | `pseudonym`, `presence`, `path_only`, `origin_only`, `event_properties` |
| create | `analytics/warehouse/extract/extract.py` | Nightly read-only copy into `jassmin_wh.raw` (guards, `raw_next` swap, `extract_runs`) |
| create | `analytics/warehouse/extract/setup.py` | Idempotent: create `jassmin_wh`, roles, passwords, column grants |
| create | `analytics/warehouse/tests_py/test_allowlist.py` | No personal column copied as is; columns match `frames.COLUMNS`; every grant column exists |
| create | `analytics/warehouse/tests_py/test_transforms.py` | Unit tests of each transform |
| create | `analytics/warehouse/tests_py/test_extract.py` | End to end on a migrated throwaway app DB with sentinel personal values |
| modify | `analytics/warehouse/wh.py` | `prod` guard (`jassmin_wh[_suffix]`, not the app DB); `prod` excludes `customer_truth` dependents |
| modify | `analytics/warehouse/tests_py/test_wh.py` | Guard tests for `prod` |
| modify | `analytics/warehouse/models/staging/_sources.yml` | Source schema `raw` on both targets; `extract_runs` |
| modify | `analytics/warehouse/macros/casts.sql`, `profiles.yml` | Comments: prod reads the text copy |
| create | `analytics/warehouse/models/marts/sales/mart_sales_daily.sql`, `_sales__models.yml` | Daily sales |
| create | `analytics/warehouse/models/marts/sales/fct_gift_card_sales.sql` | Gift card purchases |
| create | `analytics/warehouse/models/marts/customers/mart_tester_conversion.sql`, `_customers__models.yml` | Trio → full bottle within 60 days |
| create | `analytics/warehouse/models/marts/customers/mart_customer_rfm.sql` | RFM and churn-risk segment |
| create | `analytics/warehouse/tests/assert_sales_daily_reconciles.sql` | Daily sales add up to `fct_orders` |
| modify | `analytics/warehouse/models/marts/**/_*__models.yml`, `dbt_project.yml` | Docs, tests, RFM vars |
| modify | `analytics/warehouse/tests/assert_marts_have_no_personal_data.sql` | `depends_on` the new marts |
| modify | `analytics/warehouse/fixtures/raw_fixture.sql` | Gift card payment, trio orders, RFM cases |
| modify | `analytics/warehouse/tests_py/test_build.py` | Assertions on the new marts |
| create | `analytics/warehouse/scripts/nightly.sh` | extract → dbt build → Evidence build → atomic publish |
| create | `analytics/dashboard/` (`package.json`, `pnpm-lock.yaml`, `evidence.config.yaml`, `sources/warehouse/connection.yaml` + `*.sql`, `pages/index.md`, `pages/sales.md`, `pages/products.md`, `pages/testers.md`, `pages/customers.md`, `pages/perfumer.md`, `README.md`, `.gitignore`) | The Evidence dashboard |
| create | `deploy/analytics/Dockerfile`, `deploy/analytics/Dockerfile.dockerignore`, `deploy/analytics/crontab` | Analytics image and schedule |
| modify | `deploy/caddy/Caddyfile`, `deploy/caddy/Dockerfile`; create `deploy/caddy/entrypoint.sh`, `deploy/caddy/no-data/index.html` | `stats.` site with basic auth |
| modify | `aspire-apphost/production.mts` | Parameters, `analytics-setup`, `analytics`, volume, Caddy env |
| modify | `aspire-apphost/AGENTS.md` | Services and parameters |
| modify | `deploy/pg-backup/backup.sh` | Header: `jassmin_wh` deliberately not dumped |
| modify | `.github/workflows/ci.yml` | Warehouse pytest step |
| modify | `analytics/README.md`, `analytics/warehouse/README.md`, `docs/deploy.md`, `AGENTS.md` | Documentation |

## Steps
- [x] **1. Allow-list and transforms** — `allowlist.py`: `TABLES: dict[str, dict[str, Transform]]` for
  the 13 tables of `frames.COLUMNS` (minus `customer_truth`), keyed by the generator's column names,
  with the app column each one reads (`email` → `users.email`; `null` columns read nothing).
  `transforms.py` implements decision 3/4 as pure functions. Tests: `test_transforms.py` (each
  transform, including `@example.com` handling, empty/None, URLs with tokens) and `test_allowlist.py`
  (columns equal `frames.COLUMNS` per table; every name matching
  `full_name|email|phone|address|password|waybill|note|ip|referrer|landing_page|anonymous_id|event_properties`
  has a non-`copy` transform; nothing reads `perfumer_*`). `uv run --project analytics/warehouse pytest`.
- [x] **2. Setup script** — `setup.py` (psycopg, admin URL from `WH_ADMIN_URL`): create database
  `jassmin_wh` if missing; create/alter roles `wh_extract`, `wh_owner`, `wh_reader` with passwords
  from env; `REVOKE ALL` on `public` tables from `wh_extract` then `GRANT SELECT (cols)` from the
  allow-list; `ALTER ROLE wh_extract SET default_transaction_read_only = on`; `ALTER DATABASE
  jassmin_wh OWNER TO wh_owner`; reader grants on `marts` (+ `ALTER DEFAULT PRIVILEGES FOR ROLE
  wh_owner IN SCHEMA marts GRANT SELECT TO wh_reader`). Identifiers via `psycopg.sql`. The app
  database is named explicitly (`--app-db jassmindb`) and must differ from `jassmin_wh`. Idempotent
  (the test runs it twice).
- [x] **3. Extract** — `extract.py`: connect to the app with `WH_EXTRACT_URL` (assert the session is
  read-only: `show transaction_read_only` = on, else exit 2) and to `WH_TARGET_URL` (guard: name
  `jassmin_wh[_suffix]`, never equal to the app DB name + host). In one `jassmin_wh` transaction:
  `drop schema if exists raw_next cascade`, create text tables, stream each table
  (`COPY (select <granted cols> from public.<t>) TO STDOUT (FORMAT csv)`), transform row by row,
  `COPY … FROM STDIN`; insert `raw_next.extract_runs`; swap schemas; commit. Re-grant
  `raw.extract_runs` to `wh_reader`. Logs row counts, never values.
- [x] **4. Extract privacy test** — `test_extract.py` (skipped without a server, like `test_build.py`):
  create `jassmin_app_test_<pid>`, run `pnpm db:migrate` against it (as the generator's `db.migrate`
  does), insert a user, guest order, session, events (`page_view` with `?token=SECRET`, `search` with a
  query), payment with `last_callback`, inventory note and a perfumer thread/message, each with unique
  sentinel strings; run `setup.py` and `extract.py` into `jassmin_wh_test_<pid>`; then scan **every
  text column of every table** in `jassmin_wh_test_<pid>` for each sentinel (email, name, phone,
  address, waybill, password hash, token, query, note, message text) → none found. Also: `wh_extract`
  can't `select *` from `users` (permission denied) and can't `insert` (read-only). Assert the app DB's
  row counts and `pg_stat_user_tables.n_tup_ins/upd/del` are unchanged by the extract.
- [x] **5. `wh.py` prod target** — `resolve("prod")`: `WAREHOUSE_PROD_URL`, guard `jassmin_wh(_suffix)?`
  and ≠ app DB; `--target prod` adds `--exclude source:raw.customer_truth+` to `build`/`run`/`test`.
  `_sources.yml` schema → `raw`. Tests in `test_wh.py` (prod refuses `jassmindb`, `jassmin_synth`,
  missing URL; synth unchanged). Extend `test_extract.py`: after the extract, `wh.py build --target
  prod` on `jassmin_wh_test_<pid>` succeeds.
- [x] **6. Notebook guard check** — add a case to `analytics/notebooks/tests/test_db.py` that
  `jassmin_wh` is refused. No code change.
- [x] **7. New marts** — `mart_sales_daily`, `fct_gift_card_sales`, `mart_tester_conversion`,
  `mart_customer_rfm` (decision 7, RFM vars in `dbt_project.yml`), with yml docs and tests
  (`unique`/`not_null` keys, `accepted_values` for segments, a reconciliation test that
  `mart_sales_daily` revenue sums to `fct_orders` net revenue). Add them to
  `assert_marts_have_no_personal_data`'s `depends_on`. Extend `raw_fixture.sql` and `test_build.py`
  with rows that pin each result (a trio buyer converting on day 59 and one on day 61, a gift card
  payment, one customer per RFM segment). Run the synth build test and `scripts/check_docs.py`.
- [x] **8. Nightly script** — `scripts/nightly.sh`: `set -euo pipefail`; `uv run … extract/extract.py`;
  `uv run … wh.py build --target prod`; `pnpm --dir analytics/dashboard sources && … build`; copy
  `build/` to `$SITE_DIR/releases/<UTC stamp>`; `ln -sfn` + `mv -T` to switch `current`; keep the last
  3 releases. Logs each stage with timings. Exit non-zero on any failure (supercronic logs it).
- [x] **9. CI** — add the warehouse pytest step to the `analytics` job (`WAREHOUSE_TEST_SERVER_URL`),
  and `analytics/dashboard/**` is already under the `analytics/**` path filter.
- [x] **10. Evidence project** — scaffold `analytics/dashboard/` from Evidence's template by hand
  (package.json with exact versions, `"packageManager"` matching the root, `pnpm install
  --ignore-workspace`), `evidence.config.yaml` with only the postgres plugin, `sources/warehouse/
  connection.yaml` reading `EVIDENCE_SOURCE__warehouse__*` env vars (host, port, database
  `jassmin_wh`, user `wh_reader`, password, `schema: marts`). Source queries: one per mart used, plus
  `extract_runs`. `.gitignore` for `.evidence/`, `build/`, `node_modules/`. Check `pnpm build` works
  against a locally extracted `jassmin_wh` (or the synth marts via a dev-only connection override).
- [x] **11. Dashboard pages (uk)** — every page opens with the "Дані на …" line and the stale banner.
  - `index.md`: headline numbers for yesterday / last 7 / last 30 days vs the previous period.
  - `sales.md`: revenue, orders, average order by day/week/month (selector), vs previous period.
  - `products.md`: top perfumes and sizes (net revenue, units), families, gift card sales and
    redemptions, and "закінчується" — sizes with ≤ 14 days of cover (`fct_inventory_daily`).
  - `testers.md`: share of trio buyers converting within 60 days, by month of the trio order (only
    complete windows), and median days to the bottle.
  - `customers.md`: new vs returning per month, monthly cohort retention grid, cities, acquisition
    channels, RFM segment counts and trend.
  - `perfumer.md`: `mart_perfumer_daily` — messages, conversations, p50/p95 answer time, error and
    rate-limited share, click-through, 7-day conversion, 👍/👎.
- [x] **12. Dashboard build check** — a small fixture mode (`EVIDENCE_SOURCE__warehouse__database`
  pointed at the synth test DB built by `test_build.py`) so `pnpm --dir analytics/dashboard build`
  is exercised in CI after the warehouse tests, if it fits the job's time limit; otherwise documented
  as a manual pre-PR check.
- [x] **13. Image, Caddy, cron** — `deploy/analytics/Dockerfile` (+ `.dockerignore` allowing only
  `analytics/warehouse`, `analytics/dashboard`, `analytics/generator/frames.py` if imported,
  `deploy/analytics`), non-root user, `uv sync --locked`, `dbt deps`, `pnpm install --frozen-lockfile
  --ignore-workspace`; `crontab`: `0 1 * * * /app/analytics/warehouse/scripts/nightly.sh`. Caddy:
  `stats.{$SITE_DOMAIN}` block (decision 10), `entrypoint.sh`, `no-data` fallback via
  `try_files`. Build both images locally (`docker build`) to check.
- [ ] **14. Aspire production** — in `production.mts`: parameters `stats-password` (secret, asked)
  and generated `wh-extract-password`, `wh-owner-password`, `wh-reader-password`, `wh-pseudonym-key`;
  `postgres.addDatabase` is **not** used for `jassmin_wh` (setup creates it with its owner);
  `analytics-setup` (`addDockerfile("analytics-setup", "..", { dockerfilePath:
  "deploy/analytics/Dockerfile" })`, args `uv run … extract/setup.py`, `WH_ADMIN_URL` with the
  postgres password, the three role passwords, `waitForCompletion(dbMigrate)`); `analytics` (same
  image, supercronic, the three role URLs built with `refExpr` from the postgres endpoint, the key,
  volume `jassmin-stats-site` at `/srv/stats`, `waitForCompletion(analyticsSetup)`,
  `restartUnlessStopped`); `proxy` gets the volume read-only and `STATS_PASSWORD`. Comment that
  `jassmin_wh` isn't backed up. `pnpm aspire:build` and `pnpm aspire publish -o aspire-output` to
  inspect the Compose file (no secrets in it, `analytics` has no superuser password).
- [ ] **15. Documentation** — `analytics/README.md`: "Real data: the one exception" (what's copied, by
  whom, the allow-list, pseudonyms, what never leaves the app, notebooks stay synth-only);
  `analytics/warehouse/README.md`: replace "The `prod` target" section, document the extract and the
  new marts; `analytics/dashboard/README.md`: running locally, adding a page; `docs/deploy.md`: DNS
  record for `stats.`, the `stats-password` parameter, running the pipeline by hand (`docker compose
  exec analytics /app/analytics/warehouse/scripts/nightly.sh`), logs, and that `jassmin_wh` is
  rebuildable and not backed up; `aspire-apphost/AGENTS.md`: services and parameters; root
  `AGENTS.md`: the rule "analytics reads real data only through the pseudonymised `jassmin_wh` copy;
  a new app column reaches it only by being added to `extract/allowlist.py`".
- [ ] **16. Full check** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; warehouse pytest
  (with a server) and `wh.py build` on synth; generator and notebook pytest unchanged and green.

## Testing & verification
- **Python (warehouse project):** `test_transforms.py`, `test_allowlist.py` (unit); `test_extract.py`
  (sentinel scan over all of `jassmin_wh`, role privileges, app DB untouched, then `dbt build --target
  prod`); `test_wh.py` (guards); `test_build.py` (new marts on the synth fixture). Run with
  `WAREHOUSE_TEST_SERVER_URL=postgres://postgres:…@localhost:5432/postgres uv run --project
  analytics/warehouse pytest analytics/warehouse`.
- **Synthetic pipeline unchanged:** `uv run --project analytics pytest analytics`, `wh.py build`
  (synth), `uv run --project analytics/notebooks pytest analytics/notebooks`.
- **Repo:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm aspire:build`.
- **Manual:** locally, run `setup.py` + `extract.py` against the dev `jassmindb` into a local
  `jassmin_wh`, `wh.py build --target prod`, `pnpm --dir analytics/dashboard dev` and check each page
  and the date line; make one dbt test fail on purpose and confirm `nightly.sh` exits before the
  switch and the previous release stays `current`. After deploy: `stats.<domain>` asks for the
  password, then shows the pages.

## Acceptance criteria
- [ ] A nightly job copies the shop's data into `jassmin_wh` using a read-only role; the app's database is never written — steps 2, 3, 4, 8, 13, 14
- [ ] No email, phone, name, password hash, address, IP or perfumer message text reaches `jassmin_wh` (tested) — steps 1, 3, 4
- [ ] `dbt build --target prod` builds and tests the marts on the copy; a failing test keeps the previous dashboard — steps 5, 7, 8
- [ ] `stats.<domain>` shows sales, products, tester-to-bottle conversion, customers and AI perfumer pages, behind a password — steps 10, 11, 13, 14
- [ ] The notebooks still refuse every database except `jassmin_synth` — step 6
- [ ] The synthetic pipeline (#131–#133) works as before — steps 5, 7, 16
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass, and the warehouse's pytest and dbt tests pass — steps 9, 16

## Out of scope
- Training or scoring ML models on real data; the notebooks stay on `jassmin_synth`.
- Live or intra-day numbers (nightly only).
- Dashboards for staff other than the owner, per-user logins, email reports.
- A Postgres read replica or `postgres_fdw`: the nightly copy replaces both.
- Backing up `jassmin_wh` (it's rebuilt from the app's database each night).
- Changing the generator's raw shape or its fixtures.
