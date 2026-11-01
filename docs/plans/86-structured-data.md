# Plan: Add schema.org structured data for products, breadcrumbs, the store and blog posts (#86)

Issue: https://github.com/savchukolgaa/jassmin/issues/86
Branch: `issue/86`
Worktree: `.claude/worktrees/issue-86`
Status: Planned

## Goal
Shoppers searching on Google should see Jassmin's price, availability, store address and breadcrumbs
right in the results. Add typed schema.org JSON-LD: `Product` + `Offer`s on product pages,
`BreadcrumbList` on product, catalog and blog post pages, `PerfumeStore` + `WebSite` on the home
page, and `BlogPosting` on blog posts. All builders live in one isomorphic module, and one
`<JsonLd>` component renders them safely.

## Dependencies & prerequisites
- **#85 (canonical URLs, `PUBLIC_SITE_URL`)**: open, not on `origin/main`. JSON-LD needs absolute
  URLs. Until #85 lands, the plan uses the request origin, as `routes/blog-post.tsx` already does
  for `seo.canonicalUrl`. All of it goes through one place (step 2), so switching to #85's origin
  is a one-line change. See Q1.
- **#83 (product slugs) / #84 (locale-prefixed URLs)**: open. URLs are built with the existing
  path helpers (`catalogHref`, `blogPostHref`, plus a new `productHref`), so whichever of these
  merges first only changes those helpers.
- Product data (#26, #74) and store code (`products.store_code`, #65): present. The code is not
  in `ProductDetail` yet (step 3).
- Store location and contacts (#43, #64): present. `home-page.location` has `address` and
  `openingHours` as **free text**. `site-settings` has `phone`, `email` and `socialLinks`. There
  are no coordinates (see Q2/Q3).
- No new packages, env vars or migrations.

## Decisions & assumptions
- **Module**: `app/lib/structured-data.ts` (isomorphic, no server imports). It holds small
  hand-written schema.org types (`JsonLdThing`, `ProductLd`, `OfferLd`, `BreadcrumbListLd`,
  `PerfumeStoreLd`, `WebSiteLd`, `BlogPostingLd`; no `any`, no `schema-dts` dependency) and pure
  builders that return plain objects, with `@context: "https://schema.org"` on the root. The
  module also exports `serializeJsonLd(data)`: `JSON.stringify` with every `<` replaced by
  `<` (plus U+2028/U+2029 escaped for safety).
- **Rendering**: `app/components/JsonLd.tsx` exports `<JsonLd data={…} />`, which renders
  `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}>`
  with a `biome-ignore` comment like the one in `root.tsx`. It is rendered in the route
  **component**, not through `meta`'s `script:ld+json`, so the escaping is ours and tested.
  Google reads JSON-LD in `<body>`.
- **Where data is built**: in the route component, from `loaderData` plus `useT()` (breadcrumb
  names and volume labels come translated). Loaders only add what the client lacks: `origin`, and
  for the product `storeCode`.
- **Absolute URLs**: `absoluteUrl(origin, path)` in `structured-data.ts`. Relative image URLs
  (from Strapi or `products.image_url`) resolve against the origin; absolute ones stay as they are.
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
- **Address (unconfirmed, Q2)**: the CMS stores one string. The builder puts it whole into
  `PostalAddress.streetAddress` with `addressCountry: "UA"`. If the last comma-separated part is a
  5-digit postcode and the one before is not numeric, it fills `postalCode` and `addressLocality`.
  For example, `вул. Хрещатик, 1, Київ, 01001` gives street `вул. Хрещатик, 1`, locality `Київ` and
  postcode `01001`. `address` is the only required LocalBusiness field, so the fallback is still
  valid.
- **Opening hours (unconfirmed, Q3)**: `parseOpeningHours(text)` turns lines such as
  `Пн–Пт 10:00–20:00` / `Mon–Fri 10:00–20:00` / `Сб 11:00–18:00` into schema.org strings
  (`Mo-Fr 10:00-20:00`). It accepts uk and en day abbreviations and `-`, `–`, `—` as dashes. Lines
  it can't parse are dropped, and if none parse the property is omitted (it's only recommended).
- **Breadcrumbs**: `breadcrumbList(origin, items: { name, path }[])`; the last item keeps its
  `item` URL. The trails are:
  - Product: Home > Women's/Men's catalog (via the existing `catalogOf(gender)`) > product title.
  - Catalog: Home > catalog title. The URL has no query string, so filters/pages don't leak.
  - Blog post: Home > Blog > post title.

  "Home" needs a new key `nav.home` (uk `Головна`, en `Home`).
- **Visible breadcrumbs (unconfirmed, Q4)**: a shared `app/components/layout/Breadcrumbs.tsx`
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
- **Snapshot tests** use inline snapshots (`toMatchInlineSnapshot`) so the expected JSON is
  reviewable in the diff.

## Open questions
- [ ] **Q1: Wait for #85, or ship with the request origin?** Why it matters: #85 forbids trusting
  the `Host` header for absolute URLs. The blog post route already does that today, though.
  Recommended default: implement with `new URL(request.url).origin` behind one helper and switch to
  #85's `PUBLIC_SITE_URL` (root loader) when it merges; if #85 merges first, use it directly.
  Affects steps: 2, 6–9.
- [ ] **Q2: Add structured address fields (street, city, postcode, coordinates) to the Strapi
  `location` component?** Why it matters: Google's local panel prefers a split `PostalAddress` and
  `geo`, and a single free-text field can only be parsed heuristically. Recommended default: no CMS
  change now; use the heuristic split above and omit `geo`. Affects steps: 4, 8.
- [ ] **Q3: Parse the free-text opening hours, or add structured hours in Strapi?** Why it matters:
  staff may type hours the parser doesn't understand ("щодня", "вихідний"), and then the hours are
  silently dropped from the JSON-LD. Recommended default: parse the common `Days HH:MM–HH:MM`
  form, omit the rest, and document the expected format in the CMS field's description. Affects
  steps: 4, 8.
- [ ] **Q4: Show visible breadcrumbs (replacing the `← catalog` / `← blog` back links)?** Why it
  matters: this is a visible UI change that `docs/design.md` doesn't cover. Recommended default:
  yes, on product, catalog and blog post pages, styled like the current back link. Affects
  steps: 7, 9, 10.

## Resolved questions
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
- **Is there an existing pattern for absolute URLs?** The blog post route uses the request origin
  (`buildBlogPostView(post, { origin: new URL(request.url).origin, … })`) (source:
  `app/routes/blog-post.tsx`).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `app/lib/structured-data.ts` | schema.org types, `serializeJsonLd`, `absoluteUrl`, builders, `parseOpeningHours`, `parsePostalAddress` |
| create | `app/lib/structured-data.test.ts` | builder snapshots, escaping, hours/address parsing |
| create | `app/components/JsonLd.tsx` | `<JsonLd data>` script renderer |
| create | `app/components/JsonLd.test.ts` | renders a script whose text has no raw `<` |
| create | `app/components/layout/Breadcrumbs.tsx` | visible breadcrumb trail (Q4) |
| modify | `app/lib/products.ts` | `storeCode` on `ProductDetail`; `productHref(id)` |
| modify | `app/.server/services/products.ts` | map `storeCode` in `toDetail` |
| modify | `app/lib/cms.ts`, `app/.server/cms/schemas.ts`, `app/.server/cms/content.ts` | read blog post `updatedAt` |
| modify | `app/lib/blog.ts`, `app/.server/services/blog.ts` | `updatedAt` on `BlogPostView` |
| modify | `app/routes/product.tsx` | `origin` in loader; Product + BreadcrumbList JSON-LD; Breadcrumbs |
| modify | `app/routes/catalog.tsx` | `origin` in loader; BreadcrumbList; Breadcrumbs |
| modify | `app/routes/home.tsx`, `app/lib/home.ts`, `app/.server/services/home.ts` | `origin` in view; PerfumeStore + WebSite JSON-LD |
| modify | `app/routes/blog-post.tsx`, `app/features/blog/BlogArticle.tsx` | BlogPosting + BreadcrumbList; Breadcrumbs instead of the top back link |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `nav.home` |
| modify | route/feature tests (`product.test.ts`, `catalog.test.ts`, `home.test.ts`, `blog-post.test.ts`, `blog-ui.test.ts`, `product-ui.test.ts`) | loader `origin`, JSON-LD present, breadcrumbs |

## Steps

- [ ] **1. Serializer and `<JsonLd>`**: in `app/lib/structured-data.ts`, add the base type
  `JsonLdThing` and `serializeJsonLd(data)` (escape `<`, U+2028, U+2029). Add
  `app/components/JsonLd.tsx`. Tests: a `description` containing `</script><script>alert(1)` comes
  out with no `<` and still `JSON.parse`s back to the input; rendering `<JsonLd>` with
  `renderToStaticMarkup` produces a single `<script type="application/ld+json">`.
- [ ] **2. URL helpers**: `absoluteUrl(origin, pathOrUrl)` (keeps `http(s):` URLs, resolves
  `/x` against the origin, strips a trailing slash from the origin). Add `productHref(id)` to
  `app/lib/products.ts` and use it in the existing product links (`ProductCard` etc.), so #83 only
  has to change one function. Unit tests.
- [ ] **3. Store code in the product DTO**: add `storeCode: string | null` to `ProductDetail` and
  map it in `toDetail` (`app/.server/services/products.ts`). Check that `findProductByPublicId`
  selects it, and update fixtures/tests that build `ProductDetail`.
- [ ] **4. Builders**: implement `productLd`, `breadcrumbListLd`, `perfumeStoreGraphLd` (store +
  website `@graph`), `blogPostingLd`, `parseOpeningHours` and `parsePostalAddress` per the
  decisions. Inputs are the existing DTOs (`ProductDetail`, `HomePageView`, `BlogPostView`) plus
  `origin` and already-translated strings. Builders never call `t` themselves, so they stay pure.
  Tests: inline snapshots for each builder (product with two variants, one sold out; product
  without image/description/code; home with and without hours/social links; blog post with and
  without author/image). Also test that availability maps per variant, that a product without
  variants returns `null`, and that no output contains `aggregateRating`. Cover hours parsing for
  uk and en input, `–` and `-`, single days, and unparseable lines.
- [ ] **5. Blog `updatedAt`**: read `updatedAt` (nullish) in the blog post schema, expose it on
  `BlogPost` (`app/lib/cms.ts`) and pass it through `buildBlogPostView` into `BlogPostView`
  (falling back to `publishedAt`). Update `blog.test.ts` and the content tests; the fixtures
  already contain `updatedAt`.
- [ ] **6. Origin in loaders**: product, catalog and home loaders return
  `origin: new URL(request.url).origin` (blog post already has `seo.canonicalUrl`; add `origin`
  to its view too). Use #85's site URL instead if it has merged (Q1). Update the loader tests.
- [ ] **7. `Breadcrumbs` component + `nav.home`**: create `app/components/layout/Breadcrumbs.tsx`
  taking `items: { name: string; to: string }[]`. Add `nav.home` to `uk.ts`/`en.ts`. Component
  test: an `<ol>` trail, the last item has `aria-current="page"` and is not a link.
- [ ] **8. Home page**: render `<JsonLd data={perfumeStoreGraphLd(...)} />` in the home route
  component from `loaderData.location`, `contacts`, `hero` image and `origin`, with `inLanguage`
  from `useT().locale`. Test: the home route renders a JSON-LD script with
  `"@type":"PerfumeStore"`, the CMS phone and the social links.
- [ ] **9. Product and catalog pages**: on the product page, render `productLd` (skipped when
  `null`) and the breadcrumb JSON-LD, and replace the `← catalog` nav with `<Breadcrumbs>`. On the
  catalog page, render the breadcrumb JSON-LD and `<Breadcrumbs>` above the `h1`. Variant names
  use `formatVolume(..., translator)`. Update `product-ui.test.ts` / `catalog-ui.test.ts`.
- [ ] **10. Blog post**: render `blogPostingLd` and the breadcrumb JSON-LD in `BlogPost`. In
  `BlogArticle`, swap the top `BackToBlogLink` for `<Breadcrumbs>` (Home > Blog > title); keep
  `BackToBlogLink` for the error boundary. Update `blog-ui.test.ts`.
- [ ] **11. Verify**: run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`. Run
  `pnpm aspire run`, view the source of a product, catalog, home and blog post page, and paste each
  page's HTML into Google's Rich Results Test (code snippet mode, since localhost isn't
  reachable). Record the results (no errors; any warnings) for the PR description.

## Testing & verification
- Unit: `app/lib/structured-data.test.ts` covers the escaping, `absoluteUrl`, every builder
  (inline snapshots), `parseOpeningHours` and `parsePostalAddress`.
- Component: `JsonLd.test.ts`, the Breadcrumbs test, and the updated product/catalog/blog UI tests
  (a JSON-LD script is present and the breadcrumb trail is visible).
- Route: loaders return `origin`; the product loader's DTO has `storeCode`; the blog view has
  `updatedAt`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: Google Rich Results Test (code snippet) for product, home and blog post pages, plus the
  catalog for breadcrumbs. Also check that a CMS text containing `</script>` doesn't break the page.

## Acceptance criteria
- [ ] Product pages output valid `Product` + `Offer` JSON-LD with UAH prices and correct availability per volume (steps 3, 4, 9)
- [ ] Product, catalog and blog post pages output `BreadcrumbList` (steps 4, 9, 10)
- [ ] The home page outputs the store as `PerfumeStore` with address, hours, phone and social profiles from the CMS (steps 4, 8)
- [ ] Blog posts output `BlogPosting` (steps 4, 5, 10)
- [ ] Google's Rich Results Test shows no errors for these page types (step 11)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass (step 11)

## Out of scope
- Reviews, ratings and `aggregateRating`.
- `SearchAction` (no site search).
- Canonical/Open Graph meta, `PUBLIC_SITE_URL` (#85), slug URLs (#83), locale-prefixed URLs and
  hreflang (#84), and the sitemap.
- Structured address/hours/geo fields in Strapi (Q2/Q3, unless answered yes).
- JSON-LD for `/offers`, `/popular`, the blog list or account pages.
