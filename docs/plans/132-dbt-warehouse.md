# Plan: Build a raw → staging → marts warehouse with dbt and data-quality tests (#132)

Issue: https://github.com/savchukolgaa/jassmin/issues/132
Branch: `issue/132`
Worktree: `.claude/worktrees/issue-132`
Status: Implemented (the Aspire resources wait for #131 to merge, see step 11)

## Goal
As a data analyst, I want a layered warehouse (raw → staging → intermediate → marts) built from
the shop's data, so that BI dashboards and ML models read clean, documented, tested tables instead
of the app's tables. A dbt project in `analytics/warehouse/` cleans every anomaly in #131's
catalogue in staging, builds star-schema marts (orders, order items, sessions, events, customers,
products, dates, daily inventory) plus a point-in-time ML feature table, and proves it all with
data tests and `dbt docs`.

## Dependencies & prerequisites
- **#131 (synthetic data generator): in progress on `issue/131`, not merged or pushed.** Its raw
  contract (`analytics/generator/frames.py` `COLUMNS`, every column `text`) and anomaly catalogue
  (`analytics/README.md`) were read from its worktree, and its generator was run read-only with
  `--no-db --out` (10,000 customers, seed 42) to load a local `jassmin_synth` for verification.
  Merging needs nothing from #131 except the Aspire resource (step 11): this branch makes the same
  edits as #131 to `vite.config.ts` and `biome.json`, so the two merge cleanly.
- **#128, #129, #130**: merged.
- Python (separate uv project `analytics/warehouse/`): `dbt-core` 1.12, `dbt-postgres` 1.11,
  `psycopg[binary]` 3; dev `pytest`. dbt package `dbt-labs/dbt_utils` 1.4.1 (`package-lock.yml`).
- No app migrations, no app env vars, no changes under `app/`.

## Decisions & assumptions
- **Separate uv project in `analytics/warehouse/`** (deviation: the plan said the shared `analytics/`
  environment). #131 owns `analytics/pyproject.toml`, which isn't merged; a second project avoids
  conflicts and keeps dbt's large dependency tree out of the generator's environment.
  `analytics/warehouse/conftest.py` skips the warehouse tests when pytest is started from
  `analytics/` (#131's CI job), whose environment has no dbt.
- **`wh.py` wrapper.** All dbt commands go through `analytics/warehouse/wh.py`, which resolves the
  database like #131's generator (`WAREHOUSE_DATABASE_URL`, `JASSMIN_SYNTH_URI`, `SYNTH_DATABASE_URL`,
  else `DATABASE_URL` with the database name replaced by `jassmin_synth`), refuses any database not
  named `jassmin_synth[_suffix]` and the app's own, and sets the `WAREHOUSE_*` env vars that
  `profiles.yml` reads (no secret in the repo). It runs `dbt deps` on first use.
- **Targets.** `synth` (default) reads schema `raw`; `prod` reads `public` from
  `WAREHOUSE_PROD_URL` and is defined but not run (Q2 default). The casts go through `::text`, so they
  work on the typed app tables too.
- **Schemas.** `generate_schema_name` writes exactly `staging`, `intermediate`, `marts`. Staging and
  intermediate are views, marts tables. `persist_docs` puts the descriptions on the relations.
- **Customer identity.** `customer_key = md5('u:' || user_id)` or `md5('g:' || normalised guest
  email)`; the id and email never reach the marts.
- **Kyiv time.** Every timestamp is `timestamptz` from staging on; every date is a Kyiv date.
  Money is `numeric(12, 2)`.
- **Staging is one model per raw table**; `stg_sessions` reads `stg_user_events` (bot flag),
  `stg_orders` reads `stg_order_items` and `stg_order_status_history` (typo and timeline fixes),
  `stg_order_items` reads the catalog (orphan products).
- **Test accounts are flagged in staging, excluded downstream** (deviation: the plan said dropped
  from `stg_users` plus an `int_excluded_users` model). `stg_users.is_test_account` and
  `stg_orders.is_test_account` keep the cleaning auditable; `int_orders`, `int_sessions` and
  `int_events` drop them, so no mart sees them. `int_excluded_users` wasn't needed.
- **Anomaly handling**: the table in `analytics/warehouse/README.md`, with the rates measured on
  #131's default run. Changes from the plan, found on the generated data:
  - **Double-fired events** also require identical `event_properties`. With session, type and
    product alone, the rule dropped 2.39 % of rows instead of the catalogue's 1.5 %: two page views
    a moment apart (different pages) and quick "+" clicks are real. With properties it drops 1.50 %,
    which is also #131's definition of a double fire.
  - **Bot gap rule** counts product views only: a real visitor's impressions arrive in batches with
    one timestamp, which would make any session's median gap zero.
  - **Deleted product on a line**: #131 keeps `variant_id`, so the product is recovered from the size
    (`product_recovered_from_variant`, all 177 lines on the default run); only lines with neither go
    to the unknown product `-1`.
  - **Ledger consistency** sums in write order (`movement_id`): on the generated data 3 supplier
    receipts are written after a sale that happened minutes later, and `stock_after` follows the
    write order. Worth raising on #131.
- **Order states.** A revenue order is paid, shipped or completed. Features use the status as of the
  snapshot (`int_order_status_intervals`), not the final one.
- **`dim_products`** is per perfume plus the unknown member `-1`; facts carry `variant_id` and
  `volume_ml`. `fct_inventory_daily` is per tracked size and day, rebuilt from the ledger.
- **`mart_customer_features`** (Q3 default): monthly snapshots (1st, 00:00 Kyiv), customers with a
  revenue order as of the snapshot, label window `[snapshot_at, snapshot_at + 90 days)`, label
  null when the data ends earlier. `max_input_at` makes leakage testable. Favourite family as of the
  snapshot was left out of the features (it's on `dim_customers`): joining every event to every
  snapshot is expensive, and the ML issue can add it.
- **Personal data guard** reads `information_schema.columns` for `intermediate` and `marts`;
  boolean flags (`has_phone`) are allowed. The test depends on every model it inspects.
- **Docs coverage**: `scripts/check_docs.py` (models: every column in the catalog; sources: every
  declared column), unit-tested and run in `test_build.py`.
- **`raw.customer_truth`** is a declared source that no model reads.
- **Aspire** (step 11): deferred until #131 merges, since `dbt-build` / `dbt-docs` are children of
  #131's `jassmin-synth` database resource; adding that resource here would conflict.
- **CI** (Q4 default): no warehouse job in this issue.

## Open questions
None left: the user accepted every recommended default (Q2 `prod` defined, not run; Q3 monthly
snapshots of customers with a revenue order; Q4 no CI job). Q1 was answered by #131's
implementation (all-text raw tables, UTC ISO timestamps, `raw.products` / `raw.product_variants`,
deleted products as `product_id` null with the size kept).

## Resolved questions
- **What exactly is the raw layer?** — `raw.<table>` with `frames.COLUMNS`, every column `text`,
  ISO 8601 UTC timestamps, `t`/`f` booleans, Postgres array literals (source: #131
  `analytics/generator/frames.py`, `analytics/README.md`).
- **Which anomalies, at what rates?** — #131's catalogue in `analytics/README.md`; all twelve are
  handled (README table here).
- **Which statuses, reasons and event types are valid?** — `app/lib/enums.ts`.
- **What do event properties hold?** — `docs/analytics-events.md` (#129).
- **What must the ledger reconcile to?** — `sum(quantity_delta) = stock_quantity` (#130 schema
  comments); on #131's raw layer the raw ledger and raw `stock_quantity` agree, backorders included.
- **Is the order total `subtotal − discount + shipping − gift card`?** — yes (`orders` schema
  comment on `gift_card_amount`).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `analytics/warehouse/pyproject.toml`, `uv.lock`, `.python-version` | uv project: dbt-core, dbt-postgres, psycopg; pytest |
| create | `analytics/warehouse/dbt_project.yml`, `profiles.yml`, `packages.yml`, `package-lock.yml` | dbt project, env-only profile, dbt_utils |
| create | `analytics/warehouse/.gitignore`, `conftest.py` | venv and dbt output; keep #131's pytest out |
| create | `analytics/warehouse/wh.py` | resolve and guard the database, run dbt |
| create | `analytics/warehouse/macros/*.sql` | schema names, casts, `to_utc`, Kyiv dates, keys |
| create | `analytics/warehouse/models/staging/*` | sources and 13 staging models with docs and tests |
| create | `analytics/warehouse/models/intermediate/*` | 7 intermediate models with docs and tests |
| create | `analytics/warehouse/models/marts/**` | 9 marts with docs and tests |
| create | `analytics/warehouse/tests/*.sql` | 11 singular data tests |
| create | `analytics/warehouse/fixtures/raw_fixture.sql` | hand-written raw layer with every anomaly |
| create | `analytics/warehouse/scripts/check_docs.py` | every column described |
| create | `analytics/warehouse/tests_py/*.py` | pytest: wh.py, check_docs, end-to-end build |
| create | `analytics/warehouse/README.md` | running, layers, anomaly table, features, prod target |
| modify | `vite.config.ts`, `biome.json` | ignore `analytics/` (same lines as #131) |
| modify | `tsconfig.json` | exclude `analytics` |
| modify | `AGENTS.md` | where the warehouse is and how to run it |

## Steps
- [x] **1. Scaffold the dbt project** — separate uv project, `dbt_project.yml`, env-only
  `profiles.yml`, `dbt_utils`, `generate_schema_name`, `wh.py` with the database guard, repo
  plumbing.
- [x] **2. Macros** — `clean_text`, `to_int`, `to_money`, `to_bool`, `to_uuid`, `to_jsonb`,
  `to_text_array`, `is_naive_timestamp`, `to_utc`, `kyiv_date`, `days_between`, `customer_key`,
  `product_key`.
- [x] **3. Sources and simple staging models** — `_sources.yml` (every table described,
  `customer_truth` unread); products, variants, discounts, carts, cart items, payments, status
  history, inventory movements.
- [x] **4. `stg_users`, `stg_user_events`, `stg_sessions`** — normalised emails and test-account
  flag; naive timestamps, `unknown` devices and de-duplication; bot flag.
- [x] **5. `stg_orders`, `stg_order_items`** — currency, customer key, price typos, timeline fix;
  orphan products recovered from the size.
- [x] **6. Intermediate models** — `int_data_window`, `int_orders`, `int_order_lines`,
  `int_customer_orders`, `int_order_status_intervals`, `int_sessions`, `int_events`.
- [x] **7. Core marts** — `dim_date`, `dim_products`, `dim_customers`, `fct_orders`,
  `fct_order_items`; totals-reconcile and test-account tests.
- [x] **8. Behaviour and inventory marts** — `fct_sessions`, `fct_events`, `fct_inventory_daily`;
  ledger, bot and signup tests.
- [x] **9. `mart_customer_features`** — monthly snapshots, as-of statuses, `max_input_at`, label.
- [x] **10. Leakage and personal-data tests** — `assert_features_point_in_time`,
  `assert_features_match_history_before_snapshot`, `assert_marts_have_no_personal_data`; each was
  checked to fail on a deliberate leak (features reading 30 days ahead through orders, through
  visits; an email column in a mart; naive timestamps read as Kyiv time).
- [ ] **11. Docs, docs check, Aspire** — done: every model and column described, `check_docs.py`,
  `dbt docs generate` lineage, README, `AGENTS.md`. **Left for after #131 merges:** rebase on
  `origin/main`, then add to `aspire-apphost/apphost.mts` two explicit-start children of #131's
  `synthDb`: `dbt-build` (`addExecutable("dbt-build", "uv", "..", ["run", "--project",
  "analytics/warehouse", "analytics/warehouse/wh.py", "build"])`, `.withReference(synthDb)`,
  `.withEnvironment("JASSMIN_SYNTH_URI", await synthDb.uriExpression())`, `.waitFor(synthDb)`,
  `.withParentRelationship(synthDb)`, `.withExplicitStart()`) and `dbt-docs` (`wh.py docs serve
  --port <endpoint>` with an `http` endpoint), documented in `aspire-apphost/AGENTS.md`; check with
  `pnpm aspire:build`.

## Testing & verification
- **Full generated data:** #131's generator (`--customers 10000 --seed 42 --no-db --out`, 1.2 M raw
  rows) loaded into a local `jassmin_synth` (PostgreSQL 16) with all-text tables like its
  `load_raw`. `wh.py build`: **179 of 179 models and tests pass** in about 3 minutes. Anomaly rates
  found match the catalogue (README table). `wh.py docs generate` + `check_docs.py`: every column of
  29 models described; the manifest's lineage reaches the raw sources from every mart.
- **pytest** (`uv run --project analytics/warehouse pytest analytics/warehouse`, with
  `WAREHOUSE_TEST_SERVER_URL`): 32 passed, including the end-to-end fixture build.
- **Negative checks** (step 10): each guard fails on its deliberate bug, then the clean build passes.
- **App checks:** `pnpm typecheck`, `pnpm lint` and `pnpm build` pass. `pnpm test`: no local
  PostgreSQL 18 was available; on a local PostgreSQL 16 with a `uuidv7()` shim, 2,215 of 2,218 pass.
  The 2 failures are migrator tests expecting PostgreSQL 18's `23001` (restrict violation) where 16
  raises `23503`. No app code changed; CI runs them on PostgreSQL 18.

## Acceptance criteria
- [x] `dbt build` against `jassmin_synth` passes with all tests green — steps 1–10 (verified on a
  local `jassmin_synth` loaded from #131's generator; the Aspire-managed database follows step 11)
- [x] Every anomaly in #131's catalogue is handled by a staging model and covered by a test or a
  documented flag — steps 3–5, 7, 8; README table
- [x] `mart_customer_features` is point-in-time correct: a test proves no feature uses data after
  its snapshot date — steps 6, 9, 10
- [x] Marts contain no names, emails, phones or street addresses — steps 7, 10
- [x] `dbt docs` shows the lineage from raw to marts with every column described — step 11

## Out of scope
- Dashboards (Metabase / Power BI) and the ML models themselves.
- Running the `prod` target against a real replica, and a CI job for the warehouse.
- SQL linting (sqlfluff), incremental models and snapshots: full rebuilds are fine for the
  synthetic data.
- Any change to the app schema, migrations or the generator (#131).
