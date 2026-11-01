# Plan: Add complete translated SEO metadata (canonical, Open Graph, robots) to every page (#85)

Issue: https://github.com/savchukolgaa/jassmin/issues/85
Branch: `issue/85`
Worktree: `.claude/worktrees/issue-85`
Status: Planned

## Goal

A shopper who finds Jassmin in Google, or in a link shared on Instagram, Telegram or Viber, should
see a clear title, description and preview image before clicking. Every route gets complete,
translated `<head>` metadata from one isomorphic helper: title, description, absolute canonical
URL, Open Graph and Twitter card tags, and `robots` rules for private, transactional, filtered and
error pages.

## Dependencies & prerequisites

- **#83 (product slug URLs): open, not on `origin/main`.** Product routes are still
  `products/:id` (UUID) in `app/routes.ts`.
- **#84 (locale-prefixed, translated URLs + hreflang): open, not on `origin/main`.** The locale
  still comes from the cookie / `Accept-Language` (`app/.server/locale.ts`), and every URL serves
  both languages.
- This plan is written so it **does not need either one to land first** (see Decisions): the
  canonical path is the URL the page was actually served under (`location.pathname`), with an
  allow-list for query parameters. Once #83 redirects UUIDs to slugs and #84 moves pages to
  `/katalog/...` and `/en/...`, canonical and `og:url` follow automatically. Whichever lands second
  rebases on the other; the touch points are listed in step 11.
- New env var `PUBLIC_SITE_URL` (required in production). Add it to `.env.example`, the README env
  table and the Aspire `web` resource.
- New static asset `public/og-default.jpg` (1200×630).
- No migrations, no new packages.

## Decisions & assumptions

- **One helper, `seoMeta()` in `app/lib/seo.ts`** (isomorphic, no server imports). Signature:
  ```ts
  seoMeta({
    t,                    // Translator from metaTranslator(matches)
    site,                 // { url: string } from the root loader
    title,                // page part; wrapped with t("meta.title", { page }) unless rawTitle
    description,
    location,             // MetaArgs["location"]
    keepParams?: readonly string[],   // query params that stay in the canonical, default []
    image?: { url: string; alt: string; width?: number; height?: number } | null,
    type?: "website" | "article" | "product",
    noindex?: boolean,
    extra?: MetaDescriptor[],         // e.g. product:price:*, article:published_time
  }): MetaDescriptor[]
  ```
  It returns `title`, `description` (truncated by `truncateDescription()` to ≤155 characters on a
  word boundary, with `…`), `<link rel="canonical">`, `og:title/description/url/image/image:alt/
  image:width/image:height/type/site_name/locale/locale:alternate`, `twitter:card=
  summary_large_image`, `twitter:title/description/image`, and `robots`. With `noindex` it emits
  `robots: noindex, follow` and **no** canonical or `og:url` (a canonical on a noindex page sends
  mixed signals).
- **Canonical URL = `PUBLIC_SITE_URL` + `location.pathname` + allow-listed params.** Every query
  parameter not in `keepParams` is dropped, which removes `utm_*`, `fbclid`, `gclid` and any other
  tracking or filter parameter in one rule. Only `page` is kept, on the blog list and `/popular`
  (paginated pages are self-canonical), and `page=1` is dropped. `/popular?family=…` therefore
  canonicalizes to `/popular` (or `/popular?page=n`). Trailing slashes are stripped except on `/`.
- **The public origin comes from `PUBLIC_SITE_URL`, never from the `Host` header.** In
  `app/.server/env.ts`: `PUBLIC_SITE_URL: z.url({ protocol: /^https?$/ })`, optional in
  development/test, required when `NODE_ENV === "production"` (a `.refine`, like the payment
  simulator rule). Outside production it falls back to `http://localhost:${PORT}` — a constant,
  still not the `Host` header. The root loader returns `site: { url }` next to `locale`; a
  `seoSite(matches)` helper reads it in `meta`, like `metaTranslator` reads the locale.
- **`og:locale`** is `uk_UA` / `en_US` from the active locale (root loader), and
  `og:locale:alternate` is the other one. Today that is the cookie locale; after #84 it is the URL
  locale with no change here. `hreflang` stays in #84.
- **`og:site_name`** = `"Jassmin"`, a brand constant (not translated).
- **Images must be absolute.** `seoMeta` resolves relative image URLs against `site.url`. Strapi
  images are already absolute (`app/.server/cms/content.ts`), product `imageUrl` may not be. The
  default image is `/og-default.jpg`, with translated alt text `meta.defaultImageAlt`.
- **Titles:** every page uses `t("meta.title", { page })` (`"{page} — Jassmin"`). Two exceptions,
  rendered as-is: the home page (CMS `seo.title`, already branded) and the product page, which
  becomes `t("meta.title", { page: "<title> — <brand>" })`, keeping today's output.
- **Product pages:** `og:type=product`, `product:price:amount` = the lowest variant price
  (`minPrice` logic, formatted as a plain decimal `"1250.00"`, not `formatPrice`),
  `product:price:currency=UAH`, `product:availability` (`in stock` / `out of stock`) and the
  product image. Telegram and Viber read `og:title`, `og:description` and `og:image`, so the price
  is also put in the description: `t("product.metaDescription", { title, brand, price })` when the
  product has no description, otherwise `"<price> · <description>"` — so the preview shows the
  price (acceptance criterion 2).
- **Catalog description** per gender: new keys `catalog.metaDescription.women` / `.men`.
- **Privacy:** new `privacy.metaDescription`.
- **noindex, follow** for: cart, checkout, checkout success, login, register, account (layout,
  index, order, profile), payments simulator, and every error render (404, 503, 500) — via
  `seoMeta({ noindex: true })` or the shared `errorMeta()` below. `checkout/pay/:orderId` is an
  action-only resource route without a document, so it needs no meta; its responses get an
  `X-Robots-Tag: noindex` header for completeness.
- **Errors:** React Router calls `meta` with `error` set and `loaderData` undefined when a loader
  throws. A helper `errorMeta(t, error)` returns the translated error title (from
  `describeRouteError`) plus `robots: noindex, follow`. Every indexable route returns it when
  `error` is set. The root gets a `meta` export too, for unmatched URLs (the root is then the
  deepest match).
- Loaders stop computing `canonicalUrl` from `request.url` (`blog.tsx`, `offers.tsx`,
  `popular.tsx`, and `seo.canonicalUrl` in `app/.server/services/blog.ts`): one source of truth,
  and it no longer trusts `Host`. The `origin` parameter of `getBlogPost` goes away.
- **Default share image:** `public/og-default.jpg`, 1200×630, ≤300 KB, the Jassmin wordmark on
  the C+ background (`docs/design.md` tokens): no photo.

## Resolved questions

- **Where does the locale for `meta` come from?** — The root loader's data, via
  `metaTranslator(matches)` (source: `app/lib/i18n/react.tsx`). `seoSite(matches)` follows the same
  pattern for `site.url`.
- **Which pages already have OG / canonical?** — Home (OG, no canonical), blog list, blog post,
  offers, popular (OG + canonical from `request.url`); catalog has a title only; product has title +
  description; privacy, cart, checkout, login, register have a title only; account order and the
  payments simulator are `noindex` (source: `meta` exports in `app/routes/*.tsx`).
- **Are filtered `/popular` pages already canonicalized?** — Yes, the loader builds
  `popularHref([], page.page)`; this plan moves that rule into `keepParams: ["page"]` (source:
  `app/routes/popular.tsx`).
- **Product price shape** — variants carry `price` as a decimal string; the card price uses
  `minPrice` (source: `app/lib/products.ts`).
- **Should `og:image` for blog posts and the home page stay CMS-driven?** — Yes, keep current
  behaviour, fall back to the default image when missing (issue: "blog list and post (keep
  current)"; `loaderData.seo.image` in `home.tsx`, `blog-post.tsx`).
- **Default share image** — the "Jassmin" wordmark on the C+ background, no photo (answered by the user).
- **Implement now or wait for #83 / #84?** — Start now on today's URLs; whichever of #83/#84 lands second resolves the conflicts (answered by the user; see step 11).
- **Production `PUBLIC_SITE_URL` value** — not needed in the code: it's set per deployment in the environment, and the app refuses to start in production without it (step 1).
- **Structured data and sitemap** — out of scope (issue #85 Context; sitemap/robots.txt is #87).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `app/lib/seo.ts` | `seoMeta`, `truncateDescription`, `canonicalUrl`, `absoluteUrl`, `seoSite`, `errorMeta`, `OG_LOCALES`, `SITE_NAME`, `DEFAULT_SHARE_IMAGE` |
| create | `app/lib/seo.test.ts` | Helper tests |
| create | `public/og-default.jpg` | Default 1200×630 share image |
| create | `app/routes/meta.test.ts` | One `meta` test per route type |
| modify | `app/.server/env.ts`, `app/.server/env.test.ts` | `PUBLIC_SITE_URL` (required in production) + `getSiteUrl()` |
| modify | `.env.example`, `README.md` | Document `PUBLIC_SITE_URL` |
| modify | `aspire-apphost/apphost.mts`, `aspire-apphost/AGENTS.md` | Pass `PUBLIC_SITE_URL` to `web` (the dev endpoint) |
| modify | `app/root.tsx` | Return `site` from the loader; root `meta` for unmatched URLs |
| modify | `app/routes/home.tsx`, `catalog.tsx`, `product.tsx`, `blog.tsx`, `blog-post.tsx`, `offers.tsx`, `popular.tsx`, `privacy.tsx` | Indexable pages through `seoMeta` |
| modify | `app/routes/cart.tsx`, `checkout.tsx`, `checkout-success.tsx`, `login.tsx`, `register.tsx`, `account.tsx`, `account.profile.tsx`, `account.orders.$id.tsx`, `payments.simulator.tsx` | `noindex, follow` through `seoMeta` |
| modify | `app/routes/checkout-pay.ts` | `X-Robots-Tag: noindex` |
| modify | `app/.server/services/blog.ts`, `app/.server/services/blog.test.ts`, `app/lib/blog.ts` | Drop `canonicalUrl` / `origin` |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | New copy (descriptions, alt text) |

## Steps

- [ ] **1. `PUBLIC_SITE_URL`** — In `app/.server/env.ts` add `PUBLIC_SITE_URL: z.url({ protocol:
  /^https?$/ }).optional()` (empty counts as unset) and a `.refine` that requires it when
  `NODE_ENV === "production"`. Add `getSiteUrl(env)` returning the value without a trailing slash,
  or `http://localhost:${PORT}` outside production. Tests in `env.test.ts`: required in production,
  fallback in development, trailing slash stripped, non-http rejected. Document it in
  `.env.example` and `README.md`; in `aspire-apphost/apphost.mts` pass the `web` endpoint URL as
  `PUBLIC_SITE_URL` and note it in `aspire-apphost/AGENTS.md`. Check: `pnpm typecheck`, `pnpm
  test app/.server/env.test.ts`.
- [ ] **2. Root loader + site context** — `app/root.tsx` loader returns `{ locale, site: { url:
  getSiteUrl(getEnv()) } }`. Add `seoSite(matches)` to `app/lib/seo.ts`, reading `site.url` from the
  `root` match (narrowing `unknown`, like `metaTranslator`), falling back to `""` (relative URLs)
  when the root loader failed.
- [ ] **3. Default share image** — Add `public/og-default.jpg` (1200×630): the Playfair Display "Jassmin" wordmark on the C+ background, generated once and committed as a static file and
  `DEFAULT_SHARE_IMAGE = { url: "/og-default.jpg", width: 1200, height: 630 }`. Add
  `meta.defaultImageAlt` to `uk.ts` / `en.ts`.
- [ ] **4. The helper `app/lib/seo.ts`** — Implement `truncateDescription(text, max = 155)` (collapse
  whitespace, cut at the last space before `max - 1`, append `…`; never cut a word; short text
  unchanged), `absoluteUrl(pathOrUrl, siteUrl)`, `canonicalUrl(location, siteUrl, keepParams)`
  (drop all params except `keepParams`, drop `page=1`, sort kept params, strip trailing slash),
  `seoMeta(...)` as specified in Decisions, and `errorMeta(t, error)` (uses `describeRouteError`
  from `app/lib/route-error.ts`). Return `MetaDescriptor[]` from `react-router`. Tests in
  `app/lib/seo.test.ts`: truncation (word boundary, ≤155, short text, Cyrillic), absolute URLs
  (relative image, already absolute image, canonical from site URL not location host), tracking
  params dropped (`utm_source`, `fbclid`, `gclid`), `page` kept only when listed and >1, `noindex`
  output (robots present, canonical and `og:url` absent), `og:locale` / `og:locale:alternate` per
  locale, default image + alt when no image, Twitter tags.
- [ ] **5. Indexable static pages** — `privacy.tsx` (new `privacy.metaDescription`), `offers.tsx`
  (hero image or default; drop `canonicalUrl` from the loader), `popular.tsx` (`keepParams:
  ["page"]`; drop `canonicalUrl` from the loader), `blog.tsx` (`keepParams: ["page"]`; drop
  `canonicalUrl` from the loader). Each returns `errorMeta` when `error` is set.
- [ ] **6. Home and catalog** — `home.tsx`: CMS `seo.title` as the raw title, CMS description or
  `home.defaultDescription`, CMS image or default. Improve `home.defaultDescription` in both
  languages to a full sentence (it is currently "Магазин парфумів Jassmin"). `catalog.tsx`: title as
  today, new `catalog.metaDescription.women` / `.men` keys, default image, no query params in the
  canonical (catalog filters and sort are not canonical).
- [ ] **7. Blog post** — `blog-post.tsx` uses `seoMeta({ type: "article", image: seo.image, extra:
  [article:published_time] })`; keep the current title/description. Remove `canonicalUrl` and the
  `origin` argument from `getBlogPost` in `app/.server/services/blog.ts` and its type in
  `app/lib/blog.ts`; update `services/blog.test.ts`.
- [ ] **8. Product** — `product.tsx`: title `t("meta.title", { page: "<title> — <brand>" })`,
  description with the price (see Decisions; new `product.metaDescription` key, prices via a plain
  decimal helper `priceAmount()` in `app/lib/seo.ts` and `formatPrice` for the human text),
  `type: "product"`, product image (absolute) or default, `image:alt` = `"<title> — <brand>"`,
  `extra`: `product:price:amount`, `product:price:currency=UAH`, `product:availability`. Remove
  `DESCRIPTION_LENGTH` (the helper truncates). Uses `metaTranslator` (it doesn't today).
- [ ] **9. noindex pages** — cart, checkout, checkout success, login, register, account layout,
  account index (if it has meta; else the layout's applies), profile, order, payments simulator:
  `seoMeta({ ..., noindex: true })`, keeping their current titles. `checkout-pay.ts`: add
  `X-Robots-Tag: noindex` to its responses.
- [ ] **10. Error pages** — Add `meta` to `app/root.tsx` that returns `errorMeta` when `error` is
  set (unmatched URLs) and `[]` otherwise. Every route from steps 5–9 returns `errorMeta` when
  `error` is set (product/blog-post 404, CMS 503). Check in the running app: `/products/<random
  uuid>`, `/nope`, `/blog/missing` render `noindex, follow`.
- [ ] **11. Coordinate with #83 / #84** — If either has merged by now, rebase on `origin/main`:
  product route param name (`:handle`) and `getProductWithId` → slug lookup (#83) don't affect
  `meta`; translated route ids and `/en/...` paths (#84) don't affect `seoMeta` because it reads
  `location.pathname`. Re-run the route meta tests against the new paths. If #84 adds `hreflang`
  links, keep them in its helper; `seoMeta` must not duplicate them.
- [ ] **12. Route meta tests** — `app/routes/meta.test.ts` calls each `meta` export with
  hand-built `matches` (root data `{ locale, site: { url: "https://jassmin.test" } }`), `location`
  and `loaderData`: home, catalog (women/men, uk/en descriptions differ), product (price tags,
  absolute image, `og:type=product`), blog list (page 2 self-canonical), blog post, offers, popular
  with `?family=woody&utm_source=x` (canonical `/popular`), privacy, one noindex page (cart), and one
  error case (`error` set → noindex). Assert titles are unique across indexable routes.
- [ ] **13. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; manual checks
  below.

## Testing & verification

- Unit: `app/lib/seo.test.ts` (step 4), `app/.server/env.test.ts` (step 1),
  `app/.server/services/blog.test.ts` (step 7).
- Route meta: `app/routes/meta.test.ts` (step 12).
- Commands: `pnpm --dir "$WT" typecheck`, `lint`, `test`, `build`.
- Manual (in `pnpm aspire run`): view source of home, catalog, a product, blog list page 2, a post,
  offers, popular with `?family=…&utm_source=x`, privacy (uk and en via the switcher): one
  `<title>`, description ≤155 chars, absolute canonical on `PUBLIC_SITE_URL`, full `og:*` and
  `twitter:*` set. Cart, checkout, login, register, account and a 404 show `noindex, follow` and no
  canonical. Optionally check a product URL in the Telegram/Facebook debugger via a tunnel.

## Acceptance criteria

- [ ] Every indexable page has a unique translated title and description, a canonical URL, and
  Open Graph and Twitter tags with an image. — steps 2–8, 12
- [ ] A product link pasted into Telegram or Viber shows the product name, image and price. —
  step 8 (price in `og:description` and `product:price:*`, absolute `og:image`)
- [ ] Cart, checkout, login, register, account and error pages are `noindex`. — steps 9, 10
- [ ] URLs with tracking or filter parameters declare the clean canonical URL. — steps 4, 5, 12
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass. — step 13

## Out of scope

- Structured data (JSON-LD) and the sitemap / `robots.txt` (#87).
- `hreflang` alternates, translated paths and the URL-based locale (#84).
- Product slug URLs and redirects (#83).
- Per-product or per-page CMS-editable SEO fields beyond what Strapi already provides.
