# Plan: Make every perfume orderable in all five sizes at the standard prices (#98)

Issue: https://github.com/savchukolgaa/jassmin/issues/98
Branch: `issue/98`
Worktree: `.claude/worktrees/issue-98`
Status: Planned

## Goal
Customers should be able to order every active perfume in 5, 10, 30, 50 and 100 ml at the shop's
standard prices (119 / 240 / 459 / 629 / 969 ₴) and never see "out of stock". The shop pours from
large bottles, so availability becomes unlimited. Each size gets a `track_stock` flag that defaults
to off. Untracked sizes are always in stock and are never checked or decremented at checkout.
Tracked sizes keep today's behaviour. A one-off, idempotent script then gives every active product
all five sizes at the price table and queues the products for Strapi.

## Dependencies & prerequisites
- #66 (owner's catalog, `CATALOG_PRICES`, `pnpm db:import-catalog`, `db-import-catalog` in Aspire): merged.
- #40 (CMS sync, `cms_outbox`, `applyCmsProductChange`, Strapi middleware): merged.
- #26 (product variants), #11 (checkout), #10 (cart merge): merged.
- New migration `0019_variant_track_stock` with its rollback.
- No new env vars or packages.

## Decisions & assumptions
- **Shape of "unlimited":** a per-variant column `product_variants.track_stock boolean not null default false`.
  The default is `false`, so the migration makes every existing size untracked, which is the owner's
  request. `stock_quantity` and its CHECK stay, so tracking can be switched back on per size (for
  example for a limited edition). No ML-feature column is touched.
- **One SQL hinge instead of scattered `if`s.** In `db/queries/products.ts`:
  - `variantStock` = `case when track_stock then stock_quantity else ${UNTRACKED_STOCK} end` (no
    `products` join needed).
  - `availableStock` = `case when products.active then ${variantStock} else 0 end`, the existing
    export, redefined on top of `variantStock`.
  - `UNTRACKED_STOCK = MAX_LINE_QUANTITY` (99, `~/lib/cart`). A line can never exceed 99, so
    "stock 99" can't be told apart from unlimited. The cart (`addItem`, `updateQuantity`,
    `mergeGuestCart`), the checkout stock check and the cart UI (`maxQuantity`, `stockNotice`) all
    keep working without new branches.
  - Archived products still read 0 (acceptance: "Archived products stay unavailable").
- **Writes stay explicit.** `decrementVariantStock` and `restockOrder` only touch rows where
  `track_stock` is true, using a `where` on the column, so neither checkout nor a cancellation
  moves an untracked size's number. `createOrder` and `applyCmsOrderChange` only queue the products
  whose stock actually changed (tracked lines) for Strapi. The order itself is still queued.
- **DTOs:** `ProductVariant` (`~/lib/products`) gains `trackStock: boolean`, and `stockQuantity`
  becomes the effective stock (99 for untracked). The product page passes `stockQuantity` to
  `StockStatus` only for tracked sizes, so "Only N left" is never computed from the stand-in number.
  `CardVariant.inStock` comes from `variantStock > 0`, so the card picker needs no code change.
  `CartLine` stays as it is.
- **`~/lib/commerce` `ProductVariant` row mirror** gains `trackStock` (`schema.test.ts` checks it).
- **Data script:** `pnpm db:apply-catalog-prices`
  (`db/apply-catalog-prices.ts` → `applyCatalogPrices(db, prices)`, CLI in
  `db/scripts/apply-catalog-prices.ts`, Aspire resource `db-apply-catalog-prices`). It runs in one
  transaction. First it **archives every active set** (`pack_size > 1`, e.g. the sample
  "Набір тестерів 3 × 10 мл") with `active = false`, and queues it for Strapi. At the standard
  prices a set would sell 3 bottles for the price of one and undercut the tester trio, so the trio
  discount stays the only way to buy 3 testers cheaper (owner's decision). Then, for every active
  product (all of them are now single perfumes):
  1. inserts missing sizes from `CATALOG_PRICES` (`onConflictDoNothing` on `(product_id, volume_ml)`,
     `trackStock: false`, `stockQuantity: 0`);
  2. updates sizes whose price differs from the table (`where price <> table price`, so a second
     run matches nothing);
  3. deletes sizes not in the table, through the existing `deleteVariants` (cart lines cascade,
     order lines keep their `volume_ml` snapshot). The `product_variants_volume_ml_check` already
     limits sizes to the five, so today this is only a guard;
  4. sets the deprecated `products.price` / `volume_ml` / `stock_quantity` from the smallest size,
     like `productWrite`, but only where they differ, so `updated_at` (sitemap `lastmod`) doesn't
     move on a no-op run;
  5. calls `enqueueCmsSync(tx, "product", changedIds)` only for products where steps 1–4 changed
     something.

  It returns `{ setsArchived, productsChanged, variantsInserted, pricesUpdated, variantsDeleted, queued }`.
  A second run returns all zeros (acceptance). The script does **not** change `track_stock`: the
  migration already defaulted every size to untracked, and a staff "track" choice made later must
  survive a re-run.
- The script is a one-off fix, not a sync: re-running it resets prices that staff changed in Strapi
  since. This is said in the script header and in the AGENTS note. `importCatalog` stays the path
  for new products and never touches existing ones.
- **`importCatalog`** writes `trackStock: false` explicitly on the sizes it inserts, and its comments
  and log message no longer say "stock 0" as if it meant sold out.
- **Strapi:** the `catalog.variant` component gets `trackStock` (boolean, default `false`, labelled
  through the component's description/hint). `stock` gets a Strapi 5 `conditions.visible`
  rule (`{"==": [{"var": "trackStock"}, true]}`) so it's hidden for untracked sizes. If conditions
  aren't supported inside a component in Strapi 5.59, fall back to keeping `stock` visible with a
  description "Used only when Track stock is on" **(unconfirmed, check while implementing)**.
  Then regenerate `cms/types/generated` (`pnpm --filter jassmin-cms strapi ts:generate-types`).
- **CMS sync:** `cmsVariantSchema` gains `trackStock: z.boolean().default(false)`. The middleware
  sends it, and `applyProductAnswer` writes the stored value back. `applyCmsProductChange`:
  - tracked size: stock as today (`stock - expectedStock` delta, clamped at 0);
  - untracked size: `stock_quantity` is stored as typed (no sales move it, so there's no delta to
    protect);
  - switching a size's flag stores the typed stock as-is.

  `findProductSyncState` and `CmsProductState.variants` carry `trackStock`, and
  `toStrapiProductData` pushes it.
- Analytics events are unchanged.
- **Deviation (step 2): `pnpm db:seed` inserts the sample sizes with `track_stock = true`.** The
  dev-only sample catalog is the fixture for sold-out and low-stock sizes in many existing tests
  (catalog, cart, checkout, CMS sync). If they were untracked, those tests would no longer cover
  the tracked path. The shop's real range (`db:import-catalog`, the data script) stays untracked,
  and sample rows seeded before migration 0019 keep the migration's `false`, because the seed never
  updates an existing size.
- `variantColumns.stockQuantity` is `variantStock` (99 for untracked sizes), so the detail DTO and
  `checkVariantForCart` need no branch. `trackStock` comes alongside it.
- **Tester trio stays cheaper than buying normally.** Today the trio is an automatic
  `fixed_price_set` rule (`slug = 'tester-trio'`): any three single 10 ml sizes for 499 ₴, up to 3
  trios per order, for every shopper. It exists only where `pnpm db:seed` created it
  (`SAMPLE_DISCOUNTS`), because no migration creates it, so production may not have it. At the new
  prices 3 × 240 = 720 ₴, so 499 ₴ saves 221 ₴. The price stays at 499 ₴ for now (owner).
  - New data migration `0020_tester_trio_rule` inserts the rule exactly as the seed defines it,
    with `ON CONFLICT (slug) DO NOTHING`, so an existing rule (and its redemption count) is kept.
    Its rollback deletes the rule only when no order references it (`orders.discount_id`
    restricts deletes).
  - A guard test (integration, migrated test DB) checks that the trio's `value` is below
    `minQuantity × CATALOG_PRICES[10]`. If a future price change made the trio dearer than three
    single testers, `priceCart` would silently give no saving (it ignores savings ≤ 0) while the
    home page badge still advertised it.
  - How to change the trio price from now on, documented in `app/.server/AGENTS.md` → Discounts:
    (1) a new migration `UPDATE discounts SET value = '<price>' WHERE slug = 'tester-trio'`; the
    home page badge and "How it works" follow automatically (`getTesterTrioOffer`). (2) Staff edit
    the Strapi texts that state the price by hand: the home page hero headline and subtitle (uk/en)
    and the tester-trio offer's `priceNote`, summary and body.

## Follow-up (separate issue, not in #98)
- **Tester trio for new customers only** (owner's request). Today every shopper gets it
  automatically. Limiting it to a customer's first order needs a new eligibility rule in
  `services/pricing.ts` / `priceCart` (e.g. a `first_order_only` column on `discounts`), a
  definition of "new" for guests (no earlier order with that email) and for accounts (no earlier
  order on the user), a re-check inside the checkout transaction (the email is only known there),
  and new copy on the home page, cart and checkout ("for your first order"). Create it with
  `/create-issue` after #98.

## Resolved questions
- **Q1: Do the standard sizes and prices apply to every product?** — Yes, to every active product (owner). Sets (`pack_size > 1`) are archived instead of repriced, so the trio isn't undercut (owner).
- **Q2: Hide or explain the Strapi stock field for untracked sizes?** — Hide it with `conditions.visible` if Strapi 5.59 supports that inside a component, otherwise show a hint (owner accepted the default).
- **Trio price?** — Stays 499 ₴ for now. It's changed later with a migration plus the Strapi texts (owner).
- **Where does stock gate availability today?** — `availableStock` and `variantStats.inStock` (`app/.server/db/queries/products.ts`), `toVariant` / `checkVariantForCart` (`services/products.ts`), `addItem` / `updateQuantity` / `mergeGuestCart` (`services/cart.ts`), the `createOrder` short-line check plus `decrementVariantStock` (`services/orders.ts`, `db/queries/orders.ts`), `restockOrder` on cancel (`db/queries/orders.ts`), and `routes/checkout.tsx:44`. All but the two writes read through `availableStock` / `variantColumns`, hence the single hinge.
- **Can 7 ml sizes still exist?** — No. Migration 0015 deleted them, and `product_variants_volume_ml_check` allows only 5/10/30/50/100 (`app/.server/db/migrations/0015_volume_5ml.sql`). The script's delete step is a guard.
- **Do cart lines snapshot prices?** — No. Cart lines read the live variant price, and only `order_items.price_at_purchase` is a snapshot (`app/.server/AGENTS.md` → Orders). A cart open during the price change shows the new price, and checkout's `expectedTotal` check (`total-changed`) protects a shopper who submits an older total.
- **How are size removals propagated to Strapi?** — Queue the product in `cms_outbox`. The push replaces the variants list (`toStrapiProductData`, `cms-push.ts`), as migration 0015 did for 7 ml.
- **How do Aspire one-off DB jobs look?** — `db-import-catalog` in `aspire-apphost/apphost.mts:49` (`addJavaScriptApp` + `withPnpm({ install: false })`, `withReference(db)`, `waitForCompletion(dbMigrate)`, `withParentRelationship(db)`, `withExplicitStart()`).
- **Is the 99 cap safe as "unlimited"?** — Yes. `MAX_LINE_QUANTITY = 99` (`app/lib/cart.ts:9`) bounds every line through `cart.schema.ts`, and `mergeGuestCart` caps at `least(..., stock)`, which is ≥ any valid line.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/db/schema.ts` | `productVariants.trackStock` boolean, not null, default false |
| create | `app/.server/db/migrations/0019_variant_track_stock.sql` (+ `meta/`) | generated by `pnpm db:generate --name variant_track_stock` |
| create | `app/.server/db/rollbacks/0019_variant_track_stock.sql` | `ALTER TABLE product_variants DROP COLUMN track_stock;` |
| create | `app/.server/db/migrations/0020_tester_trio_rule.sql` (+ `meta/`) | custom migration (`pnpm db:generate --custom --name tester_trio_rule`) inserting the tester-trio rule if missing |
| create | `app/.server/db/rollbacks/0020_tester_trio_rule.sql` | delete the rule unless an order references it |
| create | `app/.server/db/tester-trio.test.ts` | the migrated rule matches `SAMPLE_DISCOUNTS` and stays below 3 × the 10 ml price |
| modify | `app/.server/db/seed-data.ts` | the sample 3 × 10 ml set is seeded `active: false`, and the trio comment explains the migration |
| modify | `app/lib/commerce.ts` | `ProductVariant.trackStock` row mirror |
| modify | `app/lib/products.ts` | `ProductVariant.trackStock`, doc comments |
| modify | `app/.server/db/queries/products.ts` | `UNTRACKED_STOCK`, `variantStock`, `availableStock`, `variantStats`, `variantColumns`, sync-state query, `insertVariants` / `updateVariant` / `lockVariantsByProductId` with `trackStock` |
| modify | `app/.server/services/products.ts` | `toVariant` (`inStock`, `trackStock`), archived override |
| modify | `app/.server/db/queries/orders.ts` | `lockCartLinesForOrder` returns `trackStock`; `decrementVariantStock` / `restockOrder` only on tracked rows, `restockOrder` returns only tracked products |
| modify | `app/.server/services/orders.ts` | decrement and queue only tracked lines' products |
| modify | `app/.server/services/cart.ts` | comments only (logic unchanged through `availableStock`) |
| modify | `app/lib/cms-sync.ts` | `cmsVariantSchema.trackStock`, `CmsProductState.variants[].trackStock` |
| modify | `app/.server/services/cms-sync.ts` | per-size stock rule for tracked vs untracked |
| modify | `app/.server/services/cms-push.ts` | push `trackStock` (via `toStrapiProductData`) |
| modify | `cms/src/components/catalog/variant.json` | `trackStock` attribute, `stock` visibility/description |
| modify | `cms/src/sync/middleware.ts` | send and write back `trackStock` |
| modify | `cms/types/generated/components.d.ts` | regenerated |
| modify | `app/.server/db/import-catalog.ts`, `db/scripts/import-catalog.ts` | explicit `trackStock: false`, wording |
| create | `app/.server/db/apply-catalog-prices.ts` | `applyCatalogPrices(db, prices)` |
| create | `app/.server/db/apply-catalog-prices.test.ts` | integration tests |
| create | `app/.server/db/scripts/apply-catalog-prices.ts` | CLI |
| modify | `package.json` | `db:apply-catalog-prices` script |
| modify | `aspire-apphost/apphost.mts`, `aspire-apphost/AGENTS.md` | `db-apply-catalog-prices` resource |
| modify | `app/features/product/ProductPurchase.tsx` | `stockQuantity` only for tracked sizes |
| modify | `app/features/catalog/StockStatus.tsx`, `CardVolumePicker.tsx` | doc comments only, plus tests |
| modify | `app/.server/AGENTS.md`, `README.md` | document `track_stock`, the script, and the Strapi field |
| modify | existing tests (`queries/products.test.ts`, cart/orders/cms-sync tests, seed tests) | fixtures that rely on stock 0 meaning sold out set `trackStock: true` |

## Steps
- [x] **1. Schema + migration.** Add `trackStock: boolean().notNull().default(false)` to `productVariants` with a doc comment ("`false`: always available, stock not counted, #98"). Run `pnpm db:generate --name variant_track_stock`, review the SQL (one `ADD COLUMN ... DEFAULT false NOT NULL`), and write the rollback. Add `trackStock` to `~/lib/commerce` `ProductVariant`. Check: `pnpm typecheck`, `schema.test.ts`, `migrator.test.ts` (rollback round-trip).
- [x] **2. Read-side hinge.** In `queries/products.ts`, add `UNTRACKED_STOCK` and `variantStock`, rebuild `availableStock` on them, use `${variantStock} > 0` in `variantStats.inStock`, and in `variantColumns` select `stockQuantity: variantStock` plus `trackStock`. In `services/products.ts` `toVariant`, set `trackStock` and `inStock: row.stockQuantity > 0`. The archived override stays. Add `trackStock` to `ProductVariant` in `~/lib/products`. Tests (`queries/products.test.ts`, `services/products.test.ts`): an untracked size at stock 0 is `inStock`, a tracked one at 0 isn't, an archived product's sizes aren't, and `checkVariantForCart` accepts an untracked stock-0 size.
- [ ] **3. Cart.** No logic change: `findVariantForProduct` and the cart queries already use the hinge. Update comments in `services/cart.ts`. Tests: add to cart, update to 99 and guest merge with an untracked stock-0 size all succeed, and a tracked size still answers `exceeds-stock` / is dropped on merge.
- [ ] **4. Checkout and restock.** `lockCartLinesForOrder` also selects `trackStock`. In `createOrder`, call `decrementVariantStock` only for tracked lines and queue only those lines' products, plus the order. Add `eq(productVariants.trackStock, true)` to the decrement `where` as a backstop. `restockOrder` filters on `trackStock` and returns only tracked products. Tests (`services/orders.test.ts`, `cms-sync.test.ts`): ordering an untracked stock-0 size succeeds and leaves `stock_quantity` at 0, a tracked size still decrements and still answers `insufficient-stock`, an archived product's line still answers `insufficient-stock`, and cancelling an order with untracked lines doesn't change their stock.
- [ ] **5. Data script.** Add `applyCatalogPrices` (see Decisions) with `CATALOG_PRICES`, the CLI with the same `.env` / `getDatabaseUrl` / `createDb(url, 1)` pattern as `import-catalog.ts` (log counts and "run `pnpm db:sync-cms`" when anything was queued), `package.json` script `db:apply-catalog-prices`, and the Aspire resource `db-apply-catalog-prices` (copy of `db-import-catalog`), documented in `aspire-apphost/AGENTS.md`. Tests on `createTestDatabase()`: active sets archived and queued, missing sizes added untracked, wrong prices fixed, deprecated product columns follow 5 ml, archived products untouched, changed products queued (and only those), the second run returns zeros with the same `cms_outbox.version` and `products.updated_at`, and order lines keep `price_at_purchase`. Check with `pnpm aspire:build`.
- [ ] **5a. Tester trio rule.** Run `pnpm db:generate --custom --name tester_trio_rule` and write the `INSERT INTO discounts (slug, kind, value, scope_volumes_ml, scope_pack_size, min_quantity, max_sets) VALUES ('tester-trio', 'fixed_price_set', '499.00', '{10}', 1, 3, 3) ON CONFLICT (slug) DO NOTHING`, plus the rollback `DELETE FROM discounts WHERE slug = 'tester-trio' AND NOT EXISTS (SELECT 1 FROM orders WHERE discount_id = discounts.id)`. Add `tester-trio.test.ts`: on a migrated test DB the rule matches the `SAMPLE_DISCOUNTS` entry, `toTrioOffer` returns it, and `value < minQuantity × CATALOG_PRICES[10]`. Then `priceCart` gives 3 × 10 ml at the new prices a 221 ₴ saving. Check that `seed.test.ts` still passes, since the seed's `onConflictDoNothing` on slug now skips the trio.
- [ ] **6. `importCatalog`.** Set `trackStock: false` on inserted sizes and update its doc comment and CLI message. Extend `import-catalog.test.ts`: imported sizes are untracked and `inStock`.
- [ ] **7. Strapi field + sync.** Add `trackStock` to `variant.json` (boolean, default false; component description explains it) and the `stock` visibility condition or hint (Q2). Regenerate `cms/types/generated`. In `~/lib/cms-sync`, add `trackStock` to `cmsVariantSchema` and `CmsProductState`. The middleware's `productPayload` sends `trackStock` and `applyProductAnswer` writes it back. In `applyCmsProductChange`, `create`/new sizes store `trackStock` and typed stock, and existing sizes use the delta only when tracked after the edit (otherwise the typed stock). `insertVariants` / `updateVariant` accept `trackStock`. `findProductSyncState` selects it, and `toStrapiProductData` passes it. Tests (`cms-sync.test.ts`, `lib/cms-sync.test.ts`, `cms-push.test.ts`): a missing `trackStock` defaults to false, the delta applies only to tracked sizes, and the answer and the push carry `trackStock`.
- [ ] **8. UI.** `ProductPurchase` passes `stockQuantity={selected.trackStock ? selected.stockQuantity : undefined}`. Tests: `StockStatus` shows "В наявності" for an untracked size, `ProductPurchase` never shows "Залишилося лише" for an untracked size, and `CardVolumePicker` leaves untracked stock-0 sizes enabled (no strike-through). No i18n changes are needed.
- [ ] **9. Fixtures and seed.** Fix existing tests that build "sold out" sizes so they set `trackStock: true`. Seed data keeps the default (untracked). The sample 3 × 10 ml set gets `active: false` in `seed-data.ts`, so a fresh dev database matches what the script does. Run the whole suite.
- [ ] **10. Docs.** `app/.server/AGENTS.md`: product variants (`track_stock`, `variantStock` / `availableStock`, `UNTRACKED_STOCK`), the Cart and Orders sections (stock rules apply to tracked sizes), CMS sync (`trackStock`, delta rule), the #66 import note (sizes are untracked), a new bullet for `pnpm db:apply-catalog-prices` (archives sets, re-running resets staff prices), and Discounts: migration 0020 creates the tester trio, plus how to change its price (migration + Strapi hero/offer texts) and the guard test. `README.md`: script table and Strapi field.
- [ ] **11. Verify.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm aspire:build`. Then the manual run (below).

## Testing & verification
- Automated: the tests listed in steps 2–8 (unit plus DB integration with `describe.skipIf(!hasDatabase)` / `createTestDatabase()`).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm aspire:build`.
- Manual (Aspire):
  1. Run `pnpm aspire run`. `db-migrate` applies 0019.
  2. Start `db-apply-catalog-prices`; it logs counts. Start it again; it logs zeros.
  3. Start `db-sync-cms`. In Strapi, a product shows 5 sizes at 119–969 with "Track stock" off.
  4. On the site, the catalog cards show no struck-through sizes. The product page shows "В наявності" for every size.
  5. Add 100 ml to the cart and check out with COD. The order is placed and the variant's `stock_quantity` is unchanged.
  6. Archive a product in Strapi. It disappears from the shop, and its cart line answers out of stock at checkout.
  7. Turn "Track stock" on for one size with stock 1 and buy 2. Checkout refuses. Buy 1: stock goes to 0 and the size shows sold out.
  8. Add three different perfumes in 10 ml. The cart shows the subtotal 720 ₴, the "Тестерне тріо 3 × 10 мл" discount of 221 ₴ and a total of 499 ₴. The sample 3 × 10 ml set is no longer listed.

## Acceptance criteria
- [ ] Every active product offers 5, 10, 30, 50 and 100 ml at 119, 240, 459, 629 and 969 ₴, on the site and in Strapi — steps 5, 6, 7 (sets are archived, so every active product is a single perfume)
- [ ] (Added by the owner) Three 10 ml testers through the trio still cost less than buying them normally — step 5a
- [ ] Every size of every active product can be added to the cart and ordered. Nothing shows as "out of stock" — steps 1–4, 8
- [ ] Checkout no longer decrements stock for untracked sizes, and tracked sizes (if any) keep today's behaviour — step 4
- [ ] Archived products stay unavailable — steps 2, 4 (`availableStock` keeps 0 for inactive)
- [ ] Running the data script twice changes nothing the second time — step 5
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 11

## Out of scope
- Product pictures and descriptions (separate issues).
- Removing the stock columns or the deprecated `products.price` / `volume_ml` / `stock_quantity`.
- Per-size stock reservation, low-stock alerts or a "limited edition" UI.
- Changing analytics events.
- Changing the trio price (stays 499 ₴), and the "new customers only" trio (follow-up issue, see above).
- Editing discount rules in Strapi.
