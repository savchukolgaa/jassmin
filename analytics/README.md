# Analytics: synthetic shop data

The real shop is new, so there's too little history for LTV, churn or demand forecasting. The
generator in `generator/` (#131) simulates about three years of this shop: about 10,000
customers with a known behaviour model and 15,000 anonymous visitors. It produces their visits
and #129 analytics events, carts, orders, payments, discounts, status history and inventory, and
loads them into a separate `jassmin_synth` database. The ETL (#132) and ML (#133) work runs on it.

The data looks like this shop rather than generic e-commerce:

- the real catalog (`app/.server/db/catalog-data.ts`, 128 perfumes) and price table (5 ml 119 ₴,
  10 ml 240 ₴, 30 ml 459 ₴, 50 ml 629 ₴, 100 ml 969 ₴);
- the shop's discount rules, priced by a port of the app's own pricing: the tester trio (3 × 10 ml
  for 499 ₴, #59), the couple offer (15 % off every second full bottle, #124), the welcome code
  `JASSMIN10`, and a yearly 8 March code `VESNA<year>`. Free delivery starts at 1500 ₴ after the
  discount (#71);
- Ukrainian seasonality: 8 March, 14 February, St Nicholas Day, New Year, Black Friday, and a
  summer dip;
- card payments (with failed attempts) or cash on delivery, and Nova Poshta parcels that are
  never collected (`unclaimed`);
- traffic mostly from Instagram and Telegram, and mostly on phones.

## Running it

You need [uv](https://docs.astral.sh/uv/) (`winget install --id=astral-sh.uv -e`) and the repo's
`pnpm install`, because the app's migrations are applied with `pnpm db:migrate`.

```bash
# From the repo root. The server is SYNTH_DATABASE_URL, else DATABASE_URL in .env.
uv run analytics/generator/generate.py --customers 10000

# Also fill the app's own tables in jassmin_synth, so the app can run on the synthetic data.
uv run analytics/generator/generate.py --customers 10000 --load-app-schema

# Only the CSV files (one per table), no database.
uv run analytics/generator/generate.py --customers 300 --out analytics/out --no-db
```

Under Aspire, start **`synth-generate`** from the dashboard (child of `jassmin-synth`). It runs
the same command with `--load-app-schema` against the Aspire Postgres server, whose password only
Aspire knows.

| Argument | Default | Meaning |
|----------|---------|---------|
| `--customers` | 10000 | Registered customers. |
| `--visitors` | 15000 | Anonymous visitors who never register. About 2 % of them place a guest order. |
| `--start` / `--end` | 2024-01-01 / 2026-11-01 | The simulated period (Kyiv days, end exclusive). |
| `--seed` | 42 | The same seed gives byte-identical data. |
| `--load-app-schema` | off | Also load `public.*` (see below). |
| `--out DIR` | — | Also write one CSV per table. |
| `--no-db` | off | Don't connect to any database. |
| `--database-name` | `jassmin_synth` | `jassmin_synth` or `jassmin_synth_<suffix>` only (used by the tests). |

A full run (10,000 customers) takes about 40 s to generate and one to two minutes to migrate and load.
With seed 42 it produces:

| Table | Rows |
|-------|------|
| users | 10,015 |
| sessions | 67,387 |
| user_events | 1,019,447 |
| carts / cart_items | 25,108 / 48,709 |
| orders / order_items | 18,067 / 35,498 |
| payments | 10,222 |
| order_status_history | 63,078 |
| inventory_movements | 19,717 |

### Safety

The generator **never writes to the app's database**. The database name is always replaced by
`jassmin_synth` (or `--database-name`). It must match `jassmin_synth[_suffix]`, and it must not be
the database of `JASSMINDB_URI` or `DATABASE_URL`. Any other target exits with an error before
anything connects. A missing database is created. Every run then applies the app's migrations
and replaces the data: the `raw` schema is dropped and recreated, and with `--load-app-schema` the
app tables are truncated first.

## What's in the database

**`raw.*`** is the landing zone for #132. It has one table per app table with the app's column
names, plus `raw.customer_truth` and `raw.generation_runs`. There are no keys or constraints, and
**every column is `text`**, so every anomaly survives exactly as written (naive timestamps, `uah`,
padded emails) and the staging models do all the casting. Timestamps are ISO 8601 in UTC
(`2025-03-07T18:42:10.123+00:00`), money is a decimal string, arrays are PostgreSQL array literals.

| Table | Content |
|-------|---------|
| `raw.users`, `raw.sessions`, `raw.user_events` | Customers, visits and the #129 event stream (`event_properties` follows `docs/analytics-events.md`). |
| `raw.carts`, `raw.cart_items` | Carts: `converted`, `abandoned` (after 24 h, with #139 reminders for opted-in users) or `active`. |
| `raw.orders`, `raw.order_items`, `raw.payments`, `raw.order_status_history` | Orders with the full lifecycle, `discount_allocated` per line, card payment attempts (`simulator` provider) and every status change with its source. |
| `raw.discounts` | The rules, with their `redemption_count`. |
| `raw.products`, `raw.product_variants` | The real catalog; 30/50/100 ml sizes track stock, 5/10 ml don't. |
| `raw.inventory_movements` | The stock ledger: opening balance, sales, supplier receipts, units back from cancellations, returns and unclaimed parcels. |
| `raw.customer_truth` | The ground truth per customer (below). **Evaluate models against it, never train on it.** It is never copied to `users`. |
| `raw.generation_runs` | Seed, arguments, git commit, digest and row counts of the run. |

**`public.*`** is only filled with `--load-app-schema`. It holds the raw rows that pass the app's
own constraints, so the app can run on the synthetic data. The filter reads them from the
database: values valid for the column types, NOT NULL, CHECKs, foreign keys, and unique indexes.
Anomalies that the schema allows (padded emails, test accounts, `uah`, ×10 totals, double-fired
events, bots) stay in. Two tables are exceptions. `public.inventory_movements` and
`product_variants.stock_quantity` come from a clean ledger in which each backorder shortfall is
covered by an `adjustment` row (note `synthetic backorder`), so `stock_after >= 0` and
`sum(quantity_delta) = stock_quantity` hold, and so does the `inventory_daily` view. Every
synthetic user can log in with the password **`jassmin-demo`**.

## The customer model (ground truth)

Each customer has a segment, an individual purchase rate, a churn probability, a favourite
fragrance family, a usual device, a city and an acquisition channel. `raw.customer_truth` stores
them, with `churned_at` (the order after which the customer churned; `null` if still alive at the
end).

| Segment | Share | Mean orders / year while alive | Churn probability after each order |
|---------|-------|--------------------------------|-------------------------------------|
| `loyal` | 8 % | 6.0 | 0.06 |
| `regular` | 22 % | 3.0 | 0.18 |
| `occasional` | 35 % | 1.3 | 0.40 |
| `one_time` | 35 % | 0.6 | 0.85 |

- **Purchases** follow a Poisson process (BG/NBD-style). Each customer's rate is drawn from a
  Gamma distribution (shape 2) around their segment's mean, and scaled by the day's seasonality.
  After every order the customer churns with the segment's probability. 70 % order in the visit
  they sign up in.
- **Browsing:** 0–3 visits before each order, 35 % of them leaving a cart (most get abandoned).
  Some visits come before signup with the same anonymous id, which is the first touch. Churned
  customers still come back about 1.5 times without buying.
- **Taste:** 65 % of a customer's product views are in their favourite family; the rest follow
  overall popularity, which favours the `/popular` list.
- **Signups** grow over time (a Beta(1.6, 1) trend) with the same seasonality.
- **Traffic and devices:** Instagram 34 %, Google 22 %, direct 16 %, Telegram 12 %, referral 9 %,
  Facebook 7 % (paid, with a campaign). Phones dominate, most of all for Instagram and Telegram,
  and 85 % of visits use the customer's usual device. Card payment is more likely on a desktop
  (62 %) than on a phone (52 %).
- **Seasonality** (multiplier on demand): January 0.8, February 1.15 (× 1.9 on 7–14 February),
  March 1.25 (× 2.6 on 1–8 March), April and May 0.95, June 0.85, July 0.75, August 0.85,
  November 1.15 (× 1.7 in Black Friday week, 22–30 November), December 1.6 (× 1.8 on 1–6 December
  and × 1.5 on 15–31 December).
- **Lifecycle:** 3 % of orders are cancelled by staff. 8 % of first card payments fail, and 40 % of
  those orders are never paid and get cancelled with `payment_failed` by the job after 48 h.
  Parcels ship after about a day (slower in December), arrive about a day later, and 7 % of
  cash-on-delivery parcels (1 % of card ones) are never collected and come back as `unclaimed`.
  2 % of completed orders are returned.
- **Inventory:** each tracked size opens with 2–8 units (6–12 for popular perfumes). At 1 unit or
  fewer a supplier order of 3–8 units (plus any backorder) arrives in 5–21 days. A shopper who
  finds a size out of stock usually takes 10 ml instead; 15 % order it anyway (a backorder).

Every parameter lives in `generator/config.py`.

## Anomaly catalogue

These anomalies are deliberate, for #132 to detect and clean. They exist only in `raw.*` (and in
`public.*` where the app's schema allows them). Rates are exact counts, `round(rate × rows)`, except
backorders, which happen per shopper with a probability.

| Anomaly | Where | Rate | How to detect |
|---------|-------|------|---------------|
| Missing device type | `sessions.device_type`, `user_events.device_type` | 3 % of each | `device_type is null` |
| Double-fired events | `user_events` | 1.5 % extra rows | same `session_id`, `event_type`, `created_at` and `event_properties`, another `event_id` |
| Bot sessions | `sessions` + `user_events` | 25 sessions of 150–399 product views, 0.7 s apart | `count(*) > 100` product views per session, or views per minute |
| Timezone-naive timestamps | `user_events.created_at` | 1 % | `created_at !~ '[+-]\d\d:\d\d$'` (the value is UTC) |
| Missing phone | `users.phone` | 12 % | `phone is null` (the orders still carry `guest_phone`) |
| Messy emails | `users.email` | 2 % | `email <> lower(trim(email))` |
| Test accounts | `users` | 15 extra users | `email like '%@example.com'`, `full_name = 'Test Test'`, no orders |
| Price typo (extra zero) | `orders.total_amount` | 0.2 % | `subtotal - discount_amount <> total_amount` (it's × 10) |
| Shipped after completion | `orders.shipped_at` | 0.4 % of completed orders | `shipped_at > completed_at` |
| Lowercase currency | `orders.currency` | 1 % | `currency <> 'UAH'` |
| Deleted product on a line | `order_items.product_id` | 0.5 % | `product_id is null` (`variant_id` and `volume_ml` remain) |
| Backorders: negative stock | `inventory_movements.stock_after`, `product_variants.stock_quantity` | ~15 % of adds of an out-of-stock size | `stock_after::int < 0` |

## Sanity checks in SQL

```sql
-- Seasonality: orders per day, 1–8 March against July.
select extract(month from created_at::timestamptz at time zone 'Europe/Kyiv') as month,
       count(*) from raw.orders group by 1 order by 1;

-- Abandoned carts.
select status, count(*) from raw.carts group by 1;

-- Stock-outs.
select count(*) from raw.inventory_movements where stock_after::int <= 0;
select count(*) from public.inventory_daily where was_out_of_stock;  -- with --load-app-schema

-- Unclaimed parcels, by payment method.
select status, payment_method, count(*) from raw.orders group by 1, 2 order by 3 desc;
```

## Development

```bash
uv run --project analytics pytest analytics          # needs SYNTH_TEST_DATABASE_URL or DATABASE_URL for the load tests
uv run --project analytics analytics/generator/fixtures.py   # after changing the simulation or the pricing
pnpm analytics:export-catalog                        # after changing the catalog or the prices
```

- `generate.py` lists its dependencies inline (PEP 723), so `uv run` works from the repo root.
  Keep them equal to `pyproject.toml`; a test checks.
- `fixtures/` is checked by the app's Vitest suite
  (`app/.server/synthetic-data.contract.test.ts`): generated events against the #129 schemas, and
  the pricing port against the app's `priceCart`.
- Determinism: every random stream is derived from `--seed`, ids are serial counters or seeded
  UUIDs (v7 for sessions and events, like the app's `uuidv7()`), money is integer kopiyky, and
  rows are written sorted by primary key.
