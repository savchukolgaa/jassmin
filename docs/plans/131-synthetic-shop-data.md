# Plan: Generate realistic synthetic shop data into a separate database (#131)

Issue: https://github.com/savchukolgaa/jassmin/issues/131
Branch: `issue/131`
Worktree: `.claude/worktrees/issue-131`
Status: Implemented

## Goal

As a data analyst, I want a reproducible generator that fills a **separate** `jassmin_synth`
database with realistic data for this shop, so ETL (#132), BI and ML (#133) work can be built and
demoed before the real shop has enough history. A seeded Python script in `analytics/generator/`
simulates ~10,000 customers over ~3 years (sessions, events, carts, orders, payments, discounts,
status history, inventory) with a known customer model as ground truth and a catalogue of deliberate
data-quality anomalies, loads it into `raw.*` with `COPY`, and optionally loads the rows that pass
the app's constraints into `public` so the app itself can run on it.

## Dependencies & prerequisites

- **#128** (lifecycle columns, `order_status_history`, `order_items.discount_allocated`,
  `users.city` / `marketing_opt_in`): merged, migration `0028_order_lifecycle_ml.sql`.
- **#130** (`inventory_movements` ledger + `inventory_daily` view, append-only trigger): merged,
  migration `0029_inventory_movements.sql`.
- **#129** (typed `event_properties` contract, `docs/analytics-events.md`,
  `app/lib/analytics.schema.ts`): merged. The prototype's camelCase properties predate it and must
  be rewritten to the snake_case contract.
- **#139** (`carts.reminder_sent_at` / `restored_at`, `users.locale`): merged, migration 0031.
- **Tooling:** `uv` is **not installed** on this machine (`uv: command not found`; Python 3.10.2 is).
  Install it before implementing (`winget install --id=astral-sh.uv -e`). uv brings its own Python;
  the project pins **3.12** in `analytics/.python-version`.
- **Python packages** (in `analytics/pyproject.toml` + `uv.lock`): `numpy`, `pandas`,
  `psycopg[binary]` 3, `tzdata` (Windows has no IANA zone database for `zoneinfo`); dev: `pytest`.
- **No app migration.** `jassmin_synth` gets the app's existing migrations; the `raw` schema is
  created by the generator, not by drizzle.

## Decisions & assumptions

**Layout and running**
- `analytics/` is a standalone uv project (`pyproject.toml`, `uv.lock`, `.python-version`), not part
  of the pnpm workspace. pnpm, Biome, `tsc` and Vite ignore it (`biome.json` `!analytics`,
  `vite.config.ts` watch-ignore, `.gitignore` for `.venv`, caches and `out/`). `tsconfig.json` only
  includes `.ts`, so it needs no change.
- `uv run` discovers projects from the **current directory**, not the script's, so
  `uv run analytics/generator/generate.py` from the repo root would not see `analytics/pyproject.toml`.
  To make the issue's exact command work, `generate.py` carries **PEP 723 inline metadata** with the
  same dependency pins as `pyproject.toml`; a pytest test asserts the two lists match.
  `uv run --project analytics pytest` (or `cd analytics && uv run pytest`) runs the tests.
- Code is split into small modules next to `generate.py` (importable as siblings when run as a
  script; `pythonpath = ["generator"]` for pytest): `config.py` (constants, segments, seasonality,
  anomaly rates), `ids.py`, `catalog.py`, `pricing.py`, `simulate.py`, `anomalies.py`, `frames.py`,
  `db.py`.

**Safety: never the app's database**
- The target URL comes from, in order: `JASSMIN_SYNTH_URI` (injected by Aspire for the new
  `jassmin-synth` database resource), `SYNTH_DATABASE_URL`, or the app's `DATABASE_URL` from `.env`
  **with the database name replaced** by `jassmin_synth`.
- Hard guard before any connection: the target database name must match
  `^jassmin_synth(_[a-z0-9_]+)?$` (the suffix is for throwaway test databases), and must differ from
  the database of `JASSMINDB_URI` / `DATABASE_URL`. Otherwise exit with an error. Unit-tested.
- If the database doesn't exist (non-Aspire runs), the generator connects to the server's `postgres`
  maintenance database and runs `CREATE DATABASE jassmin_synth` (Aspire creates it itself).
- Migrations: the generator runs `pnpm db:migrate` as a subprocess from the repo root with
  **both** `JASSMINDB_URI` and `DATABASE_URL` overridden to the synth URL (drizzle.config.ts reads
  `JASSMINDB_URI || DATABASE_URL`), so the app's own migrator and journal are reused, never
  re-implemented.

**Determinism**
- One `numpy.random.Generator` per concern, all derived from `--seed` with `SeedSequence.spawn`
  (people, sessions, orders, inventory, anomalies, ids), so adding draws in one place doesn't shift
  every other table.
- UUIDs come from a seeded `Ids` class (replaces the prototype's `globals()["uid"]` hack). Session
  and event ids are **UUIDv7-shaped** (48-bit millisecond timestamp + seeded random bits), like the
  app's `uuidv7()` defaults, so they sort by time. Product and variant public ids are the real ones.
- No `pandas.sample(random_state=1)` with fixed states, no set iteration, no wall-clock time, no
  floats for money: amounts are integer kopiyky internally and written as `"1234.00"` strings.
- "Byte-identical output" = the COPY payload (CSV text) of every table. `generate.py --out <dir>`
  also writes those CSVs without a database, which is what the determinism test compares.

**Time**
- Simulation runs in `zoneinfo("Europe/Kyiv")` (real DST, unlike the prototype's fixed +02:00);
  timestamps are written as ISO 8601 with offset. Seasonality uses Kyiv local dates.

**Catalog (from the real shop)**
- A new `pnpm analytics:export-catalog` script writes `analytics/generator/data/catalog.json` from
  `CATALOG_PRODUCTS` (`app/.server/db/catalog-data.ts`, 128 perfumes with real `publicId`, brand,
  gender, `fragranceFamilies`, `popularRank`, `storeCode`) and `CATALOG_PRICES` (5 sizes), plus
  `FRAGRANCE_FAMILIES` and `FREE_SHIPPING_THRESHOLD`. The JSON is **committed** so the generator
  runs without Node; a Vitest test fails when it's stale.
- Variant `public_id`s are derived deterministically (UUIDv5 of product public id + volume), since
  the catalog has none.
- **(unconfirmed, Q4)** Full bottles (30/50/100 ml) are `track_stock = true` in the synthetic world
  so the ledger and stock-outs exist; 5/10 ml decants are untracked, as in the real shop.

**Discounts and pricing (ported from the app)**
- `pricing.py` ports `discountedUnits` / `priceCart` / `allocateDiscount`
  (`app/.server/services/pricing.ts`): best single rule wins, ties prefer the entered code then the
  older rule; `discount_allocated` per line adds up exactly to `orders.discount_amount`;
  `free_shipping = subtotal - discount >= 1500`; `shipping_amount = 0` (`SHIPPING_AMOUNT`).
- Rules (from `seed-data.ts` where they exist): `tester-trio` (`fixed_price_set` 499, 10 ml, sets
  of 3, max 3), `couple-15` (`percent_every_nth` 15 %, 30/50/100 ml), `welcome-10` with the real
  code `JASSMIN10` (first orders), plus a synthetic seasonal code `VESNA15` (15 %, `starts_at`
  1 March / `ends_at` 9 March each year — one row per year, e.g. `vesna-2025`). `redemption_count`
  is filled from the orders.
- **(unconfirmed, Q3)** `couple-15.starts_at = 2025-09-01`, so models see a before/after.
- A parity fixture (`analytics/generator/fixtures/pricing-cases.json`, ~50 generated carts with the
  generator's results) is checked by a Vitest test against the real `priceCart`, so the port can't
  drift from the app.

**Events follow the #129 contract**
- `event_properties` use the snake_case keys and shapes of `docs/analytics-events.md`: product events
  carry `product_public_id`, `variant_id` (uuid), `volume_ml`, `price` (string), `in_stock`, and
  `list_id` / `list_position` on impressions and clicks; `product_dwell` has `dwell_ms` (≤ 1 800 000)
  and `max_scroll_pct`; `search` has `search_id`, `query: null`, `gender`, `fragrance_family`,
  `brand`, `sort`, `page`, `result_count`, `product_public_ids` (≤ 24); `checkout_start`, `purchase`
  (with `items`, `is_first_order`, `gift_card_amount`) and `login` (`method`) as documented.
- Sessions follow the funnel: `page_view` → impressions/clicks on a list → `product_view` +
  `product_dwell` → `add_to_cart` (with `cart_value_after`) → `checkout_start` → `purchase`;
  `login` with `register` on the signup session, `login` on later logged-in sessions.
- A fixture of generated events (`analytics/generator/fixtures/sample-events.json`, every type) is
  validated by a Vitest test against `eventPropertiesSchemas`, so the Python output can't break the
  contract. Anomalies never change `event_properties` (bot events are valid product views).

**Rows match the real schema** (prototype fixes)
- `payments`: card attempts only, `provider = 'simulator'` (the only `PAYMENT_PROVIDERS` value, not
  `liqpay`), `reference = '<order id>-<attempt>'`, some `failed` attempts before a `succeeded` one;
  a card order whose payment never succeeds is cancelled with `cancel_reason = 'payment_failed'` by
  the `job` (#128). Cash-on-delivery orders have no payment row and become `paid` on completion.
- `order_status_history.source`: `checkout` (pending), `payment` (paid), `cms` (shipped,
  completed, cancelled by staff, returned, unclaimed), `job` (payment_failed cancellations).
- Shipped orders get a 14-digit `waybill_number` and `arrived_at` (#138) between shipping and
  completion / return.
- `inventory_movements`: `opening_balance` (source `migration`) for the first stock, `receipt`
  (`cms`) for restocks, `sale` (`checkout`), and units coming back: `cancellation` (`job` for
  `payment_failed`, `cms` for staff cancels) and `return` (`cms`, for returned and unclaimed
  parcels). The prototype's `stockout` rows with `quantity_delta = 0`
  violate `reason` and `quantity_delta <> 0`, so they are dropped: stock-outs show up as
  `stock_after <= 0` and in `inventory_daily.was_out_of_stock`.
- `cart_items` merge repeated variants (unique `cart_id, variant_id`); a user or guest session has at
  most one `active` cart (older ones become `abandoned`); `abandoned_at = updated_at + 24 h`
  (`DEFAULT_ABANDONED_CART_HOURS`); for opted-in users, abandoned carts get `reminder_sent_at`
  (≤ 1 per 7 days) and some `restored_at` (#139).
- `users`: `password_hash` is one constant argon2id hash of a documented demo password (computed
  once with `@node-rs/argon2`, stored in `config.py`), so a demo login works on `--load-app-schema`
  data; `locale` (`uk` ~90 %), `email_verified_at`, `first_touch_*`, `city`, `marketing_opt_in`,
  `last_login_at`. The prototype's `birth_year` and the orders' `item_count`, `is_first_order`,
  `device_type`, `delivery_city` aren't app columns and are dropped.
- Prototype fixes from the issue: the pandas `concat` FutureWarning (build frames from lists once;
  never concat empty/all-NA frames) and the `globals()` uid replacement (seeded `Ids`).

**Raw layer**
- `raw.<table>` for each output table with the app's column names, **no constraints, keys or
  indexes**. **(unconfirmed, Q2)** All columns are `text`, so every anomaly survives exactly as
  written (naive timestamps, `uah`, padded emails); #132's staging models do the casting.
- `raw.customer_truth(user_id, segment, purchase_rate, churn_probability, favourite_family,
  usual_device, churned_at)` holds the ground truth, never `users`.
- `raw.generation_runs` (one row: seed, arguments, git commit, row counts, started/finished) for
  provenance.
- A run is idempotent: `DROP SCHEMA IF EXISTS raw CASCADE` then recreate; loads use psycopg 3
  `cursor.copy("COPY raw.t (...) FROM STDIN")` in one transaction.

**`--load-app-schema`**
- **(unconfirmed, Q1)** Loads into `public` the rows of `raw.*` that pass the app's constraints
  (the issue's wording), so anomalies that are legal in the app (padded emails, test accounts,
  `uah`, ×10 totals, double events, bots) are kept — the app shows dirty-but-valid data.
- Implemented in SQL: `TRUNCATE` the loaded public tables `RESTART IDENTITY CASCADE` (the ledger's
  append-only trigger is row-level on UPDATE/DELETE, so TRUNCATE works — verify in step 9), then
  one `INSERT INTO public.t (...) SELECT <casts> FROM raw.t WHERE <constraint checks> AND <parent
  exists>` per table in FK order, in one transaction, then `setval` every serial sequence.
- The ledger needs care: dropping sale rows with negative `stock_after` would break
  `sum(quantity_delta) = stock_quantity`. Instead the public ledger is rebuilt from the clean
  simulation: before a sale that would go negative an `adjustment` (+shortfall, source `cms`, note
  `synthetic backorder`) is inserted. `product_variants.stock_quantity` = the ledger's final sum.
- `discounts`, `products`, `product_variants` are loaded so FKs resolve; Strapi is not involved
  (no `cms_outbox` rows).

**Aspire**
- `apphost.mts`: `postgres.addDatabase("jassmin-synth", { databaseName: "jassmin_synth" })` and an
  explicit-start child `synth-generate`: `builder.addExecutable("synth-generate", "uv", "..",
  ["run", "analytics/generator/generate.py", "--load-app-schema"])` with `.withReference(synthDb)`
  (injects `JASSMIN_SYNTH_URI`), `.waitFor(synthDb)`, `.withParentRelationship(synthDb)`,
  `.withExplicitStart()`. It does **not** reference `jassmindb`. Needed because under Aspire the
  Postgres password is known only to Aspire (same reason as `db-seed`).

**CI**
- New `analytics` job in `.github/workflows/ci.yml`, path-filtered like `cms` (`analytics/**`,
  `app/.server/db/catalog-data.ts`, `app/.server/db/migrations/**`): `astral-sh/setup-uv`,
  `uv run --project analytics pytest` with a `postgres:18` service. Not a required check.

**Deviations during implementation** (recorded here so nothing diverges silently)
- **Open questions answered with the defaults** (user, 2026-11-09): Q1 constraint-filtered raw
  rows, Q2 all-`text` raw columns, Q3 couple offer from 2025-09-01, Q4 track 30/50/100 ml.
- **No pandas.** Rows are dicts and CSV is written with the `csv` module: a million event rows
  in DataFrames plus copies for the anomalies used far more memory for no benefit. numpy stays for
  the bulk draws (Beta signups, Gamma rates, popularity); scalar draws use seeded
  `random.Random` streams (numpy scalar calls are ~50× slower). All streams come from
  `SeedSequence(seed).spawn(...)`.
- **Simulation order.** Visits are planned per person, then run in time order with stock events
  (receipts, units coming back) in a heap, so serial ids grow with time and shoppers see the stock
  of the moment. Out-of-stock adds: 85 % switch to 10 ml, 15 % backorder (a probability, so its
  test uses a binomial bound; every other anomaly is an exact count).
- **Clean ledger.** The simulation keeps a second ledger where each backorder shortfall gets an
  `adjustment`; `--load-app-schema` loads it (and the matching stock) through temp tables instead of
  `raw.inventory_movements`, which keeps its negative `stock_after`.
- **Public load is generic.** `db.py` reads the column types, defaults, CHECKs and single-column
  FKs from the catalog and builds one `insert … select … where` per table (`pg_input_is_valid`
  for casts, `check is not false`), instead of a hand-written `sql/load_public.sql`.
- **Fixtures** are written by `generator/fixtures.py`; `tests/test_fixtures.py` checks freshness.
- **Test accounts** are 15 extra users (no orders) instead of overwriting real customers.
- **Guest orders:** ~2 % of anonymous visitors check out as guests (`user_id` null), for
  identity resolution in #132.
- **Aspire** passes the URI explicitly (`JASSMIN_SYNTH_URI` from `uriExpression()`), so it doesn't
  depend on the generated env-var name for a hyphenated resource.
- **CI:** the load tests fail instead of skipping when `CI` is set without a database URL.

## Open questions

- [x] **Q1: Should `--load-app-schema` load the anomalous-but-valid rows, or the clean
  pre-anomaly data?** — Why it matters: the issue says "rows that pass the app's constraints",
  which keeps test accounts, padded emails, bot sessions and ×10 totals in the app's tables; a
  clean load would make the app demo and Metabase-on-`public` nicer, while `raw` keeps the dirty
  copy for #132. Recommended default: follow the issue literally (constraint-filtered raw rows).
  Affects steps: 9.
- [x] **Q2: Are `raw.*` columns all `text`, or typed like the app's (timestamptz, numeric, int)?** —
  Why it matters: typed columns would silently fix the naive-UTC timestamp anomaly (cast in the
  session time zone) and reject unparseable values, but are easier to query; #132's staging layer
  depends on the choice. Recommended default: all `text` (a true landing zone, every anomaly
  survives). Affects steps: 8, 9, 10.
- [x] **Q3: When does the couple offer (#124) start in the synthetic history?** — Why it matters:
  the prototype gates it after 2026-11-15, i.e. after `--end`, so it never appears; the issue lists
  it among the discount rules. Recommended default: `2025-09-01`, giving a before/after for a
  promotion-uplift analysis. Affects steps: 4.
- [x] **Q4: Should the synthetic shop track stock on full bottles (30/50/100 ml)?** — Why it
  matters: the real catalog tracks no size (`track_stock = false`, #98), so a faithful copy would
  have no ledger, no stock-outs and nothing for demand forecasting, which the issue asks for.
  Recommended default: track 30/50/100 ml, keep 5/10 ml untracked. Affects steps: 3, 7.

## Resolved questions

- **Which payment provider do payment rows use?** — `simulator`, the only value of
  `PAYMENT_PROVIDERS`; the CHECK would reject the prototype's `liqpay` (source:
  `app/lib/enums.ts`, `app/.server/db/schema.ts` `payments_provider_check`).
- **Is there a `stockout` movement reason?** — No: `INVENTORY_MOVEMENT_REASONS` is
  `opening_balance, sale, cancellation, return, receipt, adjustment`, and `quantity_delta <> 0`,
  `stock_after >= 0` are CHECKs (source: `app/lib/enums.ts`, `schema.ts` `inventoryMovements`).
- **What do event properties look like?** — snake_case, money as decimal strings, public UUIDs,
  validated by `eventPropertiesSchemas` (source: `docs/analytics-events.md`, #129).
- **Is free shipping on the subtotal or after discount?** — `subtotal - discount >= 1500`, and the
  store charges no shipping (`SHIPPING_AMOUNT = "0.00"`) (source: `app/lib/checkout.ts`,
  `app/.server/services/pricing.ts`).
- **How is the discount split over lines?** — `allocateDiscount`: proportional to discounted units'
  prices, floored to kopiyky, remainder on the heaviest line (source: `pricing.ts`, #128).
- **Which promo code is the welcome code?** — `JASSMIN10` (`welcome-10`) (source:
  `app/.server/db/seed-data.ts`).
- **When is a cart abandoned?** — after 24 h of inactivity (`DEFAULT_ABANDONED_CART_HOURS`), with
  `abandoned_at` set and `updated_at` untouched (source: `app/.server/db/abandoned-carts.ts`, #19).
- **Which order-status sources exist?** — `checkout, payment, cms, job` (source: `app/lib/enums.ts`).
- **How are migrations applied to another database?** — `pnpm db:migrate` reads
  `JASSMINDB_URI || DATABASE_URL` (source: `drizzle.config.ts`), so overriding both targets the
  synth DB.
- **Can Aspire add a second database and run a non-Node command?** — yes:
  `addDatabase(name, { databaseName })` and `addExecutable(name, command, workingDirectory, args)`
  exist in the generated SDK (source: `aspire-apphost/.aspire/modules/aspire.mts`).
- **Where does the real catalog come from?** — `CATALOG_PRODUCTS` (128 perfumes with public ids and
  families) and `CATALOG_PRICES` (source: `app/.server/db/catalog-data.ts`,
  `catalog-prices.ts`).
- **Does `uv run <script>` find `analytics/pyproject.toml` from the repo root?** — No, project
  discovery starts at the working directory; hence PEP 723 inline metadata in `generate.py`.
- **Who consumes the output?** — #132 (dbt raw → staging → marts) reads `raw.*`; #133 (models,
  case study) evaluates against `raw.customer_truth`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `analytics/pyproject.toml` | uv project: numpy, psycopg[binary], tzdata; dev pytest; pytest config |
| create | `analytics/uv.lock` | Locked dependencies |
| create | `analytics/.python-version` | `3.12` |
| create | `analytics/README.md` | How to run, customer model, anomaly catalogue, raw/public layout |
| create | `analytics/generator/generate.py` | CLI with PEP 723 metadata: args, safety guard, orchestration |
| create | `analytics/generator/config.py` | Segments, channels, devices, cities, names, seasonality, anomaly rates, demo hash |
| create | `analytics/generator/ids.py` | Seeded serial counters, UUIDv7-shaped and UUIDv5 ids |
| create | `analytics/generator/catalog.py` | Loads `data/catalog.json`, builds products, variants, discounts |
| create | `analytics/generator/pricing.py` | Port of the app's pricing and discount allocation |
| create | `analytics/generator/simulate.py` | People, sessions/events, carts, orders, lifecycle, payments, inventory |
| create | `analytics/generator/anomalies.py` | Deliberate anomalies, each with its configured rate |
| create | `analytics/generator/frames.py` | Rows → deterministic CSV/COPY payloads per table |
| create | `analytics/generator/db.py` | URL resolution, guard, create DB, migrate, raw DDL, COPY, public load |
| create | `analytics/generator/data/catalog.json` | Exported real catalog (generated, committed) |
| create | `analytics/generator/fixtures.py` | Writes the two fixture files |
| create | `analytics/generator/fixtures/sample-events.json` | One generated event per type, for the zod contract test |
| create | `analytics/generator/fixtures/pricing-cases.json` | Generated carts with expected pricing, for the parity test |
| create | `analytics/tests/conftest.py` | Small-run fixture (e.g. 300 customers), throwaway DB helper |
| create | `analytics/tests/test_determinism.py` | Same seed → identical payloads; different seed → different |
| create | `analytics/tests/test_model.py` | Totals reconcile, no order before signup, seasonality, lifecycle order, ledger sums |
| create | `analytics/tests/test_anomalies.py` | Each anomaly within ±30 % of its rate |
| create | `analytics/tests/test_safety.py` | Guard refuses non-synth / app database names |
| create | `analytics/tests/test_fixtures.py` | Committed fixtures equal a fresh generation; PEP 723 deps = pyproject deps |
| create | `analytics/tests/test_load.py` | (needs `DATABASE_URL`) migrate + raw load + `--load-app-schema` into `jassmin_synth_test_<pid>` |
| create | `app/.server/db/synthetic-catalog.ts` | Pure `buildSyntheticCatalog()` → the JSON object |
| create | `app/.server/db/scripts/export-synthetic-catalog.ts` | Writes `analytics/generator/data/catalog.json` |
| create | `app/.server/db/synthetic-catalog.test.ts` | Committed JSON is up to date |
| create | `app/.server/synthetic-data.contract.test.ts` | Fixture events pass `eventPropertiesSchemas`; pricing cases match `priceCart` |
| modify | `package.json` | `analytics:export-catalog` script |
| modify | `aspire-apphost/apphost.mts` | `jassmin-synth` database + explicit-start `synth-generate` |
| modify | `aspire-apphost/AGENTS.md` | Document the two resources |
| modify | `biome.json` | Exclude `analytics` |
| modify | `vite.config.ts` | Watch-ignore `**/analytics/**` |
| modify | `.gitignore` | `analytics/.venv/`, `__pycache__/`, `.pytest_cache/`, `analytics/out/` |
| modify | `.github/workflows/ci.yml`, `docs/ci.md` | Path-filtered `analytics` pytest job |
| modify | `AGENTS.md`, `README.md`, `docs/setup.md` | Mention `analytics/` (uv, never the app DB), how to run |

## Steps

- [x] **1. Repo plumbing** — `.gitignore`, `biome.json` (`!analytics`), `vite.config.ts` watch
  ignore. Check: `pnpm lint`, `pnpm typecheck` unchanged.
- [x] **2. Catalog export** — `synthetic-catalog.ts` (`buildSyntheticCatalog()` returning
  `{ products, prices, fragranceFamilies, freeShippingThreshold }` from `CATALOG_PRODUCTS`,
  `CATALOG_PRICES`, `FRAGRANCE_FAMILIES`, `FREE_SHIPPING_THRESHOLD`), the tsx script and
  `pnpm analytics:export-catalog`; write the JSON with sorted keys and a trailing newline; Vitest
  test compares the committed file to `buildSyntheticCatalog()`.
- [x] **3. Python project skeleton** — `pyproject.toml`, `.python-version`, `uv lock`;
  `generate.py` with PEP 723 metadata and argparse (`--customers 10000 --visitors 15000 --start
  2024-01-01 --end 2026-11-01 --seed 42 --load-app-schema --out <dir> --database-name`);
  `config.py` from the prototype (segments, channels, devices, cities, names, `HOUR_P`,
  seasonality with Kyiv dates, track-stock volumes per Q4); `ids.py`; `catalog.py` reading
  `catalog.json` (products with real ids/families/`popular_rank`, 5 variants each at
  `CATALOG_PRICES`, derived variant ids). Check: `uv run analytics/generator/generate.py --help`.
- [x] **4. Pricing port** — `pricing.py` mirroring `discountedUnits`, `priceCart`,
  `allocateDiscount` and the tie rules in kopiyky; discount rows per the decisions (couple offer
  start per Q3, yearly `VESNA15`). Generate `fixtures/pricing-cases.json`; add the parity part of
  `synthetic-data.contract.test.ts`. Check: `pnpm test` passes on the parity cases.
- [x] **5. People and ground truth** — port `build_users`: signup growth (Beta), segment +
  Gamma-distributed rate, churn probability, favourite family (65 % of views), usual device by
  channel, city, channel → `first_touch_*`, `locale`, `marketing_opt_in`, demo `password_hash`;
  `customer_truth` rows kept separately.
- [x] **6. Sessions, events, carts, orders** — port `simulate`/`session`/`place_order`/`lifecycle`
  with the fixes listed in Decisions: #129 event properties and funnel, one active cart per owner,
  merged cart lines, `abandoned_at`, reminders for opted-in users, `discount_allocated`, payments
  with attempts, status history with sources, waybill + `arrived_at`, COD `unclaimed` (~7 %),
  returns, cancellations; churned customers keep browsing. Generate
  `fixtures/sample-events.json` and add the contract part of `synthetic-data.contract.test.ts`.
- [x] **7. Inventory** — port `run_inventory`: opening balances, sales in time order, reorder point
  and supplier lead time, receipts, cancellation/unclaimed/return units put back; backorders let
  stock go negative (raw anomaly) and the clean ledger used for `public` inserts `adjustment` rows
  instead. `product_variants.stock_quantity` = final ledger sum.
- [x] **8. Anomalies and output** — `anomalies.py` applies, on copies of the clean frames, each
  catalogued anomaly with its own spawned RNG and rate from `config.py`: missing `device_type`
  (3 % of sessions and events), double-fired events (1.5 %, new id, same timestamp), 25 bot
  sessions (150–400 product views, 0.7 s apart), missing phones (12 %), emails with stray
  spaces/upper case (2 %), 15 `@example.com` test accounts, ×10 price typos (0.2 % of orders),
  `shipped_at` after `completed_at` (0.4 %), lowercase `uah` (1 %), order items with deleted
  product (`product_id` NULL, 0.5 %), naive UTC timestamps (1 % of events), negative stock during
  stock-outs. `frames.py` turns rows into deterministic CSV (fixed column order, `\N` for NULL,
  sorted by primary key); `--out` writes them to disk.
- [x] **9. Database load** — `db.py`: URL resolution and guard, create DB if missing, `pnpm
  db:migrate` with overridden env, `DROP/CREATE SCHEMA raw`, `CREATE TABLE raw.*` (column types per
  Q2) + `raw.customer_truth` + `raw.generation_runs`, `COPY` every table in one transaction.
  `--load-app-schema`: `sql/load_public.sql` (TRUNCATE … RESTART IDENTITY CASCADE, constraint- and
  FK-filtered inserts in FK order, `setval`), per Q1. Verify the ledger trigger allows TRUNCATE
  (migration 0029). Print row counts per table, raw and public.
- [x] **10. Tests** — pytest files from the Files table: determinism (two runs with seed 7 and
  300 customers give identical payload hashes); `subtotal - discount = total` on clean frames;
  no order/session/cart before the user's `created_at`; March 1–8 daily orders > 2× July daily
  average; status timestamps in lifecycle order on clean data; per-variant ledger sum = stock;
  each anomaly rate within ±30 % (bot and test-account counts exact); guard refuses
  `jassmindb`/`postgres`/the app DB name; fixtures and catalog JSON fresh; PEP 723 deps match
  `pyproject.toml`; DB integration test skipped (with a reason) when no `DATABASE_URL`.
- [x] **11. Aspire** — `jassmin-synth` database and explicit-start `synth-generate` executable;
  document in `aspire-apphost/AGENTS.md`. Check: `pnpm aspire:build`; start `synth-generate` from
  the dashboard and confirm `jassmindb` row counts are unchanged.
- [x] **12. CI** — `analytics` job (setup-uv, pnpm install for migrations, postgres:18 service,
  `uv run --project analytics pytest`), path filter in `changes`; update `docs/ci.md`.
- [x] **13. Docs** — `analytics/README.md`: commands (standalone and Aspire), arguments, the
  customer model (segment table, rates, churn, Gamma heterogeneity, family affinity, devices,
  channels, seasonality multipliers), the anomaly catalogue (anomaly, table/column, rate, how to
  detect in SQL), raw vs public, `customer_truth` warning, the demo password, the sanity SQL from
  Testing below. Short pointers in `AGENTS.md` (Python in `analytics/`, uv, never writes the app
  DB), `README.md`, `docs/setup.md`.
- [x] **14. Full run** — `uv run analytics/generator/generate.py --customers 10000
  --load-app-schema`; record runtime and row counts in the README; run the app against
  `jassmin_synth` briefly (catalog, an order page) to confirm `public` is usable.

## Testing & verification

- **pytest** (`uv run --project analytics pytest`): determinism, reconciliation, causality,
  seasonality, lifecycle order, ledger invariant, anomaly rates, safety guard, fixture freshness,
  DB load integration (with Postgres).
- **Vitest**: `synthetic-catalog.test.ts` (JSON fresh), `synthetic-data.contract.test.ts` (sample
  events pass `eventPropertiesSchemas`; pricing cases match `priceCart` and `allocateDiscount`).
- **App checks:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm aspire:build`.
- **Sanity SQL on `jassmin_synth`** (also in the README):
  - seasonality: orders per day, `date_trunc('day', created_at::timestamptz at time zone
    'Europe/Kyiv')`, March 1–8 vs July;
  - abandoned carts: `select status, count(*) from raw.carts group by 1`;
  - stock-outs: `select count(*) from raw.inventory_movements where stock_after::int <= 0`, and
    `inventory_daily where was_out_of_stock` on `public`;
  - unclaimed parcels: `select status, payment_method, count(*) from raw.orders group by 1, 2`;
  - the app DB untouched: row counts in `jassmindb` before/after a run.

## Acceptance criteria

Verified locally on 2026-11-09 against a throwaway `postgres:18` container (the same major
version as Aspire and CI).

- [x] `uv run analytics/generator/generate.py --customers 10000` creates and loads `jassmin_synth`
  and never touches the app's database — steps 3, 9, 11, 14. The exact command ran from the repo
  root (PEP 723 inline deps) and created, migrated (32 migrations) and loaded the database in about
  3.5 min. The guard is covered by `test_safety.py`. **Not run:** the Aspire `synth-generate`
  resource itself; the apphost compiles (`pnpm aspire:build`), but Aspire wasn't started.
- [x] The output covers users, sessions, user_events, carts, cart_items, orders, order_items,
  payments, discounts, order_status_history and inventory_movements — steps 4–9. All of them are in
  `raw.*`, and every row passed into `public.*`.
- [x] The same seed gives identical data — steps 3, 8, 10. `test_determinism.py`, and two 10k runs
  in different Python environments gave the same digest `b84b507e9602`.
- [x] Seasonality, abandoned carts, stock-outs and unclaimed parcels are visible in simple SQL
  counts — steps 6, 7, 13, 14. 10k run: 45.1 orders/day on 1–8 March vs 12.4 in July, 7,040
  abandoned carts, 2,302 ledger rows at or below zero stock (8,521 out-of-stock days in
  `inventory_daily`), and 686 unclaimed parcels (599 cash on delivery).
- [x] Every anomaly in the README catalogue is present at roughly its documented rate — steps 8,
  10, 13. Checked by `test_anomalies.py` (±30 %; binomial bound for backorders).
- [x] `pytest` passes, and the app's `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`
  are unaffected — steps 1, 2, 10, 12. 35 pytest tests pass (2 need a database). Vitest against a
  real Postgres: 2222 passed, 1 skipped. Without a reachable database, `health.test.ts` fails
  exactly as it did before this branch. **Not run yet:** the new `analytics` CI job.

## Out of scope

- Cleaning, staging and marts (#132) and models / case study (#133).
- Gift cards, gift card redemptions, order emails, email suppressions, auth tokens, rate limits,
  `cms_outbox` and Strapi data in the synthetic database.
- Any change to the app's schema, migrations or runtime code.
- Running the generator against production, or scheduling it.
