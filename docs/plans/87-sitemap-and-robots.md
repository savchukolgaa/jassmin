# Plan: Serve sitemap.xml and robots.txt (#87)

Issue: https://github.com/savchukolgaa/jassmin/issues/87
Branch: `issue/87`
Worktree: `.claude/worktrees/issue-87`
Status: Planned

## Goal
The store owner wants search engines to find every product, catalog page and blog post in both
languages, and to skip private pages, so new perfumes show up in Google quickly. Serve a dynamic
`/sitemap.xml` (every public URL per locale, with `hreflang` alternates and `lastmod`) and a
`/robots.txt` that blocks private and action-only paths, links the sitemap, and disallows
everything outside production.

## Dependencies & prerequisites
- **#83 (product slug URLs), OPEN.** Provides `productHref(product)` and `/products/<slug>`. The
  sitemap must list slug URLs. **Not on `origin/main` yet.**
- **#84 (locale-prefixed, translated URLs), OPEN.** Provides the path table and
  `href(page, params, locale)` in `app/lib/paths.ts`, and per-language blog slugs from Strapi. Both
  the sitemap URLs and the `robots.txt` `Disallow` list are generated from it. **Not on
  `origin/main` yet.**
- **#85 (SEO metadata), OPEN.** Adds `PUBLIC_SITE_URL` to `app/.server/env.ts`. Both files need
  absolute URLs. **Not on `origin/main` yet.**
- **Implement after #83, #84 and #85 are merged**, then rebase `issue/87` on `origin/main`. If
  #85 is not merged first, this issue adds `PUBLIC_SITE_URL` itself, in the shape #85 describes
  (step 1), and #85 reuses it.
- Migration: `products.updated_at` (step 2). The table has no such column today
  (`app/.server/db/schema.ts`, `products` has only `created_at`).
- No new packages. The XML is small and built with a hand-written escaper.

## Decisions & assumptions
- **Resource routes.** `route("sitemap.xml", "routes/sitemap.xml.ts")` and
  `route("robots.txt", "routes/robots.txt.ts")` at the top level of `app/routes.ts`, outside the
  `_shop` layout so no session, visitor cookie or analytics middleware runs. Their loaders return
  a `Response` with `Content-Type: application/xml; charset=utf-8` / `text/plain; charset=utf-8`
  and `Cache-Control: public, max-age=3600`. No `Vary`: neither depends on cookies or
  `Accept-Language`.
- **Pure builders in `app/.server/seo/`, route modules stay thin.**
  - `sitemap.ts`: `buildSitemapXml(entries)`, `escapeXml()`, and `collectSitemapEntries(deps)`,
    which gathers URLs from the services.
  - `robots.ts`: `buildRobotsTxt({ siteUrl, disallowAll, privatePaths })`.
  - Each is unit-tested without a server.
- **One sitemap entry per (page, locale).** Each `<url>` has `<loc>` and `<lastmod>`, plus three
  `<xhtml:link rel="alternate">` for `uk`, `en` and `x-default` (the Ukrainian URL), as Google
  requires on every variant. The namespaces are `http://www.sitemaps.org/schemas/sitemap/0.9` and
  `http://www.w3.org/1999/xhtml`. A single file is used: about 140 products × 2 locales plus
  static pages and posts is well under 50,000 URLs and 50 MB.
- **Static pages:** home, catalog women and men, offers, popular, blog and privacy, each in
  `uk` and `en`, built with `href(page, params, locale)` from #84. **No Unisex catalog** (only the
  men's and women's catalogs exist).
- **Products:** listed products only, through the existing `isListed` filter
  (`app/.server/db/queries/products.ts`): `active = true` and at least one variant. "Unlisted" in
  the issue means products without variants, which the catalog doesn't show either. Add a new
  query `listSitemapProducts()` → `{ slug, publicId, updatedAt }[]`. It uses the same filter as
  the catalog, so the sitemap and the catalog can't disagree.
- **Product URLs:** `productHref` from #83 per locale (`/parfumy/<slug>`,
  `/en/perfumes/<slug>`). Products whose `slug` is still `null` are left out
  (Q1): their UUID URL is temporary and would 301 once a slug exists.
- **`lastmod`:**
  - **Products:** the new `products.updated_at`. It uses the shared `updatedAt()` helper
    (`defaultNow()` plus `$onUpdate`), so it's refreshed by `updateProduct`, `setActive` and the
    CMS sync. Those all use the query builder. A raw-SQL update would have to set the column
    itself. Variant price and stock changes don't touch it (Q2).
  - **Blog posts:** Strapi `updatedAt`.
  - **Catalog pages:** the newest `updated_at` among listed products of that gender.
  - **Home, offers, popular:** the newest product `updated_at`.
  - **Blog list:** the newest post `updatedAt`.
  - **Privacy:** `PRIVACY_POLICY_UPDATED_AT` (`app/lib/consent.ts`).
  - All values are written as W3C datetime (`toISOString()`, or the bare date for privacy).
- **Blog posts:** a new CMS query `listBlogPostsForSitemap()` in `app/.server/cms/content.ts`.
  - It fetches every published post per locale (paged at `MAX_PAGE_SIZE` until `pageCount`),
    with only `documentId`, `slug`, `locale` and `updatedAt`.
  - Posts are grouped by `documentId`, so a post that exists in both languages gets its
    translated slug (#84) in each `<loc>` and in the alternates.
  - A post that exists only in Ukrainian gets a single `uk` entry, with `hreflang` `uk` and
    `x-default` only. Its English URL would just serve the Ukrainian fallback, a duplicate.
  - Add `updatedAt` to the zod entry schema as `z.iso.datetime({ offset: true })`.
- **Strapi down:** `collectSitemapEntries` catches `CmsError` (`isCmsError`) from the blog query,
  logs a warning and still returns the DB-backed entries. In that case the response gets a short
  `Cache-Control: public, max-age=300`, so the full sitemap comes back soon. A database error
  still fails (500): there is nothing useful to serve without it.
- **Escaping:** `escapeXml` replaces `& < > " '` in every `<loc>`/`href` value. Slugs are ASCII
  today, but Strapi slugs are staff-edited, so they are encoded with `encodeURI` while the path is
  built, then escaped for XML.
- **robots.txt rules:**
  - `User-agent: *`.
  - `Disallow` for cart, checkout (covers success), account (covers orders and profile), login
    and register in both locales, from the #84 path table: e.g. `/koshyk`, `/en/cart`,
    `/oformlennia`, `/en/checkout`, `/kabinet`, `/en/account`, `/vkhid`, `/en/login`,
    `/reiestratsiia`, `/en/register`.
  - Plus the untranslated `/api/`, `/cms/`, `/payments/`, `/locale`, `/consent` and `/logout`.
    Also the legacy pre-#84 paths `/cart`, `/checkout`, `/account`, `/login` and `/register`, so
    URLs that only 301 aren't crawled into private pages (Q3).
  - The private list is a typed constant: `ROBOTS_PRIVATE_PAGES` (page keys) in
    `app/.server/seo/robots.ts`, mapped through the path table. A test fails if a page key is
    missing from the path table.
  - Then `Sitemap: <PUBLIC_SITE_URL>/sitemap.xml`.
- **Non-production:** `disallowAll` is true when `NODE_ENV !== "production"` **or**
  `ROBOTS_DISALLOW_ALL` is truthy. Add `ROBOTS_DISALLOW_ALL` to `app/.server/env.ts` as an
  optional boolean (`"true"`/`"1"`), with empty values counting as unset, like the other optional
  vars. It's for production-mode staging or preview servers. The output is then
  `User-agent: *\nDisallow: /` plus the `Sitemap:` line.
- **`PUBLIC_SITE_URL` comes from #85 (deviation, merged).** #85 added `PUBLIC_SITE_URL`
  (required in production) and `getSiteUrl(env, request)`, which falls back to the request's origin
  outside production. Step 1 therefore only adds `ROBOTS_DISALLOW_ALL`; the builders take `siteUrl`
  as a parameter, and the routes pass `getSiteUrl(getEnv(), request)`.
- **Migration number.** #83 also adds a migration (`0016_product_slug_history`). Whichever lands
  second renumbers its migration (regenerate the journal and snapshot with `pnpm db:generate`
  after rebasing) and updates the rollback chains in `migrator.test.ts`.
- **Sitemap outside production:** still served (useful for checking), but `robots.txt` blocks
  everything, so nothing gets indexed.

## Resolved questions
- **Q1: Should products with a `null` slug be in the sitemap under their UUID URL?** — No. They
  are left out: the first Strapi sync backfills every slug, and a UUID URL would 301 later
  (source: owner's answer).
- **Q2: Should a variant price change (or restock) bump the product's `lastmod`?** — No. Only
  product row edits do. A staff price edit in Strapi still bumps it, because the sync calls
  `updateProduct` on every save. Checkout stock decrements don't (source: owner's answer).
- **Q3: Disallow the legacy English-segment Ukrainian paths (`/cart`, `/checkout`, `/account`,
  `/login`, `/register`) too?** — Yes. They only 301 after #84, and blocking them saves crawl
  budget on redirects to private pages (source: owner's answer).
- **Does `products.updated_at` exist?** — No. `products` has only `created_at`, so a migration
  adds it with the shared `updatedAt()` helper (source: `app/.server/db/schema.ts`).
- **Will product edits refresh it automatically?** — Yes. `insertProduct`, `updateProduct` and
  the active toggle use the Drizzle query builder (`app/.server/db/queries/products.ts`,
  `app/.server/services/cms-sync.ts`), so `$onUpdate` applies. The catalog import inserts rows,
  so `defaultNow()` applies.
- **What are "unlisted" products?** — Products without variants, which the catalog doesn't show.
  Archived ones are `active = false`. Both are excluded by `isListed` plus the variant join
  (source: `app/.server/AGENTS.md`, `app/.server/db/queries/products.ts`).
- **Where does the privacy page's date come from?** — `PRIVACY_POLICY_UPDATED_AT`
  (source: `app/lib/consent.ts`).
- **Does Strapi return `updatedAt` for blog posts?** — Yes, it's a standard Strapi 5 system field.
  It isn't in `blogPostSummaryEntry` yet, so the sitemap query adds it to its own schema
  (source: `app/.server/cms/schemas.ts`).
- **Which catalogs are listed?** — Women and men only (no Unisex; project decision).
- **How should a CMS outage be handled?** — Catch `CmsError` and fall back to the DB entries, per
  the issue. The usual `cmsUnavailable` (a 503) is not used here
  (source: issue #87, `app/.server/AGENTS.md` → CMS).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/env.ts` (+ `env.test.ts`) | `ROBOTS_DISALLOW_ALL`; `PUBLIC_SITE_URL` only if #85 hasn't added it |
| modify | `app/.server/db/schema.ts` | `products.updatedAt` |
| create | `app/.server/db/migrations/0017_product_updated_at.sql` (+ meta snapshot/journal via drizzle-kit) | add column, backfill from `created_at` |
| create | `app/.server/db/rollbacks/0017_product_updated_at.sql` | drop column |
| modify | `app/.server/db/migrator.test.ts` / `schema.test.ts` | column exists and refreshes on update |
| modify | `app/.server/db/queries/products.ts` | `listSitemapProducts()` |
| modify | `app/.server/cms/schemas.ts`, `app/.server/cms/content.ts` (+ tests, fixture) | `listBlogPostsForSitemap()` |
| create | `app/.server/seo/sitemap.ts` + `sitemap.test.ts` | entries, XML builder, escaping |
| create | `app/.server/seo/robots.ts` + `robots.test.ts` | robots builder and private page list |
| create | `app/routes/sitemap.xml.ts` + test | resource route |
| create | `app/routes/robots.txt.ts` + test | resource route |
| modify | `app/routes.ts` (+ `app/routes.test.ts` if it enumerates routes) | register both routes |
| modify | `README.md` | "SEO" section and the new env var |
| modify | `app/.server/AGENTS.md` | short note: sitemap and robots sources, `products.updated_at` |

## Steps
- [x] **1. Env** — Add `ROBOTS_DISALLOW_ALL` (optional, `z.stringbool()` or an enum of
  `"true"`/`"1"`; empty means unset) to `envSchema` in `app/.server/env.ts`. If `PUBLIC_SITE_URL`
  isn't there yet (#85 not merged), add it as `z.url()`, required when `NODE_ENV === "production"`
  (via `.refine`), defaulting to `http://localhost:${PORT}` in development and test. Tests in
  `env.test.ts`. Document both under "Environment variables" in `README.md`.
- [x] **2. `products.updated_at`** — In `schema.ts`, add `updatedAt: updatedAt()` to `products`.
  Update the helper's comment to name products too. Generate the migration
  (`pnpm db:generate` or the repo's drizzle-kit script). Hand-edit it to
  `ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()`, then
  `UPDATE products SET updated_at = created_at`, so the first sitemap doesn't claim that every
  product changed today. Add the matching rollback (`DROP COLUMN updated_at`). Test: `updateProduct`
  moves `updated_at` forward. Don't touch any ML column.
- [x] **3. Product query** — `listSitemapProducts()` in `db/queries/products.ts`: select `slug`,
  `publicId`, `gender`, `updatedAt` where `isListed`, the product has at least one variant (reuse
  the catalog's variant condition), and `slug is not null` (Q1: no UUID URLs). Order by `slug`. Integration test
  with the test DB: an archived product, a product without variants and a `null`-slug product are
  excluded.
- [x] **4. Blog query** — `blogPostSitemapEntry` zod schema (`documentId`, `slug`, `locale`,
  `updatedAt`) and `listBlogPostsForSitemap()` in `cms/content.ts`. It loops over `LOCALES` and
  pages with `fields: ["slug", "updatedAt", "locale"]` and `pagination.pageSize = MAX_PAGE_SIZE`
  until `pageCount`. It returns `{ documentId, slugs: Partial<Record<Locale, string>>,
  updatedAt }[]`, where `updatedAt` is the newest across locales. Test with a fetch-mock fixture,
  following the existing `__fixtures__` pattern: a post in both locales, and a Ukrainian-only post.
- [ ] **5. Sitemap builder** — `app/.server/seo/sitemap.ts`:
  - `type SitemapEntry = { alternates: Partial<Record<Locale, string>>; lastmod: string }`
    (relative paths).
  - `collectSitemapEntries({ products, posts, now })` builds the static pages, products and posts
    with `href()` / `productHref()` from #84 and #83, and the `lastmod` rules from Decisions.
  - `buildSitemapXml(entries, siteUrl)` emits one `<url>` per available locale. Each has an
    absolute `<loc>`, the `xhtml:link`s for every available locale, and `x-default` → the `uk`
    URL. Everything goes through `escapeXml`.
  - Tests:
    - Well-formed XML (parse with `DOMParser` from the jsdom/happy-dom test env, or check the
      structure).
    - `&` and `<` are escaped.
    - Every `<url>` has `uk`, `en` and `x-default` alternates, except the Ukrainian-only post.
    - No inactive product appears.
    - No private page (cart, checkout, account, login, register) appears.
    - `lastmod` values are valid ISO strings.
- [ ] **6. Robots builder** — `app/.server/seo/robots.ts`:
  - `ROBOTS_PRIVATE_PAGES` (page keys from #84's table), `ROBOTS_SYSTEM_PATHS` (`/api/`,
    `/cms/`, `/payments/`, `/locale`, `/consent`, `/logout`) and `ROBOTS_LEGACY_PATHS` (Q3: `/cart`, `/checkout`, `/account`, `/login`, `/register`).
  - `buildRobotsTxt({ siteUrl, disallowAll })`.
  - Tests:
    - Production lists both locales' paths for every private page (e.g. `/koshyk` and
      `/en/cart`), the system paths, and the `Sitemap:` line with the absolute URL.
    - `disallowAll` gives `Disallow: /` and no other `Disallow`.
    - No public page path (home, catalog, product, blog) is disallowed.
- [ ] **7. Routes** — `app/routes/sitemap.xml.ts`: the loader reads `getEnv()`, runs
  `listSitemapProducts()` and `listBlogPostsForSitemap()` in parallel (the CMS one with a `.catch`
  that logs and returns `null`), and returns a `Response` with XML headers. `max-age=3600`, or
  `300` when the CMS failed. `app/routes/robots.txt.ts`: `disallowAll = NODE_ENV !== "production"
  || ROBOTS_DISALLOW_ALL`. Register both at the top level of `app/routes.ts`, with a comment like
  the others. Route tests: content types, cache headers, and a CMS failure still giving 200 with
  product URLs (mock the services, as in `blog.test.ts`).
- [ ] **8. Docs** — `README.md` "SEO" section:
  - Where the files are (`/sitemap.xml`, `/robots.txt`).
  - `PUBLIC_SITE_URL` must be the public `https://` origin.
  - `ROBOTS_DISALLOW_ALL` is for staging.
  - Submitting `https://<domain>/sitemap.xml` in Google Search Console (Sitemaps → Add) and Bing
    Webmaster Tools (Sitemaps → Submit, or import from Search Console).
  - Checking with the URL Inspection tool.
  - Add a short note to `app/.server/AGENTS.md`.
- [ ] **9. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, then the
  manual checks below.

## Testing & verification
- Unit: `escapeXml`, `buildSitemapXml`, `collectSitemapEntries`, `buildRobotsTxt`, env parsing.
- Integration (test DB): `listSitemapProducts` filters, `products.updated_at` default, backfill
  and refresh on update, migration and rollback.
- CMS: `listBlogPostsForSitemap` paging and grouping, with fixtures.
- Routes: headers, CMS-down fallback.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`):
  - Open `/sitemap.xml`: the browser renders it as XML, it has both locales, and an archived
    product in Strapi disappears after a save.
  - Run it through an online sitemap validator (or `xmllint --noout`).
  - Stop the Strapi resource and reload: still 200, blog posts gone.
  - `/robots.txt` in development shows `Disallow: /`.
  - `pnpm build && NODE_ENV=production pnpm start` shows the full rule set.

## Acceptance criteria
- [ ] `/sitemap.xml` is valid XML and lists all public pages, active products and published posts
  in both languages with `hreflang` alternates and `lastmod` — steps 2, 3, 4, 5, 7.
- [ ] Archived products and private pages aren't listed — steps 3, 5.
- [ ] `/robots.txt` blocks private and action-only paths and links the sitemap. Non-production
  environments disallow everything — steps 1, 6, 7.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 9.

## Out of scope
- Sitemap index, image or news sitemaps (`<image:image>`), and `changefreq`/`priority` (Google
  ignores them).
- Paginated blog list pages (`/blog?page=2`) and filtered `/popular?family=…` URLs. Only canonical
  URLs are listed.
- Pinging search engines on change (Google retired the ping endpoint). Submission is manual, as
  documented in step 8.
- The metadata (`noindex`, canonical) itself, which is #85, and the path table and redirects,
  which are #84.
