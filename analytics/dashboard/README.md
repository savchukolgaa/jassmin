# The owner's dashboard (Evidence)

A private dashboard of the shop's real numbers (#183), in Ukrainian: sales, products, tester to
bottle, customers and the AI perfumer. It's an [Evidence](https://evidence.dev) project: SQL and
Markdown pages, built into a static site. In production it's rebuilt every night from the marts of
`jassmin_wh`, the pseudonymised copy of the shop's data, and served on `stats.<site-domain>` behind
a password (`docs/deploy.md`).

| Page | What it shows | Marts |
|------|---------------|-------|
| `pages/index.md` | Revenue, orders and average order, last 7 and 30 days vs the period before | `mart_sales_daily` |
| `pages/sales.md` | The same by day, week or month, first vs repeat orders | `mart_sales_daily` |
| `pages/products.md` | Top perfumes and sizes, families, gift cards, sizes running out | `fct_order_items`, `dim_products`, `fct_gift_card_sales`, `fct_inventory_daily` |
| `pages/testers.md` | Share of trio buyers who order a full bottle within 60 days | `mart_tester_conversion` |
| `pages/customers.md` | New vs returning, cohorts, churn-risk segments, cities, channels | `fct_orders`, `mart_customer_rfm` |
| `pages/perfumer.md` | Messages, answer time, click-through, 7-day orders, ratings | `mart_perfumer_daily` |

Every page starts with `<DataDate>` (`components/DataDate.svelte`): when the last nightly copy
finished (`meta.extract_runs`), and a warning when it's more than 36 hours old.

## How it reads the data

- `sources/warehouse/connection.yaml` is the PostgreSQL source. Its settings come only from the
  environment: `EVIDENCE_SOURCE__warehouse__host`, `__port`, `__database`, `__user`, `__password`.
  In production that's `jassmin_wh` as the read-only `wh_reader` role, which can read `marts` and
  `meta` and nothing else.
- `sources/warehouse/*.sql` run against PostgreSQL at `pnpm run sources` and are stored as Parquet.
  Each returns at least one row: with no data it returns a typed placeholder row
  (`is_placeholder`), because Evidence can't store an empty result. Pages read
  `(select * from warehouse.<source> where not is_placeholder)`.
- The pages' ` ```sql ` blocks run in DuckDB, in the browser and at build time. Dates arrive as
  timestamps, so date arithmetic needs `::date`.
- Every chart, table and number has `emptySet=pass emptyMessage="Ще немає даних"`, so a shop without
  orders yet still builds.

## Running it locally

It's its own pnpm workspace (`pnpm-workspace.yaml`, its own lockfile), outside the shop's install.
`nodeLinker: hoisted` because the SvelteKit app Evidence generates expects a flat `node_modules`.

```bash
pnpm --dir analytics/dashboard install
```

Build a local `jassmin_wh` first (`analytics/warehouse/README.md` → Real data → Running it by hand),
then, with its reader role:

```bash
# bash; PowerShell: $env:EVIDENCE_SOURCE__warehouse__host = "127.0.0.1", and so on.
export EVIDENCE_SOURCE__warehouse__host=127.0.0.1 EVIDENCE_SOURCE__warehouse__port=5432 \
  EVIDENCE_SOURCE__warehouse__database=jassmin_wh EVIDENCE_SOURCE__warehouse__user=wh_reader \
  EVIDENCE_SOURCE__warehouse__password=... SEND_ANONYMOUS_USAGE_STATS=no
pnpm --dir analytics/dashboard run sources        # query the marts into Parquet
pnpm --dir analytics/dashboard run dev            # http://localhost:3000, live reload
pnpm --dir analytics/dashboard run build:strict   # the static site in build/, as in production
```

`SEND_ANONYMOUS_USAGE_STATS=no` turns off Evidence's usage telemetry; production sets it too.

`analytics/warehouse/tests_py/test_extract.py` builds the site on its throwaway warehouse whenever
`node_modules` is installed here, as CI does.

## Adding a page

Add `pages/<name>.md` with the `freshness` query and `<DataDate data={freshness} />` at the top,
Ukrainian copy, UAH as `fmt='#,##0" ₴"'`, and the empty-data props on every component. A new source
query needs a typed placeholder row like the others. Read only `marts` (and `meta`): the reader role
can't see anything else, and personal data never reaches the marts.
