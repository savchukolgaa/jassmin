# Plan: Improve Core Web Vitals, status codes and on-page SEO basics (#88)

Issue: https://github.com/savchukolgaa/jassmin/issues/88
Branch: `issue/88`
Worktree: `.claude/worktrees/issue-88`
Status: Planned

## Goal

A shopper on a slow phone connection should see the perfume quickly, and Google should rank the
shop well for it. This is a technical SEO pass on what search engines measure beyond tags:
responsive, layout-stable images; fast, self-hosted fonts; real 404s and a defined behaviour for
archived products; one `<h1>` per page; meaningful translated `alt` text; and readable link text.
Success is measured with Lighthouse (mobile) on a local production build.

## Dependencies & prerequisites

- #40 (Strapi as the admin, products archived with `products.active = false`): merged. Archived
  products are currently filtered out by `isListed` in `app/.server/db/queries/products.ts`, so
  their page answers 404 today.
- #72 (bigger hero/About photos) and #73 (Playfair Display headings): merged.
- #80 (shared vs. localized images, `pickImage`): merged; home/offer/blog images already carry
  `srcSet`, `width`, `height` from `toImage` in `app/.server/cms/content.ts`.
- #85, #86, #87 (metadata, structured data, sitemap): **out of scope**, may land in parallel. This
  plan only adds the `robots: noindex` meta for archived products to `routes/product.tsx`'s `meta`;
  expect a small merge conflict there with #85.
- New packages: `@fontsource-variable/manrope` and `@fontsource-variable/playfair-display`
  (self-hosted variable fonts, Latin + Cyrillic subsets).
- New migration `0017_product_image_meta` (nullable columns, no data loss) with a hand-written
  rollback in `app/.server/db/rollbacks/`.
- After deploy: one run of the new backfill script so existing products get their image sizes.

## Decisions & assumptions

1. **Product image sizes come from Strapi and are stored on the product row.** Today the sync
   (`cms/src/sync/middleware.ts` → `routes/cms.products.ts` → `applyCmsProductChange`) stores only
   the original URL in `products.image_url`. Strapi only creates the `thumbnail/small/medium/large`
   formats that fit the original (a small upload has no `large_…`), so guessing format URLs from
   the filename would produce 404 candidates. Instead:
   - Migration adds `products.image_width integer`, `image_height integer` and
     `image_formats jsonb` (an array of `{ url, width, height }`, already absolute). All nullable.
     `image_url` is unchanged (it is used by order history and the CMS push).
   - The Strapi middleware's `imageUrl()` becomes `imageData()` and also returns `width`, `height`
     and `formats` from the upload file. The app's `cmsProductChangeSchema` (`app/lib/cms-sync.ts`)
     gains optional `imageWidth`, `imageHeight`, `imageFormats` (each URL validated like
     `imageUrl`); `routes/cms.products.ts` resolves the relative URLs against `STRAPI_URL` like it
     already does for `imageUrl`. Old Strapi payloads without these fields stay valid (they clear
     the meta to `null`, which falls back to a plain `src`).
2. **One isomorphic image helper**, `app/lib/images.ts`:
   - `ResponsiveImage` DTO `{ url, srcSet: string | null, width: number | null, height: number | null }`.
   - `buildSrcSet(candidates: { url; width }[])` (smallest first, de-duplicated by width) — the
     server's `toSrcSet` in `app/.server/cms/content.ts` is refactored to call it so there is one
     implementation.
   - `toResponsiveImage(url, width, height, formats)` for product rows.
   - `PRODUCT_IMAGE_SIZES` constants (`card`, `compact`, `page`, `thumb`) with the `sizes`
     attribute for each layout, so components don't repeat breakpoint strings.
   The product DTOs in `app/lib/products.ts` replace `imageUrl: string | null` with
   `image: ResponsiveImage | null` (cards, detail, cart and order lines keep `imageUrl` where only
   a URL snapshot exists, e.g. order history).
3. **`ProductImage` renders the full set:** `src`, `srcSet`, `sizes`, `width`/`height` (when known;
   the 4/5 frame already reserves the space via `aspect-[4/5]`), `decoding="async"`,
   `loading="lazy"` by default, and a new `priority` prop (replaces `eager`) that sets
   `loading="eager"` + `fetchPriority="high"`. The product page passes `priority`; cards never do.
   - Alt text: `t("product.imageAlt", { brand, title })` → "<brand> <name>" in both locales.
   - In cards the image link is `aria-hidden` and `tabIndex={-1}` (the heading link is the one
     accessible link), so its image gets `alt=""` there to avoid double announcements. This is the
     "decorative duplicate" case; the product page image keeps the descriptive alt (confirmed by
     the owner).
4. **Hero / About / offers / blog images get a translated fallback alt** when the editor left the
   CMS alt blank: `home.hero.imageAlt`, `home.about.imageAlt`, `offers.imageAlt` (with the offer
   title), `blog.coverAlt` (with the post title). Purely decorative images (the empty
   `aria-hidden` placeholder frames) stay `alt=""`/`aria-hidden`.
5. **Archived product = 200 + `noindex`, with an "unavailable" notice and similar perfumes**
   (instead of 410). Reasons: staff can un-archive a product in Strapi (`active` is a toggle), so
   the page may come back; old links and bookmarks still help shoppers find an alternative;
   Google drops `noindex` pages from the index just like a 410 (confirmed by the owner).
   - New query `findProductPageByPublicId` (no `isListed` filter, returns `active`) and service
     `getProductPage(publicId)` → `{ id, product, available }`. `getProductWithId` and the cart
     checks keep `isListed`, so nothing archived can be bought.
   - New query/service `listSimilarProducts(product, limit = 4)`: active products of the same
     catalog gender (or unisex) that share any fragrance family (GIN index via `arrayOverlaps`),
     ordered by `popular_rank` then title, excluding the product itself; falls back to the same
     brand, then to bestsellers, so the block is never empty when the catalog has products.
   - The product page for an archived product shows the photo, brand, title, families, notes and
     description, an `Unavailable` notice instead of `ProductPurchase`, and a "Similar perfumes"
     section of `ProductCard`s (`headingLevel={3}`). `meta` adds `{ name: "robots", content:
     "noindex" }`. No `product_view` analytics change (still recorded).
6. **Missing pages:** unknown product id/UUID, unknown blog slug, removed/unpublished post and an
   unknown catalog gender already `throw data(null, { status: 404 })`; unmatched URLs fall to the
   root `ErrorBoundary`. The plan adds tests that pin the 404 status and makes the 404 page
   helpful: `ErrorContent` gets the design's page-heading style and the shared "not found" body
   offers links to both catalogs, bestsellers and the blog (`NotFoundLinks` component), used by the
   `_shop` and root boundaries and the product/blog-post boundaries. The unmatched-URL page
   currently renders without the header (root boundary); add a splat route `*` inside the `_shop`
   layout (`routes/not-found.tsx`, loader `throw data(null, { status: 404 })`) so unknown URLs get
   the header, footer and links with a 404 status.
7. **Fonts are self-hosted** with `@fontsource-variable/manrope` (wght 400–800) and
   `@fontsource-variable/playfair-display` (wght 600–700 used), importing only the `latin` and
   `cyrillic` subset CSS files from `app/app.css` (both use `font-display: swap`). This removes
   two third-party connections (DNS + TLS to googleapis/gstatic on slow mobile) and lets us
   `<link rel="preload" as="font" type="font/woff2" crossorigin>` the two files needed for
   above-the-fold text in the default locale (Manrope Cyrillic, Playfair Cyrillic). The Vite
   `?url` import gives the hashed asset URL for the preload. Remove the Google Fonts `links` in
   `app/root.tsx`. Add metric-matched fallbacks (`size-adjust` / `ascent-override` via
   `@font-face` local fallbacks) only if Lighthouse still reports font-swap CLS.
8. **Headings and link text** are an audit with fixes, not a redesign: every route renders exactly
   one `h1` (including error pages and the new archived/404 views), sections step `h2` → `h3`
   without skipping, and no link's accessible name is only "here"/"more"/"read more"/an arrow.
   Product cards stay one accessible link (the heading's product name); the image link is already
   hidden from AT. Blog cards and offer CTAs get their target's title in the accessible name
   (visible text, or `aria-describedby`/visually hidden suffix where the design shows a short label).
9. **Lighthouse is a manual measurement** on a local production build (`pnpm build && pnpm start`
   with the Aspire-provided env, or `pnpm aspire run` with the app in production mode), mobile
   preset, for home, `/catalog/women`, one product page and one blog post, before and after. The
   scores go in the PR description (`/open-pr` will pick them up from the plan's checklist). No
   Lighthouse CI is added.

## Resolved questions

- **Archived products: 200 + `noindex` or `410 Gone`?** — 200 + `noindex`, with the
  "unavailable" notice and similar perfumes (decision 5; steps 6, 7). (source: owner, 2026-11-01)
- **Product-card images: `alt=""` or "<brand> <name>"?** — `alt=""` on card images (the image
  link is an `aria-hidden` duplicate of the heading link); "<brand> <name>" on the product page,
  cart and order lines (decision 3; step 5). (source: owner, 2026-11-01)
- **Font packages or committed woff2 files?** — Add the `@fontsource-variable/manrope` and
  `@fontsource-variable/playfair-display` packages (decision 7; step 9). (source: owner,
  2026-11-01)

- **Does Strapi generate product image formats?** — Yes; the product `image` is a standard media
  field (`cms/src/api/product/content-types/product/schema.json`), but the sync only forwards
  `file.url` (`cms/src/sync/middleware.ts` `imageUrl()`), so the app never sees the formats today.
- **Where are relative upload URLs resolved?** — In `routes/cms.products.ts` against `STRAPI_URL`
  before `applyCmsProductChange` (and `toImage` for CMS content). Format URLs follow the same path.
- **Do unknown products, posts and catalogs already 404?** — Yes: `routes/product.tsx`,
  `routes/blog-post.tsx` and `routes/catalog.tsx` `throw data(null, { status: 404 })`; drafts are
  never requested (`getBlogPostBySlug` asks for published content only). What's missing is tests
  pinning it, a helpful 404 page, and the shop layout around unmatched URLs.
- **What happens to archived products today?** — 404, because `findProductByPublicId` filters on
  `isListed` (`app/.server/db/queries/products.ts`). Their rows remain for order history (#40).
- **Do hero/About images already have `srcSet`, `width`, `height` and priority?** — Yes
  (`features/home/HeroSection.tsx` has `fetchPriority="high"`; `AboutSection.tsx` is lazy); only
  their `alt` falls back to `""` when the CMS alt is blank (`toImage` in `cms/content.ts`).
- **Is there a `noindex` convention?** — `meta` returns `{ name: "robots", content: "noindex" }`
  (e.g. `routes/account.tsx`, `routes/checkout-success.tsx`) and tests assert it.
- **Can product columns be added?** — Yes; only dropping/renaming ML columns is forbidden
  (`AGENTS.md`), and migrations need a rollback file (`app/.server/AGENTS.md` → Migrations).
- **How are fonts loaded now?** — One Google Fonts request with `display=swap` in `app/root.tsx`
  `links`, documented in `docs/design.md` → Typeface (to be updated).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `app/lib/images.ts` (+ `images.test.ts`) | `ResponsiveImage`, `buildSrcSet`, `toResponsiveImage`, `PRODUCT_IMAGE_SIZES` |
| modify | `app/.server/cms/content.ts` | `toSrcSet` uses `buildSrcSet`; translated alt fallback inputs |
| modify | `app/.server/db/schema.ts` | `image_width`, `image_height`, `image_formats` on `products` |
| create | `app/.server/db/migrations/0017_product_image_meta.sql` (+ meta) | generated by `pnpm db:generate --name product_image_meta` |
| create | `app/.server/db/rollbacks/0017_product_image_meta.sql` | drops the three columns |
| modify | `cms/src/sync/middleware.ts` (+ test) | send image width/height/formats |
| modify | `app/lib/cms-sync.ts` (+ test), `app/routes/cms.products.ts` (+ test), `app/.server/services/cms-sync.ts` (+ test) | accept, resolve and store image meta |
| create | `app/.server/db/scripts/backfill-product-images.ts`, `package.json` script `db:backfill-product-images` | fill image meta for existing products from Strapi |
| modify | `app/.server/db/queries/products.ts`, `app/.server/services/products.ts` (+ tests) | select image meta, `findProductPageByPublicId`, `getProductPage`, `listSimilarProducts` |
| modify | `app/lib/products.ts` | `image: ResponsiveImage \| null` in card/detail DTOs |
| modify | `app/features/catalog/ProductImage.tsx`, `ProductCard.tsx` (+ dom test) | responsive image, `priority`, alt |
| modify | `app/features/cart/CartLineItem.tsx`, `app/features/account/OrderLineItem.tsx`, offers/popular/home card users | pass sizes/alt, lazy |
| modify | `app/features/home/HeroSection.tsx`, `AboutSection.tsx`, `app/features/offers/OfferCard.tsx`, `OffersHero.tsx`, `app/features/blog/BlogCover.tsx`, `BlogPostCard.tsx` | translated alt fallback, width/height, lazy/priority audit |
| modify | `app/routes/product.tsx` (+ test) | archived view, `noindex`, `priority` image |
| create | `app/features/product/ProductUnavailable.tsx`, `SimilarProducts.tsx` | archived notice and similar perfumes |
| create | `app/components/layout/NotFoundLinks.tsx` | helpful links on 404 pages |
| modify | `app/components/layout/ErrorContent.tsx`, `app/routes/_shop.tsx`, `app/root.tsx`, `app/routes/blog-post.tsx` | styled single `h1`, 404 links |
| create | `app/routes/not-found.tsx` (+ test), modify `app/routes.ts`, `app/routes.test.ts` | splat 404 inside the shop layout |
| modify | `app/root.tsx`, `app/app.css`, `package.json`, `pnpm-lock.yaml` | self-hosted fonts + preload |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | new keys (image alts, unavailable, similar, 404 links, link-text suffixes) |
| modify | `docs/design.md` | fonts are self-hosted; image rules (sizes, priority, alt) |
| modify | `app/.server/AGENTS.md` | product image meta columns + backfill script |

## Steps

- [x] **1. Image helper** — Create `app/lib/images.ts` with `ResponsiveImage`, `buildSrcSet`,
  `toResponsiveImage` and `PRODUCT_IMAGE_SIZES` (`card: "(min-width: 1024px) 280px, (min-width:
  640px) 45vw, 90vw"`, `compact`, `page: "(min-width: 768px) 50vw, 100vw"`, `thumb: "96px"`;
  tune against the real grid classes). Refactor `toSrcSet` in `app/.server/cms/content.ts` to
  call `buildSrcSet`. Tests: ordering, de-duplication, original included, `null` with no widths,
  relative URLs rejected/handled. Existing `content.test.ts` must stay green.
- [x] **2. Schema + migration** — Add `imageWidth`, `imageHeight` (`integer`) and `imageFormats`
  (`jsonb().$type<{ url: string; width: number; height: number }[]>()`) to `products` in
  `schema.ts`; `pnpm db:generate --name product_image_meta`; write the rollback. Update
  `schema.test.ts` if it mirrors product columns. Check `pnpm db:migrate` + `pnpm db:rollback`
  locally.
- [x] **3. Sync image meta from Strapi** — `cms/src/sync/middleware.ts`: `imageData()` returns
  `{ url, width, height, formats }` from the media object or `plugin::upload.file`; payload gets
  `imageWidth`, `imageHeight`, `imageFormats` (array of `{ url, width, height }` from
  `file.formats`). App: extend `cmsProductChangeSchema` (zod, optional/nullish, URL refine shared
  with `imageUrl`, max 8 formats); `routes/cms.products.ts` resolves each format URL against
  `STRAPI_URL`; `productWrite` in `services/cms-sync.ts` stores them. Tests in each layer
  (middleware payload, schema accept/reject, route resolves URLs, service writes columns).
- [x] **4. Backfill script** — `app/.server/db/scripts/backfill-product-images.ts`
  (`pnpm db:backfill-product-images`): with `parseCmsSyncEnv`, page through Strapi `products`
  (`populate: ["image"]`, `fields: ["publicId"]`) using the existing `cmsSyncDeps` fetch, and
  update `image_url`/`image_width`/`image_height`/`image_formats` by `public_id` in batches.
  Pure mapping function unit-tested; document in `app/.server/AGENTS.md` and README's CMS section.
- [x] **5. Product DTOs and `ProductImage`** — Select the new columns in the card, detail, cart and
  summary queries; map with `toResponsiveImage` in `services/products.ts` (`toSummary`,
  `toDetail`); change DTOs in `app/lib/products.ts` to `image`. `ProductImage` takes `image`,
  `sizes`, `alt` and `priority`; renders `srcSet`/`sizes`/`width`/`height`/`decoding="async"`,
  lazy unless `priority` (`loading="eager"` + `fetchPriority="high"`). Update every caller:
  catalog and compact cards (`alt=""`), cart line (`thumb`, "<brand> <name>"), product
  page (`page`, `priority`, "<brand> <name>"). The brand-initial placeholder keeps
  `role="img"` + `aria-label` with the same translated alt. Add `product.imageAlt` to both locale
  files. Tests: `ProductCard.dom.test.ts` asserts `loading="lazy"`, `srcset`, `sizes`, `width`;
  `product-ui.test.ts` asserts the page image's alt and `fetchpriority`.
- [x] **6. Archived product data** — `findProductPageByPublicId` (no `isListed`, selects
  `active`), `getProductPage` → `{ id, product, available }` (variants of an archived product
  report out of stock via `availableStock`), and `listSimilarProducts` (same catalog gender or
  unisex, `arrayOverlaps` on families, active, excludes self, `popular_rank` then title, limit 4,
  fallbacks brand → bestsellers). Integration tests with `test-utils.ts`: archived product found
  with `available: false`; similar list excludes archived and self; `getProductWithId` and
  `checkVariantForCart` still reject archived.
- [ ] **7. Archived product page** — `routes/product.tsx` loader uses `getProductPage`; when
  `!available` it also loads similar products. Component renders `ProductUnavailable` (notice in
  the blush panel style, links to the catalog) instead of `ProductPurchase`, and
  `SimilarProducts` (`h2` "Similar perfumes", `ProductCard` grid with `headingLevel={3}`).
  `meta` adds `robots: noindex` when unavailable. New i18n keys `product.unavailable.*`,
  `product.similar.*`. Tests (`routes/product.test.ts`): archived → 200 + `noindex` meta +
  similar products; unknown UUID / malformed id → 404; active product has no `noindex`.
- [ ] **8. 404 pages** — `NotFoundLinks` (catalogs, bestsellers, blog; descriptive link text);
  `ErrorContent` styled as a page (`h1` with the page-heading scale, body text tokens) and shows
  `NotFoundLinks` for 404s; use it in `_shop`, root, product and blog-post boundaries (the
  product boundary's custom links collapse into it). Add `route("*", "routes/not-found.tsx")` as
  the last child of the `_shop` layout; its loader throws a 404 so the layout's boundary renders
  with header and footer. Tests: `routes.test.ts` (splat inside layout), `not-found.test.ts`
  (404 status), `blog-post.test.ts` (unknown/removed slug → 404), `catalog.test.ts` (unknown
  gender → 404). Check that `/api/events`, `/cms/*`, `/logout` etc. still match their own routes
  (they are declared outside the layout and are more specific than `*`).
- [ ] **9. Self-hosted fonts** — `pnpm add @fontsource-variable/manrope
  @fontsource-variable/playfair-display`; in `app/app.css` import only the `latin` and
  `cyrillic` subset files (wght axis) and keep `--font-sans`/`--font-serif` family names in sync
  with fontsource's (`"Manrope Variable"`, `"Playfair Display Variable"`), keeping the fallbacks.
  In `app/root.tsx` drop the Google Fonts links and preload the Cyrillic woff2 of both families
  via `?url` imports (`rel: "preload", as: "font", type: "font/woff2", crossOrigin:
  "anonymous"`). Verify in the built `build/client/assets` that only the 4 subset files ship and
  that `font-display: swap` is present. Update `docs/design.md` → Typeface.
- [ ] **10. CMS images: alt fallbacks and loading audit** — Hero, About, offer, offers-hero and
  blog cover/card images: when `image.alt` is empty, use a translated fallback
  (`home.hero.imageAlt`, `home.about.imageAlt`, `offers.imageAlt` with `{title}`,
  `blog.coverAlt` with `{title}`). Ensure every `<img>` has `width`/`height` (or sits in a
  fixed-aspect frame), below-the-fold ones `loading="lazy"`, and exactly one
  `fetchPriority="high"` per page (home hero, offers hero, blog post cover, product photo). Update
  `HomePage.test.ts`, `offers-ui.test.ts`, `blog-ui.test.ts` to assert non-empty alt.
- [ ] **11. Headings and link-text audit** — For each route (home, catalog, product, popular,
  offers, blog, blog post, cart, checkout, success, login/register, account pages, privacy,
  404): exactly one `h1`, no skipped levels (fix `headingLevel` props and section headings as
  found). Replace "more"/"→"-only links with descriptive text or add the target's name (visually
  hidden `<span className="sr-only">`). Add a small test helper (`app/test/headings.ts` or inline
  in existing UI tests) that renders a page component to static markup and counts `<h1`; use it
  in the main page tests.
- [ ] **12. Measure and verify** — Lighthouse mobile before (on `main`) and after, on home,
  `/catalog/women`, a product page and a blog post, against a local production build. Fix
  remaining findings that block SEO 100 / Performance ≥ 90 (e.g. missing `meta description` on
  pages owned by #85 are noted, not fixed, if they're the only SEO loss — see Out of scope).
  Record the table of scores for the PR. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`.

## Testing & verification

- Unit: `app/lib/images.test.ts`; `cms-sync` schema; backfill mapping; middleware payload
  (`cms/src/sync/middleware.test.ts`).
- Integration (DB): product page query/service for archived + similar; cart still rejects
  archived; CMS sync writes image meta.
- Route tests: product (200 + `noindex` archived, 404 unknown/malformed), blog post (404),
  catalog (404), splat route (404), `routes.test.ts`.
- Component tests: `ProductCard.dom.test.ts` (lazy, `srcset`, `sizes`, dimensions, one link with
  the product name), product page image (`fetchpriority`, alt), home/offers/blog alt presence in
  `uk` and `en` (`<I18nProvider locale="en">`), one `h1` per page.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; `pnpm db:migrate` +
  `pnpm db:rollback` round trip; in `cms/`, its own test command for the middleware.
- Manual: `pnpm aspire run`, edit a product image in Strapi → check `image_formats` filled and
  the card's `srcset`; archive a product → page shows the notice, `curl -I` gives 200 and the HTML
  has `noindex`; `curl -I /nope` → 404 with header/footer; DevTools network shows no
  `fonts.googleapis.com`; Lighthouse mobile runs as in step 12.

## Acceptance criteria

- [ ] Lighthouse mobile SEO score is 100 and Performance ≥ 90 on home, catalog and product pages
  (local production build). — steps 5, 9, 10, 11, 12
- [ ] No image causes layout shift, and below-the-fold images are lazy-loaded with responsive
  sizes. — steps 1–5, 10
- [ ] Missing pages answer 404, and archived products follow the decided behaviour. — steps 6, 7, 8
- [ ] Every page has one `<h1>`, and every content image has a meaningful translated `alt`. —
  steps 5, 8, 10, 11
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass. — step 12

## Out of scope

- Titles, descriptions, canonical/hreflang, Open Graph (#85), structured data (#86), sitemap and
  `robots.txt` (#87). If Lighthouse SEO < 100 only because of those, it's noted in the PR and
  left to those issues.
- An on-the-fly image resizing endpoint or CDN; we rely on Strapi's generated formats.
- Converting images to AVIF/WebP (Strapi's formats keep the upload's type).
- Lighthouse CI or performance budgets in CI.
- Redesigning pages; heading fixes keep the current visual styles.
