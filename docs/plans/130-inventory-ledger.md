# Plan: Log every stock change in an inventory ledger for demand forecasting (#130)

Issue: https://github.com/savchukolgaa/jassmin/issues/130
Branch: `issue/130`
Worktree: `.claude/worktrees/issue-130`
Status: Implemented

## Goal

The store owner and data analyst want every change to a tracked size's stock recorded with its
reason, so they can forecast demand per perfume and size and see when a stock-out cost sales. Add
an append-only `inventory_movements` ledger (sale, cancellation, return, receipt, adjustment,
opening balance) written in the same transaction as every `product_variants.stock_quantity`
change, plus an `inventory_daily` view with units sold, closing stock and an out-of-stock flag per
variant and day.

## Dependencies & prerequisites

- #98 (stock tracking: `track_stock`, `decrementVariantStock`, `restockOrder`) is on `main`.
- #11 / #40 / #128 (checkout transaction, Strapi write-through, `changeOrderStatus` shared by the
  CMS and the unpaid-order job) are on `main`.
- No new packages or env vars. One migration (`0029_inventory_movements`) with a hand-written
  rollback. One Strapi component change (`catalog.variant` gets a stock reason field), so Strapi
  must be restarted after the deploy.

## Decisions & assumptions

- **Writers of tracked stock today** (all of them must write the ledger):
  1. `decrementVariantStock` at checkout (`services/orders.ts` → `db/queries/orders.ts`) → `sale`,
     source `checkout`, `order_id` set.
  2. `restockOrder` from `changeOrderStatus` (`services/order-lifecycle.ts`), used by Strapi
     edits (source `cms`) and `pnpm db:cancel-unpaid-orders` (source `job`) → `cancellation` for
     `cancelled`, `return` for `unclaimed`, `order_id` set. `returned` orders don't restock
     (`RESTOCK_STATUSES` in `~/lib/order-status.ts`: an opened perfume isn't resold), so they write
     nothing.
  3. `applyCmsProductChange` (`services/cms-sync.ts`) → `receipt` / `adjustment` for a stock edit
     of a size that is tracked before and after; `opening_balance` when a size starts being
     tracked (new tracked size, or `trackStock` switched on).
  4. `pnpm db:seed` inserts tracked sample sizes → `opening_balance` rows (source `job`) for the
     sizes it actually inserted (`returning()` after `onConflictDoNothing`), so the invariant
     holds in development databases too.
  `import-catalog` and `apply-catalog-prices` only insert untracked sizes and never change
  `track_stock` or tracked stock, so they write nothing.
- **Logging lives in the query functions** that change stock, not in their callers:
  `decrementVariantStock` and `restockOrder` use `update … returning stock_quantity` and then insert
  the movement with that `stock_after`, so no caller can change stock without a row. The variant
  rows are already locked `FOR UPDATE` in id order (checkout's `lockCartLinesForOrder`,
  `restockOrder`'s own select, the CMS's `lockVariantsByProductId`), so concurrent writers
  serialise per variant and `stock_after` is always consistent.
- **The invariant** `sum(quantity_delta) = stock_quantity` for every tracked variant. Untracked
  sizes write nothing. When tracking is switched on, the CMS writes an `opening_balance` with
  `delta = new stock − current ledger sum` (skipped when 0), so a size that was tracked, switched
  off and switched on again still adds up. Switching tracking off writes nothing.
- **Strapi stock reason**: `catalog.variant` gets `stockReason`, an enumeration shown only while
  `trackStock` is on, with Ukrainian values like the fragrance-family enum: `коригування`
  (default) and `надходження`. The middleware maps them to `adjustment` / `receipt` and sends
  `stockReason` per variant (`cmsVariantSchema` defaults a missing one to `adjustment`). When it
  saves the app's answer it resets the field to `коригування`, so the next edit doesn't inherit a
  stale "receipt". A `receipt` whose applied delta isn't positive is refused with a 422
  `receipt-not-positive` (Ukrainian message in `cms/src/utils/app-sync.ts`) (Q2, confirmed).
- **Clamping**: `editedStock` clamps at 0; the ledger records the delta actually applied
  (`stored − current`), never the typed one, so the sum stays exact. A zero delta writes no row.
- **Append-only at the database level**: a trigger `inventory_movements_append_only` raises on
  `DELETE` and on any `UPDATE` except the FK's `order_id → null`. `variant_id` is `on delete
  restrict` as the issue says (Q1, confirmed); `order_id` is `on delete set null`.
- **`occurred_at`** is the transaction's `now` the caller already uses (`createOrder`'s `now`,
  `changeOrderStatus`'s `now`); the CMS and the migration use `now()`.
- **`source`** reuses `ORDER_STATUS_SOURCES`' style: a new `INVENTORY_MOVEMENT_SOURCES` =
  `checkout | cms | job | migration` and `INVENTORY_MOVEMENT_REASONS` in `~/lib/enums`, enforced by
  CHECK constraints built with `oneOf` (like `order_status_history_source_check`).
- **`inventory_daily`** (plain view, recomputed on read; the data is small): days are calendar days
  in `Europe/Kyiv` (the shop's time zone, as in `services/offers.ts` and the translator). One row
  per variant that has movements, for every day from its first movement to today
  (`generate_series`). Columns: `variant_id`, `day` (`date`), `units_sold` (`-sum(delta)` of `sale`
  rows that day, gross; cancellations aren't netted out, they are their own reason),
  `closing_stock` (the last `stock_after` on or before the day, carried forward),
  `was_out_of_stock` (`true` when the previous day's closing stock was 0 or any `stock_after` that
  day was 0). Defined in Drizzle with `pgView(...).as(sql…)` so drizzle-kit generates it; if
  drizzle-kit 0.31 mangles the SQL, write it by hand in the migration and declare it with
  `.existing()`. Implemented: the view and the trigger are hand-written in migration 0029 and
  the view is declared with `.existing()`, so drizzle-kit never regenerates them.
- `stockReason` is optional in `cmsVariantSchema` (a missing one means `adjustment`) rather than
  defaulted, so existing callers and tests of `CmsVariantInput` don't all need the field. The
  CMS checks both refusals (receipt, removed size with history) before any write, instead of
  mapping the FK error: returning a refusal inside the transaction would otherwise commit
  earlier writes.
- `ON DELETE RESTRICT` raises `23001` (`restrict_violation`), not `23503`; the CMS maps that code.
- `quantity_delta <> 0` and `stock_after >= 0` are CHECKs; index on `(variant_id, occurred_at)`.
- These columns are ML features: add them to the "never drop or rename" list in `AGENTS.md`.

## Open questions

All three were answered on 2026-11-06: the user accepted the recommended defaults.


- [x] **Q1: What happens when staff remove a tracked size that has ledger rows?** — Why it
  matters: `variant_id … on delete restrict` (from the issue) makes `deleteVariants` in
  `applyCmsProductChange` fail with `23503`, so Strapi can no longer remove such a size, while
  `cascade` / `set null` would destroy or orphan the audit trail. Recommended default: keep
  `restrict` and turn the FK violation into a 422 `size-has-stock-history` with the Strapi message
  «Цей розмір уже має історію складу, його не можна видалити. Вимкніть «Track stock» або
  поставте залишок 0.» Sizes that never tracked stock have no rows and can still be removed.
  Affects steps: 2, 6, 7.
- [x] **Q2: A "receipt" (надходження) that doesn't increase stock** — Why it matters: data quality
  of restock dates and sizes vs. friction for staff. Recommended default: refuse with 422
  `receipt-not-positive` («Надходження має збільшити залишок.»). Alternative: record it as an
  `adjustment` silently. Affects steps: 6, 7.
- [x] **Q3: Should `inventory_daily` cover days on which a size wasn't tracked?** — Why it matters:
  while `track_stock` is off the size is always available, but the view would carry the last
  tracked stock forward (and may flag those days out of stock). Recommended default: only list
  days while the size has an unbroken tracked history, approximated by listing days up to today
  only for variants currently tracked, and document the limitation; a full fix needs
  `tracking_on` / `tracking_off` events, which the issue doesn't ask for. Affects steps: 3.

## Resolved questions

- **Which order changes put stock back, and which reason do they get?** — Only `cancelled` and
  `unclaimed` restock (`RESTOCK_STATUSES`, `app/lib/order-status.ts`); `returned` does not. So
  `cancelled` → `cancellation`, `unclaimed` (parcel came back unopened) → `return`.
- **Where do the CMS stock edits happen?** — `applyCmsProductChange` / `editedStock` in
  `app/.server/services/cms-sync.ts`, with `expectedStock` sent by `cms/src/sync/middleware.ts`;
  there is no separate `cms-*` stock service.
- **Are concurrent checkouts safe for the ledger?** — Yes: `createOrder` locks the cart's variant
  rows `FOR UPDATE` in id order before any write (`app/.server/AGENTS.md` → Orders), and
  `restockOrder` / the CMS update lock the same rows, so `stock_after` taken from
  `update … returning` can't interleave.
- **Which source does the unpaid-order job use?** — `changeOrderStatus` already receives
  `source: "job"` from `db/cancel-unpaid-orders.ts`; pass it through to `restockOrder`.
- **Do untracked sizes need rows?** — No (issue assumptions; #98: their stock is a stand-in).
- **Migration conventions** — `pnpm db:generate --name <name>`, hand-written
  `db/rollbacks/<tag>.sql`, explicit snake_case constraint names, row types mirrored in `~/lib/`
  and checked in `schema.test.ts` (`app/.server/AGENTS.md` → Database).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | `INVENTORY_MOVEMENT_REASONS`, `INVENTORY_MOVEMENT_SOURCES` and their types |
| modify | `app/lib/commerce.ts` | `InventoryMovement` row type (and `InventoryDay` for the view) |
| modify | `app/.server/db/schema.ts` | `inventoryMovements` table, `inventoryDaily` view |
| modify | `app/.server/db/schema.test.ts` | columns, FKs, constraints and type mirror of the new table |
| create | `app/.server/db/migrations/0029_inventory_movements.sql` (+ `meta/`) | table, checks, index, trigger, view, opening balances |
| create | `app/.server/db/rollbacks/0029_inventory_movements.sql` | drop view, trigger, function, table |
| create | `app/.server/db/queries/inventory.ts` | `insertInventoryMovement(s)`, `inventoryBalance`, `listInventoryMovements`, `listInventoryDaily` |
| create | `app/.server/db/queries/inventory.test.ts` | ledger, trigger, view and invariant tests (DB) |
| modify | `app/.server/db/queries/orders.ts` | `decrementVariantStock` / `restockOrder` write movements |
| modify | `app/.server/services/orders.ts` | pass `orderId` and `now` to `decrementVariantStock` |
| modify | `app/.server/services/order-lifecycle.ts` | pass reason, source and `now` to `restockOrder` |
| modify | `app/.server/services/cms-sync.ts` | log receipts / adjustments / opening balances; map FK error |
| modify | `app/lib/cms-sync.ts` | `stockReason` on `cmsVariantSchema` |
| modify | `app/routes/cms.products.ts` | 422 for the new refusals (if not already generic) |
| modify | `app/.server/db/seed.ts` | opening balances for inserted tracked sizes |
| modify | `cms/src/components/catalog/variant.json` | `stockReason` enumeration, visible with `trackStock` |
| modify | `cms/src/sync/middleware.ts` (+ test) | send `stockReason`, reset it on save |
| modify | `cms/src/utils/app-sync.ts` | Ukrainian messages for `receipt-not-positive`, `size-has-stock-history` |
| modify | tests: `services/orders.test.ts`, `services/cms-sync.test.ts`, `db/cancel-unpaid-orders.test.ts`, `db/seed.test.ts` | movements written by each path |
| modify | `AGENTS.md`, `app/.server/AGENTS.md`, `docs/setup.md` | document the ledger, the ML columns and the view |

## Steps

- [x] **1. Enums and types** — Add `INVENTORY_MOVEMENT_REASONS = ["opening_balance", "sale",
  "cancellation", "return", "receipt", "adjustment"]` and `INVENTORY_MOVEMENT_SOURCES =
  ["checkout", "cms", "job", "migration"]` (+ types) to `app/lib/enums.ts`; `InventoryMovement`
  (and `InventoryDay`) in `app/lib/commerce.ts`. `pnpm typecheck`.
- [x] **2. Schema and migration** — In `schema.ts` add `inventoryMovements`: `id` serial,
  `variantId` (FK `product_variants`, restrict), `occurredAt` timestamptz default now, `reason`,
  `quantityDelta` int, `stockAfter` int, `orderId` (FK `orders`, set null, nullable), `source`,
  `note` text nullable; checks `inventory_movements_reason_check`, `…_source_check`,
  `…_quantity_delta_check` (`<> 0`), `…_stock_after_check` (`>= 0`); index
  `inventory_movements_variant_id_occurred_at_idx`. Add the `inventoryDaily` view. Run
  `pnpm db:generate --name inventory_movements`, then append by hand: the append-only trigger
  function + trigger, and the backfill `insert into inventory_movements (variant_id, reason,
  quantity_delta, stock_after, source, note) select id, 'opening_balance', stock_quantity,
  stock_quantity, 'migration', 'Залишок на момент запуску журналу' from product_variants where
  track_stock and stock_quantity > 0`. Write the rollback. Extend `schema.test.ts`. Check with
  `pnpm db:migrate` and `pnpm db:rollback` on a dev database.
- [x] **3. View SQL** — Write `inventory_daily` (see Decisions): a `days` CTE with
  `generate_series(min(occurred_at at time zone 'Europe/Kyiv')::date, (now() at time zone
  'Europe/Kyiv')::date, '1 day')` per variant, a per-day aggregate (`units_sold`, `min(stock_after)`,
  last `stock_after` by `occurred_at, id`), and a carry-forward of the closing stock (`last
  value` over a running group, or a lateral `order by occurred_at desc limit 1`). Apply the Q3
  default.
- [x] **4. Ledger queries** — `app/.server/db/queries/inventory.ts`: `insertInventoryMovements(tx,
  rows)` (the only writer), `inventoryBalance(tx, variantId)` (`coalesce(sum(quantity_delta), 0)`),
  `listInventoryMovements(db, variantId)` and `listInventoryDaily(db, variantId, from, to)` for
  tests and future exports. Module comment states the append-only rule.
- [x] **5. Checkout and order lifecycle** — `decrementVariantStock(tx, { variantId, quantity,
  orderId, now })`: `update … where track_stock returning stock_quantity`, then a `sale` row
  (`-quantity`, `stock_after`) when a row came back. `restockOrder(tx, orderId, { reason, source,
  now })`: `.returning()` on each update and one row per line. `changeOrderStatus` passes `reason =
  patch.status === "unclaimed" ? "return" : "cancellation"` and its `source` (`cms` / `job`;
  `ORDER_STATUS_SOURCES` → `INVENTORY_MOVEMENT_SOURCES`, only those two can restock). Update
  `services/orders.test.ts` and `cancel-unpaid-orders.test.ts` to assert the rows.
- [x] **6. CMS product edits** — `cmsVariantSchema.stockReason: z.enum(["adjustment",
  "receipt"]).default("adjustment")`. In `applyCmsProductChange`, collect movements while applying
  sizes: tracked → tracked with `stored ≠ current` → `adjustment` / `receipt` with `stored −
  current` (refuse a non-positive receipt, Q2: return before any write, so check all sizes first);
  untracked → tracked, or a new tracked size (create or added) → `opening_balance` with `stored −
  inventoryBalance` (new sizes: `stored`) after the insert gives them an id; insert them all with
  `source: "cms"`. Map a `23503` from `deleteVariants` on `inventory_movements_variant_id_…_fk` to
  `size-has-stock-history` (Q1). Extend `CmsProductResult` and `cms-sync.test.ts`.
- [x] **7. Strapi** — `variant.json`: `stockReason` enumeration (`коригування`, `надходження`,
  default `коригування`, visible when `trackStock`), described in the component. `middleware.ts`:
  send `stockReason` mapped to English, write `коригування` back when saving the app's answer.
  `app-sync.ts`: messages for the new errors. Update `middleware.test.ts`.
- [x] **8. Seed** — In `db/seed.ts` take `returning({ id, stockQuantity })` from the variant insert
  and write `opening_balance` rows (`source: "job"`) for inserted sizes with stock > 0, in the same
  transaction (wrap the seed's writes in one if they aren't). Extend `seed.test.ts`.
- [x] **9. Invariant and view tests** (`inventory.test.ts`, on `createTestDatabase`):
  - after the migration backfill, a checkout, a cancel, an unclaimed return, a Strapi adjustment
    and a receipt, `sum(quantity_delta) = stock_quantity` for every tracked variant (one SQL
    query over all variants);
  - concurrent checkouts (`Promise.all` of several `createOrder` on a variant with little stock):
    sales never exceed stock, the invariant holds and `stock_after` values are distinct and
    consecutive;
  - selling the last unit gives that day `was_out_of_stock = true`, `closing_stock = 0` and the
    right `units_sold`; the next day without movements carries `closing_stock` forward; a restock
    day after it shows the new stock;
  - the trigger refuses `update` and `delete`, and deleting an order nulls `order_id`.
- [x] **10. Docs** — `app/.server/AGENTS.md` (Database: an "Inventory ledger (#130)" bullet with
  writers, invariant, append-only trigger, view; Orders / CMS sync bullets mention the rows),
  `AGENTS.md` ML list (`inventory_movements`, `inventory_daily`), `docs/setup.md` (Strapi restart
  for the new field; the unpaid-order job also logs returns of stock).

## Testing & verification

- Unit / integration tests from steps 2, 5–9 (`pnpm test`; DB tests skip without a database).
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`): turn on Track stock for a size in Strapi with stock 3 (one
  `opening_balance`), place an order for 1 (`sale`, stock_after 2), cancel it in Strapi (with a
  reason; `cancellation`, 3), add 5 as "надходження" (`receipt`, 8) and check the field resets,
  correct to 6 (`adjustment`, −2); `select * from inventory_daily where variant_id = …`.
- Run `pnpm db:rollback` and `pnpm db:migrate` once to check the rollback.
- Done: typecheck, lint, test (2072 passed, including the DB tests) and build pass. Migrate and
  rollback are covered by `migrator.test.ts` on a throwaway database; the manual Strapi run and a
  migration of the development database were not done (the dev database is shared with the main
  checkout, which doesn't have migration 0029).

## Acceptance criteria

- [x] Every change to a tracked variant's stock (checkout, cancellation, return, Strapi edit)
  writes one `inventory_movements` row in the same transaction — steps 4, 5, 6, 7 (tests in 5, 6, 9)
- [x] For every tracked variant, `sum(quantity_delta)` = `stock_quantity` — steps 2, 5, 6, 8, 9
- [x] `inventory_daily` gives units sold, closing stock and an out-of-stock flag per variant per
  day — steps 2, 3, 9
- [x] Existing stock is recorded as `opening_balance` by the migration — step 2 (test in 9)
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — all steps

## Out of scope

- Supplier orders, purchase prices, lead times entered by staff.
- The forecasting model and any export of the dataset.
- Showing the ledger in Strapi or the storefront.
- Logging untracked sizes or `track_stock` switching off.
- Stock reservation for carts.
