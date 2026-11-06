# Plan: Serve a product feed for Google Shopping and Instagram Shopping (#140)

Issue: https://github.com/savchukolgaa/jassmin/issues/140
Branch: `issue/140`
Worktree: `.claude/worktrees/issue-140`
Status: Planned

## Goal

The store owner wants the shop's perfumes in Google Shopping (free listings) and taggable in
Instagram posts. The app serves a product feed in Google's RSS 2.0 format with the `g:` namespace,
with one item per perfume size (price, stock, photo). Google Merchant Center and Meta Commerce
Manager fetch it on a schedule: `/feeds/products.xml` in Ukrainian and `/en/feeds/products.xml` in
English. `docs/product-feeds.md` walks the owner through setting up the accounts.

## Dependencies & prerequisites

All of these are merged on `origin/main`:

- #83/#84: product URLs `/parfumy/<slug>` and `/en/perfumes/<slug>` (`app/lib/paths.ts`,
  `productHref` in `app/lib/products.ts`).
- #86/#87: product JSON-LD (`app/lib/structured-data.ts`), sitemap and robots
  (`app/.server/seo/*`, `app/.server/services/sitemap.ts`). The feed reuses the sitemap's resource
  route pattern and its `escapeXml`.
- #98: five sizes per product in `product_variants`, plus `track_stock` and the `variantStock` SQL
  expression in `app/.server/db/queries/products.ts`.
- #100: `products.description_en`, and `pickDescription` with a fallback to the other language.
- #118: the shop bottle photo (`app/lib/shop-bottle.ts`, WebP in 320–1280 px).
- #126: free delivery from 1500 ₴ (`FREE_SHIPPING_THRESHOLD` in `app/lib/checkout.ts`).
- `PUBLIC_SITE_URL` (`getSiteUrl`) for absolute URLs; it is already required in production.

No new packages, env vars or migrations. One new static asset: a JPEG copy of the bottle photo
(step 1).

## Decisions & assumptions

- **Route.** One module, `app/routes/feeds.products.xml.ts`, registered twice in `app/routes.ts`
  (`feeds/products.xml` with id `feed-products.uk`, `en/feeds/products.xml` with id
  `feed-products.en`), next to `sitemap.xml`. Both routes sit outside `_shop.tsx`, so no session,
  visitor cookie or analytics run, and both come before the `*` catch-all in `redirects.ts`. The
  locale comes from the route id or the path, never from the cookie or `Accept-Language`, so each
  URL always returns the same language.
- **Response.** `Content-Type: application/xml; charset=utf-8`,
  `Cache-Control: public, max-age=3600` (prices and stock stay at most an hour old), and
  `X-Robots-Tag: noindex`. The DB query runs first, so a DB error is still a plain 500. The body is
  then streamed as a `ReadableStream`: the header, one chunk per item, then the footer. At a few
  hundred products × 5 sizes this stays well under Google's 4 GB limit either way.
- **Not indexed, but fetchable.** The issue asks for "excluded from robots.txt indexing but
  fetchable". A robots `Disallow` would also stop Google's and Meta's fetchers: Merchant Center's
  scheduled fetch respects robots.txt. So the feed is **not** added to `ROBOTS_SYSTEM_PATHS`, and
  `X-Robots-Tag: noindex` keeps it out of search results. On staging, `disallowAll` still blocks
  it, which is fine.
- **Which items.** One item per variant of a product with `active = true`, a non-null `slug` (as in
  the sitemap: a slugless product's UUID URL would 301 later) and `price > 0`. Google rejects a
  price of 0. Archived products and products without sizes are left out. The rows are ordered by
  slug, then volume, so the feed is the same on every request.
- **Ids.** `g:id` is `product_variants.public_id`, and `g:item_group_id` is `products.public_id`.
  Both are stable UUIDs, so renaming a slug doesn't create new items.
- **Availability.** `in_stock` when `variantStock > 0`, else `out_of_stock`. Untracked sizes
  always report `UNTRACKED_STOCK`, so they are always `in_stock` (#98).
- **Price.** `"<price> UAH"` straight from the `numeric` string (`"629.00 UAH"`), with no float
  conversion. Pack products (sets of testers, `pack_size > 1`) use the same variant price.
- **Title.** The i18n key `feed.itemTitle`: uk `"{brand} {title} — розпив, {size}"` and en
  `"{brand} {title} — decant, {size}"`. `{size}` is `formatVolume` (`10 мл`, `3 × 2 мл`). The title
  is truncated to 150 characters, Google's limit.
- **Description.** `pickDescription(row, locale)` (falls back to the other language), plain text
  with whitespace collapsed to single spaces, then truncated to 5000 characters on a word
  boundary. `description` is required, so a product without one gets the i18n fallback
  `feed.fallbackDescription`: "Оригінальний аромат {brand} {title}, розлитий у флакон JASSMIN…".
- **Condition and identifiers.** `g:condition` = `new`, and `g:identifier_exists` = `no`
  (decants have no GTIN or MPN).
- **Brand.** `g:brand` is the perfume house (`products.brand`). The title says
  "розпив / decant" and the description states that the perfume is decanted into the shop's
  JASSMIN bottle, so the listing doesn't claim a sealed original. The choice is one constant/function
  (`feedBrand(row)`) in the service, so switching to `JASSMIN` is a one-line change.
- **Images.** `g:image_link` is the product's own photo (its largest Strapi format, else
  `image_url`) when it has one, else the shop bottle photo at 1280 px. When the product has its own
  photo, `g:additional_image_link` is the bottle photo. Otherwise there is no additional image. The
  `/og/products/*.png` share card is never used, because its text overlay breaks Google's image
  policy. The bottle photo is served as a **JPEG** (`shop-bottle-1280.jpg`, new asset): Google
  accepts WebP, but Meta's catalog documentation only lists JPEG/PNG. Absolute URLs come from
  `absoluteUrl(path, siteUrl)`.
- **Category and type.** `g:google_product_category` is `479`. `g:product_type` is
  `"<gender> > <primary family>"`, from the new i18n keys `feed.gender.{men,women,unisex}` and the
  existing `catalog.families.*`. With no family it is just `<gender>`. `g:gender` is
  `male`/`female`/`unisex`, a cheap and useful extra for Google.
- **Size.** `g:size` is `formatVolume` in the feed's locale (`10 мл` / `10 ml`).
- **Shipping.** `g:free_shipping_threshold` is `UA:1500.00 UAH`, from `FREE_SHIPPING_THRESHOLD`.
  `g:shipping` is **left out of the feed**. The recipient pays Nova Poshta's rate
  on receipt, and the shop doesn't know that rate per item. So shipping is set up once as a Merchant
  Center account-level shipping service (Nova Poshta, an estimated rate, free over 1500 UAH), as
  documented in `docs/product-feeds.md`. A fake `0 UAH` in the feed would break Google's shipping
  policy.
- **Channel.** `<title>` and `<description>` come from the i18n keys `feed.channelTitle` and
  `feed.channelDescription`, and `<link>` is the home page in that locale.
- **Code layout** (follows the sitemap split):
  - `app/.server/seo/xml.ts`: `escapeXml` moves here from `seo/sitemap.ts`, which re-imports it.
    It gains `xmlText()`, which also strips characters XML 1.0 forbids (C0 controls except
    tab/LF/CR, and lone surrogates), because CMS text can contain them.
  - `app/.server/seo/product-feed.ts`: the pure builder, `FeedItem` type → XML chunks
    (`productFeedChunks(channel, items)`) plus `buildProductFeedXml` for tests.
  - `app/.server/db/queries/products.ts`: `listFeedVariants(db)`.
  - `app/.server/services/product-feed.ts`: `feedItems(rows, { locale, siteUrl })` (rows → DTOs,
    with translations) and `getProductFeed(siteUrl, locale, deps)`, with injectable deps like
    `getSitemap`.
- **Freshness.** "Within an hour" holds for the URL (max-age 3600). Google and Meta fetch the feed
  daily or hourly. The docs tell the owner to switch on Merchant Center's *automatic item updates*,
  which use the product JSON-LD from #86 to fix price and availability between fetches, and to set
  Meta's schedule to hourly.

## Resolved questions

- **Q1: Should `g:brand` be the perfume house or JASSMIN?** The perfume house (`products.brand`).
  The title and description say plainly that it's a decant ("розпив / decant") poured into a
  JASSMIN bottle, and `identifier_exists=no`. If listings are rejected under the brand rules,
  switch `feedBrand` to `JASSMIN` (source: owner, 2026-11-06).
- **Q2: Should the feed carry a shipping price?** No. There is no `g:shipping`; the feed carries
  `g:free_shipping_threshold` (`UA`, 1500.00 UAH), and the owner sets Nova Poshta shipping once in
  the Merchant Center account settings, as documented (source: owner, 2026-11-06).
- **Q3: Are Google free listings and Instagram Shopping available in Ukraine?** Build the feed as
  planned. `docs/product-feeds.md` starts with an eligibility check for both platforms (source:
  owner, 2026-11-06).
- **How do I get a "price" for each size?** From `product_variants.price` (`numeric`, an exact
  string). `products.price` is deprecated (source: `app/.server/db/schema.ts`, #26).
- **How is stock decided for untracked sizes?** With the `variantStock` SQL expression: untracked
  sizes report `UNTRACKED_STOCK` (source: `app/.server/db/queries/products.ts`, #98).
- **What is a product's canonical link?** `productHref(locale, product)` gives `/parfumy/<slug>` or
  `/en/perfumes/<slug>`. Products without a slug are left out, as in the sitemap (source:
  `app/lib/products.ts`, `listSitemapProducts`, #83/#84/#87).
- **Which products are listed?** Those with `products.active = true` (`isListed`). Archived and
  deleted ones have `active = false` (source: `app/.server/db/schema.ts`, #40).
- **Which description goes in the English feed?** `pickDescription` with the `en` locale:
  `description_en`, falling back to `description` (source: `app/lib/products.ts`, #100).
- **What's the free delivery threshold?** `FREE_SHIPPING_THRESHOLD = "1500.00"`, paid by the
  store above it and by the recipient below it (source: `app/lib/checkout.ts`, #126).
- **Which photo?** The shop bottle (#118). A product's own Strapi photo wins when one exists, like
  `ProductImage` (source: `app/features/catalog/ProductImage.tsx`, and the memory note "shop bottle
  photos are generic").
- **Does the CSP or the nonce affect the feed?** No. The CSP is only added to `text/html` responses
  (`isHtml` in `app/.server/security-headers.ts`, #143). The other security headers are harmless for
  XML.
- **How do absolute URLs work?** `getSiteUrl(getEnv(), request)` gives `PUBLIC_SITE_URL`, falling
  back to the request origin in dev (source: `app/.server/env.ts`, `routes/sitemap.xml.ts`).
- **Should the feed be `Disallow`ed in robots.txt?** No, because the fetchers respect robots.txt.
  It uses `X-Robots-Tag: noindex` instead (see Decisions).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `app/assets/shop-bottle/shop-bottle-1280.jpg` | JPEG copy of the 1280 px bottle photo for the feeds |
| modify | `app/lib/shop-bottle.ts` | Export `SHOP_BOTTLE_FEED_IMAGE_URL` (the JPEG asset URL) |
| create | `app/.server/seo/xml.ts` (+ `xml.test.ts`) | `escapeXml` (moved) and `xmlText` (escape + strip invalid chars) |
| modify | `app/.server/seo/sitemap.ts` (+ test) | Import `escapeXml` from `./xml`; move its test |
| create | `app/.server/seo/product-feed.ts` (+ `.test.ts`) | Pure RSS 2.0 + `g:` builder from `FeedItem`s |
| modify | `app/.server/db/queries/products.ts` (+ `products.test.ts`) | `listFeedVariants(db)` and `FeedVariantRow` |
| create | `app/.server/services/product-feed.ts` (+ `.test.ts`) | Rows → `FeedItem`s (title, description, images, type) and `getProductFeed` |
| create | `app/routes/feeds.products.xml.ts` (+ `.test.ts`) | Resource route: headers and streamed body |
| modify | `app/routes.ts` | Register `feeds/products.xml` and `en/feeds/products.xml` |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `feed` namespace: channel title/description, item title, fallback description, gender labels |
| create | `docs/product-feeds.md` | Owner's setup guide for Merchant Center and Commerce Manager |
| modify | `README.md` / `docs/setup.md` | Link to `docs/product-feeds.md` (one line) |

## Steps

- [x] **1. Bottle photo as JPEG.** Convert `app/assets/shop-bottle/shop-bottle-1280.webp` once to
  `shop-bottle-1280.jpg` (1280×1600, quality ~85, metadata stripped; any local tool such as
  ImageMagick or Squoosh), and commit it. In `app/lib/shop-bottle.ts`, import it and export
  `SHOP_BOTTLE_FEED_IMAGE_URL`. Check: `pnpm build` fingerprints it under `build/client/assets/`.
- [x] **2. XML helpers.** Create `app/.server/seo/xml.ts` with `escapeXml` (moved unchanged) and
  `xmlText(value)`, which strips the forbidden characters and then escapes. `seo/sitemap.ts`
  imports `escapeXml` from it. Move the `escapeXml` test to `xml.test.ts` and add cases for control
  characters and lone surrogates. Check: the sitemap tests still pass.
- [ ] **3. Feed builder.** In `app/.server/seo/product-feed.ts`, define
  `FeedChannel { title; link; description }` and `FeedItem { id; groupId; title; description; link;
  imageLink; additionalImageLinks; price; availability: "in_stock" | "out_of_stock"; brand;
  condition: "new"; productType; googleProductCategory: "479"; gender; size }` and the constants
  (`GOOGLE_NS = "http://base.google.com/ns/1.0"`, `FEED_CATEGORY_PERFUME = "479"`, and
  `freeShippingThreshold`). `productFeedChunks(channel, items, { freeShippingThreshold })` yields
  `<?xml …?><rss version="2.0" xmlns:g="…"><channel>…`, then one `<item>` string per item with every
  text through `xmlText`, then `</channel></rss>`. `buildProductFeedXml` joins the chunks. Tests
  (jsdom `DOMParser`, as in `seo/sitemap.test.ts`): well-formed, `g:` namespace, `Dolce & Gabbana`
  and `<` in titles round-trip, one `<item>` per input, a control character in a description
  doesn't break parsing, and an empty item list is still a valid channel.
- [ ] **4. Query.** Add `listFeedVariants(db)` to `app/.server/db/queries/products.ts`: an inner
  join of `products` and `productVariants`, `where isListed and slug is not null and price > 0`.
  It selects the product's `publicId`, `slug`, `title`, `brand`, `gender`, `fragranceFamily`,
  `packSize`, `description`, `descriptionEn` and image columns, plus the variant's `publicId`,
  `volumeMl`, `price`, and `variantStock` as `stock`. Order by `slug`, then `volumeMl`. Export
  `FeedVariantRow`. Add a DB integration test (`describe.skipIf(!hasDatabase)`, like
  `listSitemapProducts`): archived, slugless and zero-priced rows are left out, there is one row per
  variant, an untracked size with `stock_quantity = 0` reports a positive stock, and a tracked size
  with 0 reports 0.
- [ ] **5. Service.** Create `app/.server/services/product-feed.ts`:
  - `feedItems(rows, { locale, siteUrl })` builds the translator with `createTranslator(locale)`
    and maps each row to a `FeedItem` using the rules in Decisions (`productHref`, `formatVolume`,
    `pickDescription` plus collapse and truncation to 5000, the fallback description, the title
    cut to 150, `feedBrand`, images, `"<gender> > <family>"`, and the `g:gender` mapping).
  - `feedChannel(locale, siteUrl)`.
  - `getProductFeed(siteUrl, locale, deps = { listVariants: () => listFeedVariants(db) })` returns
    the chunk iterable.

  Add uk/en keys under a new `feed` namespace in `app/lib/i18n/uk.ts` and `en.ts`. Unit tests with
  fake rows cover: ids and group ids, `"629.00 UAH"`, availability from stock, uk vs en title, size
  and link (`/parfumy/…` vs `/en/perfumes/…`), the English description falling back to Ukrainian,
  the fallback description when both are empty, truncation at 5000, own photo vs bottle JPEG with
  absolute URLs, product_type with and without a family, and a pack size of 3 giving `3 × 2 мл`.
- [ ] **6. Route.** Create `app/routes/feeds.products.xml.ts`. The `loader({ request })` reads the
  locale from the URL (`/en/` prefix → `en`, else `uk`, using `EN_PREFIX`), awaits the rows, and
  returns `new Response(stream, { headers })` with the headers from Decisions. The `ReadableStream`
  pulls from the chunk iterator through a `TextEncoder`. Register both paths in `app/routes.ts` with
  a comment. Run `pnpm typecheck` to generate `+types`. Route test: mock the service (or inject
  rows) and check the status, the three headers, that the English path gives English titles, and
  that the body text equals `buildProductFeedXml` for the same items.
- [ ] **7. Check robots and redirects.** Add a test in `app/.server/seo/robots.test.ts` that
  `/feeds/products.xml` and `/en/feeds/products.xml` aren't blocked by `robotsDisallowPaths()`.
  Check that `redirects.test.ts` still passes. Run the app (`pnpm aspire run`), open
  `/feeds/products.xml` and `/en/feeds/products.xml` in the browser, and check them against the
  seeded catalog (number of items = active slugged variants with a price).
- [ ] **8. Docs.** Write `docs/product-feeds.md`, in the style of `docs/email.md`:
  - The feed URLs and what each field comes from.
  - Eligibility checks for Ukraine .
  - Merchant Center: create the account, verify and claim the domain (the HTML tag or DNS TXT
    record; the DNS route needs no code change), add a "scheduled fetch" data source per language
    (uk primary, en optional), set up shipping , turn on automatic item updates, and set up free
    listings.
  - Meta Commerce Manager: create a catalog, verify the domain in Business Settings, add a data
    feed with a scheduled hourly fetch on the uk URL, and connect the catalog to the Instagram
    account (Shopping).
  - Reading feed errors in both tools, the common ones (images, brand or trademark disapprovals and
    what to change), and the `curl -I` checks.

  Link the page from `README.md` and `docs/setup.md`.
- [ ] **9. Final checks.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`.
  Validate a sample of the generated XML with Google's feed specification (the Merchant Center
  "Test" upload, or a manual check of the required fields) and record the result in the PR.

## Testing & verification

- Unit tests: `app/.server/seo/xml.test.ts`, `app/.server/seo/product-feed.test.ts`,
  `app/.server/services/product-feed.test.ts`, `app/routes/feeds.products.xml.test.ts`, and the
  robots test addition.
- DB integration test: `listFeedVariants` in `app/.server/db/queries/products.test.ts` (runs when
  a DB is configured).
- `app/lib/client-bundle.guard.test.ts` must still pass. The new code is all under `.server` or
  routes, and nothing client-side imports zod or the feed.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: both URLs in the running app; `curl -I` for the headers; the XML opened in a browser for
  well-formedness; one item checked against its product page (price, sizes, link, image loads).
  After deployment, the owner runs the Merchant Center feed check (the acceptance criterion
  "validates in Merchant Center").

## Acceptance criteria

- [ ] `/feeds/products.xml` lists every available perfume size with id, group id, title, link,
  image, price, availability, size and category — steps 3, 4, 5, 6
- [ ] The feed validates in Google Merchant Center's feed checker without errors — steps 3, 5, 9
  (the final check is the owner's, after deployment and account setup)
- [ ] The same URL can be used as a Meta Commerce Manager scheduled data feed — steps 1 (JPEG
  image), 3, 8
- [ ] Prices and stock in the feed match the shop within an hour — steps 4, 6 (live query,
  `max-age=3600`), 8 (fetch schedule, automatic item updates)
- [ ] `docs/product-feeds.md` explains the account setup — step 8
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 9

## Out of scope

- Paid ads (Performance Max), the Meta Pixel and the Conversions API (they need the consent
  banner's marketing category).
- Creating or configuring the Merchant Center and Commerce Manager accounts, and domain
  verification (done by the owner; a verification `<meta>` tag would be a follow-up only if the owner
  picks that method over DNS).
- Meta "language feeds" (overrides) for the English catalog; the English feed is a separate full
  feed.
- Per-product photos, sale prices (`g:sale_price`) and promotions feeds.
- A Unisex catalog (product_type uses "Унісекс" only as a label for unisex products).
