# Plan: Build men's and women's catalog and product detail routes (#8)

Issue: https://github.com/savchukolgaa/jassmin/issues/8
Branch: `issue/8`
Worktree: `../jassmin-worktrees/issue-8`
Status: Planned

## Goal
Shoppers can browse perfumes on separate, server-rendered catalog pages for men (`/catalog/men`)
and women (`/catalog/women`). They can filter by fragrance family and brand, sort by price or
newest, and page through the results, all through URL search params so the pages are shareable and
work without JS. Each product opens a detail page (`/products/:id`) with the full description,
stock status and an "Add to cart" button. All data is loaded in route `loader`s.

## Dependencies & prerequisites
- **#3 (closed):** `products` table, `gender_type` enum, `GENDERS` / `Gender` in `app/lib/enums.ts`,
  seed data (`SAMPLE_PRODUCTS`, 9 products across men/women/unisex, one with `stockQuantity: 0`).
  This is everything the queries need.
- **#6 (closed):** `/catalog/:gender` → `routes/catalog.tsx` and `/products/:id` →
  `routes/product.tsx` are already registered as placeholders under the `_shop` layout. The
  `_shop` `ErrorBoundary` and `describeRouteError` / `ErrorContent` exist.
- **#10 (open):** the cart `action` doesn't exist yet. "Add to cart" posts to `/cart`, so this plan
  adds a minimal stub `action` there (see Q2).
- **#18 / #5 (open):** the analytics tables and `trackEvent` don't exist yet, so no
  `product_view` / `search` events are recorded here. The plan leaves a marked hook in each loader.
- **#27 (open):** C+ design tokens (deep pink `#C22F4B`, Manrope, pill buttons, `ink`/`blush`/
  `card`/`line` colours) aren't on `main` yet. Lay pages out after the canvas pages "C+ Catalog" and
  "C+ Product". Use only the tokens that exist today (`primary`, `Button`, `ButtonLink`), so #27's
  restyle picks them up. If #27 merges first, rebase and use its tokens.
- **#26 (open):** will move price/stock to `product_variants` later. Keep the DTO mapping in one
  place (`services/products.ts`) so #26 only changes it there.
- No new packages, env vars or migrations. `zod` and `drizzle-orm` are already installed.

## Decisions & assumptions
- **Keep the existing route files.** `routes/catalog.tsx` and `routes/product.tsx` stay as they
  are. Don't rename them to `catalog.$gender.tsx` / `products.$id.tsx` (the issue's names), because
  `app/routes.ts` and `app/routes.test.ts` already point at them.
- **Unisex products appear in both catalogs** (confirmed, Q1). The query is
  `gender in (<catalog gender>, 'unisex')`.
- **`:id` is the product's `public_id` (UUID v7), not the serial `id`.** An `:id` that isn't a valid
  UUID is a 404 without a DB query.
- **Search params** (all optional) are parsed by a pure zod schema in `app/lib/catalog.ts`.
  Invalid values fall back to their defaults via `.catch()`, so a bad URL never errors:
  - `fragrance_family`: string, trimmed, max 100 chars, empty → undefined.
  - `brand`: string, trimmed, max 255 chars, empty → undefined.
  - `sort`: `price_asc | price_desc | newest`, default `newest`.
  - `page`: integer ≥ 1, default 1.
  - One value per filter (a single `<select>` each). Multi-select is out of scope.
- **Sorting:** `price_asc` → `price asc, id asc`; `price_desc` → `price desc, id asc`; `newest` →
  `created_at desc, id desc`. The `id` tie-breaker keeps pagination stable.
- **Page size: 12** (`CATALOG_PAGE_SIZE`). A page past the last one shows the empty state and a
  link back to page 1, not a 404.
- **Filter options** are the distinct `brand` / `fragrance_family` values within the catalog's
  gender scope (men + unisex, or women + unisex), sorted alphabetically. They're loaded in parallel
  with the page query.
- **Money:** `price` stays a string end to end. `formatPrice` in `app/lib/money.ts` formats it for
  display only, with `Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH",
  minimumFractionDigits: 0, maximumFractionDigits: 2 })`, so `"6850.00"` → `6 850 ₴`. Nothing does
  arithmetic on it.
- **Volume label:** `50 ml`, or `3 × 10 ml` when `packSize > 1` (`formatVolume` in
  `app/lib/products.ts`).
- **DTOs** live in `app/lib/products.ts` (isomorphic):
  - `ProductSummary`: `id` (publicId), `title`, `brand`, `gender`, `price`, `volumeMl`,
    `packSize`, `imageUrl`, `inStock`.
  - `ProductDetail`: everything in `ProductSummary` plus `description`, `fragranceFamily` and
    `stockQuantity`.
  - The serial `id` and `createdAt` never leave the server.
- **Images:** seeded products have no `image_url`, so `ProductImage` renders a neutral placeholder
  with the brand initial when `imageUrl` is null. It's lazy-loaded, has a fixed aspect ratio and
  uses the title as `alt`.
- **Add to cart:** `AddToCartForm` is a `fetcher.Form method="post" action="/cart"` with hidden
  `intent=add` and `productId=<publicId>`. Its button is disabled when the product is out of stock
  and shows `loading` while `fetcher.state !== "idle"`. It's used both on the card and on the
  detail page.
- **Pending UI:** while `useNavigation()` is loading the same pathname (filter, sort or page
  change), the catalog grid gets `aria-busy="true"` and reduced opacity. A JS-only `onChange`
  submit isn't added. There's an explicit "Apply" submit button, so the form works without JS.
- **Error boundaries:** `catalog.tsx` and `product.tsx` each export an `ErrorBoundary` that renders
  `ErrorContent` with `describeRouteError(error)`. The product page overrides the 404 details with
  "This perfume could not be found." and a link back to the catalogs. The `_shop` layout keeps the
  header.
- **`meta`:**
  - Catalog: `"<Men|Women> Perfumes — Jassmin"`.
  - Product: `"<title> — <brand> — Jassmin"` plus `description` (first 160 chars of the
    description). When `loaderData` is missing (error), fall back to `"Jassmin"`.
- **UI language:** labels are in English, matching the existing header ("Men Perfumes", "Add to
  cart", "In stock", "Out of stock"). Product content stays as seeded (Ukrainian).

## Resolved questions
- **Q1: Do unisex products appear in both the men's and the women's catalog?** Yes:
  `gender in (<g>, 'unisex')`, via the `GENDER_SCOPE` mapping in `services/products.ts`. (source:
  confirmed by the issue owner, 2026-10-23)
- **Q2: What should "Add to cart" do before #10 lands?** A minimal `action` in `routes/cart.tsx`
  validates `{ intent: "add", productId: uuid }` with zod and returns a typed
  `{ ok: false, error: "cart-unavailable" }`. `AddToCartForm` shows "Cart coming soon" for that
  result, and #10 replaces the action body. (source: confirmed by the issue owner, 2026-10-23)
- **Q3: Should #8 also add a `/catalog/unisex` page?** No, it's out of scope. Unisex products are
  covered by Q1. (source: confirmed by the issue owner, 2026-10-23)
- **Which route files do the catalog and product pages use?** `routes/catalog.tsx` and
  `routes/product.tsx`, already registered for `catalog/:gender` and `products/:id`. (source:
  `app/routes.ts`, `app/routes.test.ts`)
- **Is `:id` the serial id or the public id?** `public_id` (UUID v7) is the stable external key,
  and `id` stays the FK target. (source: `app/.server/AGENTS.md` → Database,
  `app/.server/db/schema.ts`)
- **How is money handled?** `price` is `numeric(10,2)` and comes back as a string, so never use
  floats. (source: `app/.server/AGENTS.md`)
- **How is volume shown for the tester set?** The total is `packSize * volumeMl`, and `volumeMl` is
  per unit. (source: `app/.server/AGENTS.md`, `seed-data.ts`)
- **Where do queries vs. business rules go?** Small typed queries go in `db/queries/<area>.ts`,
  orchestration in `services/`. (source: `app/.server/AGENTS.md`)
- **How is a 404 thrown and rendered?** `throw data(null, { status: 404 })` (as in the current
  `catalog.tsx`), rendered by `describeRouteError` + `ErrorContent`. (source:
  `app/routes/catalog.tsx`, `app/lib/route-error.ts`)
- **Which design should the pages follow?** C+ canvas pages "C+ Catalog" and "C+ Product". (source:
  #27, project memory)
- **How are DB integration tests written?** `describe.skipIf(!hasDatabase)`, a throwaway DB from
  `createTestDatabase`, `migrateLatest`, `seedProducts`, dynamic imports. (source:
  `app/.server/db/seed.test.ts`, `app/.server/AGENTS.md`)
- **How are components tested?** `renderToStaticMarkup` + `MemoryRouter` in `*.test.ts` (node
  environment, no `.tsx` tests). (source: `app/components/layout/Header.test.ts`,
  `vitest.config.ts`)
- **Should events be recorded?** Not yet. #18 and #5 are open and `trackEvent` doesn't exist.
  (source: #18, codebase)

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `app/lib/catalog.ts` | `CATALOG_GENDERS` (`men`, `women`), `CatalogGender`, `isCatalogGender`, `CATALOG_SORTS`, `CatalogSort`, `CATALOG_PAGE_SIZE`, zod `catalogSearchSchema` + `parseCatalogSearch(URLSearchParams)`, `catalogPageHref(params, page)` |
| create | `app/lib/catalog.test.ts` | Tests for search param parsing and fallbacks and for page hrefs |
| create | `app/lib/products.ts` | `ProductSummary`, `ProductDetail`, `CatalogPage` DTOs, `formatVolume` |
| create | `app/lib/products.test.ts` | `formatVolume` tests |
| create | `app/lib/money.ts` | `formatPrice(price: string)` |
| create | `app/lib/money.test.ts` | `formatPrice` tests (whole, fractional, thousands separator) |
| create | `app/.server/db/queries/products.ts` | `listProducts`, `countProducts`, `listFilterOptions`, `findProductByPublicId` (Drizzle query builder, `db`/`tx` param) |
| create | `app/.server/services/products.ts` | `getCatalogPage(gender, search)`, `getProduct(publicId)`: gender scope, pagination, mapping to DTOs |
| create | `app/.server/services/products.test.ts` | DB integration tests on a throwaway seeded DB |
| create | `app/features/catalog/ProductCard.tsx` | Card: image, brand, title, volume, price, link to detail, `AddToCartForm` |
| create | `app/features/catalog/ProductImage.tsx` | Image with placeholder fallback |
| create | `app/features/catalog/CatalogFilters.tsx` | `<Form method="get">` with family/brand selects, sort select, Apply and Reset |
| create | `app/features/catalog/Pagination.tsx` | Prev/next + page links built with `catalogPageHref` |
| create | `app/features/catalog/StockStatus.tsx` | "In stock" / "Only N left" / "Out of stock" badge |
| create | `app/features/cart/AddToCartForm.tsx` | `fetcher.Form` posting `intent=add` to `/cart` |
| create | `app/features/catalog/catalog-ui.test.ts` | Static-markup tests for `ProductCard`, `CatalogFilters`, `Pagination`, `AddToCartForm` |
| modify | `app/routes/catalog.tsx` | Real `loader`, `meta`, page UI, pending state, `ErrorBoundary` |
| modify | `app/routes/product.tsx` | `loader` (404 on unknown/invalid id), `meta`, detail UI, `ErrorBoundary` |
| modify | `app/routes/cart.tsx` | Stub `action` for `intent=add` (Q2) |

## Steps
Each step is small, ordered and leaves the app working.

- [x] **1. Shared catalog types and helpers.**
  - Create `app/lib/catalog.ts`:
    - Move `isCatalogGender` and the titles out of `routes/catalog.tsx` (`CATALOG_TITLES`).
    - `CATALOG_SORTS = ["newest", "price_asc", "price_desc"] as const`.
    - `catalogSearchSchema`, a zod object with `.catch()` defaults.
    - `parseCatalogSearch(params: URLSearchParams): CatalogSearch`.
    - `catalogPageHref(search, page)`, which keeps the other params and drops defaults.
  - Create `app/lib/money.ts` (`formatPrice`) and `app/lib/products.ts` (DTOs, `formatVolume`).
  - Add the three `*.test.ts` files.
  - Check: `pnpm test` and `pnpm typecheck`.

- [x] **2. Product queries.** Create `app/.server/db/queries/products.ts`, taking `db: Db` (default
  the shared `db`):
  - `listProducts(db, { genders, fragranceFamily?, brand?, sort, limit, offset })` uses
    `inArray(products.gender, genders)` and optional `eq` filters, `orderBy` per sort (see
    Decisions), and selects only the summary columns plus `publicId`.
  - `countProducts(db, sameWhere)` uses `db.$count(products, where)`.
  - `listFilterOptions(db, genders)` runs two `selectDistinct` queries (`brand`, and non-null
    `fragranceFamily`), ordered ascending.
  - `findProductByPublicId(db, publicId)` returns the detail columns or `undefined`.
  - Build the `where` once in a shared helper so the count and the list can't drift.

- [x] **3. Products service.** Create `app/.server/services/products.ts`:
  - `GENDER_SCOPE: Record<CatalogGender, Gender[]> = { men: ["men", "unisex"], women: ["women",
    "unisex"] }` (Q1).
  - `getCatalogPage(gender, search): Promise<CatalogPage>` runs the list, count and filter options
    with `Promise.all`. It returns `{ products: ProductSummary[], total, page, pageCount,
    filterOptions: { brands, fragranceFamilies } }`. `pageCount` is at least 1, and
    `offset = (page - 1) * CATALOG_PAGE_SIZE`.
  - `getProduct(publicId): Promise<ProductDetail | null>`.
  - Map rows to DTOs in `toSummary` / `toDetail`, with `inStock = stockQuantity > 0`. This is the
    single place #26 changes.
  - Write `services/products.test.ts` (integration, `skipIf(!hasDatabase)`, `createTestDatabase`,
    `migrateLatest`, `seedProducts`). To run against the throwaway DB, the service functions take
    an optional `db` argument (default the shared one).
  - Cover:
    - men = men + unisex, women = women + unisex.
    - The brand and family filters.
    - Each sort order.
    - Pagination (`total`, `pageCount`, a page past the end is empty).
    - Filter options are scoped by gender.
    - `getProduct` returns the full product, and `null` for an unknown UUID.

- [x] **4. Catalog loader.** In `routes/catalog.tsx`:
  - `loader({ params, request })`:
    - `isCatalogGender(params.gender)`, else `throw data(null, { status: 404 })`.
    - `const search = parseCatalogSearch(new URL(request.url).searchParams)`.
    - Return `{ gender, search, ...(await getCatalogPage(gender, search)) }`.
    - Add the comment `// #18: trackEvent(request, "search", …) when filters are present`.
  - Update `meta`. Keep the placeholder body for now, rendering the count, so the app still works.
  - Check: `pnpm typecheck` shows that `loaderData` is typed through `Route.ComponentProps`.

- [x] **5. Product loader.** In `routes/product.tsx`:
  - `loader({ params })`:
    - `z.uuid().safeParse(params.id)`, and on failure throw a 404.
    - `const product = await getProduct(id)`, and if it's null throw a 404.
    - Return `{ product }`.
    - Add the comment `// #18: trackEvent(request, "product_view", { productId })`.
  - `meta` returns the title and description (see Decisions).
  - `ErrorBoundary` uses the product-specific 404 copy.
  - Check: `/products/not-a-uuid` and an unknown UUID both render the 404 inside the shop layout.

- [ ] **6. Add-to-cart form and cart stub.**
  - Create `app/features/cart/AddToCartForm.tsx` with props `{ productId: string; inStock: boolean;
    size?: ButtonSize }`. It uses `useFetcher<typeof cartAction>()`, hidden inputs for `intent` and
    `productId`, and a `Button` that's `disabled={!inStock}` and has
    `loading={fetcher.state !== "idle"}`. The label is "Add to cart" / "Out of stock". It shows
    `fetcher.data` errors in an `aria-live="polite"` region.
  - In `routes/cart.tsx`, add `action` with the zod schema
    `z.object({ intent: z.literal("add"), productId: z.uuid() })`:
    - Invalid input returns `data({ ok: false, error: "invalid" }, { status: 400 })`.
    - Valid input returns `{ ok: false, error: "cart-unavailable" }` with the comment
      `// Stub until #10`.
  - Import the action's type only (`import type { action as cartAction }`), so no server code
    reaches the client.

- [ ] **7. Catalog UI components.** Create `ProductImage`, `StockStatus`, `ProductCard`,
  `CatalogFilters` and `Pagination` under `app/features/catalog/`:
  - `ProductCard`: an `<article>` with the image and title linking to `/products/:id`, then brand,
    `formatVolume`, `formatPrice` and `AddToCartForm`. It follows the C+ Catalog card layout (large
    radius, brand above title, price prominent).
  - `CatalogFilters`: a `<Form method="get">` with labelled `<select name="fragrance_family">`,
    `<select name="brand">` (each with an "All" empty option) and `<select name="sort">`, all
    defaulting to the current `search`. It has an "Apply" submit button and a "Reset" `Link` to the
    bare pathname. It doesn't send `page`, so changing a filter resets to page 1.
  - `Pagination`: a `<nav aria-label="Pagination">` with Prev/Next and page-number `Link`s built
    with `catalogPageHref`. The current page has `aria-current="page"`, and the nav is hidden when
    `pageCount === 1`.
  - Add `catalog-ui.test.ts`:
    - The card renders the price `6 850 ₴`, `50 ml` and a detail link.
    - The out-of-stock card's button is disabled.
    - Filters have `method="get"` and preselect the current values.
    - The pagination hrefs keep the filters.
    - Use `createMemoryRouter` / `RouterProvider` where a fetcher needs a data router.

- [ ] **8. Catalog page.** Replace the placeholder in `routes/catalog.tsx`:
  - An `<h1>` with the title and a "N perfumes" count, then `CatalogFilters`.
  - A responsive grid of `ProductCard`s (1 col at 375px, 2 at `sm`, 3–4 at `lg`), then
    `Pagination`.
  - Empty state: "No perfumes match these filters" with a reset link.
  - Pending state: `const navigation = useNavigation()`, and set busy when
    `navigation.state === "loading" && navigation.location.pathname === location.pathname`. That
    gives `aria-busy` and `opacity-60 transition-opacity` on the grid.
  - Add an `ErrorBoundary` (generic `describeRouteError`).

- [ ] **9. Product detail page.** In `routes/product.tsx`, following the C+ Product canvas page:
  - The image (left on desktop, top on mobile).
  - Brand, `<h1>` title, fragrance family chip, `formatVolume` and `formatPrice`.
  - `StockStatus` with `stockQuantity` (e.g. "Only 3 left" when ≤ 3), then the description.
  - `AddToCartForm` (size `lg`), disabled when `stockQuantity === 0`.
  - A breadcrumb or back link to the matching catalog: `/catalog/<gender>`, or `/catalog/women`
    for unisex.

- [ ] **10. Verify and polish.**
  - Run `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`.
  - Do the manual checks below and fix any issues.
  - Set the plan's Status to "Implemented".

## Testing & verification
- **Unit tests:**
  - `app/lib/catalog.test.ts`:
    - Defaults.
    - Valid values for each param.
    - Invalid `sort` / `page=abc` / `page=0` / `page=-1` fall back.
    - Empty strings become undefined.
    - Over-long values are dropped.
    - `catalogPageHref` keeps filters and omits `page=1`.
  - `app/lib/money.test.ts`: `"6850.00"` → `6 850 ₴` (allow for the narrow no-break space by
    normalising whitespace), and `"990.50"`.
  - `app/lib/products.test.ts`: `formatVolume` for single units and packs.
  - `app/features/catalog/catalog-ui.test.ts`: static-markup checks (see step 7).
  - The `cart` action stub: invalid input → 400, valid input → `cart-unavailable` (in
    `app/routes/cart.test.ts`, calling `action` with a `Request` carrying `FormData`).
- **Integration tests:** `app/.server/services/products.test.ts` on a throwaway seeded DB (see
  step 3).
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`.
- **Manual checks** (`pnpm aspire run`, `pnpm db:seed`):
  - Server-rendered data:
    - `curl -s localhost:<port>/catalog/men` contains "Sauvage" and "Molecule 01" (unisex) but not
      "J'adore".
    - `curl` on `/products/01a1652b-6e25-7c44-8d5b-bce46a20ad83` contains the full description.
  - With JS disabled in DevTools:
    - Changing the sort or a filter and clicking Apply updates the URL (`?sort=price_asc&brand=Dior`)
      and the results.
    - Pagination links work.
  - With JS on, the grid dims while a filter change loads.
  - `/catalog/unisex`, `/catalog/foo`, `/products/123` and an unknown UUID render a 404 with the
    header.
  - Acqua di Giò (stock 0) shows "Out of stock" with a disabled button, on the card and on the
    detail page.
  - Clicking "Add to cart" doesn't navigate and shows the stub message.
  - The layout works at 375px with no horizontal scroll.
  - Tab order and labels on the filters are accessible.

## Acceptance criteria
- [ ] `/catalog/men` shows only men's (and unisex) products; same for
  `/catalog/women`. Steps 2, 3, 4, 8.
- [ ] Product data is present in the server-rendered HTML. Steps 4, 5, 8, 9 (manual `curl` check).
- [ ] Filtering and sorting are reflected in the URL and work without JS. Steps 1, 7, 8.
- [ ] The product detail page shows full info and stock status, and unknown ids show a 404.
  Steps 5, 9.
- [ ] Loader data is typed via generated route types. Steps 4, 5 (`Route.LoaderArgs` /
  `Route.ComponentProps`, `pnpm typecheck`).

## Out of scope
- Recording `product_view` / `search` events (#18). Only marked hooks are left.
- A real cart, with add, update, the header badge count and stock validation (#10). Only a stub
  `action` is added.
- Volume variants and "from ₴…" pricing (#26).
- C+ theme tokens, Manrope, the pill buttons and the footer (#27).
- A `/catalog/unisex` page (Q3), free-text search, multi-select filters and price-range filters.
- Product images and image upload (#16).
