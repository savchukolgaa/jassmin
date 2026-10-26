# Plan: Add a Popular perfumes page with a header button and C+ design (#67)

Issue: https://github.com/savchukolgaa/jassmin/issues/67
Branch: `issue/67`
Worktree: `.claude/worktrees/issue-67`
Status: Planned (all owner answers applied, 2026-10-26)

## Goal
Shoppers get a `/popular` page that lists the store's most popular perfumes, so they can start from
scents other customers love. Staff set the order in the Strapi admin with a per-product "popular"
position, and the page tops itself up from #64's sales-based bestsellers, so it is never empty
while products are listed. A **"Bestsellers"** button in the C+ header (desktop and mobile menu,
between Catalog and Offers) and the home hero's "Order Now" CTA lead to it. The home page's
"Build your trio" CTA also links here with up to three `family` params, which narrow the list
(issue comment). The list is paginated. The page is designed first as a `PopularPlus` artboard on
the C+ canvas and built after the owner approves it. The owner's catalogue (128 perfumes, 30 marked
popular) becomes the seed data.

## Dependencies & prerequisites
- **#64 (home page), merged** (`ef70ebf`): `listBestsellers` in `app/.server/db/queries/products.ts`,
  `getBestsellers` / `getTrioFamilies` in `app/.server/services/products.ts`, the `compact`
  `ProductCard` variant, the `icon` `AddToCartForm`, and `~/lib/trio` (`TRIO_TARGET_PATH = "/popular"`,
  `parseTrioSearch`, `trioHref`). The hero CTA already points at `/popular`: `FALLBACK_CTA_PATH` in
  `app/lib/links.ts`, `ctaHref: "/popular"` in `cms/scripts/seed.ts` and both
  `app/.server/cms/__fixtures__/home-page*.json`. Today these links 404.
- **#65 (families, notes, store code), merged**: `products.fragrance_families`, `FRAGRANCE_FAMILIES`
  (`~/lib/enums`), `familyFilter` (any of the families, `&&`), `products.store_code` (not unique,
  #66), and the end-to-end pattern for adding a product field (`storeCode`) through the Strapi sync.
- **#40 (Strapi CMS), merged**: product edits flow through `cms/src/sync/middleware.ts`
  (`productPayload`, `applyProductAnswer`) → `POST /cms/products` → `cmsProductChangeSchema`
  (`~/lib/cms-sync`) → `applyCmsProductChange` (`services/cms-sync.ts`), and back via
  `findProductSyncState` → `toCmsProductState` / `toStrapiProductData` (`services/cms-push.ts`).
- **#8 catalog**: `CATALOG_PAGE_SIZE = 12`, the `page` search param schema and
  `~/components/ui/Pagination` (`page`, `pageCount`, `hrefForPage`), reused for `/popular`.
- **#27, #10, #28**: header/footer, add to cart with the "Added to cart" status, i18n. All merged.
- **Migration:** `0014_product_popular_rank` with a hand-written rollback. No new packages or env vars.
- **Design canvas** https://claude.ai/artifact/RCvne95y2han2bw8dWm1iW: checked on 2026-10-26, it
  has no `PopularPlus` artboard yet.
- **Owner's catalogue:** `makrtextfiles/catalog.md` in the main checkout (outside git), one line per
  perfume: `store code | title | brand | families | notes`, `(popular)` on 30 of them, split into
  "Womens perfume" (75) and "Mens perfume" (53). It has **no** prices, sizes, stock, descriptions or
  images (placeholders, Q5).

## Decisions & assumptions
- **Field shape:** `products.popular_rank integer NULL` with `CHECK (popular_rank > 0)`. `NULL` means
  "not on the popular list"; 1 is first. **Not unique**: staff can renumber one product at a time in
  Strapi without hitting a constraint, and equal ranks fall back to the bestseller order. No index:
  the catalogue is small. Strapi field `popularRank` (`integer`, `min: 1`, optional), app field
  `popularRank` everywhere (schema, `ProductWrite`, `cmsProductChangeSchema`, `CmsProductState`,
  sync middleware).
- **What the list holds (Q2: paginated):** every listed product that has a popular rank, in rank
  order. When fewer than one page (`POPULAR_PAGE_SIZE = CATALOG_PAGE_SIZE` = 12) are ranked, the
  list is topped up with the best-selling unranked products until it fills one page. So the total
  is `max(ranked, min(12, listed))`: with the owner's 30 popular perfumes that is 30 products on
  3 pages (12, 12, 6), and with none ranked it is #64's top 12. The page doesn't turn into the whole
  catalogue sorted by sales.
- **One ordering, two queries:** `listPopularProducts(db, filters, { limit, offset })` orders listed
  products by `popular_rank IS NULL, popular_rank, units sold desc, created_at desc, id desc`, so
  ranked products come first and the rest are exactly #64's bestseller ranking, with no duplicates
  and no merging in JS. `countPopularProducts(db, filters)` returns `{ ranked, listed }` in one
  query (`count(*) filter (where popular_rank is not null)`, `count(*)`), and the service works out
  the total, clamps `page` to `pageCount`, and passes `limit = min(12, total − offset)`. The `sold`
  subquery and `SOLD_ORDER_STATUSES` move into a shared `soldUnits(db)` used by `listBestsellers`
  too, so the two rankings can't drift apart. Inactive products and products without variants are
  excluded (`isListed`, inner join on `variantStats`), and women, men and unisex are all included.
- **Family filter (Q4 default):** the loader reads `family` params with `parseTrioSearch(params,
  await getTrioFamilies())` (known values only, at most `TRIO_SIZE` = 3, deduplicated, in pick
  order) and passes them as `fragranceFamilies`, so the ranked part, the top-up and the count are
  all narrowed. Unknown families are ignored, so a stale link shows the unfiltered page. The chosen
  families appear as removable chips (`FamilyChip`) with a "Show all" link to `/popular`, with no
  trio price block. When nothing matches, an empty state (a blush panel like `OffersEmpty`) links to
  `/popular` and both catalogues.
- **URLs:** `popularHref(families, page)` in `app/lib/popular.ts` builds `/popular?family=…&page=n`
  (families in order, `page` omitted when 1), like `catalogHref`. `trioHref` becomes
  `popularHref(families, 1)`. The page param uses the catalogue's `page` schema (`z.coerce…catch(1)`),
  and a page past the end clamps to the last one.
- **Header (Q3):** the button reads **"Бестселери" / "Bestsellers"** (`nav.bestsellers`, the same
  words as #64's home section title), sits **between Catalog and Offers** in `Header.tsx` and
  `MobileMenu.tsx`, and links to `/popular`. It's a `NavLink` with `navItemClasses(isActive)`, so
  React Router sets `aria-current="page"`; the active state also covers `/popular?…`. The footer is
  unchanged. The route stays `/popular`, and the page is titled "Популярні аромати" / "Popular perfumes" (Q6).
- **Route constant:** `POPULAR_PATH = "/popular"` in a new isomorphic `app/lib/popular.ts`;
  `TRIO_TARGET_PATH` (`~/lib/trio`) and `FALLBACK_CTA_PATH` (`~/lib/links`) reuse it, and
  `BESTSELLERS_LINK = { to: POPULAR_PATH, labelKey: "nav.bestsellers" }` joins `OFFERS_LINK` in
  `app/components/layout/nav.ts`.
- **Cards:** the `compact` `ProductCard` with the round `icon` add-to-cart, as in #64's home
  bestsellers, in a 1 / 2 / 4-column grid, as on the approved artboard (owner, 2026-10-26).
  `AddToCartForm` already shows the "Added to cart" status (`role="status"`, `animate-toast`).
- **Revalidation:** like `routes/home.tsx`, `shouldRevalidate` skips reloading after a POST to
  `/cart`, so adding to the cart doesn't re-run the ranking (the layout still updates the count).
- **No cache headers:** like `/catalog/:gender`, the page reads only PostgreSQL.
- **Seed from the owner's catalogue (Q1):** all 128 perfumes go into a new
  `app/.server/db/seed-catalog.ts` (`OWNER_CATALOG: SampleProduct[]`), which `seed-data.ts` appends
  to `SAMPLE_PRODUCTS`, so `seed-data.ts` stays readable. Each gets a fresh fixed UUID v7, its
  `storeCode`, title, brand, families (primary first, as listed) and notes, `gender` from its
  section (`women` / `men`), or `unisex` when the title ends in "(Unisex)" (the suffix is dropped
  from the title; 11 products). The 30 `(popular)` ones get `popularRank` 1–30 in file order (women
  first, then men) (Q7). Notes are lower-cased like the existing samples. Prices,
  sizes and stock are placeholders (Q5). Data fixes, all listed in the seed file's header comment
  for the owner: `Цитрус` → `цитрусові` (2-Y Lordly, 1-X Xeryus Rouge), `Древовидні` → `деревні`
  (4-Y Spisebomb), `Пряні, пряні` → `пряні` (3-G Givenchy Blue Label).
- **Overlap with the existing samples:** 1-L La Vie Est Belle, 2-C Christian Dior Sauvage and 2-A
  Acqua Di Gio are already sample products. They keep their `publicId`s (never change one) and take
  the owner's store code, families and notes; their sizes and prices stay. The other existing samples
  (Coco Mademoiselle, J'adore, Bleu de Chanel, Wood Sage & Sea Salt, Molecule 01, the tester set) stay
  as they are, without a rank.
- **Existing databases:** `seedProducts` keeps inserting with `onConflictDoNothing`, so the new
  products reach existing dev databases. A new backfill sets the sample products' `store_code`
  where it is still `null`, and their `popular_rank` only while **no** product has a rank yet, so a
  re-seed never overrides what staff set. Strapi gets the products with `pnpm db:sync-cms --all`;
  `cms/scripts/seed.ts` needs no product change and its hero `ctaHref` is already `/popular`.
- **Implementation notes (deviations):** the `nav.bestsellers` and `popular.*` copy landed in
  step 5, since the page doesn't typecheck without its keys; step 8 keeps the seed. `~/lib/popular`
  has `parsePopularPage` (the page only) instead of `parsePopularSearch`: `~/lib/trio` now imports
  `popularHref` from it, so it can't import `parseTrioSearch` back without a cycle, and the loader
  calls both. Per the approved artboard the band has a "Bestsellers" eyebrow and the list ends with
  a blush "Looking for something else?" panel; the count reuses `catalog.count`.
- **Header breakpoint (step 7):** measured in headless Edge with the built CSS, the bar with five
  links is 805px (uk) / 816px (en) wide, but the `md` container is 768px, so it overflowed between
  768 and 1023px. The inline nav and the language switcher now show from `lg` and the hamburger
  menu below `lg` (was `md`); at 1024px and wider the bar fits (1024px container).
- **Seed list (step 8):** `seed-catalog.ts` was generated from `catalog.md` by a one-off script
  (125 perfumes; the three overlaps update the existing samples). Instead of appending it to
  `SAMPLE_PRODUCTS`, `seed-data.ts` exports `SEED_PRODUCTS = [...SAMPLE_PRODUCTS, ...OWNER_CATALOG]`
  and `seedProducts(db, catalog = SEED_PRODUCTS)` takes the list: the catalog service tests seed the
  small `SAMPLE_PRODUCTS` only, since they expect it to fit on one catalog page. The overlapping
  samples keep their prices and descriptions; their notes, families and store codes are the owner's.
- **Analytics:** no new event; `page_view` is recorded by the `_shop` layout middleware as usual.

## Resolved questions
- **Q5: Prices, sizes and stock for the catalogue?** — Placeholders: the same sizes for every new
  product (10 ml 450.00, 30 ml 1100.00, 50 ml 1650.00, stock 5), marked as placeholders in the seed
  file header; no descriptions or images (cards show the existing image placeholder). (source: owner)
- **Q6: Page name and URL?** — The URL stays `/popular` and the page is called "Популярні аромати" /
  "Popular perfumes"; only the header button says "Бестселери" / "Bestsellers" (Q3). (source: owner)
- **Q7: Order of the 30 popular perfumes?** — File order (women first, then men), ranks 1–30; staff
  can reorder in Strapi. (source: owner)
- **Q8: Entries that look alike?** — They are different perfumes and become different products:
  11-L Lolita Lempicka and 11-L Lift, 15-D Dolce & Gabbana Anthology L'Imperatrice 3 and 14-Z D&G
  L'Imperatrice 3, and the women's and men's Davidoff Cool Water and Hugo Boss. Names and notes
  are seeded as written. (source: owner)
- **Q9: Load the catalogue into production?** — Not now: this issue only seeds dev databases.
  (source: owner)
- **Q1: Which perfumes are popular?** — The 30 marked `(popular)` in the owner's catalogue; the
  whole catalogue is added to the seed. (source: owner, `makrtextfiles/catalog.md`)
- **Q2: Pagination?** — Yes: 12 per page with the catalogue's `Pagination`, ranked products topped
  up to one page from bestsellers. (source: owner)
- **Q3: Header button?** — "Bestsellers" ("Бестселери"), between Catalog and Offers, linking to the
  page. (source: owner)
- **Q4: Filtered state?** — The default: removable family chips, "Show all", no trio price block,
  an empty state when nothing matches. (source: owner)
- **Does the hero "Order Now" CTA already lead to `/popular`?** — Yes: `FALLBACK_CTA_PATH` is
  `/popular`, the Strapi seed sets `ctaHref: "/popular"` for both locales, and the fixtures and
  `HomePage.test.ts` assert it. Only the route is missing. (source: `app/lib/links.ts`,
  `cms/scripts/seed.ts:138`, `app/.server/cms/__fixtures__/home-page*.json`, #64)
- **"Update #64's plan/fixtures"** — #64's plan was removed when it merged and its fixtures already
  use `/popular`; nothing to update. (source: `ef70ebf`)
- **Is the query called `getBestsellers` in `queries/products.ts`?** — No: the query is
  `listBestsellers(db, limit)` and `getBestsellers` is the service (fixed at `BESTSELLER_COUNT = 4`);
  the new query shares the sold-units subquery instead. (source: `app/.server/db/queries/products.ts`,
  `app/.server/services/products.ts`)
- **Do the catalogue's families fit `FRAGRANCE_FAMILIES`?** — All but three spellings (`цитрус`,
  `древовидні`, a repeated `пряні`), mapped as above. (source: `app/lib/enums.ts`, `catalog.md`)
- **How does the trio CTA link here?** — `trioHref` builds `/popular?family=…` with the stored
  Ukrainian values; `parseTrioSearch` already validates them. (source: `app/lib/trio.ts`, issue comment)
- **Does the Strapi seed need products?** — No: Strapi's products come from the app's database via
  `pnpm db:sync-cms --all`. (source: `app/.server/db/scripts/sync-cms.ts`)
- **Unisex?** — Shown together with women and men; no Unisex catalogue or link. (source: issue,
  `docs/design.md`)

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | canvas `project/PopularPlus.dc.html`, `project/PopularPlusPhone.dc.html` (+ `canvas.json` entries) | The artboards, desktop and 375px, in the C+ row |
| modify | `docs/design.md` | `C+ Popular` row in "Pages and issues" and a short description |
| modify | `app/.server/db/schema.ts`, `app/.server/db/schema.test.ts` | `popularRank` column and CHECK |
| create | `app/.server/db/migrations/0014_product_popular_rank.sql` (+ `meta/`), `app/.server/db/rollbacks/0014_product_popular_rank.sql` | Migration and rollback |
| modify | `app/.server/db/migrator.test.ts` | Migrate and roll back 0014 |
| modify | `app/.server/db/queries/products.ts` | `soldUnits`, `listPopularProducts`, `countPopularProducts`, `popularRank` in `ProductWrite` and `findProductSyncState` |
| modify | `app/.server/services/products.ts` | `POPULAR_PAGE_SIZE`, `getPopularPage(families, page)` |
| create | `app/.server/services/popular.test.ts` | DB integration tests for the ranking, top-up and pages |
| modify | `app/lib/cms-sync.ts`, `app/lib/cms-sync.test.ts` | `popularRank` in the change schema and `CmsProductState` |
| modify | `app/.server/services/cms-sync.ts`, `cms-sync.test.ts`, `cms-push.ts`, `cms-push.test.ts` | Write and push `popularRank` |
| modify | `app/routes/cms.products.test.ts` | The route accepts and returns `popularRank` |
| modify | `cms/src/api/product/content-types/product/schema.json`, `cms/types/generated/contentTypes.d.ts` | Strapi `popularRank` field |
| modify | `cms/src/sync/middleware.ts`, `cms/src/sync/middleware.test.ts` | Send and save `popularRank` |
| create | `app/lib/popular.ts`, `app/lib/popular.test.ts` | `POPULAR_PATH`, `parsePopularSearch`, `popularHref`, `PopularPageView` |
| modify | `app/lib/trio.ts`, `app/lib/links.ts` | Reuse `POPULAR_PATH` / `popularHref` |
| create | `app/features/popular/PopularPage.tsx` (+ sub-components the artboard needs), `app/features/popular/popular-ui.test.ts` | Page UI and its render tests |
| create | `app/routes/popular.tsx`, `app/routes/popular.test.ts` | Loader, `meta`, `shouldRevalidate`, `ErrorBoundary` |
| modify | `app/routes.ts` | `route("popular", "routes/popular.tsx")` under `_shop` |
| modify | `app/components/layout/nav.ts`, `Header.tsx`, `MobileMenu.tsx`, `Header.test.ts` | "Bestsellers" link with `aria-current` |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `nav.bestsellers`, `popular.*` |
| create | `app/.server/db/seed-catalog.ts` | The owner's 128 perfumes with ranks for the 30 popular ones |
| modify | `app/.server/db/seed-data.ts`, `app/.server/db/seed.ts`, `app/.server/db/seed.test.ts` | Include the catalogue, update the 3 overlapping samples, backfill store codes and ranks |
| modify | `app/.server/AGENTS.md` | Document `popular_rank`, the ranking and the seed catalogue |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [x] **1. Design the `PopularPlus` artboards and get approval** — On the C+ canvas add
  `PopularPlus.dc.html` (desktop, `expand: "fill"`, w 1440) and `PopularPlusPhone.dc.html` (375 px)
  to the "Chosen direction: Option C+" row, built only from C+ tokens, Manrope, `Button` variants,
  the compact product card and the motion utilities in `docs/design.md`. Show: the header with
  "Bestsellers" between Catalog and Offers, marked current; the page header (`h1` "Популярні аромати" + intro);
  the 12-card grid with pagination; the filtered state with family chips and "Show all"
  (`data-props` tweak); and the empty state (tweak). Check that the desktop nav still fits at
  768px with the extra item. Ask the owner to approve before step 5, then add a `C+ Popular`,
  `C+ Popular, phone width` | `/popular` | #67 row to `docs/design.md` with a short paragraph like
  the `/offers` one.
- [x] **2. Add `products.popular_rank`** — In `schema.ts` add `popularRank: integer()` with a doc
  comment (staff order on `/popular`, `null` = not on it, #67) and
  `check("products_popular_rank_check", sql\`${t.popularRank} > 0\`)`. Run
  `pnpm db:generate --name product_popular_rank`; write
  `rollbacks/0014_product_popular_rank.sql` (`DROP CONSTRAINT`, then `DROP COLUMN`). Update
  `schema.test.ts`'s products column list and add a 0014 case to `migrator.test.ts` (column exists
  and is nullable; `0` is refused; rollback removes it). Check: `pnpm test`, `pnpm db:migrate`,
  `pnpm db:rollback`, migrate again.
- [x] **3. Sync the field with Strapi** — `~/lib/cms-sync`: `popularRank:
  z.number().int().min(1).max(9999).nullish().transform((v) => v ?? null)` in `productFields`, and
  `popularRank: number | null` in `CmsProductState`. `ProductWrite` and `productWrite()` in
  `services/cms-sync.ts` carry it; `findProductSyncState` selects it and `toCmsProductState` maps it
  (`toStrapiProductData` spreads it as is). Strapi: add `"popularRank": { "type": "integer", "min": 1 }`
  to the product `schema.json` and regenerate `cms/types/generated/contentTypes.d.ts`
  (`pnpm --dir cms strapi ts:generate-types`, or edit to match); in `cms/src/sync/middleware.ts`
  `productPayload` sends `popularRank` (empty → `null`, else `toNumber`) and `applyProductAnswer`
  saves the app's value. Tests: the schema accepts `null`, missing and `3`, and refuses `0`, `-1`,
  `1.5`; `applyCmsProductChange` writes and clears it on create and update; `cms.products.test.ts`
  round-trips it; `cms-push.test.ts` and `middleware.test.ts` include it.
- [x] **4. Queries and service** — In `queries/products.ts` extract `soldUnits(db)` and use it in
  `listBestsellers` (no behaviour change; `bestsellers.test.ts` stays green). Add
  `listPopularProducts(db, { fragranceFamilies }, { limit, offset })`: `summaryColumns`, inner join
  on `variantStats`, left join on `soldUnits`, `where(and(isListed, familyFilter(fragranceFamilies)))`,
  ordered by `${products.popularRank} is null, ${products.popularRank}`, units sold desc,
  `created_at` desc, `id` desc. Add `countPopularProducts(db, { fragranceFamilies })` returning
  `{ ranked, listed }` over the same join and filter. In `services/products.ts` add
  `POPULAR_PAGE_SIZE = CATALOG_PAGE_SIZE` and `getPopularPage(families, page, db = defaultDb):
  Promise<PopularPage>` (`products`, `total`, `page`, `pageCount`): total =
  `max(ranked, min(POPULAR_PAGE_SIZE, listed))`, page clamped to `1…pageCount`, limit
  `min(POPULAR_PAGE_SIZE, total − offset)`. Integration tests in `services/popular.test.ts` (pattern
  of `bestsellers.test.ts`, `skipIf(!hasDatabase)`): ranked first in rank order; topped up by units
  sold then newest, without duplicates, only up to one page; 30 ranked → 3 pages of 12/12/6 and no
  top-up; equal ranks fall back to sales; ranked but inactive or size-less products excluded; women,
  men and unisex included; the family filter narrows the list, the top-up and the count; a page past
  the end clamps; empty when nothing is listed.
- [x] **5. URL helpers and page UI** — `app/lib/popular.ts`: `POPULAR_PATH`,
  `parsePopularSearch(params, knownFamilies)` (`parseTrioSearch` for the families plus the
  catalogue's `page` schema), `popularHref(families, page)`, and `PopularPageView` (`PopularPage`
  plus the chosen families with labels via `labelTrioFamilies`, in pick order). Point
  `TRIO_TARGET_PATH`, `trioHref` and `FALLBACK_CTA_PATH` at them; unit tests in `popular.test.ts`
  (and `trio.test.ts` stays green). `app/features/popular/PopularPage.tsx` per the approved
  artboard: `main` with the `h1` (`popular.title`: "Популярні аромати" / "Popular perfumes"), intro, the family chips with remove links (`popularHref` of
  the other families) and "Show all" when filtered, a `ul` grid of `ProductCard variant="compact"
  headingLevel={2}`, `Pagination` with `hrefForPage={(n) => popularHref(families, n)}`, and the empty
  states (`popular.empty.*`, linking to `/popular` when filtered and to both catalogues).
  `animate-fade-up` / `reveal` only as the artboard shows; nothing new in `app/app.css` unless the
  artboard needs it, and then inside the reduced-motion block. Render tests in
  `popular-ui.test.ts`: cards in order with add-to-cart forms, chips and their hrefs, pagination
  links keeping the families, empty states, Ukrainian by default and English in
  `<I18nProvider locale="en">`.
- [x] **6. Route** — `app/routes/popular.tsx`: the `loader` gets `getTrioFamilies()`, parses
  `parsePopularSearch(url.searchParams, known)`, then `getPopularPage(families, page)`, and returns
  the view with labels from `createTranslator(await getLocale(request))`. `meta` via
  `metaTranslator(matches)`: `meta.title` with `popular.metaTitle`, `popular.metaDescription`,
  `og:*`, and a canonical URL of `/popular` (plus `?page=n` after page 1; family filters aren't
  canonical). `shouldRevalidate` skips POSTs to `/cart` (as in `home.tsx`). `ErrorBoundary` with
  `describeRouteError`. Register `route("popular", "routes/popular.tsx")` in `app/routes.ts` after
  `offers`. Tests in `popular.test.ts`: only known families are passed (max 3, unknown dropped),
  the page param is parsed and clamped, meta in uk/en, canonical URL, `shouldRevalidate`.
- [x] **7. Header and mobile menu** — Add `BESTSELLERS_LINK` to `nav.ts`, and a `NavLink` item
  between `CatalogMenu` and Offers in `Header.tsx`, and between the catalogue list and Offers in
  `MobileMenu.tsx`, with `navItemClasses(isActive)` / `navItemClasses(isActive, "onLight")`. Update
  `Header.test.ts`: the order test (About, Catalog, Bestsellers, Offers, Contacts), the hrefs test
  (`/popular`), and a "highlights Bestsellers on the popular page" test checking the active classes
  and `aria-current="page"`, including with `?family=…&page=2`, plus the same in the mobile menu.
  Check the header at 768px and 375px for wrapping.
- [x] **8. i18n and seed** — `nav.bestsellers` ("Бестселери" / "Bestsellers") and a `popular`
  namespace (`title`, `metaTitle`, `metaDescription`, `intro`, `filteredBy`, `removeFamily` with
  `{family}`, `showAll`, `empty.heading`, `empty.text`, `empty.filteredText`, `browseWomen`,
  `browseMen`, plus any copy the artboard adds) in `uk.ts` and `en.ts`. Seed: write
  `seed-catalog.ts` from `makrtextfiles/catalog.md` as described in Decisions (fresh UUID v7s from
  `select uuidv7()`, placeholder sizes per Q5, ranks per Q7, the family fixes in the header comment;
  look-alike entries stay separate products, Q8), include it in `SAMPLE_PRODUCTS`, and give the three overlapping samples their
  store codes, the owner's families and notes and their ranks. In `seedProducts` add the backfill
  (store codes where `null`; ranks only while no product has one). `seed.test.ts`: every seed
  product's families are in `FRAGRANCE_FAMILIES` and its sizes in `PERFUME_VOLUMES_ML`; `publicId`s
  are unique; ranks 1–30 are unique; a fresh seed lists 30 ranked products; a re-seed doesn't
  override a rank staff changed.
- [ ] **9. Docs** — `app/.server/AGENTS.md`: a bullet on `products.popular_rank` (staff order on
  `/popular`, nullable, not unique, synced from Strapi's `popularRank`; the ranking, the one-page
  top-up and the pagination) and on `seed-catalog.ts` (the owner's catalogue with placeholder
  prices). Make sure `docs/design.md` (step 1) matches the built page.
- [ ] **10. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; then the manual
  checks below.

## Testing & verification
- **Unit/render:** `cms-sync.test.ts` (schema), `lib/popular.test.ts`, `trio.test.ts`,
  `popular-ui.test.ts`, `routes/popular.test.ts`, `Header.test.ts`, `seed.test.ts`,
  `middleware.test.ts` (Strapi side), `cms-push.test.ts`.
- **DB integration** (with a database configured): `services/popular.test.ts`,
  `bestsellers.test.ts` (unchanged after the refactor), `cms-sync.test.ts`, `migrator.test.ts`,
  `seed.test.ts`.
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **Manual** (`pnpm aspire run`, `pnpm db:seed`, `pnpm db:sync-cms --all`): `/popular` shows the 30
  popular perfumes on 3 pages; in the Strapi admin set, change and clear a product's popular
  position and see `/popular` reorder; archive a ranked product and see it disappear; click "Order
  Now" on `/` and the header's "Bestsellers" (desktop and mobile menu, marked current); pick three
  families in "Build your trio" → "Show my trio" lands on the filtered list, and its pagination keeps
  the families; add a card to the cart and see "Added to cart" and the header count; compare with
  the artboard at 1440px and 375px (no horizontal scroll); switch to English; turn on
  `prefers-reduced-motion: reduce` and check nothing animates.

## Acceptance criteria
- [ ] A `PopularPlus` artboard (desktop and phone) exists on the C+ canvas and is approved by the owner — step 1
- [ ] `/popular` lists the popular perfumes in the staff-defined order, topped up from bestsellers, and matches the artboard at desktop and 375px widths — steps 4, 5, 6, 10
- [ ] Staff can set and change a product's popular position in the Strapi admin, and it is saved to PostgreSQL — steps 2, 3
- [ ] The header (desktop and mobile menu) has a button linking to `/popular` ("Bestsellers", per the owner), marked current on that page — step 7
- [ ] The home hero's "Order Now" button leads to `/popular` — already linked (#64); works once step 6 adds the route; `POPULAR_PATH` reuse in step 5
- [ ] Cards support add to cart with the "Added to cart" toast — steps 5, 6
- [ ] Only C+ tokens are used; all copy is in `uk.ts` and `en.ts`; animations stop with `prefers-reduced-motion: reduce` — steps 1, 5, 8
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 10
- [ ] (comment) `/popular?family=…` (up to 3) shows the popular perfumes with any of those families, and the design covers the filtered state — steps 1, 4, 5, 6
- [ ] (owner) The list is paginated — steps 4, 5, 6
- [ ] (owner) The owner's catalogue is in the seed, with its 30 popular perfumes ranked — step 8

## Out of scope
- A new design system, tokens or fonts; changes to the catalogue pages or the footer (unless the
  approved artboard adds a link).
- The home page's own `Bestsellers` section beyond sharing the sold-units subquery (#64).
- Sorting or other filters on `/popular` beyond the trio's `family` params and the page.
- Making `popular_rank` or `store_code` unique (#66), or a drag-and-drop ordering UI in Strapi.
- Real prices, stock, descriptions and images for the owner's catalogue, and loading it into
  production (Q5, Q9).
