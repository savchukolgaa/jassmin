# Plan: Build a raw → staging → marts warehouse with dbt and data-quality tests (#132)

Issue: https://github.com/savchukolgaa/jassmin/issues/132
Branch: `issue/132`
Worktree: `.claude/worktrees/issue-132`
Status: Planned

## Goal
As a data analyst, I want a layered warehouse (raw → staging → intermediate → marts) built from
the shop's data, so that BI dashboards and ML models read clean, documented, tested tables instead
of the app's tables. A dbt project in `analytics/warehouse/` cleans every anomaly in #131's
catalogue in staging, builds star-schema marts (orders, order items, sessions, events, customers,
products, dates, daily inventory) plus a point-in-time ML feature table, and proves it all with
data tests and `dbt docs`.

## Dependencies & prerequisites
- **#131 (synthetic data generator) — OPEN, not started.** Branch `issue/131` has no commits and
  `analytics/` doesn't exist on `origin/main`. This issue needs from it: the `analytics/` uv
  project (`pyproject.toml` / `uv.lock`), the `jassmin_synth` database (Aspire `AddDatabase`), the
  `raw.*` tables, and the anomaly catalogue in `analytics/README.md`. **Implement and merge #131
  first**, then rebase `issue/132` on `origin/main`. Steps 1–2 can start earlier; the
  staging SQL (steps 3–5) must be checked against #131's actual raw DDL and catalogue.
- **#128** (`order_status_history`, `orders.returned_at` / `cancel_reason` / `arrived_at`,
  `order_items.discount_allocated`, `users.city` / `acquisition_channel`) — merged (`39d45fb`).
- **#129** (typed `user_events.event_properties`, `docs/analytics-events.md`) — merged (`8b81f83`).
- **#130** (`inventory_movements` ledger, `inventory_daily` view) — merged (`15944d0`).
- New Python dev dependencies in the `analytics/` uv project: `dbt-core` and `dbt-postgres`
  (latest 1.x, pinned by `uv.lock`). dbt package: `dbt-labs/dbt_utils` (`packages.yml`, installed
  by `dbt deps`).
- No app migrations, no app env vars, no changes under `app/`.

## Decisions & assumptions
- **Location and tooling.** dbt project in `analytics/warehouse/` (`dbt_project.yml`, profile
  `jassmin_warehouse`). It runs from the shared `analytics/` uv environment:
  `uv run --project analytics dbt build --project-dir analytics/warehouse`. `profiles.yml` lives in
  the project dir (`DBT_PROFILES_DIR` = project dir) and reads only `env_var()`s, so no secret is
  committed.
- **Targets.** `synth` (default) reads `jassmin_synth` with sources in schema `raw`. `prod` is
  defined (sources in `public`, connection from `WAREHOUSE_PROD_*` env vars) but not exercised in
  this issue **(unconfirmed, Q2)**. The source schema is `var('raw_schema')`, so the same models
  run against either.
- **Schemas.** A `generate_schema_name` macro writes exactly `staging`, `intermediate` and `marts`
  (no `<target>_` prefix). Materialisations: staging = views, intermediate = views (ephemeral
  would hide them from the lineage graph), marts = tables.
- **Customer identity.** `customer_key = dbt_utils.generate_surrogate_key([...])` over
  `'u:' || user_id` for registered customers, or `'g:' || normalised guest_email` for guest
  orders, so repeat guests count as one customer. The raw `user_id` / email never reach marts.
- **Kyiv time.** Every timestamp becomes `timestamptz` in staging; every date column in
  intermediate/marts is `(ts at time zone 'Europe/Kyiv')::date`. Amounts stay `numeric(12,2)`
  in UAH.
- **Staging is one model per raw table** (`stg_users`, `stg_sessions`, `stg_user_events`,
  `stg_carts`, `stg_cart_items`, `stg_orders`, `stg_order_items`, `stg_payments`,
  `stg_discounts`, `stg_order_status_history`, `stg_inventory_movements`, `stg_products`,
  `stg_product_variants`). Exceptions the issue requires: the bot flag on `stg_sessions` reads
  `stg_user_events`, and the timeline fix in `stg_orders` reads `stg_order_status_history`
  (staging → staging refs only, never marts).
- **Anomaly handling** (each gets a flag column so nothing is silently lost, plus a test):

  | Anomaly (#131) | Where | Handling | Test |
  |---|---|---|---|
  | Missing `device_type` (3%) | `stg_sessions`, `stg_user_events` | `coalesce(device_type, 'unknown')` | `not_null` + `accepted_values` (`mobile`, `desktop`, `tablet`, `unknown`) |
  | Double-fired events (1.5%) | `stg_user_events` | drop an event when the previous one with the same session, type and product is < 1 s earlier (`lag()` over `created_at`) | singular test `assert_no_double_fired_events` |
  | Bot sessions (150–400 views in minutes) | `stg_sessions.is_bot` | > 60 `product_view`s in any 10-minute window (`count(*) over (… range between interval '10 minutes' preceding and current row)`), or ≥ 10 events with a median gap < 2 s | marts exclude them; test `assert_no_bot_sessions_in_marts` |
  | Missing phones (12%) | `stg_users.has_phone` | keep `null`, flag | `not_null` on the flag |
  | Emails with stray spaces / case | `stg_users`, `stg_orders` | `lower(trim(email))` | `unique` on `stg_users.email_normalised` |
  | `@example.com` test accounts | `stg_users.is_test_account` | dropped from `stg_users`; their sessions, events and orders are dropped in marts via `int_excluded_users` | `assert_no_test_accounts_in_marts` |
  | Price typos (×10) | `stg_orders` | `is_price_outlier` when `total_amount > 5 × sum(quantity × price_at_purchase)`; `total_amount` recomputed as `subtotal − discount + shipping − gift_card`, the raw value kept as `raw_total_amount` | `assert_order_totals_reconcile` on `fct_orders` |
  | Shipping after completion | `stg_orders` | `has_impossible_timeline` when `shipped_at > completed_at`; `shipped_at` / `completed_at` replaced by the first `shipped` / `completed` row of `order_status_history` when that fixes it, else `shipped_at` set to `null` | `assert_order_timeline_consistent` on `fct_orders` |
  | Lowercase `uah` | `stg_orders`, `stg_payments` | `upper(currency)` | `accepted_values: ['UAH']` |
  | Order items for deleted products | `stg_order_items.is_orphan_product` | `product_id` with no product → `null`; facts use the "unknown product" member `product_key = '-1'` in `dim_products` | `relationships` from `fct_order_items.product_key` to `dim_products` |
  | Timezone-naive UTC timestamps | every `stg_*` | macro `to_utc(col)`: a value without an offset is read as UTC (`::timestamp at time zone 'UTC'`), one with an offset as `::timestamptz` | `not_null` on the timestamps; `assert_no_event_before_signup` |
  | Stock going negative (backorders) | `stg_inventory_movements`, `fct_inventory_daily` | keep the ledger as is; `backorder_units = greatest(-stock_after, 0)`; `closing_stock` floored at 0, stock-out when stock ≤ 0 | `assert_ledger_sums_to_stock` |

  The final list follows #131's README catalogue: any anomaly it adds gets a row here.
- **Order states.** A *revenue order* is one whose status is `paid`, `shipped` or `completed`
  (not `pending`, `cancelled`, `returned`, `unclaimed`). For features, the status is taken **as of
  the snapshot** from `order_status_history`, not from the final `orders.status`.
- **Grain of `dim_products`.** One row per product (`product_key`), with brand, gender, fragrance
  family / families, active flag and the five size prices. Facts carry `product_key`,
  `variant_id` (degenerate) and `volume_ml`. `fct_inventory_daily` is per variant and day.
- **`dim_customers`**: first order date, first order channel, `acquisition_channel`, `city`,
  signup date, device mix (share of sessions per `device_type`), favourite fragrance family (most
  `product_view`s by `products.fragrance_family`, ties → most purchased, then alphabetical),
  `is_registered`. No name, email, phone or address.
- **`mart_customer_features` (ML training table).** One row per customer and monthly snapshot
  date (the 1st of each month 00:00 Kyiv) for customers with at least one revenue order before the
  snapshot. Every input is filtered `< snapshot_at` (orders by `created_at`, statuses by
  `order_status_history.changed_at`, returns by `returned_at`, sessions by `started_at`).
  Features: recency (days since last order), frequency, monetary (net revenue), tenure (days since
  signup / first order), average order value, discount share (`sum(discount_allocated) /
  gross`), return rate and unclaimed rate (as of the snapshot), sessions in the last 30 / 90 days,
  days since the last visit, favourite family as of the snapshot. Label `churned_next_90d` = no
  order placed (any status but `cancelled` with reason `payment_failed`) in
  `(snapshot_at, snapshot_at + 90 days]`; `null` when the data ends before `snapshot_at + 90
  days`. To make leakage testable, each row also stores `max_input_at`: the latest timestamp of
  any row that fed it. **(unconfirmed, Q3)** for the snapshot cadence and population.
- **Personal data guard.** A singular test reads `information_schema.columns` for schemas
  `marts` and `intermediate` and fails on any column named like `%name%` (except
  `brand`/`product` names, allow-listed), `%email%`, `%phone%`, `%address%`.
- **Docs coverage.** Every model and column has a description in its `_<layer>__models.yml`. A
  small script `analytics/warehouse/scripts/check_docs.py` reads `target/manifest.json` and
  `target/catalog.json` after `dbt docs generate` and fails if any column in the catalog lacks a
  description. It runs under `pytest`.
- **`raw.customer_truth`** is declared as a source (so the lineage shows it) but no model reads
  it: the ML issue evaluates against it directly, and features never see it.
- **Aspire.** Two explicit-start children of #131's `jassmin_synth` database resource: `dbt-build`
  (runs `uv run dbt deps && uv run dbt build`) and `dbt-docs` (runs `dbt docs generate && dbt docs
  serve --port <endpoint>` with an `http` endpoint), because the database password only Aspire
  knows (same pattern as `db-seed`). They get host, port, user, password and database name from the
  database reference's injected env vars (check the exact names in `aspire-apphost/.aspire/`).

## Open questions
- [ ] **Q1: What is the exact raw layer #131 produces?** — Why it matters: staging SQL depends on
  the column types (are timestamps `text`, `timestamp` or mixed?), whether `raw.products` /
  `raw.product_variants` exist or the catalog is only in `public`, and how a "deleted product"
  looks (dangling id vs. `null`). Recommended default: `raw.<app table>` with the app's column
  names, timestamps as `text`, products in `raw.products` / `raw.product_variants`, deleted
  products as dangling ids; adjust staging once #131 is merged. Affects steps: 3, 4, 5.
- [ ] **Q2: How should the `prod` target work against a read-only replica?** — Why it matters: dbt
  must write its models somewhere, and a read-only replica can't hold them. Recommended default:
  this issue only defines the `prod` target and `raw_schema = public`, documented as "not yet
  run"; choosing where prod models live (a separate warehouse database reading the replica via
  `postgres_fdw`, or a dedicated writable schema) is a later issue. Affects steps: 1, 11.
- [ ] **Q3: Snapshot cadence and population for `mart_customer_features`?** — Why it matters:
  table size and what the churn model learns. Recommended default: monthly snapshots, customers
  with ≥ 1 revenue order before the snapshot, label `null` in the last 90 days of data. Affects
  steps: 9, 10.
- [ ] **Q4: Should CI run the warehouse?** — Why it matters: without it, a schema change in the
  app or the generator can silently break `dbt build`. Recommended default: out of scope here
  (the issue doesn't ask for it, and #131 decides whether CI gets a Python job); if #131 adds one,
  extend it with `generate.py --customers 300` + `dbt build` in a follow-up. Affects steps: none.

## Resolved questions
- **Which statuses, cancel reasons, movement reasons and event types are valid?** —
  `ORDER_STATUSES`, `PAYMENT_STATUSES`, `CART_STATUSES`, `CANCEL_REASONS`, `ORDER_STATUS_SOURCES`,
  `INVENTORY_MOVEMENT_REASONS`, `INVENTORY_MOVEMENT_SOURCES`, `PAYMENT_METHODS`, `EVENT_TYPES`
  (source: `app/lib/enums.ts`); the `accepted_values` tests copy these lists.
- **What do event properties hold?** — `product_public_id`, `variant_id`, `volume_ml`, `price`
  (decimal string), `in_stock`, `list_id`, `list_position`, `search_id`; no personal data (source:
  `docs/analytics-events.md`, #129). `fct_events` extracts these into typed columns.
- **What must the ledger reconcile to?** — For every tracked size, `sum(quantity_delta) =
  product_variants.stock_quantity`, and `inventory_daily` is per variant and Kyiv day with units
  sold, closing stock and a stock-out flag (source: `app/.server/db/schema.ts` comments on
  `inventoryMovements` / `inventoryDaily`, #130). `fct_inventory_daily` rebuilds this from the
  ledger rather than reading the view, because the raw layer has no view and its stock can go
  negative.
- **Which columns must never be dropped?** — The ML columns listed in `AGENTS.md`; the warehouse
  only reads them, so nothing in the app changes.
- **Which genders exist?** — `women`, `men`, `unisex` in the enum, but the shop only has men's and
  women's catalogs (`app/lib/enums.ts`, project memory); `dim_products.gender` keeps the raw value.
- **Is the Python tooling linted by Biome / `tsc`?** — No: Biome handles JS/TS/JSON/CSS and ignores
  Markdown; `analytics/` is excluded from the app's checks by #131's assumptions. dbt output
  (`target/`, `dbt_packages/`, `logs/`) must be git-ignored.
- **Where does the worktree come from?** — Already created on `issue/132` with linked `.env`
  files (user instruction).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `analytics/pyproject.toml`, `analytics/uv.lock` | add `dbt-core`, `dbt-postgres` |
| create | `analytics/warehouse/dbt_project.yml` | project config, layer schemas and materialisations, `raw_schema` var |
| create | `analytics/warehouse/profiles.yml` | `synth` and `prod` targets from env vars |
| create | `analytics/warehouse/packages.yml`, `package-lock.yml` | `dbt_utils` |
| create | `analytics/warehouse/.gitignore` | `target/`, `dbt_packages/`, `logs/`, `.user.yml` |
| create | `analytics/warehouse/macros/generate_schema_name.sql` | exact schema names |
| create | `analytics/warehouse/macros/to_utc.sql`, `kyiv_date.sql` | timestamp parsing, Kyiv dates |
| create | `analytics/warehouse/macros/tests/*.sql` | generic tests (e.g. `not_after(column, other)`) |
| create | `analytics/warehouse/models/staging/_sources.yml` | every raw table as a source, with descriptions and freshness off |
| create | `analytics/warehouse/models/staging/stg_*.sql`, `_staging__models.yml` | 13 staging models + docs + tests |
| create | `analytics/warehouse/models/intermediate/int_excluded_users.sql`, `int_order_lines.sql`, `int_customer_orders.sql`, `int_order_status_daily.sql`, `_intermediate__models.yml` | shared logic |
| create | `analytics/warehouse/models/marts/core/fct_orders.sql`, `fct_order_items.sql`, `dim_customers.sql`, `dim_products.sql`, `dim_date.sql` | order star schema |
| create | `analytics/warehouse/models/marts/behaviour/fct_sessions.sql`, `fct_events.sql` | funnel and events |
| create | `analytics/warehouse/models/marts/inventory/fct_inventory_daily.sql` | daily stock, censored demand |
| create | `analytics/warehouse/models/marts/ml/mart_customer_features.sql` | point-in-time features + label |
| create | `analytics/warehouse/models/marts/**/_*__models.yml` | docs and tests per mart |
| create | `analytics/warehouse/tests/*.sql` | singular tests (reconcile, ledger, leakage, PII, signup, bots, test accounts, duplicates) |
| create | `analytics/warehouse/scripts/check_docs.py`, `analytics/warehouse/tests_py/test_check_docs.py` | every column described |
| create | `analytics/warehouse/README.md` | how to run, layers, anomaly → handling table, feature definitions |
| modify | `analytics/README.md` | link the warehouse; anomaly catalogue points to its handling |
| modify | `aspire-apphost/apphost.mts`, `aspire-apphost/AGENTS.md` | `dbt-build`, `dbt-docs` resources |
| modify | `AGENTS.md` | one line on `analytics/warehouse/` (marts are the only tables ML/BI read) |

## Steps
Each step is small, ordered, and leaves the project in a working state.

- [ ] **1. Rebase on #131 and scaffold the dbt project** — After #131 merges, `git rebase
  origin/main`. `uv add --project analytics --dev dbt-core dbt-postgres`. Create
  `dbt_project.yml` (name `jassmin_warehouse`, `vars: { raw_schema: raw }`, models
  `staging: +materialized: view, +schema: staging`, `intermediate: view`, `marts: table`),
  `profiles.yml` (`synth` from `JASSMIN_SYNTH_HOST/PORT/USERNAME/PASSWORD/DATABASENAME`, `prod`
  from `WAREHOUSE_PROD_*` with `raw_schema: public`), `packages.yml` (`dbt_utils`),
  `.gitignore`, `macros/generate_schema_name.sql`. Check: `uv run dbt deps && uv run dbt debug`
  against `jassmin_synth`.
- [ ] **2. Macros** — `to_utc(col)` (offset-aware parse, naive → UTC), `kyiv_date(col)`,
  `kyiv_ts(col)`; generic test `not_after(model, column_name, other)`. Check: `dbt compile`.
- [ ] **3. Sources and simple staging models** — `_sources.yml` with every raw table and column
  described (incl. `customer_truth`, not referenced). Staging models that rename/cast/clean only:
  `stg_products`, `stg_product_variants`, `stg_discounts`, `stg_carts`, `stg_cart_items`,
  `stg_payments` (`upper(currency)`), `stg_order_status_history`, `stg_inventory_movements`
  (adds `backorder_units`). Tests: `unique`/`not_null` on ids, `relationships`,
  `accepted_values` from `app/lib/enums.ts`. Check: `dbt build --select staging`.
- [ ] **4. `stg_users`, `stg_user_events`, `stg_sessions`** — users: `email_normalised`,
  `is_test_account`, `has_phone`, test accounts filtered; events: `to_utc`, device `unknown`,
  de-duplication within 1 s (the dropped count is reported in the PR, step "Testing"); sessions: device
  `unknown`, `is_bot` from events (10-minute window and median gap), event count. Tests:
  `unique` on `email_normalised`, accepted device types, `assert_no_double_fired_events`.
- [ ] **5. `stg_orders`, `stg_order_items`** — orders: `upper(currency)`, `email_normalised`,
  `raw_total_amount`, `is_price_outlier`, recomputed `total_amount`, `has_impossible_timeline`
  and the fix from `stg_order_status_history`; order items: `is_orphan_product`, `product_id`
  nulled when the product doesn't exist. Tests: `accepted_values` on status / payment method /
  cancel reason, `not_after('shipped_at', 'completed_at')` *after* the fix.
- [ ] **6. Intermediate models** — `int_excluded_users` (test accounts; anything else #131's
  catalogue says to exclude), `int_order_lines` (gross = `quantity × price_at_purchase`,
  `discount_allocated`, `net_line_revenue`), `int_customer_orders` (`customer_key`, `order_seq`
  via `row_number()`, `days_since_prev_order` via `lag()`), `int_order_status_daily` (status of
  each order as of any timestamp, from `order_status_history`, for point-in-time use). Tests:
  `unique` on `order_id`, `order_seq >= 1`.
- [ ] **7. Core marts** — `dim_date` (`dbt_utils.date_spine`, Kyiv dates, ISO week, weekday,
  `is_weekend`, flags for 8 March, 14 February, St Nicholas (6 Dec), New Year, Black Friday),
  `dim_products` (+ unknown member `-1`), `dim_customers`, `fct_orders` (customer/product-free
  order facts: dates, amounts, payment method, discount kind, statuses, lifecycle timestamps,
  flags, `order_seq`, `days_since_prev_order`, `is_revenue`), `fct_order_items`. Singular tests
  `assert_order_totals_reconcile` (sum of lines = subtotal; `subtotal − discount + shipping −
  gift_card = total`; `sum(discount_allocated) = discount_amount`), `assert_no_test_accounts_in_marts`.
- [ ] **8. Behaviour and inventory marts** — `fct_sessions` (non-bot sessions: customer key,
  Kyiv date, traffic source/medium, device, landing page, event count, duration, funnel flags
  `viewed_product`, `added_to_cart`, `started_checkout`, `purchased`), `fct_events` (non-bot,
  de-duplicated, typed property columns from `event_properties`), `fct_inventory_daily` (variant ×
  Kyiv day spine from first movement to the data end: `units_sold`, `units_returned`,
  `units_received`, `closing_stock` (floored at 0), `backorder_units`, `is_stock_out`,
  `is_demand_censored` = out of stock at any moment that day). Tests: `unique_combination_of_columns`
  (variant, day), `assert_ledger_sums_to_stock`, `assert_no_bot_sessions_in_marts`,
  `assert_no_event_before_signup`.
- [ ] **9. `mart_customer_features`** — Snapshot spine (monthly, Kyiv) × eligible customers; one
  CTE per feature group, each joined with `< snapshot_at`; `max_input_at`; label from orders in
  `(snapshot_at, snapshot_at + 90 days]`, `null` past the data end. Tests:
  `unique_combination_of_columns(customer_key, snapshot_date)`, `not_null` on features,
  `accepted_values` on the label.
- [ ] **10. Leakage and PII tests** — `assert_features_point_in_time` (fails if `max_input_at >=
  snapshot_at`), plus a recompute test for one snapshot: rebuild recency/frequency/monetary from
  `fct_orders` filtered `< snapshot_at` and compare. `assert_marts_have_no_personal_data`
  (information_schema check). Check: `dbt build` green.
- [ ] **11. Docs, docs check, Aspire** — Descriptions for every model and column;
  `scripts/check_docs.py` + pytest; `dbt docs generate` and inspect the lineage graph
  (raw → staging → intermediate → marts). Add `dbt-build` / `dbt-docs` to `apphost.mts` and
  `aspire-apphost/AGENTS.md`; `analytics/warehouse/README.md` (commands, layers, the anomaly →
  handling table, feature definitions, the `prod` target status); link from `analytics/README.md`
  and `AGENTS.md`. Check: `pnpm aspire:build`, `pnpm lint`.

## Testing & verification
- `uv run --project analytics dbt build --project-dir analytics/warehouse` against a freshly
  generated `jassmin_synth` (`--customers 10000 --seed 42`): all models and tests green.
- Sanity counts after the build (recorded in the PR): rows dropped as duplicates ≈ 1.5% of
  events, bot sessions flagged, test accounts dropped, price outliers flagged, timelines fixed —
  each roughly at #131's documented rate.
- `uv run --project analytics pytest analytics/warehouse/tests_py` (docs coverage) and #131's
  generator tests still pass.
- Negative checks for the guards: temporarily add a `guest_email` column to `fct_orders` and a
  feature without the `< snapshot_at` filter — the PII and leakage tests must fail; revert.
- `pnpm aspire run`: start `dbt-build`, then `dbt-docs` and open the lineage graph.
- App checks are unaffected but still run: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`, `pnpm aspire:build`.

## Acceptance criteria
- [ ] `dbt build` against `jassmin_synth` passes with all tests green — steps 1–10
- [ ] Every anomaly in #131's catalogue is handled by a staging model and covered by a test or a documented flag — steps 3–5, 7, 8, anomaly table in the README (step 11)
- [ ] `mart_customer_features` is point-in-time correct: a test proves no feature uses data after its snapshot date — steps 6, 9, 10
- [ ] Marts contain no names, emails, phones or street addresses — steps 7, 10
- [ ] `dbt docs` shows the lineage from raw to marts with every column described — step 11

## Out of scope
- Dashboards (Metabase / Power BI) and the ML models themselves.
- Actually running the `prod` target against a real replica (Q2), and a CI job for the warehouse (Q4).
- SQL linting (sqlfluff), incremental models and snapshots (`dbt snapshot`): the synthetic data
  is rebuilt from scratch, so full rebuilds are fine.
- Any change to the app schema, migrations or the generator (#131).
