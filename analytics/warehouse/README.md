# Jassmin warehouse (dbt)

A layered warehouse built from the shop's data with dbt (#132): **raw → staging → intermediate →
marts**. BI dashboards and ML models read the marts, never the app's tables. On the `synth` target
the raw layer is #131's synthetic data in `jassmin_synth` (`analytics/README.md`); on the `prod`
target (#183) it's `jassmin_wh`, a nightly, read-only, pseudonymised copy of the real shop's data,
for the owner's dashboard ([below](#real-data-the-prod-target)).

```
raw.*  (text, anomalies)        staging.stg_*            intermediate.int_*          marts.*
users, sessions, user_events ─► cast, normalise,     ─►  real customers only,   ─►  dim_date, dim_products,
orders, order_items, ...        clean or flag every      no bots, no personal       dim_customers, fct_orders,
                                anomaly; personal        data; shared logic         fct_order_items, fct_sessions,
                                data stops here                                     fct_events, fct_inventory_daily,
                                                                                    mart_customer_features,
                                                                                    mart_perfumer_daily
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
build can never create schemas in the shop's database. `--target prod` reads `WAREHOUSE_PROD_URL`,
which must name `jassmin_wh` (or `jassmin_wh_<suffix>`), and never the app's database.

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
  questions), `int_sessions`, `int_events`, `int_perfumer_messages` (each AI perfumer message with its rating,
  click and 7-day order flags, #166; a table, since its attribution joins scan every event), and
  `int_data_window` (the span the data covers).
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
| `mart_perfumer_daily` | Kyiv day | The AI perfumer (#166): messages, conversations, rate-limited, error rate, answer time p50/p95, answers with picks, click-through, 7-day conversion, 👍/👎 |
| `mart_customer_features` | customer × month | RFM, tenure, AOV, discount share, return and unclaimed rates, recent visits; `churned_next_90d` |
| `mart_sales_daily` | Kyiv day | The owner's dashboard (#183): revenue orders, net revenue, average order, units, first vs repeat; zeros on days without orders |
| `fct_gift_card_sales` | gift card | A gift card bought (#125): a succeeded payment that pays no order; spending is `fct_orders.gift_card_amount` |
| `mart_tester_conversion` | customer | First tester trio (the `tester-trio` rule or a tester set) and whether a full bottle followed within `tester_conversion_days` (60) |
| `mart_customer_rfm` | customer | RFM as of the data's end and a churn-risk segment from fixed rules (`rfm_*` vars): new, one_time, active, at_risk, lost |

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
`price_outlier_ratio`, `churn_horizon_days`, and #183's `tester_conversion_days` and `rfm_*`).

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

## Real data: the `prod` target

Since #183 the same models run every night on the real shop, for the owner's dashboard
(`analytics/dashboard/`). The rules of this one exception to "synthetic data only" are in
`analytics/README.md` → Real data; how it works:

```
jassmindb (the app)  --wh_extract, read-only,-->  jassmin_wh.raw  --dbt, wh_owner-->  staging,       --wh_reader-->  Evidence
public.*             allow-listed columns only    text, #131's      --target prod    intermediate,                   site
                     (extract/extract.py)         raw shape                          marts
```

- **`extract/allowlist.py`** lists every app table and column that may be read, in #131's raw
  shape (the columns of `analytics/generator/frames.py`, so the staging models work unchanged), with
  a transform each (`extract/transforms.py`): `copy`; `null` (never read: names, password hashes,
  guest phones, addresses, waybill numbers, staff notes); `email_pseudonym` (HMAC of
  `lower(trim(email))` with `WH_PSEUDONYM_KEY`, as `<hash>@pseudonym.invalid`, or `@example.com` for
  test accounts, so staging still drops them and a guest's orders stay one customer);
  `id_pseudonym` (the visitor cookie); `presence` (a phone becomes `present`); `path_only` and
  `origin_only` (URLs without query strings, which can hold tokens; referrers as their site only);
  `event_properties` (`path` without its query, `search.query` null). Payments' provider id and
  callback, and every table not listed (AI perfumer chats, gift cards, auth tokens, ...), are never
  read.
- **`extract/setup.py`** (once per deploy, as the superuser) creates `jassmin_wh` and three roles:
  `wh_extract` with column-level `SELECT` on exactly the readable allow-listed columns and
  `default_transaction_read_only`, `wh_owner` owning `jassmin_wh`, and `wh_reader` reading `marts`
  and `meta` (default privileges, so dbt's rebuilt tables stay readable). Idempotent; it revokes
  earlier grants first, so dropping a column from the allow-list takes its grant away.
- **`extract/extract.py`** (nightly) reads every table in one read-only, repeatable-read snapshot,
  transforms the rows and `COPY`s them into `raw_next`, then swaps it for `raw` in the same
  transaction: a failed run leaves the previous copy. It refuses a source role that isn't read-only
  by default and any target but `jassmin_wh[_suffix]`, logs only row counts, and records each run in
  `meta.extract_runs` (the dashboard's "data as of").
- **`wh.py build --target prod`** builds and tests everything in `jassmin_wh`, as on `synth`, and
  excludes anything downstream of #131's `raw.customer_truth` (no model reads it, which
  `tests_py/test_allowlist.py` checks). A failing test stops the night before the dashboard build.
- **`scripts/nightly.sh`** runs the extract, dbt, Evidence's `sources` and `build:strict`, and only
  then switches the served site (`/srv/stats/current`, the last 3 releases kept). One run at a time
  (`flock`). In production it's the `analytics` container's cron at 01:00 UTC (`docs/deploy.md`).

A shop with no visits at all fails `int_data_window`'s not-null tests (there is no data window), so
the dashboard stays at its "not built yet" page until the first visit; from then on a shop without
orders yet builds, with empty charts.

### Running it by hand

Against a local app database (any migrated one, e.g. `jassmin_synth` after `generate.py
--load-app-schema`, as a stand-in) and a superuser URL:

```bash
export WH_ADMIN_URL=postgres://postgres:...@localhost:5432/postgres WH_APP_DATABASE=jassmin \
  WH_DATABASE=jassmin_wh WH_EXTRACT_PASSWORD=... WH_OWNER_PASSWORD=... WH_READER_PASSWORD=...
uv run --project analytics/warehouse analytics/warehouse/extract/setup.py
export WH_EXTRACT_URL=postgres://wh_extract:...@localhost:5432/jassmin \
  WH_TARGET_URL=postgres://wh_owner:...@localhost:5432/jassmin_wh WH_PSEUDONYM_KEY=<32+ characters>
uv run --project analytics/warehouse analytics/warehouse/extract/extract.py
WAREHOUSE_PROD_URL=$WH_TARGET_URL uv run --project analytics/warehouse analytics/warehouse/wh.py build --target prod
```

Then build the dashboard with the `wh_reader` role (`analytics/dashboard/README.md`). Roles are
server-wide: `WH_ROLE_PREFIX` (default `wh`) names them differently for a second setup on one server.

### Tests

`tests_py/test_extract.py` creates a throwaway `jassmin_app_test_<pid>` with the app's migrations
(`pnpm db:migrate`), fills it with rows whose personal values are unique markers, runs `setup.py`
(twice) and `extract.py` (twice) into `jassmin_wh_test_<pid>` with `wh_test_<pid>_*` roles, and
checks: no marker in any column of any table or view (raw, and after `dbt build --target prod` the
marts too); the pseudonyms keep one customer per person; `wh_extract` can't read a personal column,
`select *`, or write; the app's database is byte for byte unchanged; `wh_reader` can't read `raw`;
and, when `analytics/dashboard/node_modules` exists, the Evidence site builds as `wh_reader`. It
needs a superuser URL (`WAREHOUSE_TEST_SERVER_URL`) and pnpm. `tests_py/test_nightly.py` runs
`nightly.sh` with stub `uv` and `pnpm` (Linux only): a failing dbt keeps the previous site.
