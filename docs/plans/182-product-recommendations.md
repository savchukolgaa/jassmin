# Plan: Recommend perfumes on product, home and cart pages from real orders and views (#182)

Issue: https://github.com/savchukolgaa/jassmin/issues/182
Branch: `issue/182`
Worktree: `.claude/worktrees/issue-182`
Status: Planned

## Goal

Customers should find perfumes they'll like without searching the whole catalog. We bring the
recommender that won in notebook 04 (#133), item-item cosine on co-purchases and co-views, into the
shop. A nightly job, `pnpm db:build-recommendations`, writes each product's top 12 into a new
`product_recommendations` table. The site then shows "Customers also chose" on product pages,
"For you" on the home page and "Complete your trio" in the cart. Until there's enough data, these
lists fall back to the family-based "Similar perfumes" and then to popular perfumes.

## Dependencies & prerequisites

- **#133** (notebooks): merged. `analytics/notebooks/04_recommendations.ipynb` holds the method
  and the evaluation. Nothing runs from it in production.
- **#129** (event contract): merged. `LIST_IDS`, `ProductListProvider` and `ProductCard.listIndex`
  already send `product_impression` / `product_click` / `add_to_cart` with `list_id` and
  `list_position`.
- **#18** (consent): merged. `trackEvent` writes `product_view` only with consent, so every
  `product_view` row in `user_events` was recorded with consent.
- **#88** (similar perfumes): merged. `getSimilarProducts` / `listSimilarProducts` and the
  `SimilarProducts` component exist, but only an **archived** product's page uses them today.
- **#74** (volume choice on cards): merged as `CardVolumePicker` inside the default `ProductCard`.
- **#176** (deploy): merged. `deploy/crontab` runs in the `scheduler` container, which gets the
  same environment as `web` (`aspire-apphost/production.mts`).
- **New:** migration `0033_product_recommendations` with its rollback, a new script
  `db:build-recommendations`, and an optional env var `RECS_MIN_SIGNALS` (default 5), which only
  the job reads. No new packages.

## Decisions & assumptions

- **Method (as the issue specifies, simpler than the notebook).** Each row of the item matrix is a
  "basket":
  - one row per **customer** with the products in their sold orders (`SOLD_ORDER_STATUSES`, the
    same statuses as `soldUnits`), weight 3. The customer is `orders.user_id`, or `lower(email)`
    for guest orders.
  - one row per **analytics session** with its `product_view` products, weight 1.
  - Only the last 365 days count (`orders.created_at`, `user_events.created_at`).
  - A product counts once per basket, at the basket's weight; it isn't summed per view.
  - Cosine: `sim(i, j) = Σ_b w_bi·w_bj / (‖i‖·‖j‖)`.

  The notebook also used add-to-cart events, weights 1/3/5, a dwell bonus and `log1p`. Those stay
  in the notebook. The "From notebook to production" paragraph explains the difference.
- **Pure core, SQL extraction.** `db/queries/recommendations.ts` reads the
  `(basket, product_id, weight)` triples with one SQL query. A pure function
  `computeItemCosine(triples, { topN, minSignals })` in `db/build-recommendations.ts` builds the
  pairs, cosines, ranks and per-product signal counts. That function is what the hand-computed unit
  test checks. The catalog has a few hundred products, so computing in memory is cheap.
- **`signals` and `RECS_MIN_SIGNALS`.** A product's signal count is the number of baskets it
  appears in. A row's `signals` column is the pair's co-occurrence count, the number of baskets
  holding both products. The job writes rows only for products with
  `signals ≥ RECS_MIN_SIGNALS`, so "too little data" just means "no rows". The web app doesn't need
  the variable. It's read from `process.env` with a default, like `ABANDONED_CART_HOURS`.
- **Every product gets recommendations,** archived and out-of-stock ones included, as long as they
  have enough signals: an archived product's page uses them too. The in-stock and active filters
  apply at read time, as the issue says.
- **Table.** It's `product_recommendations` (`product_id` and `recommended_product_id` are FKs to
  `products.id` with `on delete cascade`; products are never deleted anyway). The other columns
  are `score double precision`, `rank smallint` (1–12, CHECK), `signals integer` and
  `computed_at timestamptz`. The primary key is `(product_id, recommended_product_id)`, and there's
  an index on `(product_id, rank)` and a CHECK that `product_id <> recommended_product_id`. The job
  writes it with `delete` + batched `insert` in one transaction. It's not an ML-feature table, but
  it stays documented.
- **Read-time filter** (in one query, `listRecommendedProducts`): the product is `isListed`, has at
  least one size with `variantStock > 0`, is not in the excluded ids, and is a single perfume
  (`pack_size = 1`). The order is the best score over the seed products (sum of scores when
  blending several seeds), then rank. It returns `ProductSummaryRow`s through `summaryColumns`, so
  the cards are the same as everywhere else.
- **Fallback chain, filled up to the list length:**
  1. recommendations;
  2. `listSimilarProducts` (family, then brand, then popular and bestsellers), with an added
     `excludeIds` and an in-stock condition;
  3. `listBestsellers`, also with `excludeIds`.

  A list is labelled "Customers also chose" only when step 1 gave at least one product. Otherwise
  it keeps the family heading "Similar perfumes" (Q3, default chosen).
- **Service API** (`services/recommendations.ts`):
  - `forProduct(productId, product, { cartProductIds })` returns
    `{ source: "recs" | "similar", products }`.
  - `forVisitor({ userId, anonymousId, trackingAllowed, cartProductIds })` returns
    `ProductSummary[] | null`, with `null` meaning no history.
  - `forCart(cart, trioOffer)` returns `ProductSummary[]`, empty when no trio is pending.

  `RECS_LIST_LIMIT = 4` everywhere (the product page and home grids are 4 wide).
- **"For you" history:** the visitor's last 5 viewed products (`user_events` `product_view` by
  `user_id` or `anonymous_id`, read only when `isTrackingAllowed(request)`) plus a logged-in user's
  last 5 bought products. Purchases are always excluded. With no seeds, or no recommendations for
  them, the result is `null`: the section isn't shown, and the existing bestsellers block is the
  "popular perfumes" everyone else sees (Q1, default chosen).
- **"Complete your trio":** it's shown only when the tester-trio rule is live (`getTesterTrioOffer`
  is not `null`), the cart's qualifying units (lines matching the rule's `volumeMl`, `pack_size 1`)
  modulo `setSize` are 1 or 2, and fewer than `maxSets` sets are complete. The seeds are the
  cart's products, and the cards preselect the trio's size (10 ml) (Q2, default chosen).
- **Exclusions:** the product itself and products already in the cart, everywhere. "For you" also
  excludes what the visitor has bought. The cart's product ids come from `getCartView(owner)`.
  On the product and home pages the loader reads them with `getCartOwner`. That read only happens
  when a cart cookie or user exists, so it costs nothing for most first visits.
- **Tracking:** three new `LIST_IDS`, `recs_product`, `recs_for_you` and `recs_cart` (the issue's
  `list` is the existing `list_id` property). The product page's fallback list keeps `similar`, so
  the warehouse compares `recs_product` with `similar` by click-through. The positions come from
  `listIndex`, as today. `LIST_IDS` is validated by `z.enum`, so this is a code change, not a
  migration (`event_properties` is JSON).
- **Caching:** the product and home pages now depend on the cart and the visitor. The `_shop`
  middleware already sends `private, no-store` whenever visitor cookies exist, and neither route
  sets a public `Cache-Control`, so nothing changes.
- **UI:** one shared `RecommendedProducts` section (heading, `ProductListProvider`, a grid of
  default `ProductCard`s with the volume picker), placed in `app/features/recommendations/`. The
  C+ tokens follow `SimilarProducts`, which becomes a thin wrapper around it, or is replaced by it.

- **Deviations found while implementing (steps 4–5):**
  - The recommendable filter is a `RecommendableFilter` (`excludePublicIds`, `excludeIds`,
    `volumeMl`) applied in `db/queries/products.ts` (`recommendable`). `listSimilarProducts` and
    `listBestsellers` take it as an optional `filter`, so their existing callers don't change.
    `listRecommendedProducts` also lives there, because it shares the card columns.
  - The cart's fallback is recommendations, then bestsellers with the trio size in stock. A cart
    line has no gender or family list, so the similar list doesn't fit there.
  - `TrioOffer` has no `maxSets`, so the cart shows the block for any incomplete set. Checkout
    still prices at most the rule's sets.
  - The trio cards get the 10 ml size through `preselectVolume`, which overrides the summary's
    `defaultVariant`, so `ProductCard` needs no new prop.
  - "For you" is topped up with bestsellers once it has at least one recommendation.

## Open questions

The user chose the recommended default for each of these (2026-11-19); they are decided.

- [x] **Q1: What does a visitor without history see in the home page's "For you" slot?** Why it
  matters: the home page already shows bestsellers. A "popular" fallback in a second section would
  repeat them. Recommended default: don't render "For you" without history; the existing
  bestsellers section is the popular list. With history, "For you" sits above the bestsellers.
  Affects steps: 7.
- [x] **Q2: What counts as "a trio isn't complete yet" in the cart?** Why it matters: it decides
  when the block shows and which size the cards offer. Recommended default: the live tester-trio
  rule's qualifying units (single 10 ml sizes) are 1 or 2 more than a full set, and the cards
  preselect 10 ml. Not shown for a cart of only big bottles or an empty cart. Affects steps: 5, 8.
- [x] **Q3: What heading does the product page fallback use?** The options are the family-based
  "Similar perfumes", or always "Customers also chose". Why it matters: the issue wants the family
  list kept, and tracking wants the two lists told apart. Recommended default: keep "Similar
  perfumes" with `list_id: "similar"` for the fallback, and use "Customers also chose" with
  `recs_product` only for real recommendations. Affects steps: 6.
- [x] **Q4: May a logged-in customer's purchases seed "For you" without cookie consent?** Why it
  matters: orders aren't analytics tracking, but this is personalisation. Recommended default: yes
  for purchases, which are their own account data; views are used only with consent. Affects
  steps: 5.

## Resolved questions

- **Does the product page show "Similar perfumes" for available products today?** No. Only an
  archived product's page does (#88: `product.tsx` loader, `available ? [] : getSimilarProducts`).
  This issue adds the list to available products too, with recommendations first. (source:
  `app/routes/product.tsx:118`, `app/features/product/ProductArchived.tsx`)
- **How is the click list recorded?** As `list_id` on `product_impression` / `product_click` /
  `add_to_cart` from `ProductListProvider` + `listIndex`. The issue's `list: "recs_…"` means new
  `LIST_IDS` values. (source: `app/lib/analytics.ts:24`, `docs/analytics-events.md` → Lists)
- **Do the warehouse or the generator restrict `list_id` values?** No. There are no
  `accepted_values` on `list_id` in the dbt YAML, and the generator picks lists from its own set.
  The new ids need no warehouse change. (source:
  `analytics/warehouse/models/intermediate/_intermediate__models.yml`,
  `analytics/generator/simulate.py`)
- **Are views consented?** Yes. `trackEvent` no-ops without consent or for bots, so reading
  `user_events` is enough. (source: `app/.server/AGENTS.md` → Visitor and events)
- **How are jobs structured?** A pure job module `db/<job>.ts` returns `{ …, message }`, and a CLI
  wrapper `db/scripts/<job>.ts` uses `createDb(url, 1)`, loads `.env` and closes the pool. There's
  also an explicit-start Aspire resource that waits for `db-migrate`, and a line in
  `deploy/crontab`. (source: `db/prune-rate-limits.ts`, `db/scripts/prune-rate-limits.ts`,
  `aspire-apphost/apphost.mts:117`)
- **Does a job env var need `production.mts`?** Not when it's optional with a default.
  `ABANDONED_CART_HOURS` is the precedent, and `scheduler` gets the same env as `web`. (source:
  `aspire-apphost/production.mts:147`, `docs/setup.md`)
- **Which orders count as purchases?** `SOLD_ORDER_STATUSES` (paid, shipped, completed), as for
  bestsellers. (source: `db/queries/products.ts` → `soldUnits`)
- **Where's the latest migration?** `0032_perfumer_event_types`, so the new one is `0033`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/db/schema.ts` | `productRecommendations` table |
| create | `app/.server/db/migrations/0033_product_recommendations.sql` (+ `meta/`) | generated by `pnpm db:generate --name product_recommendations` |
| create | `app/.server/db/rollbacks/0033_product_recommendations.sql` | `DROP TABLE product_recommendations` |
| modify | `app/.server/db/schema.test.ts` | the new table, if row types are mirrored |
| create | `app/.server/db/queries/recommendations.ts` | `listRecommendationSignals`, `replaceRecommendations`, `listRecommendedProducts`, `listVisitorSeedProducts`, `listPurchasedProductIds` |
| modify | `app/.server/db/queries/products.ts` | `excludeIds` and the in-stock condition on `listSimilarProducts` / `listBestsellers`; export `isInStock` |
| create | `app/.server/db/build-recommendations.ts` | `computeItemCosine` (pure) + `buildRecommendationsJob(db, now, minSignals)` |
| create | `app/.server/db/build-recommendations.test.ts` | hand-computed cosine example, top-N, min signals, plus a DB integration test |
| create | `app/.server/db/scripts/build-recommendations.ts` | CLI wrapper |
| modify | `package.json` | `db:build-recommendations` |
| create | `app/.server/services/recommendations.ts` | `forProduct`, `forVisitor`, `forCart`, fallback chain |
| create | `app/.server/services/recommendations.test.ts` | filters, exclusions, fallback, trio rule |
| create | `app/lib/recommendations.ts` | `RECS_LIST_LIMIT`, `pendingTrioUnits(lines, offer)` (isomorphic, no zod) |
| create | `app/lib/recommendations.test.ts` | `pendingTrioUnits` |
| modify | `app/lib/analytics.ts` | `LIST_IDS` += `recs_product`, `recs_for_you`, `recs_cart` |
| modify | `app/lib/analytics.schema.test.ts` / `analytics.test.ts` | the new ids |
| create | `app/features/recommendations/RecommendedProducts.tsx` | shared section |
| create | `app/features/recommendations/RecommendedProducts.dom.test.ts` | heading, list id, cards |
| modify | `app/features/product/ProductArchived.tsx` | `SimilarProducts` delegates to `RecommendedProducts` |
| modify | `app/routes/product.tsx` (+ test) | loader calls `forProduct` for every product |
| modify | `app/routes/home.tsx`, `app/.server/services/home.ts`, `app/features/home/HomePage.tsx` (+ tests) | "For you" |
| modify | `app/routes/cart.tsx` (+ test) | "Complete your trio" |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `recommendations.*` keys |
| modify | `aspire-apphost/apphost.mts`, `aspire-apphost/AGENTS.md` | `db-build-recommendations` resource |
| modify | `deploy/crontab` | nightly run |
| modify | `docs/setup.md`, `.env.example` | the job, `RECS_MIN_SIGNALS` |
| modify | `docs/analytics-events.md` | the three new lists |
| modify | `analytics/README.md` | "From notebook to production" |
| modify | `app/.server/AGENTS.md` | short "Recommendations" bullet under Database |

## Steps

- [x] **1. Table and migration.** Add `productRecommendations` to `db/schema.ts`: the columns
  above, PK `product_recommendations_pkey (product_id, recommended_product_id)`, index
  `product_recommendations_product_id_rank_idx`, and CHECKs
  `product_recommendations_not_self_check` and `product_recommendations_rank_check`
  (`rank between 1 and 12`), all with explicit snake_case names. Run
  `pnpm db:generate --name product_recommendations` and write
  `rollbacks/0033_product_recommendations.sql`. Check it with `pnpm db:migrate` then
  `pnpm db:rollback` then `pnpm db:migrate` on the dev DB, and update `schema.test.ts` if needed.
  Done: verified through `migrator.test.ts` on a throwaway database instead of the shared dev DB
  (the new table is in `ALL_TABLES`, and every rollback sequence rolls 0033 back first).
  `RECOMMENDATIONS_PER_PRODUCT` lives in `~/lib/recommendations`, imported by the schema.
- [x] **2. Signal extraction and pure cosine.**
  - `listRecommendationSignals(db, since)` is one `db.execute(sql…)` that returns
    `{ basket: string, productId: number, weight: number }[]`. It's the `union all` of:
    - distinct `('c:' || coalesce(o.user_id::text, lower(o.email)), oi.product_id, 3)` over sold
      orders with `o.created_at >= since`;
    - distinct `('s:' || e.session_id, e.product_id, 1)` over `user_events`, where
      `event_type = 'product_view'`, `product_id is not null` and `created_at >= since`.
  - `computeItemCosine(rows, { topN: 12, minSignals })` returns `{ rows: RecRow[], products: number, eligible: number }`:
    - it builds sparse vectors per product, computes the norms and the dot products over
      co-occurring baskets only, and counts the co-occurrences;
    - for each product with basket count ≥ `minSignals`, it keeps the top `topN` by score (ties
      broken by `signals` desc, then id asc), ranked 1..n.
  - Unit test, a hand-computed example: baskets `c1: {A,B}` (w3), `c2: {A,C}` (w3), `s1: {A,B}`
    (w1), `s2: {B,C}` (w1).
    - `‖A‖ = √19`, `‖B‖ = √11`, `‖C‖ = √10`;
    - `A·B = 9+1 = 10`, `A·C = 9`, `B·C = 1`;
    - so `sim(A,B) = 10/√209 ≈ 0.6917`, `sim(A,C) = 9/√190 ≈ 0.6529`, `sim(B,C) = 1/√110 ≈ 0.0953`.

    The test asserts these to 4 decimals and A's ranking (B, then C). It also covers `minSignals`
    filtering, the `topN` cut, no self pairs and an empty input.
- [x] **3. Job, script, scheduling.**
  - `buildRecommendationsJob(db, { now, minSignals })`:
    - `since = now − 365 days`;
    - extract, compute, then `db.transaction`: `delete from product_recommendations`, followed by
      inserts in chunks of 1000 (`replaceRecommendations(tx, rows, now)`);
    - it returns
      `{ products, eligible, rows, message: "Recommendations for N of M products with signals (min K); R rows." }`.
  - `minSignals` comes from `parseMinSignals(process.env.RECS_MIN_SIGNALS)`, a whole number ≥ 1
    that defaults to 5. An invalid value logs an error and exits 1.
  - Add the `db/scripts/build-recommendations.ts` wrapper, modelled on `prune-rate-limits`, and the
    `db:build-recommendations` script in `package.json`.
  - In `deploy/crontab`, add `45 2 * * * pnpm --silent db:build-recommendations` (before the 03:xx
    jobs, at night in Kyiv).
  - In `apphost.mts`, add the explicit-start `db-build-recommendations` resource (child of
    `jassmindb`, `waitForCompletion(dbMigrate)`, `withPnpm({ install: false })`), and document it
    in `aspire-apphost/AGENTS.md`.
  - DB integration test (`createTestDatabase()`): seed a few products and orders, plus sessions with
    views, one of them older than 365 days and one of them from an order with a cancelled status.
    Check that the job writes the expected rows and ignores the old view and the cancelled order,
    and that a second run replaces the rows rather than duplicating them.
- [x] **4. Read queries.**
  - In `db/queries/products.ts`, add `isInStock`: `exists (select 1 from product_variants v where
    v.product_id = products.id and <variantStock> > 0)`. Add an optional `excludeIds` to
    `listSimilarProducts` and `listBestsellers`, and use `isInStock` in both when called for
    recommendations, through an `inStockOnly` flag so the existing callers don't change.
  - In `db/queries/recommendations.ts`:
    - `listRecommendedProducts(db, { seedIds, excludeIds, limit })` joins `product_recommendations`
      for `product_id in seedIds`, groups by recommended product with `sum(score)` and `min(rank)`,
      joins `products` and `variantStats`, filters `isListed`, `isInStock`, `pack_size = 1` and not
      in `excludeIds ∪ seedIds`, and orders by `sum(score) desc` then `min(rank)`;
    - `listVisitorSeedProducts(db, { userId, anonymousId, limit })` returns the latest distinct
      viewed product ids;
    - `listPurchasedProductIds(db, userId)` returns the ids from sold orders (and pending ones, so
      a just-placed order isn't suggested again).
- [x] **5. Service.** Put `services/recommendations.ts` together from steps 2–4 with a shared
  `fillUp(primary, fallbacks…)` that dedupes and stops at `RECS_LIST_LIMIT`.
  - `forProduct`: recommendations seeded by the product, excluding the cart. If none come back,
    `source: "similar"`, built from `listSimilarProducts`, then `listBestsellers`.
  - `forVisitor`:
    - the seeds are the visitor's views when `trackingAllowed`, plus the user's last purchases;
    - it excludes their purchases and the cart;
    - it returns `null` when there are no seeds or no recommendation rows (Q1, Q4).
  - `forCart`:
    - `pendingTrioUnits(lines, offer)` lives in `~/lib/recommendations` (a pure function that also
      reads the trio's `volumeMl` and `setSize`); when it's 0, the result is `[]`;
    - the seeds are the cart's product ids; the fallbacks are the similar list for the cart's first
      line, then bestsellers;
    - it only uses products that have the trio's size in stock (Q2).

  Unit tests with injected DB fakes or a test DB cover each exclusion, the archived and
  out-of-stock filter, the fallback order and the trio counts (0, 1, 2, 3, 4 units; the max sets
  reached).
- [x] **6. Product page.**
  - The `product.tsx` loader calls `forProduct(found.id, product, { cartProductIds })` for
    available and archived products alike. It reads the cart ids from
    `getCartView(await getCartOwner(request))` only when an owner exists, and returns
    `recommendations: { source, products }`.
  - The page renders `RecommendedProducts` with:
    - for `source: "recs"`: heading `recommendations.product.title` ("Customers also chose" /
      "Покупці також обирали") and `listId: "recs_product"`;
    - otherwise: heading `product.similar` and `listId: "similar"`.
  - Keep `shouldRevalidate`. Update `product.test.ts` for the new loader shape.
- [x] **7. Home "For you".**
  - The `home.tsx` loader calls `forVisitor` with `getSessionUser`, `readVisitor(request)` and
    `isTrackingAllowed(request)`, in the existing `Promise.all`. `buildHomePageView` passes
    `forYou: ProductSummary[] | null`.
  - `HomePage` renders `RecommendedProducts` (`recommendations.forYou.title`, "For you" /
    "Для вас", `listId: "recs_for_you"`) above `Bestsellers` only when the list isn't empty.
  - Tests: `HomePage.test.ts` checks it's absent for `null` and present for a list, and
    `home.test.ts` checks the loader's wiring.
- [ ] **8. Cart "Complete your trio".**
  - The `cart.tsx` loader adds `getTesterTrioOffer()` and `forCart(cart, offer)` and returns
    `trioSuggestions`.
  - The page renders `RecommendedProducts` with `recommendations.cart.title` ("Complete your trio"
    / "Доберіть тріо") and a subtitle with the missing count (a plural:
    "Add {count} more tester for the trio price" / uk plural forms). It uses
    `listId: "recs_cart"` and cards whose volume picker preselects the trio's size. If
    `ProductCard` can't preselect a size yet, add an optional `preferredVolumeMl` prop to
    `ProductCard` → `CardVolumePicker`.
  - After an add, the cart loader revalidates, so the block updates or disappears.
- [x] **9. Tracking contract.** Add the three ids to `LIST_IDS`, document them in
  `docs/analytics-events.md` → Lists, and extend the `analytics.schema` tests so that
  impressions and clicks with the new ids parse. `cart.schema.ts` accepts them automatically
  through `LIST_IDS`. Add a `RecommendedProducts.dom.test.ts` that checks the cards carry
  `listIndex` and the provider's `listId`.
- [ ] **10. i18n and UI polish.**
  - Add `recommendations.{product,forYou,cart}.{title,subtitle?}` to `uk.ts` (the source) and
    `en.ts`.
  - Make the `RecommendedProducts` section follow C+ (`docs/design.md`): the same heading scale
    and grid as `SimilarProducts`, nothing rendered when the list is empty, and
    `aria-labelledby` set.
  - Make `SimilarProducts` call it.
- [ ] **11. Documentation.**
  - `docs/setup.md`: the Scripts table row, a "Recommendations" section (what it reads, the
    nightly cron, the Aspire resource, re-run safety) and `RECS_MIN_SIGNALS` in the env table.
  - `.env.example`: commented `RECS_MIN_SIGNALS=5`.
  - `analytics/README.md`: a "From notebook to production" paragraph linking notebook 04 to
    `db/build-recommendations.ts`, the simplified weights and the cold-start fallback.
  - `app/.server/AGENTS.md`: a short Recommendations bullet with the table, the job, the service
    and the rule that it reads only the app's own tables.
- [ ] **12. Verify.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`. Then
  check manually under `pnpm aspire run` (see Testing).

## Testing & verification

- **Unit:**
  - `computeItemCosine` (the hand-computed example, `minSignals`, `topN`, no self pairs);
  - `parseMinSignals`;
  - `pendingTrioUnits`;
  - `fillUp` dedupe and limit;
  - `LIST_IDS` schema acceptance.
- **DB integration** (`describe.skipIf(!hasDatabase)`, `createTestDatabase()`):
  - the job end to end: the 365-day window, sold statuses only, replacing the rows;
  - `listRecommendedProducts`: inactive, out-of-stock, set, seed and excluded products are left
    out, and multiple seeds are blended;
  - the `forProduct` fallback when the table is empty.
- **Component (DOM):** `RecommendedProducts` (heading, list id, `listIndex`, empty → nothing),
  HomePage with and without `forYou`, and the cart block shown and hidden.
- **Routes:** loader shapes in `product.test.ts`, `home.test.ts` and `cart.test.ts`.
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **Manual:**
  1. `pnpm aspire run`, then `db-seed` or `db-import-catalog`.
  2. Place a few orders and view products with consent.
  3. Lower the threshold with `RECS_MIN_SIGNALS=1` and start `db-build-recommendations`.
  4. Check that a product page shows "Customers also chose", and that another product with no
     signals shows "Similar perfumes".
  5. Check that the home page shows "For you" after viewing, and nothing in a fresh private
     window.
  6. Check that a cart with one 10 ml line shows "Complete your trio", and that it disappears at
     three.
  7. In the DB, check that `product_click` events with `list_id = 'recs_*'` and a `list_position`
     arrive in `user_events`.

## Acceptance criteria

- [ ] `db:build-recommendations` computes item-item cosine recommendations from real orders and
  consented views, and a unit test checks it against a hand-computed example — steps 1, 2, 3
- [ ] Product pages show "Customers also chose", and fall back to the family-based list when a
  product has too few signals — steps 5, 6
- [ ] Visitors with history see "For you" on the home page, without products they already bought;
  others see popular perfumes — steps 5, 7 (Q1)
- [ ] The cart suggests perfumes to complete a trio — steps 5, 8 (Q2)
- [ ] Only active, in-stock products are recommended, never the product itself or one already in
  the cart — steps 4, 5
- [ ] Clicks are tracked with their list and position — steps 6–9
- [ ] The job runs nightly in production and from the Aspire dashboard — step 3
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 12

## Out of scope

- Real-time updates. The table is rebuilt nightly.
- ALS or any other model in production, and add-to-cart or dwell signals.
- A/B testing against the family-based list. The warehouse comparison by `list_id` is enough.
- Recommendation emails.
- New warehouse models or a recommendations mart, and changes to the synthetic generator.
