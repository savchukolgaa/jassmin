# Jassmin warehouse (dbt)

A layered warehouse built from the shop's data with dbt (#132): **raw → staging → intermediate →
marts**. BI dashboards and ML models read the marts, never the app's tables. The raw layer is #131's
synthetic data in `jassmin_synth` (`analytics/README.md`); later, the same models can run on a
read-only replica of the real database (the `prod` target, not run yet).

```
raw.*  (text, anomalies)        staging.stg_*            intermediate.int_*          marts.*
users, sessions, user_events ─► cast, normalise,     ─►  real customers only,   ─►  dim_date, dim_products,
orders, order_items, ...        clean or flag every      no bots, no personal       dim_customers, fct_orders,
                                anomaly; personal        data; shared logic         fct_order_items, fct_sessions,
                                data stops here                                     fct_events, fct_inventory_daily,
                                                                                    mart_customer_features
```

## Running it

It's a separate uv project (dbt-core, dbt-postgres, psycopg), next to #131's generator. Install
[uv](https://docs.astral.sh/uv/) (`winget install --id=astral-sh.uv -e`); it brings its own Python
3.12. Run everything through `wh.py`, which passes its arguments to dbt:

```bash
uv run --project analytics/warehouse analytics/warehouse/wh.py build          # models + tests
uv run --project analytics/warehouse analytics/warehouse/wh.py build --select staging
uv run --project analytics/warehouse analytics/warehouse/wh.py docs generate  # lineage + docs
uv run --project analytics/warehouse analytics/warehouse/wh.py docs serve     # http://localhost:8080
uv run --project analytics/warehouse analytics/warehouse/scripts/check_docs.py
uv run --project analytics/warehouse pytest analytics/warehouse               # Python tests
```

`wh.py` runs `dbt deps` the first time (it installs `dbt_utils`, pinned in `package-lock.yml`).

**Which database.** In this order: `WAREHOUSE_DATABASE_URL`, `JASSMIN_SYNTH_URI` (set by Aspire),
`SYNTH_DATABASE_URL`, else the app's `DATABASE_URL` from the repo's `.env` with the database name
replaced by `jassmin_synth`. The same rules as the generator. The `synth` target refuses any
database not named `jassmin_synth` (or `jassmin_synth_<suffix>`) and the app's own database, so a
build can never create schemas in the shop's database. `--target prod` reads `WAREHOUSE_PROD_URL`.

**Output.** Three schemas in `jassmin_synth`: `staging` and `intermediate` (views) and `marts`
(tables). A full build on #131's default data (10,000 customers, about 1 million events) takes about
three minutes. On Windows, keep the checkout path short: dbt's dependencies have deeply nested files
(or enable long paths).

**Tests.** `pytest` runs the `wh.py` and `check_docs.py` unit tests, and `test_build.py`, which loads
`fixtures/raw_fixture.sql` into a throwaway `jassmin_synth_test_<pid>` database, runs `dbt build` and
`dbt docs generate`, and checks the cleaning and the marts row by row. It needs a PostgreSQL server:
`WAREHOUSE_TEST_SERVER_URL` (e.g. `postgres://postgres@localhost:5432/postgres`), else `DATABASE_URL`;
without one it's skipped. The fixture is a few hand-written rows per anomaly in the generator's exact
raw format, so the warehouse is tested without generating data.

## Layers

- **raw** (`models/staging/_sources.yml`): #131's tables, every column `text`, no constraints.
  `raw.customer_truth` is declared for the lineage, but no model reads it: features never see the
  ground truth.
- **staging** (`stg_*`, one per raw table): types cast (`macros/casts.sql`), values normalised,
  every anomaly cleaned or flagged (below). The only layer with personal data (names, emails,
  phones); nothing downstream selects it.
- **intermediate** (`int_*`): test accounts and bots removed; `int_orders`, `int_order_lines` (net
  revenue after `discount_allocated`), `int_customer_orders` (order sequence, days since the
  previous order), `int_order_status_intervals` (each order's status over time, for point-in-time
  questions), `int_sessions`, `int_events`, and `int_data_window` (the span the data covers).
- **marts**: a star schema for BI and the ML training table.

| Mart | Grain | What it's for |
|------|-------|---------------|
| `dim_date` | Kyiv day | Calendar, ISO weeks, 8 March, 14 February, St Nicholas Day, New Year, Black Friday, gift seasons |
| `dim_products` | perfume | Brand, gender, families, size prices; `-1` is the unknown (deleted) product |
| `dim_customers` | customer | Signup, channel, city, first order and its traffic source, device mix, favourite family, lifetime revenue |
| `fct_orders` | order | Amounts, lifecycle timestamps, order sequence, payment attempts, anomaly flags |
| `fct_order_items` | order line | Gross, allocated discount and net revenue per line |
| `fct_sessions` | visit | Traffic, device and the funnel: viewed, added to cart, checkout, purchased |
| `fct_events` | event | The #129 properties as typed columns (list, position, price, stock, dwell) |
| `fct_inventory_daily` | size × Kyiv day | Sold, returned, received, closing stock, backorders, stock-outs; censored-demand flag |
| `mart_customer_features` | customer × month | RFM, tenure, AOV, discount share, return and unclaimed rates, recent visits; `churned_next_90d` |

**Keys and time.** Every date is a Kyiv calendar date (`var('timezone')`); timestamps are
`timestamptz`. Money is `numeric(12, 2)` in UAH. A customer is `customer_key`, an md5 surrogate of
the user id, or of the normalised email for a guest, so a guest's repeat orders are one customer.
Marts hold no names, emails, phones or addresses: the key and the city only.

## Anomaly handling

Every anomaly in #131's catalogue is cleaned or flagged in staging and covered by a test. Measured on
the generator's default run (seed 42, 10,000 customers):

| Anomaly (#131) | Rate found | Staging model | Handling | Test |
|----------------|-----------|---------------|----------|------|
| Missing device type | 3.00 % of sessions | `stg_sessions`, `stg_user_events` | `'unknown'` | `accepted_values` |
| Double-fired events | 1.50 % extra rows | `stg_user_events` | dropped: same session, visitor, type, product and properties within 1 s | `assert_no_double_fired_events` |
| Bot sessions | 25 | `stg_sessions.is_bot` | > 60 product views in any 10 minutes, or ≥ 10 views with a median gap < 2 s; excluded from `int_*` and marts | `assert_no_bot_sessions_in_marts` |
| Timezone-naive timestamps | 0.99 % of events | every `stg_*` (`to_utc`) | read as UTC, `had_naive_timestamp` | `assert_no_event_before_signup` |
| Missing phone | 12.13 % of users | `stg_users.has_phone` | kept null, flagged | documented flag |
| Messy emails | 2.00 % of users | `stg_users`, `stg_orders` | `lower(trim())`, `had_unnormalised_email` | `unique` on `email_normalised` |
| Test accounts | 15 | `stg_users.is_test_account`, `stg_orders.is_test_account` | excluded from `int_*` and marts | `assert_no_test_accounts_in_marts` |
| Price typo (× 10) | 0.20 % of orders | `stg_orders.is_price_outlier` | total > 5 × the lines: recomputed as subtotal − discount + shipping − gift card; `raw_total_amount` kept | `assert_order_totals_reconcile` |
| Shipped after completion | 0.41 % of completed orders | `stg_orders.has_impossible_timeline` | fixed from `order_status_history` (all 66 here), else `shipped_at` null | `expression_is_true`, `assert_order_timeline_consistent` |
| Lowercase currency | 1.00 % of orders | `stg_orders`, `stg_payments` | `upper()`, `had_lowercase_currency` | `accepted_values: [UAH]` |
| Deleted product on a line | 0.50 % of lines | `stg_order_items.is_orphan_product` | product recovered from the size when it remains (all 177 here), else the unknown product `-1` | `relationships` to `dim_products` |
| Backorders (negative stock) | 684 movements | `stg_inventory_movements.is_backorder` | kept; `fct_inventory_daily` floors stock at 0, reports `backorder_units`, marks the day a censored stock-out | `assert_ledger_running_sum_matches_stock_after`, `assert_ledger_sums_to_stock` |

The thresholds are dbt vars in `dbt_project.yml` (`duplicate_event_seconds`,
`bot_max_product_views_10min`, `bot_min_product_views_for_gap`, `bot_median_gap_seconds`,
`price_outlier_ratio`, `churn_horizon_days`).

One quirk of the generated ledger: a few supplier receipts are written after a sale that happened
minutes later, so `occurred_at` disagrees with the write order. `stock_after` follows the write order
(`movement_id`), so the ledger test sums in that order; daily figures don't depend on it.

## The ML training table

`mart_customer_features` has one row per customer and monthly snapshot (the 1st of the month, 00:00
Kyiv), from the first snapshot at which the customer has a revenue order (paid, shipped or completed
as of the snapshot).

- **Point in time.** Every feature reads only rows strictly before `snapshot_at`: orders by
  `created_at`, their status as of the snapshot from `order_status_history` (an order returned after
  the snapshot still counts as a sale at the snapshot), visits by `started_at`, signup by
  `created_at`. `max_input_at` stores the latest timestamp any feature read.
  `assert_features_point_in_time` fails if it isn't before `snapshot_at`, and
  `assert_features_match_history_before_snapshot` recomputes the order count, recency and last visit
  from the facts independently. Both were checked to fail when a feature peeks 30 days ahead.
- **Features.** `tenure_days`, `recency_days`, `frequency`, `monetary` (net revenue),
  `avg_order_value`, `discount_share`, `orders_placed`, `return_rate`, `unclaimed_rate`,
  `sessions_30d`, `sessions_90d`, `days_since_last_visit`.
- **Label.** `churned_next_90d`: no order in the 90 days from `snapshot_at` (an order cancelled
  because its payment failed doesn't count); null when the data ends before those 90 days do
  (`is_label_available`).

On the default run it has about 102,500 rows for 8,100 customers over 33 snapshots, with a churn rate
of about 86 % where labelled.

## The `prod` target

`--target prod` reads the app's own tables (`public`, typed rather than text; the casts work on both)
from `WAREHOUSE_PROD_URL`. It's defined but not run yet: dbt has to write its schemas somewhere, and
a read-only replica can't hold them. Where the production warehouse lives (a separate database
reading the replica through `postgres_fdw`, or a writable schema) is a later decision.
