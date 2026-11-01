# Plan: Add schema.org structured data for products, breadcrumbs, the store and blog posts (#86)

Issue: https://github.com/savchukolgaa/jassmin/issues/86
Branch: `issue/86`
Worktree: `.claude/worktrees/issue-86`
Status: Implemented

## Goal
Shoppers searching on Google should see Jassmin's price, availability, store address and breadcrumbs
right in the results. Add typed schema.org JSON-LD: `Product` + `Offer`s on product pages,
`BreadcrumbList` on product, catalog and blog post pages, `PerfumeStore` + `WebSite` on the home
page, and `BlogPosting` on blog posts. All builders live in one isomorphic module, and one
`<JsonLd>` component renders them safely.

## Dependencies & prerequisites
- **#85 (canonical URLs, `PUBLIC_SITE_URL`)**: open, not on `origin/main`. **Blocking: start
  implementing only after #85 is merged** (Q1). JSON-LD takes every absolute URL from the public
  site origin that #85 adds (`PUBLIC_SITE_URL` in `app/.server/env.ts`, passed through the root
  loader). It never uses the `Host` header or `request.url`. Before step 1, rebase `issue/86` onto
  the `origin/main` that includes #85. Then reuse #85's own origin/absolute-URL helper from
  `app/lib/seo.ts` if it exports one, rather than adding a second one.
- **#83 (product slugs) / #84 (locale-prefixed URLs)**: open. URLs are built with the existing
  path helpers (`catalogHref`, `blogPostHref`, plus a new `productHref`), so whichever of these
  merges first only changes those helpers.
- Product data (#26, #74) and store code (`products.store_code`, #65): present. The code is not
  in `ProductDetail` yet (step 3).
- Store location and contacts (#43, #64): present. `home-page.location`
  (`cms/src/components/home/location.json`, localized) has `address` and `openingHours` as **free
  text**. `site-settings` has `phone`, `email` and `socialLinks`. This plan adds structured address
  fields and coordinates to the Strapi component (Q2, step 3).
- No new packages, env vars or DB migrations. The Strapi component gets new optional fields (no
  PostgreSQL change: home page content lives only in Strapi).

## Decisions & assumptions
- **Module**: `app/lib/structured-data.ts` (isomorphic, no server imports). It holds small
  hand-written schema.org types (`JsonLdThing`, `ProductLd`, `OfferLd`, `BreadcrumbListLd`,
  `PerfumeStoreLd`, `WebSiteLd`, `BlogPostingLd`; no `any`, no `schema-dts` dependency) and pure
  builders that return plain objects, with `@context: "https://schema.org"` on the root. The
  module also exports `serializeJsonLd(data)`: `JSON.stringify` with every `<` replaced by
  `\u003c` (plus U+2028/U+2029 escaped for safety).
- **Rendering**: `app/components/JsonLd.tsx` exports `<JsonLd data={…} />`, which renders
  `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}>`
  with a `biome-ignore` comment like the one in `root.tsx`. It is rendered in the route
  **component**, not through `meta`'s `script:ld+json`, so the escaping is ours and tested.
  Google reads JSON-LD in `<body>`.
- **Where data is built**: in the route component, from `loaderData`, `useT()` (breadcrumb names
  and volume labels come translated) and the site origin from the root loader (#85). Loaders only
  add what the client lacks: the product's `storeCode`.
- **Absolute URLs**: always built from #85's `PUBLIC_SITE_URL` origin (Q1). The helper is #85's own,
  or else `absoluteUrl(origin, path)` in `structured-data.ts`. Relative image URLs (from
  Strapi or `products.image_url`) resolve against that origin; absolute ones stay as they are.
- **Product**: emitted only when the product has at least one variant, because Google reports a
  `Product` without `offers`/`review`/`aggregateRating` as an error. It has one `Offer` per
  variant (not `AggregateOffer`) with:
  - `price` (the decimal string as stored), `priceCurrency: "UAH"`, and
    `availability: https://schema.org/InStock | OutOfStock` from `inStock`.
  - `itemCondition: NewCondition`, `url` = the product's absolute URL, and `name` = `formatVolume`.
  - `seller: { "@type": "Organization", name: "Jassmin" }`.

  The product also gets `sku` = store code when set, `brand: { "@type": "Brand", name }`, `image`
  when present, and `description` when present. **No `aggregateRating`/`review`, ever** (the
  issue says so).
- **Home**: one `@graph` holding:
  - a `PerfumeStore` node (`@id: <origin>/#store`) with `name: "Jassmin"`, `url`, `image` (hero
    image), `telephone`, `email`, `address`, `openingHours` (when parsed), `sameAs` (social link
    URLs) and `hasMap` (`directionsUrl`).
  - a `WebSite` node with `name`, `url`, `inLanguage` and `publisher: { "@id": <origin>/#store }`.

  `PerfumeStore` is a subtype of `Organization`, so it *is* the Organization node; a separate
  `Organization` would duplicate it. No `SearchAction`: the site has no search, only catalog
  filters (`app/routes.ts`).
- **Address and coordinates (Q2: structured fields in Strapi)**: add optional fields to the
  `home.location` component:
  - `streetAddress` (string, max 200), `addressLocality` (string, max 100) and `postalCode`
    (string, max 10).
  - `latitude` and `longitude` (`decimal`, −90…90 / −180…180).

  They're optional, so the existing content stays valid. The existing `address` string stays as
  the visible text and the source of the directions link. The component is localized, so the
  street and city come in the page's language. Staff enter the coordinates in each locale too
  (the seed does). *Deviation:* there is no per-field fallback to the uk coordinates, because that
  would need a second CMS request. An English entry without coordinates just has no `geo`.

  The builder emits a `PostalAddress` with `addressCountry: "UA"` and the structured fields when
  set. When they are empty it falls back to the whole `address` string in `streetAddress`, which
  is still valid because `address` is the only required LocalBusiness field. It emits `geo`
  (`GeoCoordinates`) only when both coordinates are set and in range. zod validates the new
  fields (`z.string().nullish()`, `z.number().min().max().nullish()`), and invalid coordinates
  become `null`, never a 503.
- **Opening hours (Q3: confirmed)**: `parseOpeningHours(text)` turns lines such as
  `Пн–Пт 10:00–20:00` / `Mon–Fri 10:00–20:00` / `Сб 11:00–18:00` into schema.org strings
  (`Mo-Fr 10:00-20:00`). It accepts uk and en day abbreviations and `-`, `–`, `—` as dashes. Lines
  it can't parse are dropped, and if none parse the property is omitted (it's only recommended).
  *Deviation:* Strapi component schemas have no per-field descriptions, so the expected format
  (one range per line, `Пн–Пт 10:00–20:00`) is documented in the `home.location` component's
  description in the admin.
- **Breadcrumbs**: `breadcrumbList(origin, items: { name, path }[])`; the last item keeps its
  `item` URL. The trails are:
  - Product: Home > Women's/Men's catalog (via the existing `catalogOf(gender)`) > product title.
  - Catalog: Home > catalog title. The URL has no query string, so filters/pages don't leak.
  - Blog post: Home > Blog > post title.

  "Home" uses a new key `nav.breadcrumbHome` (uk `Головна`, en `Home`). *Deviation:* `nav.home`
  already exists ("Jassmin, головна", the logo link's label).
- **Visible breadcrumbs (Q4: confirmed)**: a shared `app/components/layout/Breadcrumbs.tsx`
  renders the same items as `<nav aria-label={t("nav.breadcrumb")}><ol>…</ol></nav>` in the
  current product back-link style (`text-sm`, `font-bold text-primary-dark`, `focusRing("onLight")`,
  `/` separators, the last item `aria-current="page"` and not a link). It replaces the `← catalog`
  link on the product page and `BackToBlogLink` at the top of the blog post. On the catalog page it
  goes above the `h1`. `docs/design.md` has no breadcrumb pattern, so this follows the existing link
  tokens.
- **BlogPosting**: `headline` (title, cut to 110 characters on a word boundary), `description`
  (seo description), `image` (seo image, else cover), `datePublished`, `dateModified`, `author`
  (`Person` with `authorName`, else the store `Organization`), `publisher` (Organization `Jassmin`),
  `inLanguage` (`post.locale`) and `mainEntityOfPage` (`seo.canonicalUrl`). `dateModified` needs
  Strapi's `updatedAt`, which the schemas don't read yet (step 5). It falls back to `publishedAt`.
- **Order of work (deviation)**: #85 wasn't merged when implementation started. Steps that don't
  need its origin (1, 3, 3b, 4, 5, 7) were done first. The builders take `origin` as a parameter,
  so they don't depend on where it comes from. The route wiring (steps 2, 6, 8–10) waits for #85.
- **Shared trails**: `app/lib/breadcrumbs.ts` (`catalogBreadcrumbs`, `productBreadcrumbs`,
  `blogPostBreadcrumbs`) builds each page's trail once. The visible `Breadcrumbs` and the
  `BreadcrumbList` JSON-LD both use it, so they can't drift apart. Product links use #83's
  `productHref({ id, slug })`. The visible breadcrumbs of steps 9–10 are done; their JSON-LD
  waits for #85.
- **After #85 (implemented)**: the builders use #85's `absoluteUrl(url, siteUrl)` and
  `SITE_NAME` from `app/lib/seo.ts`; the local URL helper was removed. Components read the origin
  with `useSiteUrl()` (`app/lib/use-site-url.ts`, `seoSite(useMatches())`), so loaders don't
  change. The blog post's `mainEntityOfPage` is `absoluteUrl(blogPostHref(slug), siteUrl)`,
  because #85 removed `seo.canonicalUrl` from the view.
- **Snapshot tests** use inline snapshots (`toMatchInlineSnapshot`) so the expected JSON is
  reviewable in the diff.

## Resolved questions
- **Q1: Wait for #85, or ship with the request origin?** Wait for #85. Implementation starts
  after #85 is merged, and every absolute URL uses its `PUBLIC_SITE_URL` origin (source: user
  answer, 2026-11-01).
- **Q2: Structured address fields and coordinates in Strapi?** Yes. Add optional `streetAddress`,
  `addressLocality`, `postalCode`, `latitude` and `longitude` to `home.location` (source: user
  answer, 2026-11-01).
- **Q3: Parse the free-text opening hours?** Yes. Parse the common `Days HH:MM–HH:MM` form, omit
  the rest, and document the format in the CMS field description (source: user answer, 2026-11-01).
- **Q4: Visible breadcrumbs?** Yes, on product, catalog and blog post pages, replacing the top
  back links (source: user answer, 2026-11-01).
- **Is there site search for `SearchAction`?** No. Routes have no search page, and catalog
  filtering isn't a site search (source: `app/routes.ts`). Omit `potentialAction`.
- **Where is the store code?** `products.store_code` (`storeCode`, #65). It isn't unique, but
  that's fine for `sku` (source: `app/.server/db/schema.ts`).
- **Where do address/hours/phone/social links come from?** Home page `location` (`address`,
  `openingHours`, `mapEmbedUrl`) and `site-settings` (`phone`, `email`, `socialLinks`). Both are
  already in `HomePageView` (`location`, `contacts`) (source: `app/lib/home.ts`,
  `app/.server/cms/schemas.ts`).
- **Which catalog does a unisex product belong to?** The women's catalog (`catalogOf` in
  `app/routes/product.tsx`; there are no unisex catalogs, per project memory).
- **Ratings?** Never; the shop has none (source: issue #86 Context).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `app/lib/structured-data.ts` | schema.org types, `serializeJsonLd`, `absoluteUrl`, builders, `parseOpeningHours` |
| create | `app/lib/structured-data.test.ts` | builder snapshots, escaping, hours parsing, address/geo mapping |
| create | `app/components/JsonLd.tsx` | `<JsonLd data>` script renderer |
| create | `app/components/JsonLd.test.ts` | renders a script whose text has no raw `<` |
| create | `app/components/layout/Breadcrumbs.tsx` | visible breadcrumb trail (Q4) |
| modify | `cms/src/components/home/location.json` | optional `streetAddress`, `addressLocality`, `postalCode`, `latitude`, `longitude`; hours format in the field description |
| modify | `cms/types/generated/components.d.ts` | regenerated Strapi types |
| modify | `cms/scripts/seed.ts` | seed the new fields (uk/en street and city, Kyiv postcode and coordinates) |
| modify | `app/.server/cms/__fixtures__/home-page*.json` | fixture values for the new fields |
| modify | `app/lib/products.ts` | `storeCode` on `ProductDetail`; `productHref(id)` |
| modify | `app/.server/services/products.ts` | map `storeCode` in `toDetail` |
| modify | `app/lib/cms.ts`, `app/.server/cms/schemas.ts`, `app/.server/cms/content.ts` | read blog post `updatedAt` |
| modify | `app/lib/blog.ts`, `app/.server/services/blog.ts` | `updatedAt` on `BlogPostView` |
| modify | `app/routes/product.tsx` | Product + BreadcrumbList JSON-LD; Breadcrumbs |
| modify | `app/routes/catalog.tsx` | BreadcrumbList; Breadcrumbs |
| modify | `app/.server/cms/schemas.ts`, `app/lib/cms.ts`, `app/.server/cms/content.ts` | read the new location fields |
| modify | `app/routes/home.tsx`, `app/lib/home.ts`, `app/.server/services/home.ts` | structured address + geo in `HomePageView.location`; PerfumeStore + WebSite JSON-LD |
| modify | `app/routes/blog-post.tsx`, `app/features/blog/BlogArticle.tsx` | BlogPosting + BreadcrumbList; Breadcrumbs instead of the top back link |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `nav.home` |
| modify | route/feature tests (`product.test.ts`, `catalog.test.ts`, `home.test.ts`, `blog-post.test.ts`, `blog-ui.test.ts`, `product-ui.test.ts`, `content.test.ts`, `home.test.ts` service) | JSON-LD present, breadcrumbs, new CMS fields |

## Steps

- [x] **0. Wait for #85, then rebase**: check that #85 is merged
  (`gh issue view 85 --json state`), then run `git -C "$WT" fetch origin && git -C "$WT" rebase
  origin/main`. Read how #85 exposes the public origin (`PUBLIC_SITE_URL`, the root loader data,
  any helper in `app/lib/seo.ts`) and use that everywhere below. If #85 isn't merged, stop.
- [x] **1. Serializer and `<JsonLd>`**: in `app/lib/structured-data.ts`, add the base type
  `JsonLdThing` and `serializeJsonLd(data)` (escape `<`, U+2028, U+2029). Add
  `app/components/JsonLd.tsx`. Tests: a `description` containing `</script><script>alert(1)` comes
  out with no `<` and still `JSON.parse`s back to the input; rendering `<JsonLd>` with
  `renderToStaticMarkup` produces a single `<script type="application/ld+json">`.
- [x] **2. URL helpers**: reuse #85's absolute-URL helper if there is one. Otherwise add
  `absoluteUrl(origin, pathOrUrl)`, which keeps `http(s):` URLs, resolves `/x` against the origin
  and strips a trailing slash from the origin. Add a site-origin hook for components that reads
  #85's value from the root loader data. Add `productHref(id)` to `app/lib/products.ts` (unless
  #83 already added one) and use it in the existing product links (`ProductCard` etc.). Unit
  tests.
- [x] **3. Structured location fields in Strapi**: add the optional `streetAddress`,
  `addressLocality`, `postalCode`, `latitude` and `longitude` attributes to
  `cms/src/components/home/location.json`, and extend the `openingHours` description with the
  format. Regenerate `cms/types/generated/components.d.ts` with the Strapi typegen. Extend
  `cms/scripts/seed.ts`:
  - uk: `вул. Хрещатик, 1` / `Київ`; en: `1 Khreshchatyk St` / `Kyiv`.
  - Both locales: postcode `01001`, latitude `50.4501`, longitude `30.5234`.

  In the app, extend `locationComponent` in `app/.server/cms/schemas.ts` (nullish strings; nullish
  numbers within range, `.catch(null)` so bad data never 503s). Then carry the fields through
  `app/lib/cms.ts` → `HomePageView.location` (`buildHomePageView`). Update the fixtures and
  `content.test.ts` / the home service tests (fields present, missing, out of range).
- [x] **3b. Store code in the product DTO**: add `storeCode: string | null` to `ProductDetail` and
  map it in `toDetail` (`app/.server/services/products.ts`). Check that `findProductByPublicId`
  selects it, and update fixtures/tests that build `ProductDetail`.
- [x] **4. Builders**: implement `productLd`, `breadcrumbListLd`, `storeGraphLd` (store +
  website `@graph`), `blogPostingLd` and `parseOpeningHours` per the
  decisions. Inputs are the existing DTOs (`ProductDetail`, `HomePageView`, `BlogPostView`) plus
  `origin` and already-translated strings. Builders never call `t` themselves, so they stay pure.
  Tests: inline snapshots for each builder (product with two variants, one sold out; product
  without image/description/code; home with and without hours/social links; blog post with and
  without author/image). Also test that availability maps per variant, that a product without
  variants returns `null`, and that no output contains `aggregateRating`. Cover hours parsing for
  uk and en input, `–` and `-`, single days, and unparseable lines. Test the address with
  structured fields + `geo`, without them (whole-string fallback, no `geo`), and with only one
  coordinate (no `geo`).
- [x] **5. Blog `updatedAt`**: read `updatedAt` (nullish) in the blog post schema, expose it on
  `BlogPost` (`app/lib/cms.ts`) and pass it through `buildBlogPostView` into `BlogPostView`
  (falling back to `publishedAt`). Update `blog.test.ts` and the content tests; the fixtures
  already contain `updatedAt`.
- [x] **6. Site origin in components**: product, catalog, home and blog post components get the
  origin from #85's root loader data (step 2 hook), not from `request.url`. Make sure the blog
  view's `seo.canonicalUrl` already uses that origin after #85; if not, switch
  `buildBlogPostView`'s `origin` to it. Update the tests that render these routes so they provide
  the root data.
- [x] **7. `Breadcrumbs` component + `nav.home`**: create `app/components/layout/Breadcrumbs.tsx`
  taking `items: { name: string; to: string }[]`. Add `nav.home` to `uk.ts`/`en.ts`. Component
  test: an `<ol>` trail, the last item has `aria-current="page"` and is not a link.
- [x] **8. Home page**: render `<JsonLd data={storeGraphLd(...)} />` in the home route
  component from `loaderData.location` (structured address + geo), `contacts`, the `hero` image and
  the site origin, with `inLanguage` from `useT().locale`. Test: the home route renders a JSON-LD
  script with `"@type":"PerfumeStore"`, the CMS phone, the postal address, `geo` and the social
  links.
- [x] **9. Product and catalog pages**: on the product page, render `productLd` (skipped when
  `null`) and the breadcrumb JSON-LD, and replace the `← catalog` nav with `<Breadcrumbs>`. On the
  catalog page, render the breadcrumb JSON-LD and `<Breadcrumbs>` above the `h1`. Variant names
  use `formatVolume(..., translator)`. Update `product-ui.test.ts` / `catalog-ui.test.ts`.
- [x] **10. Blog post**: render `blogPostingLd` and the breadcrumb JSON-LD in `BlogPost`. In
  `BlogArticle`, swap the top `BackToBlogLink` for `<Breadcrumbs>` (Home > Blog > title); keep
  `BackToBlogLink` for the error boundary. Update `blog-ui.test.ts`.
- [x] **11. Verify** (checks and build pass; the Rich Results Test is left for a manual check): run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`. Run
  `pnpm aspire run`, check that the new location fields appear in the Strapi admin (Home page →
  Location) and are seeded, then view the source of a product, catalog, home and blog post page, and paste each
  page's HTML into Google's Rich Results Test (code snippet mode, since localhost isn't
  reachable). Record the results (no errors; any warnings) for the PR description.

## Testing & verification
- Unit: `app/lib/structured-data.test.ts` covers the escaping, `absoluteUrl`, every builder
  (inline snapshots), `parseOpeningHours` and the address/geo mapping.
- Component: `JsonLd.test.ts`, the Breadcrumbs test, and the updated product/catalog/blog UI tests
  (a JSON-LD script is present and the breadcrumb trail is visible).
- Route/service: the product loader's DTO has `storeCode`; the blog view has `updatedAt`; the
  home view carries the structured location fields; every JSON-LD URL starts with #85's
  `PUBLIC_SITE_URL`, never the request host.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: Google Rich Results Test (code snippet) for product, home and blog post pages, plus the
  catalog for breadcrumbs. Also check that a CMS text containing `</script>` doesn't break the page.

## Acceptance criteria
- [x] Product pages output valid `Product` + `Offer` JSON-LD with UAH prices and correct availability per volume (steps 3, 4, 9)
- [x] Product, catalog and blog post pages output `BreadcrumbList` (steps 4, 9, 10)
- [x] The home page outputs the store as `PerfumeStore` with address, hours, phone and social profiles from the CMS (steps 3, 4, 8)
- [x] Blog posts output `BlogPosting` (steps 4, 5, 10)
- [ ] Google's Rich Results Test shows no errors for these page types (step 11)
  — **not verified**: the test needs a publicly reachable page or a pasted HTML snippet in a browser,
  which an agent can't run here. Check it manually after deploying (see the PR).
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass (step 11)

## Out of scope
- Reviews, ratings and `aggregateRating`.
- `SearchAction` (no site search).
- Canonical/Open Graph meta, `PUBLIC_SITE_URL` (#85), slug URLs (#83), locale-prefixed URLs and
  hreflang (#84), and the sitemap.
- Structured opening-hours fields in Strapi (the free text is parsed instead, Q3).
- Showing the new address fields or the coordinates on the visible page; the location section
  keeps using `address` and the map embed.
- JSON-LD for `/offers`, `/popular`, the blog list or account pages.
