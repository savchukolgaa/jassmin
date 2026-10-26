# Plan: Add a Popular perfumes page with a header button and C+ design (#67)

Issue: https://github.com/savchukolgaa/jassmin/issues/67
Branch: `issue/67`
Worktree: `.claude/worktrees/issue-67`
Status: Planned

## Goal
Shoppers get a `/popular` page that lists the store's most popular perfumes, so they can start from
scents other customers love. Staff set the order in the Strapi admin with a per-product "popular"
position, and the page tops itself up from #64's sales-based bestsellers, so it is never empty
while products are listed. A "Popular" button in the C+ header (desktop and mobile menu) and the
home hero's "Order Now" CTA lead to it. The home page's "Build your trio" CTA also links here with
up to three `family` params, which narrow the list (issue comment). The page is designed first as a
`PopularPlus` artboard on the C+ canvas and built after the owner approves it.

## Dependencies & prerequisites
- **#64 (home page), merged** (`ef70ebf`): `listBestsellers` in `app/.server/db/queries/products.ts`,
  `getBestsellers` / `getTrioFamilies` in `app/.server/services/products.ts`, the `compact`
  `ProductCard` variant, the `icon` `AddToCartForm`, and `~/lib/trio` (`TRIO_TARGET_PATH = "/popular"`,
  `parseTrioSearch`, `trioHref`). The hero CTA already points at `/popular`: `FALLBACK_CTA_PATH` in
  `app/lib/links.ts`, `ctaHref: "/popular"` in `cms/scripts/seed.ts` and both
  `app/.server/cms/__fixtures__/home-page*.json`. Today these links 404.
- **#65 (families, notes, store code), merged**: `products.fragrance_families` and
  `familyFilter` (any of the families, `&&`), the end-to-end pattern for adding one product field
  (`storeCode`) through the Strapi sync.
- **#40 (Strapi CMS), merged**: product edits flow through `cms/src/sync/middleware.ts`
  (`productPayload`, `applyProductAnswer`) → `POST /cms/products` → `cmsProductChangeSchema`
  (`~/lib/cms-sync`) → `applyCmsProductChange` (`services/cms-sync.ts`), and back via
  `findProductSyncState` → `toCmsProductState` / `toStrapiProductData` (`services/cms-push.ts`).
- **#27, #10, #28**: header/footer, add to cart with the "Added to cart" status, i18n. All merged.
- **Migration:** `0014_product_popular_rank` with a hand-written rollback. No new packages or env vars.
- **Design canvas** https://claude.ai/artifact/RCvne95y2han2bw8dWm1iW: checked on 2026-10-26, it
  has no `PopularPlus` artboard yet (only `HomeBoldPlus`, `CatalogPlus`, `ProductPlus`,
  `OffersPlus(Phone)`, `AuthPlus`, `AccountPlus`, `AccountProfilePlus(Phone)` in the C+ row).
- **The owner's list of popular perfumes** is not in the repo or the issue yet (see Q1).

## Decisions & assumptions
- **Field shape:** `products.popular_rank integer NULL` with `CHECK (popular_rank > 0)`. `NULL` means
  "not on the popular list"; 1 is first. **Not unique**: staff can renumber products one save at a
  time in Strapi without hitting a constraint, and equal ranks fall back to the bestseller order.
  No index: the catalog is small and the query already scans listed products for bestsellers.
  Strapi field `popularRank` (`integer`, `min: 1`, optional), app field `popularRank` everywhere
  (schema, `ProductWrite`, `cmsProductChangeSchema`, `CmsProductState`, sync middleware).
- **One query, not two:** `listPopularProducts(db, { families, limit })` orders listed products by
  `popular_rank IS NULL, popular_rank, units sold desc, created_at desc, id desc`. Ranked products
  come first in staff order; the rest of the list is exactly #64's bestseller ranking, so the
  "top-up" never repeats a product and needs no merging in JS. The `sold` subquery and its
  `SOLD_ORDER_STATUSES` move into a shared helper used by both `listBestsellers` and the new query,
  so the two rankings can't drift apart. Returns `ProductSummaryRow[]` → `ProductSummary[]` via
  `toSummary`. Inactive products and products without variants are excluded (`isListed`, inner join
  on `variantStats`), and both genders plus unisex are included.
- **Family filter:** the loader reads `family` params with `parseTrioSearch(params, await
  getTrioFamilies())` (known values only, at most `TRIO_SIZE` = 3, deduplicated, in order) and
  passes them to `familyFilter`, so both the ranked part and the top-up are narrowed. Unknown
  families are ignored, so a stale link shows the unfiltered page rather than an error.
- **Page size:** `POPULAR_COUNT = 12` in `services/products.ts`, no pagination **(unconfirmed, Q2)**.
- **Route constant:** `POPULAR_PATH = "/popular"` in a new isomorphic `app/lib/popular.ts`;
  `TRIO_TARGET_PATH` (`~/lib/trio`) and `FALLBACK_CTA_PATH` (`~/lib/links`) reuse it, and a
  `POPULAR_LINK` nav item is added to `app/components/layout/nav.ts` beside `OFFERS_LINK`.
- **Header placement:** between Catalog and Offers, desktop and mobile menu, as a `NavLink` with
  `navItemClasses(isActive)` (React Router sets `aria-current="page"`) **(unconfirmed, Q3 — the
  artboard may style it differently)**. The footer is unchanged.
- **Cards:** the `compact` `ProductCard` with the round `icon` add-to-cart, as in #64's home
  bestsellers, in a 1 / 2 / 4-column grid **(unconfirmed until the artboard is approved)**.
  `AddToCartForm` already shows the "Added to cart" status (`role="status"`, `animate-toast`).
- **Revalidation:** like `routes/home.tsx`, `shouldRevalidate` skips reloading after a POST to
  `/cart`, so adding to the cart doesn't re-run the ranking (the layout still updates the count).
- **No cache headers:** like `/catalog/:gender` and `/products/:id`, the page reads only PostgreSQL;
  it doesn't use the blog's `blogCacheHeaders`.
- **Seed:** sample products in `app/.server/db/seed-data.ts` get placeholder `popularRank`s until
  the owner's list arrives **(unconfirmed, Q1)**. `seedProducts` sets them on existing databases
  only while **no** product has a rank, so it never overrides staff choices. Strapi gets products
  from `pnpm db:sync-cms --all`, not from `cms/scripts/seed.ts`, so the Strapi seed needs no product
  change; its hero `ctaHref` is already `/popular`.
- **Analytics:** no new event; `page_view` is recorded by the `_shop` layout middleware as usual.

## Open questions
- [ ] **Q1: Which perfumes are on the owner's first popular list, in what order, and with what
  details?** — Why it matters: the issue says the owner provides the list "separately"; it is not in
  the repo or on the issue. If it includes perfumes that aren't in `SAMPLE_PRODUCTS`, they need new
  sample products (fixed UUID v7s, families, notes, sizes, prices). Recommended default: rank four
  existing sample products (Coco Mademoiselle 1, Sauvage 2, La Vie Est Belle 3, Molecule 01 4) as
  placeholders, and swap in the owner's list when it arrives; on production staff set the ranks in
  Strapi anyway. Affects steps: 8.
- [ ] **Q2: How many perfumes does `/popular` show, and should it paginate?** — Why it matters:
  sets `POPULAR_COUNT` and whether the page needs the catalog's pagination. Recommended default: 12
  (three rows of four on desktop), no pagination, plus a "whole catalog" link. Affects steps: 1, 4, 5.
- [ ] **Q3: Where does "Popular" sit in the header, and does it look different from the other nav
  items (e.g. a white pill)?** — Why it matters: the desktop nav already holds About, Catalog,
  Offers, Contacts, the language switcher, profile and cart; a fifth item may be tight at `md`
  (768px). Recommended default: a plain nav item between Catalog and Offers; if it doesn't fit at
  `md`, the artboard decides (e.g. move the language switcher into the menu below `lg`). Affects
  steps: 1, 7.
- [ ] **Q4: What does the filtered state (`?family=…` from "Show my trio") show beyond the narrowed
  list?** — Why it matters: shapes the page header and whether the tester-trio offer is repeated.
  Recommended default: the heading stays, the chosen families appear as removable chips
  (`FamilyChip`) with a "Show all popular" link to `/popular`, no trio price block; when no popular
  perfume has those families, an empty state (blush panel like `OffersEmpty`) links to `/popular`
  and the catalogs. Affects steps: 1, 5.

## Resolved questions
- **Does the hero "Order Now" CTA already lead to `/popular`?** — Yes: `FALLBACK_CTA_PATH` is
  `/popular`, the Strapi seed sets `ctaHref: "/popular"` for both locales, and the fixtures and
  `HomePage.test.ts` assert it. Only the route is missing. (source: `app/lib/links.ts`,
  `cms/scripts/seed.ts:138`, `app/.server/cms/__fixtures__/home-page*.json`, #64)
- **"Update #64's plan/fixtures"** — #64's plan was removed when it merged and its fixtures already
  use `/popular`; nothing to update. (source: `ef70ebf`, `app/.server/cms/__fixtures__/`)
- **Is the query called `getBestsellers` in `queries/products.ts`?** — No: the query is
  `listBestsellers(db, limit)` and `getBestsellers` is the service in `services/products.ts`
  (fixed at `BESTSELLER_COUNT = 4`); the new query shares the sold-units subquery instead of calling
  either. (source: `app/.server/db/queries/products.ts`, `app/.server/services/products.ts`)
- **How does the trio CTA link here and which values does it send?** — `trioHref` builds
  `/popular?family=…` with the stored Ukrainian values; `parseTrioSearch` already validates them
  against known families. (source: `app/lib/trio.ts`, issue comment)
- **Does the Strapi seed need products?** — No: Strapi's products come from the app's database via
  `pnpm db:sync-cms --all` (`enqueueAllForCmsSync`). (source: `app/.server/db/scripts/sync-cms.ts`)
- **Unisex?** — Shown together with women and men; no Unisex catalog or link. (source: issue,
  `docs/design.md`)
- **Field shape (left to planning by the issue)** — settled above: `popular_rank`, nullable,
  positive, not unique. (source: issue "exact field shape is settled when this issue is planned")

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | canvas `project/PopularPlus.dc.html`, `project/PopularPlusPhone.dc.html` (+ `canvas.json` entries) | The artboards, desktop and 375px, in the C+ row |
| modify | `docs/design.md` | `C+ Popular` row in "Pages and issues" and a short description |
| modify | `app/.server/db/schema.ts`, `app/.server/db/schema.test.ts` | `popularRank` column and CHECK |
| create | `app/.server/db/migrations/0014_product_popular_rank.sql` (+ `meta/`), `app/.server/db/rollbacks/0014_product_popular_rank.sql` | Migration and rollback |
| modify | `app/.server/db/migrator.test.ts` | Migrate and roll back 0014 |
| modify | `app/.server/db/queries/products.ts` | Shared sold-units subquery, `listPopularProducts`, `popularRank` in `ProductWrite` and `findProductSyncState` |
| modify | `app/.server/services/products.ts` | `POPULAR_COUNT`, `getPopularProducts(families)` |
| create | `app/.server/services/popular.test.ts` | DB integration tests for the ranking |
| modify | `app/lib/cms-sync.ts`, `app/lib/cms-sync.test.ts` | `popularRank` in the change schema and `CmsProductState` |
| modify | `app/.server/services/cms-sync.ts`, `cms-sync.test.ts`, `cms-push.ts`, `cms-push.test.ts` | Write and push `popularRank` |
| modify | `app/routes/cms.products.test.ts` | The route accepts and returns `popularRank` |
| modify | `cms/src/api/product/content-types/product/schema.json`, `cms/types/generated/contentTypes.d.ts` | Strapi `popularRank` field |
| modify | `cms/src/sync/middleware.ts`, `cms/src/sync/middleware.test.ts` | Send and save `popularRank` |
| create | `app/lib/popular.ts` | `POPULAR_PATH`, `PopularPageView` DTO |
| modify | `app/lib/trio.ts`, `app/lib/links.ts` | Reuse `POPULAR_PATH` |
| create | `app/features/popular/PopularPage.tsx` (+ sub-components the artboard needs), `app/features/popular/popular-ui.test.ts` | Page UI and its render tests |
| create | `app/routes/popular.tsx`, `app/routes/popular.test.ts` | Loader, `meta`, `shouldRevalidate`, `ErrorBoundary` |
| modify | `app/routes.ts` | `route("popular", "routes/popular.tsx")` under `_shop` |
| modify | `app/components/layout/nav.ts`, `Header.tsx`, `MobileMenu.tsx`, `Header.test.ts` | "Popular" link with `aria-current` |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `nav.popular`, `popular.*` |
| modify | `app/.server/db/seed-data.ts`, `app/.server/db/seed.ts`, `app/.server/db/seed.test.ts` | Sample ranks and their backfill |
| modify | `app/.server/AGENTS.md` | Document `popular_rank` and the ranking |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [ ] **1. Design the `PopularPlus` artboards and get approval** — On the C+ canvas add
  `PopularPlus.dc.html` (desktop, `expand: "fill"`, w 1440) and `PopularPlusPhone.dc.html` (375 px)
  to the "Chosen direction: Option C+" row, built only from C+ tokens, Manrope, `Button` variants,
  the compact product card and the motion utilities in `docs/design.md`. Show: the header with the
  "Popular" item marked current (Q3), a page header (`h1` + intro), the card grid (Q2), the filtered
  state with family chips and "Show all popular" (Q4, as a `data-props` tweak), and the empty state
  (tweak). Ask the owner to approve before step 5; record the decisions in the plan. Then add a
  `C+ Popular`, `C+ Popular, phone width` | `/popular` | #67 row to `docs/design.md` with a short
  paragraph like the `/offers` one.
- [ ] **2. Add `products.popular_rank`** — In `schema.ts` add `popularRank: integer()` with a doc
  comment (staff order on `/popular`, `null` = not listed there, #67) and
  `check("products_popular_rank_check", sql\`${t.popularRank} > 0\`)`. Run
  `pnpm db:generate --name product_popular_rank`; write
  `rollbacks/0014_product_popular_rank.sql` (`DROP CONSTRAINT`, then `DROP COLUMN`). Update
  `schema.test.ts`'s products column list and add a 0014 case to `migrator.test.ts` (column exists
  and is nullable; a `0` is refused; rollback removes it). Check: `pnpm test`, `pnpm db:migrate` then
  `pnpm db:rollback` and migrate again.
- [ ] **3. Sync the field with Strapi** — `~/lib/cms-sync`: `popularRank:
  z.number().int().min(1).max(9999).nullish().transform((v) => v ?? null)` in `productFields`, and
  `popularRank: number | null` in `CmsProductState`. `ProductWrite` and `productWrite()` in
  `services/cms-sync.ts` carry it; `findProductSyncState` selects it and `toCmsProductState` maps it
  (`toStrapiProductData` spreads it as is). Strapi: add `"popularRank": { "type": "integer", "min": 1 }`
  to the product `schema.json` and regenerate `cms/types/generated/contentTypes.d.ts`
  (`pnpm --dir cms strapi ts:generate-types`, or edit to match); in `cms/src/sync/middleware.ts`
  `productPayload` sends `popularRank` (empty → `null`, else `toNumber`) and `applyProductAnswer`
  saves the app's value. Tests: schema accepts `null`/missing/`3`, refuses `0`, `-1`, `1.5`;
  `applyCmsProductChange` writes and clears it on create/update; `cms.products.test.ts` round-trips
  it; `cms-push.test.ts` and `middleware.test.ts` include it.
- [ ] **4. Query and service for the popular list** — In `queries/products.ts` extract the
  sold-units subquery (`soldUnits(db)`, with `SOLD_ORDER_STATUSES`) and use it in `listBestsellers`
  (no behaviour change; `bestsellers.test.ts` stays green). Add
  `listPopularProducts(db, { fragranceFamilies, limit })`: `summaryColumns`, inner join on
  `variantStats`, left join on `soldUnits`, `where(and(isListed, familyFilter(fragranceFamilies)))`,
  ordered by `${products.popularRank} is null, ${products.popularRank}`, units sold desc,
  `created_at` desc, `id` desc. In `services/products.ts` add `POPULAR_COUNT = 12` and
  `getPopularProducts(families: readonly string[] = [], db = defaultDb): Promise<ProductSummary[]>`.
  Integration tests in `services/popular.test.ts` (pattern of `bestsellers.test.ts`, `skipIf(!hasDatabase)`):
  ranked first in rank order; the rest topped up by units sold then newest, with no duplicates;
  equal ranks fall back to sales; ranked but inactive or variant-less products excluded; unisex,
  men and women all included; the family filter narrows both parts (any of the families); at most
  `POPULAR_COUNT`; empty when nothing is listed.
- [ ] **5. Page UI** — `app/lib/popular.ts`: `POPULAR_PATH` and
  `interface PopularPageView { products: ProductSummary[]; families: TrioFamily[] }` (chosen
  families with labels, via `labelTrioFamilies`, kept in pick order). Point `TRIO_TARGET_PATH` and
  `FALLBACK_CTA_PATH` at `POPULAR_PATH`. `app/features/popular/PopularPage.tsx` per the approved
  artboard: `main` with an `h1` (`popular.title`), intro, the family chips with remove links
  (`trioHref` of the other families) and "Show all popular" when filtered, a `ul` grid of
  `ProductCard variant="compact" headingLevel={2}`, and the empty state (`popular.empty.*`, links to
  `/popular` when filtered and to both catalogs). `animate-fade-up` / `reveal` only as the artboard
  shows; nothing new in `app/app.css` unless the artboard needs it, and then inside the
  reduced-motion block. Render tests in `popular-ui.test.ts`: cards in order with add-to-cart forms,
  filtered chips and their hrefs, empty states, Ukrainian by default and English in
  `<I18nProvider locale="en">`.
- [ ] **6. Route** — `app/routes/popular.tsx`: `loader` gets `getTrioFamilies()`, parses
  `parseTrioSearch(url.searchParams, known)`, then `getPopularProducts(selected)`, and returns the
  view with `labelTrioFamilies(selected, createTranslator(await getLocale(request)))` (sorted back
  into pick order). `meta` via `metaTranslator(matches)`: `meta.title` with `popular.metaTitle`,
  `popular.metaDescription`, `og:*`, and a canonical URL of `/popular` without params.
  `shouldRevalidate` skips POSTs to `/cart` (as in `home.tsx`). `ErrorBoundary` with
  `describeRouteError`. Register `route("popular", "routes/popular.tsx")` in `app/routes.ts` after
  `offers`. Tests in `popular.test.ts`: loader passes known families only (max 3, unknown dropped),
  returns the service's products; meta in uk/en; `shouldRevalidate`.
- [ ] **7. Header and mobile menu** — `POPULAR_LINK = { to: POPULAR_PATH, labelKey: "nav.popular" }`
  in `nav.ts`; a `NavLink` item in `Header.tsx` and `MobileMenu.tsx` at the position from step 1
  (default between Catalog and Offers) with `navItemClasses(isActive)` /
  `navItemClasses(isActive, "onLight")`. Update `Header.test.ts`: the order test, the hrefs test
  (`/popular`), and a "highlights Popular on the popular page" test checking the active classes and
  `aria-current="page"`, plus the same in the mobile menu. Check the header at 768px and 375px for
  wrapping.
- [ ] **8. i18n and seed** — `nav.popular` ("Популярні" / "Popular") and a `popular` namespace
  (`title`, `metaTitle`, `metaDescription`, `intro`, `filteredBy`, `removeFamily` with `{family}`,
  `showAll`, `empty.heading`, `empty.text`, `empty.filteredText`, `browseWomen`, `browseMen`, plus
  any copy the artboard adds) in `uk.ts` and `en.ts`. Seed: `popularRank` on the sample products of
  Q1's default in `seed-data.ts`; in `seedProducts`, after the insert, set the sample ranks when no
  product has `popular_rank` yet; `seed.test.ts` covers both the fresh seed and "doesn't override an
  existing rank".
- [ ] **9. Docs** — `app/.server/AGENTS.md`: a bullet on `products.popular_rank` (staff order on
  `/popular`, nullable, not unique, synced from Strapi's `popularRank`, the ranking and its top-up
  from the sold-units ranking). Make sure `docs/design.md` (step 1) matches the built page.
- [ ] **10. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; then the manual
  checks below.

## Testing & verification
- **Unit/render:** `cms-sync.test.ts` (schema), `popular-ui.test.ts`, `popular.test.ts` (loader,
  meta, revalidation), `Header.test.ts`, `seed.test.ts`, `middleware.test.ts` (Strapi side),
  `cms-push.test.ts`.
- **DB integration** (with a database configured): `services/popular.test.ts`,
  `bestsellers.test.ts` (unchanged after the refactor), `cms-sync.test.ts`, `migrator.test.ts`.
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **Manual** (`pnpm aspire run`, `pnpm db:seed`, `pnpm db:sync-cms --all`): in the Strapi admin set,
  change and clear a product's popular position and see `/popular` reorder; archive a ranked product
  and see it disappear; click "Order Now" on `/` and the header's "Popular" (desktop and mobile menu,
  marked current); pick three families in "Build your trio" → "Show my trio" lands on the filtered
  list; add a card to the cart and see "Added to cart" and the header count; compare with the
  artboard at 1440px and 375px (no horizontal scroll); switch to English; turn on
  `prefers-reduced-motion: reduce` and check nothing animates.

## Acceptance criteria
- [ ] A `PopularPlus` artboard (desktop and phone) exists on the C+ canvas and is approved by the owner — step 1
- [ ] `/popular` lists the popular perfumes in the staff-defined order, topped up from bestsellers, and matches the artboard at desktop and 375px widths — steps 4, 5, 6, 10
- [ ] Staff can set and change a product's popular position in the Strapi admin, and it is saved to PostgreSQL — steps 2, 3
- [ ] The header (desktop and mobile menu) has a "Popular" button linking to `/popular`, marked current on that page — step 7
- [ ] The home hero's "Order Now" button leads to `/popular` — already linked (#64); works once step 6 adds the route; `POPULAR_PATH` reuse in step 5
- [ ] Cards support add to cart with the "Added to cart" toast — steps 5, 6
- [ ] Only C+ tokens are used; all copy is in `uk.ts` and `en.ts`; animations stop with `prefers-reduced-motion: reduce` — steps 1, 5, 8
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 10
- [ ] (comment) `/popular?family=…` (up to 3) shows the popular perfumes with any of those families, and the design covers the filtered state — steps 1, 4, 5, 6

## Out of scope
- A new design system, tokens or fonts; changes to the catalog pages or the footer (unless the
  approved artboard adds a link).
- The home page's own `Bestsellers` section beyond sharing the sold-units subquery (#64).
- Sorting, pagination or other filters on `/popular` beyond the trio's `family` params.
- Making `popular_rank` unique or a drag-and-drop ordering UI in Strapi.
- New sample products beyond the owner's list (Q1).
