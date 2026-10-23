# Plan: Add perfume volume selection (7/10/30/50/100 ml) with dropdown on product page (#26)

Issue: https://github.com/savchukolgaa/jassmin/issues/26
Branch: `issue/26`
Worktree: `.claude/worktrees/issue-26`
Status: Planned (questions answered)

## Goal

As a customer I want to choose the volume of a perfume (7, 10, 30, 50 or 100 ml) from a dropdown
on the product page, so I can buy anything from a sample to a full bottle. Each product gets
volume **variants** (a new `product_variants` table) with their own price and stock. The product
page shows a volume `<select>` that drives the shown price and stock and is submitted as
`variantId`, catalog cards show "from <lowest price>", and cart/order lines can reference the
chosen variant.

## Dependencies & prerequisites

- **#3 core schema, #4 commerce schema, #8 catalog/product routes**: merged on `origin/main`
  (`products`, `cart_items`, `order_items`, `app/routes/product.tsx`, `ProductCard`,
  `AddToCartForm`, the cart `action` stub).
- **#10 cart (open)**: the cart `action` in `app/routes/cart.tsx` is a stub that validates and
  stores nothing (`cart-unavailable`). This issue adds the `variant_id` columns and the variant
  validation; actually inserting the cart line and rendering it on `/cart` is #10's job (see Q1).
- **#11 checkout (open)**: will decrement `product_variants.stock_quantity` (not
  `products.stock_quantity`) inside its transaction and copy the variant price into
  `order_items.price_at_purchase`. This plan only prepares the columns and documents the rule.
- **#16 admin products (open)**: variant editing UI later; seed data is enough here.
- **Parallel migrations (#5, #14)**: #5, #26 and #14 are being planned in parallel and each adds
  a Drizzle migration as the next index (`0002_…`). **If either of them lands on `main` first,
  rebase `issue/26` onto `origin/main` and regenerate this migration**: delete this branch's
  `0002_*.sql`, its `meta/0002_snapshot.json` and its `_journal.json` entry, run
  `pnpm db:generate --name product_variants` again (it becomes `0003_…`), re-append the
  hand-written backfill SQL from step 3 and rename `db/rollbacks/0002_product_variants.sql` to
  match the new tag. Never hand-merge `_journal.json` / snapshots.
- No new packages or env vars. Needs PostgreSQL 18+ (`uuidv7()`), already required.

## Decisions & assumptions

- **Allowed volumes** are `PERFUME_VOLUMES_ML = [7, 10, 30, 50, 100] as const` in
  `app/lib/enums.ts` with `type PerfumeVolumeMl`. The DB check is built from that array, the same
  way `orders_payment_method_check` is built from `PAYMENT_METHODS`, so they can't drift.
- **`product_variants` columns**: `id` serial PK, `publicId` uuid `default uuidv7()` unique
  (`product_variants_public_id_unique`), `productId` FK → `products.id` on delete cascade,
  `volumeMl` integer not null, `price` numeric(10,2) not null, `stockQuantity` integer not null
  default 0, `createdAt`. Constraints: `product_variants_product_id_volume_ml_unique`,
  `product_variants_volume_ml_check`, `product_variants_stock_quantity_check` (`>= 0`),
  `product_variants_price_check` (`>= 0`), index `product_variants_product_id_idx`.
  - `publicId` isn't in the issue's column list. It's added because `app/lib/products.ts` says
    serial ids never leave the server, and products already use `public_id` for that. The form
    field is still `name="variantId"`, but its value is the variant's `public_id` (validated with
    `z.uuid()`).
- **`volume_ml` on a variant is the per-unit volume.** `products.pack_size` stays on the product,
  so the 3 × 10 ml tester set is one product with one 10 ml variant, shown as `3 × 10 ml` by the
  existing `formatVolume`.
- **Legacy `products.price`, `products.volume_ml`, `products.stock_quantity`**: kept as they are
  (NOT NULL, unchanged), marked `@deprecated` in `schema.ts` and the `.server` AGENTS.md. App
  code stops reading them. The seed still fills them (with the product's "main" size), and dropping
  them is a follow-up after #16 (confirmed, Q2). ML feature columns (`fragrance_family`,
  `users.*`) are untouched.
- **Backfill**: one variant per existing product from its `volume_ml`, `price`, `stock_quantity`
  where `volume_ml` is allowed. A product with another volume gets no variant. Its legacy values
  stay in `products`, so nothing is lost, but it's hidden from the catalog until it gets a variant.
  All current seed products (50/100/10 ml) are allowed.
- **`cart_items`**: add `variantId` integer NOT NULL FK → `product_variants.id` on delete
  cascade. Replace unique `(cart_id, product_id)` with
  `cart_items_cart_id_variant_id_unique` `(cart_id, variant_id)`, so 10 ml and 50 ml of the same
  perfume are separate lines. Keep `product_id` so product-level analytics and the abandoned-cart
  job (#19) don't need the join. The cart service (#10) must write a `product_id` that matches the
  variant.
- **`order_items`**: add `variantId` integer nullable FK on delete **set null** (like
  `product_id`, so revenue history survives deletes) and a `volumeMl` integer snapshot, nullable
  for rows before this migration, so the bought size stays known after a variant is deleted
  (confirmed, Q3). `price_at_purchase` = variant price (#11).
- **Catalog**: summaries come from an inner join with a per-product aggregate over
  `product_variants` (`min(price)`, `max(stock_quantity) > 0`, `array_agg(volume_ml order by
  volume_ml)`, `count(*)`), so products without variants aren't listed. `price_asc`/`price_desc`
  sort by the min variant price, and `countProducts` uses the same join so totals match.
- **Card price label**: `from 1 450 ₴` when the product has more than one variant price, else
  just the price. Formatting uses `formatPrice` (`uk-UA`, so `1 450 ₴`, not `₴1 450`) to match the
  rest of the site. The volume line lists the sizes, e.g. `10 · 30 · 50 ml`.
- **Card add-to-cart** (confirmed, Q4): every card posts its default variant (the same
  `defaultVariant` rule as the product page: smallest in-stock size). Because a card can't show a
  size picker, the button names the size it adds, e.g. "Add 10 ml", so a shopper never gets a
  sample by surprise. Multi-variant cards also show a "Choose volume" `ButtonLink` to the product
  page next to it (two buttons side by side, same size, wrapping on narrow cards).
  Single-variant cards show only the add button. This stays in #26 and doesn't need its own
  issue, because #26 changes the add-to-cart contract from `productId` to `variantId`, so the
  card has to change here anyway.
- **Default selection**: the smallest in-stock variant. If none is in stock, the smallest variant,
  and the button shows "Out of stock" (disabled). A product with no variants renders with a
  disabled "Currently unavailable" state and no select. Pure helper `defaultVariant()` in
  `app/lib/products.ts`.
- **Out-of-stock options** stay in the list but are `disabled`, labelled `10 ml — 900 ₴ (out of
  stock)`.
- **Client behaviour**: a `ProductPurchase` component holds the selected variant in `useState`
  (initialised from `defaultVariant`) and renders the price, `StockStatus`, `VolumeSelect` and the
  submit button. Without JS the select is a normal field inside the `fetcher.Form`, so a plain POST
  sends the chosen `variantId`. Only the shown price/stock stay at the default until JS loads.
- **Cart action validation**: `addToCartSchema` gets `variantId: z.uuid()`. After zod, the action
  calls `checkVariantForCart(productId, variantId)` in `services/products.ts`. It returns
  `{ ok: true, variant }`, `{ ok: false, error: "invalid-variant" }` (unknown id or another
  product's variant, 400) or `{ ok: false, error: "out-of-stock" }` (409). New `CartActionError`
  members get messages in `CART_ERROR_MESSAGES`. On success the stub still returns
  `cart-unavailable` until #10.

## Resolved questions

- **Q1: Does #26 store the cart line and show it on `/cart`?** No. #26 delivers the schema
  (`cart_items.variant_id`), the `variantId` form contract and validation, and comments on #10
  that its insert must use `variantId` and its page must show the volume and variant price. The
  "stores the selected variant" AC is met when #10 lands (source: user answer).
- **Q2: Legacy `products.price/volume_ml/stock_quantity`?** Keep them NOT NULL and unchanged,
  mark them deprecated, and drop them in a follow-up after #16 (source: user answer).
- **Q3: Snapshot `volume_ml` on `order_items`?** Yes, nullable, written by #11 (source: user
  answer).
- **Q4: Catalog card buttons?** Two buttons side by side: "Choose volume" (link to the product
  page) and an add button that adds the default variant and names its size. Kept in #26, not a
  new issue (source: user answer, see Decisions).

- **Where does the volume list live?** As a shared `as const` array in `app/lib/enums.ts`, with
  the DB check built from it (source: `app/lib/enums.ts` header comment,
  `orders_payment_method_check` in `app/.server/db/schema.ts`, issue Technical section).
- **Serial id or public id in forms?** Public UUID. Serial ids never leave the server (source:
  `app/lib/products.ts` header, `products.public_id` in `app/.server/AGENTS.md`).
- **How is price formatted?** `formatPrice` → `6 850 ₴`, never float arithmetic (source:
  `app/lib/money.ts`, `app/.server/AGENTS.md` money rules).
- **Where do rows become DTOs?** Only in `toSummary`/`toDetail` in `services/products.ts`, which
  were written for this change ("moving price and stock to variants (#26) changes just this")
  (source: `app/.server/services/products.ts`).
- **Pack sizes vs. variants?** Volume is per unit and the total is `pack_size * volume_ml`, so
  `pack_size` stays on the product (source: `app/.server/AGENTS.md`, `products.packSize`).
- **Constraint naming?** Explicit snake_case names for unique/check/index (source:
  `app/.server/AGENTS.md`, Database).
- **Migration + rollback convention?** `pnpm db:generate --name <name>` plus a hand-written
  `db/rollbacks/<tag>.sql`. Never edit an applied migration (source: `app/.server/AGENTS.md`).
- **Is the cart persisted yet?** No. `app/routes/cart.tsx` is a validating stub until #10 (source:
  `app/routes/cart.tsx`, #10 open).
- **Select styling?** Reuse the sort `<select>` styling from `app/features/catalog/CatalogFilters.tsx`
  and the label pattern from `app/features/auth/TextField.tsx`. Inputs use the `card` background
  (source: `docs/design.md` tokens).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` / `enums.test.ts` | `PERFUME_VOLUMES_ML`, `PerfumeVolumeMl` |
| modify | `app/.server/db/schema.ts` | `productVariants` table; `variantId` on `cartItems`/`orderItems`; `volumeMl` on `orderItems`; deprecate legacy product columns |
| modify | `app/.server/db/schema.test.ts` | Columns/FKs/constraints of the new table and changed tables |
| modify | `app/lib/commerce.ts` | `ProductVariant` row type; `variantId` on `CartItem`/`OrderItem`, `volumeMl` on `OrderItem` |
| create | `app/.server/db/migrations/0002_product_variants.sql` (+ `meta/0002_snapshot.json`, `_journal.json`) | Generated DDL plus hand-written backfill |
| create | `app/.server/db/rollbacks/0002_product_variants.sql` | Reverse of the migration |
| modify | `app/.server/db/migrator.test.ts` | Backfill and rollback round trip (if a pattern exists there) |
| modify | `app/.server/db/seed-data.ts` / `seed.ts` / `seed.test.ts` | Sample variants (several sizes per perfume) and idempotent variant seeding |
| modify | `app/.server/db/queries/products.ts` | Variant aggregate join for list/count/sort; `listVariantsByProductId`; `findVariantForProduct` |
| modify | `app/lib/products.ts` / `products.test.ts` | `ProductVariant` DTO, new summary/detail shapes, `defaultVariant`, `formatVolumes`, `formatVariantOption` |
| modify | `app/.server/services/products.ts` / `products.test.ts` | `toSummary`/`toDetail` from variants; `checkVariantForCart` |
| modify | `app/lib/cart.ts` / `cart.test.ts` | `variantId` in the schema; new error codes and messages |
| modify | `app/routes/cart.tsx` | Variant validation in the stub `action` |
| create | `app/features/product/VolumeSelect.tsx` | Labelled `<select name="variantId">` |
| create | `app/features/product/ProductPurchase.tsx` | Selected-variant state: price, stock, select, add to cart |
| create | `app/features/product/product-ui.test.ts` | Render tests for the select and the purchase block |
| modify | `app/features/cart/AddToCartForm.tsx` | Optional hidden `variantId`, `children` inside the form |
| modify | `app/features/catalog/ProductCard.tsx` / `catalog-ui.test.ts` | "from" price, volume list, choose-volume link |
| modify | `app/routes/product.tsx` | Use `ProductPurchase` instead of the single price/stock/form |
| modify | `app/.server/AGENTS.md` | Document variants, deprecated columns, stock rule for #11 |

## Steps

- [x] **1. Volume enum**: add `PERFUME_VOLUMES_ML` and `PerfumeVolumeMl` to `app/lib/enums.ts`,
  plus a test in `enums.test.ts` (exact values, ascending). Check: `pnpm test app/lib/enums`.
- [x] **2. Schema**: in `schema.ts` add `productVariants` as described in Decisions, with the
  volume check `sql\`${t.volumeMl} in (${sql.join(PERFUME_VOLUMES_ML.map((v) => sql.raw(String(v))), sql\`, \`)})\``.
  Add `variantId` (NOT NULL, cascade) to `cartItems` and swap the unique to
  `cart_items_cart_id_variant_id_unique`. Add `variantId` (nullable, set null) and `volumeMl`
  (nullable) to `orderItems`. Add `/** @deprecated use product_variants (#26) */` on
  `products.price/volumeMl/stockQuantity`, and update the header comment. Mirror the types in
  `app/lib/commerce.ts` and extend `schema.test.ts` (columns, FKs, constraints, and the
  commerce type drift checks). Check: `pnpm typecheck && pnpm test app/.server/db/schema`.
- [x] **3. Migration + rollback**: `pnpm db:generate --name product_variants`. Read the generated
  SQL. drizzle-kit can't add a NOT NULL column to a table with rows, so edit the **unapplied**
  file to:
  1. create `product_variants` (generated);
  2. backfill:
     ```sql
     INSERT INTO "product_variants" ("product_id", "volume_ml", "price", "stock_quantity")
     SELECT "id", "volume_ml", "price", "stock_quantity" FROM "products"
     WHERE "volume_ml" IN (7, 10, 30, 50, 100)
     ON CONFLICT DO NOTHING;
     ```
  3. `cart_items`: add `variant_id` nullable, `UPDATE cart_items ci SET variant_id = pv.id FROM
     product_variants pv WHERE pv.product_id = ci.product_id` (exactly one variant per product
     right after the backfill), `DELETE FROM cart_items WHERE variant_id IS NULL`, then
     `SET NOT NULL`, the FK, and drop/add the unique constraints;
  4. `order_items`: add `variant_id` and `volume_ml`, backfill both the same way (no delete), add
     the FK.

  Keep the `--> statement-breakpoint` markers. Write `db/rollbacks/0002_product_variants.sql`:
  restore `cart_items_cart_id_product_id_unique`, drop the new columns/constraints from
  `order_items` and `cart_items`, then `DROP TABLE "product_variants"`. Check against a throwaway
  DB: `migrateLatest`, then the backfill counts equal the products with allowed volumes, then
  `rollbackLatest` and migrate again. Add this as an integration test (`describe.skipIf(!hasDatabase)`,
  `createTestDatabase`) next to the existing migrator tests. **If #5 or #14 merged first, rebase
  and regenerate as described under Dependencies before continuing.**
- [x] **4. Lib DTOs and helpers** (the `ProductSummary`/`ProductDetail` reshaping moved to step 6, so each commit typechecks together with its consumers): in `app/lib/products.ts` add `ProductVariant { id; volumeMl;
  price; stockQuantity; inStock }`. Change `ProductSummary` to `{ id, title, brand, gender,
  minPrice, hasPriceRange, volumes: number[], packSize, imageUrl, inStock, variantCount,
  defaultVariant: { id: string; volumeMl: number } | null }`, and `ProductDetail` to the product fields plus `variants: ProductVariant[]`
  (sorted ascending, no top-level price/stock). Add `defaultVariant(variants)`,
  `formatVolumes({ volumes, packSize })` (`10 · 30 · 50 ml` / `3 × 10 ml`) and
  `formatVariantOption(variant, packSize)` (`30 ml — 1 450 ₴`, plus ` (out of stock)`).
  Unit-test all three in `products.test.ts`. In `app/lib/cart.ts` add `variantId: z.uuid()` and
  the error codes `"invalid-variant" | "out-of-stock"` with messages, and update `cart.test.ts`.
- [x] **5. Seed data**: add `variants: { volumeMl: PerfumeVolumeMl; price; stockQuantity }[]` to
  `SampleProduct` (kept out of the `products` insert). Give most perfumes 2–5 sizes with different
  prices/stock, including at least one out-of-stock size and one fully out-of-stock product. Keep
  the 3 × 10 ml set single-variant. Each product's legacy `volumeMl/price/stockQuantity` must equal
  one of its variants (the backfilled one). `seedProducts`: insert products as now, then select
  ids for all sample `publicId`s and insert every variant with `onConflictDoNothing({ target:
  [productVariants.productId, productVariants.volumeMl] })`, all in the existing transaction.
  Return `{ inserted, variantsInserted }`. Extend `seed.test.ts`: allowed volumes, unique per
  product, legacy size included, idempotent re-run.
- [x] **6. Queries and service** (committed together with steps 7 and 8, because the reshaped DTOs break the card and the product page until they're updated): in `queries/products.ts` build a `variantStats` subquery
  (`groupBy(productVariants.productId)`: `minPrice: min(price)`, `maxPrice`, `maxStock`,
  `volumes: sql<number[]>\`array_agg(volume_ml order by volume_ml)\``, `variantCount`, and the
  default variant's `public_id` + `volume_ml`: the first by `(stock_quantity = 0), volume_ml`, so
  the smallest in-stock size, else the smallest. Use `(array_agg(… order by …))[1]` and keep it
  consistent with `defaultVariant()`). `innerJoin` it in `listProducts` and `countProducts`
  (replace `$count` with a `count()` select over the join), and change `ORDER_BY.price_*` to use
  `variantStats.minPrice`. Add `listVariantsByProductId(db, productId)` (ordered by `volume_ml`)
  and `findVariantForProduct(db, productPublicId, variantPublicId)` (join to `products`, so a
  variant of another product returns `undefined`). `findProductByPublicId` must also return the
  serial `id`, used only inside the service. In `services/products.ts` rewrite
  `toSummary`/`toDetail`, make `getProduct` load the variants, and add `checkVariantForCart`.
  Extend `services/products.test.ts`: catalog min price and "from" flag, price sort by min price,
  products without variants hidden, totals match, detail variants ascending, and
  `checkVariantForCart` ok / unknown / other product's variant / out of stock.
- [x] **7. Catalog card**: in `ProductCard` show `formatVolumes(product)` and
  `from {formatPrice(minPrice)}` when `hasPriceRange`. Render `AddToCartForm` with
  `variantId={defaultVariant.id}` and the label `Add {volumeMl} ml` ("Out of stock" when
  `!inStock`). When `variantCount > 1`, put a secondary `ButtonLink` "Choose volume" to
  `productHref(id)` beside it (`flex flex-wrap gap-2`, both `size="sm"`, primary/secondary per
  `docs/design.md`) (Q4). This needs an optional `label` prop on `AddToCartForm`. Update
  `catalog-ui.test.ts`: the posted `variantId` is the default variant, the button names its size,
  "Choose volume" appears only for multi-variant products, and an out-of-stock product disables
  the add button but keeps "Choose volume".
- [x] **8. Product page**: extend `AddToCartForm` with an optional `variantId` (hidden input) and
  `children` rendered inside the form before the button. Its fetcher key stays per product.
  Create `app/features/product/VolumeSelect.tsx`: `<label htmlFor="volume">Volume</label>` +
  `<select id="volume" name="variantId" value onChange>` with one `<option value={v.id}
  disabled={!v.inStock}>` per variant (`formatVariantOption`), styled like the sort select in
  `CatalogFilters` (focus ring from `focusRing("onLight")`). Create `ProductPurchase.tsx`: state
  `selectedId` from `defaultVariant`, and render the price (`animate-spin-in`, re-keyed on change
  so the animation replays), `StockStatus` for the selected variant, and `AddToCartForm` wrapping
  `VolumeSelect`, disabled when the selected variant is out of stock. No variants means a
  disabled "Currently unavailable" button. In `routes/product.tsx`, replace the volume pill,
  price, `StockStatus` and `AddToCartForm` with `<ProductPurchase product={product} />`, keeping
  the fragrance-family pill. Add `product-ui.test.ts` (render with `react-dom/server` like
  `catalog-ui.test.ts`): options ascending with prices, out-of-stock ones disabled, the default
  is the smallest in-stock one, and the select is inside the form posting to `/cart`.
- [x] **9. Cart action**: in `routes/cart.tsx`, after `parseAddToCart`, call
  `checkVariantForCart(productId, variantId)`. Return `data<CartActionResult>({ ok: false, error },
  { status: 400 | 409 })` on failure, otherwise keep returning `cart-unavailable` with a comment
  pointing #10 at the validated `variant`. Add a route test (`app/routes/cart.test.ts`, mocking
  the service like the other route tests) for invalid input, unknown variant and out-of-stock.
- [ ] **10. Docs**: update `app/.server/AGENTS.md` (Database section): `product_variants`, its
  `public_id`, the deprecated product columns, that stock checks/decrements and
  `price_at_purchase` use the variant (#11), and that `cart_items` lines are per variant. Leave a
  comment on #10/#11 summarising the contract (Q1).
- [ ] **11. Verify**: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Then
  `pnpm aspire run`, `pnpm db:migrate`, `pnpm db:seed` and the manual checks below.

## Testing & verification

- Unit: `enums.test.ts`, `lib/products.test.ts` (`defaultVariant`, `formatVolumes`,
  `formatVariantOption`), `lib/cart.test.ts`, `schema.test.ts`, `seed.test.ts` (data part),
  `catalog-ui.test.ts`, `product-ui.test.ts`, `routes/cart.test.ts`.
- Integration (with a DB, throwaway databases): migration backfill + rollback,
  `seedProducts` variants and idempotency, `services/products.test.ts` catalog/detail/validation.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: the product page lists sizes ascending with prices, and out-of-stock sizes are greyed
  and unselectable. Changing the size updates price and stock badge. With JS disabled, submitting
  posts the chosen `variantId`. A tampered `variantId` (devtools) shows the "invalid" message, not
  a 500. Catalog cards show "from …" and price sorting follows the lowest size price. An existing
  dev DB migrates with each product keeping its original size/price/stock as a variant.

## Acceptance criteria

- [ ] `product_variants` table exists with a unique `(product_id, volume_ml)` constraint and only allows 7, 10, 30, 50 or 100 ml — steps 1, 2, 3
- [ ] Existing products are migrated to at least one variant without data loss; ML feature columns are untouched — steps 3, 5 (legacy columns kept)
- [ ] The product page shows a dropdown with the product's available volumes in ascending order, each with its price — steps 6, 8
- [ ] Changing the selected volume updates the displayed price and stock status — step 8
- [ ] Out-of-stock volumes are disabled in the dropdown, and the default is the smallest in-stock volume — steps 4, 8
- [ ] Adding to cart stores the selected variant; the cart shows the volume and the variant's price — steps 2, 8, 9 (schema + contract); storing and the cart page land with #10 (Q1)
- [ ] Submitting an invalid or out-of-stock `variantId` returns a typed validation error, not a crash — steps 4, 6, 9
- [ ] Catalog cards show the lowest variant price ("from ₴…") — steps 6, 7
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 11

## Out of scope

- Per-size images, per-size discounts, admin UI for variants (#16).
- Dropping or altering the legacy `products.price/volume_ml/stock_quantity` columns (follow-up).
  ML feature columns are never touched.
- Cart persistence and the cart page (#10), and checkout stock decrement and order creation
  (#11). Only their schema and contract are prepared here.
- A volume filter in the catalog.
