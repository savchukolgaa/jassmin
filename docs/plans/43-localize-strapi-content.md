# Plan: Translate Strapi CMS content (home page, site settings, blog) into Ukrainian and English (#43)

Issue: https://github.com/savchukolgaa/jassmin/issues/43
Branch: `issue/43`
Worktree: `.claude/worktrees/issue-43`
Status: Planned (open questions answered 2026-10-24)

## Goal
A visitor who picks English should see the home page hero, about and location copy, the
customer-service hours and blog articles in English, not only the UI around them. Turn on Strapi
v5's built-in i18n for `home-page`, `site-setting` and `blog-post` (`uk` default, `en` second),
have the app request CMS content in the visitor's locale (`getLocale(request)`), and fall back to
the Ukrainian version whenever an English localization is missing.

## Dependencies & prerequisites
- UI i18n (#28, merged as #42): `Locale`, `DEFAULT_LOCALE`, `LOCALES`, `isLocale` in
  `app/lib/i18n/locales.ts`; `getLocale(request)` in `app/.server/locale.ts`. Present on `origin/main`.
- Strapi CMS (`cms/`, `@strapi/strapi` 5.59.0) and the CMS client (`app/.server/cms/`). Present.
- Blog routes (#13) already send `Vary: Cookie, Accept-Language` (`BLOG_VARY` in `app/lib/blog.ts`).
- No new packages, env vars or app (Drizzle) migrations. One Strapi database migration (step 2).
- Verifying the Strapi side needs a running local Strapi (`pnpm aspire run` or `pnpm cms:dev`)
  with existing content, to check the "no content lost" criterion against a real database.

## Decisions & assumptions
- **Locale codes** are `uk` and `en` in both Strapi and the app, so `Locale` is passed to Strapi
  unchanged (no mapping table).
- **Locales are ensured at Strapi startup**, not only by the seed: a `ensureLocales(strapi)` step
  in `cms/src/index.ts` `bootstrap` creates `uk` and `en` via
  `strapi.plugin("i18n").service("locales")` when missing and makes `uk` the default. It's
  idempotent and also covers a fresh setup where nobody runs the seed. `pnpm cms:seed` loads
  Strapi, so the bootstrap runs before it seeds.
- **Existing content becomes `uk`, by an explicit migration.** A fresh Strapi's default locale is
  `en`, and when i18n is enabled on a content type, Strapi's i18n plugin assigns existing rows the
  *current default* locale during schema sync, which runs before app `bootstrap`. Without help,
  existing Ukrainian content would be tagged `en`. So `cms/database/migrations/` gets a migration
  (user migrations run before schema sync) that, when the tables exist, inserts the `uk` row into
  `i18n_locale` if missing and sets the i18n default locale (core store
  `plugin_i18n_default_locale`) to `uk`; then the plugin's own enable step tags existing rows
  `uk`. The migration also re-tags rows of the three tables that are `null` or `en` with no `uk`
  sibling (same `document_id`) to `uk`, as a safety net. It's a no-op on a fresh database.
  Step 1 verifies this behaviour on a copy of the local DB before it's written. (Q1, confirmed)
  **Spike result (step 1, Strapi 5.59):** there was no existing `strapidb` on this machine (the
  Aspire database container wasn't running), so the upgrade was simulated in throwaway databases
  on the `jassmin-pg` container: seed on the old schema → rows have `locale = NULL`, default
  `"en"`; enabling i18n without the migration tags every row `en`. With the migration, user
  migrations do run before the i18n plugin's own `5.0.0-03-created-locale` step, and every row
  (both versions of each post, drafts too) ends up `uk`. On a database already booted with i18n
  (all rows `en`), the migration's safety net re-tags them `uk`. On a fresh database the migration
  is a no-op and the bootstrap creates `uk` (default) and `en`; a second boot changes nothing.
- **Localized vs shared fields** follow the issue exactly. In Strapi v5, a component field's
  localization is set on the component attribute in the content type schema, and non-localized
  attributes are copied to every locale on save:
  - `blog-post`: `title`, `excerpt`, `content`, `authorName`, `seo` localized; `slug`, `coverImage` not.
  - `home-page`: `hero`, `about`, `location` localized (the whole component is per locale).
    `hero.image`, `hero.ctaHref` and `location.mapEmbedUrl` live inside those components, so Strapi
    can't share them across locales; the seed and the editor docs copy them into `en`. (Q2, confirmed)
  - `site-setting`: `customerServiceHours` localized; `phone`, `email`, `socialLinks` not.
- **One fallback helper** in `content.ts`:
  `withLocaleFallback(locale, (l) => fetchOne(l))` calls the fetcher with `locale`, and only when
  the result is `null` and `locale !== DEFAULT_LOCALE` calls it again with `DEFAULT_LOCALE`. Single
  types turn a `CmsError` with `kind: "http"` and `status: 404` into `null` (a `notFoundAsNull`
  helper); every other error still throws and becomes a 503. A `uk` request never retries.
- **Blog list in English shows every published Ukrainian post, in English where available**
  (the issue's preferred behaviour, without the pagination problem). Ukrainian is the source of
  truth, so the list paginates over `uk` posts (`locale=uk`, sorted `publishedAt:desc`, same
  `page`/`pageSize` meta as today). For an `en` request, a second query fetches the `en`
  localizations of that page's posts (`filters[documentId][$in]=…`, `locale=en`,
  `pagination[pageSize]=<page size>`) and each `uk` entry is replaced by its `en` sibling when one
  exists. Two requests per English page, one for Ukrainian (unchanged). Consequence: a post
  published in `en` but not in `uk` isn't listed, which matches "Ukrainian content must always exist".
- **Blog post by slug:** query `filters[slug][$eq]` with `locale=<locale>`, fall back to `uk` with
  the helper. Slugs aren't localized, so `/blog/:slug` is the same URL in both languages and the
  language switcher keeps the reader on the article.
- **`cmsFetch(path, query, schema, { locale })`**: an optional 4th options argument (keeps the
  existing 3-argument calls valid) that adds `locale=<code>` next to `status=published`.
- **DTOs gain `locale: Locale`**, the locale the content was actually served in: `HomePage`,
  `SiteSettings`, `BlogPostSummary` (so `BlogPost` too) in `app/lib/cms.ts`. The zod entries gain
  `locale: z.string().nullish()`; the mappers use `isLocale(entry.locale) ? entry.locale : requested`.
  `BlogPostCardView` / `BlogPostView` carry it on, and `BlogArticle` and `BlogPostCard` set
  `lang={post.locale}` on their `<article>` only when it differs from the UI locale (`useT().locale`),
  so the Ukrainian UI renders the same markup as before. The home page sections (hero, about,
  location) get the same `lang` treatment via `HomePageView.contentLocale`. (Q3, confirmed)
  **Changed during step 8:** `lang` goes on the CMS-text elements, not on the whole `<article>` /
  `<section>`, because those also hold UI copy in the page's language (eyebrows, the back link,
  the date label), which `lang="uk"` would mislabel. A `useContentLang(locale)` hook in
  `app/lib/i18n/react.tsx` returns the value only when it differs from the UI locale, and
  `RichText` takes a `lang` prop. Marked: the hero text block, about title and body, address and
  opening hours, customer-service hours (wrapped in a `<span>`), and a post's title, excerpt and
  body (card and article).
- **Home route cache headers:** `app/routes/home.tsx` sets no cache headers today, so nothing to vary.
- **Seed text:** the current seed stores English copy in what becomes the `uk` localization. The
  seed is rewritten to create real Ukrainian copy as `uk` and the current English copy as `en`.
  Existing local databases keep their content (the seed skips existing `uk` entries), but get the
  missing `en` localizations added.
- **Seeding a new localization (step 4 finding):** `documents.update({ documentId, locale: "en",
  data })` creates the `en` version, but doesn't fill non-localized fields by itself (it failed
  with `slug must be a string`), so the seed passes `slug` and `coverImage` in every locale's data.
  Checked against Strapi 5.59 REST with the read-only token: `?locale=en` returns `locale: "en"`,
  a missing single-type localization answers 404, and a missing post gives an empty `data` list.
- **Token permissions stay as they are.** `locale` is a query parameter of `find`/`findOne`; the
  app never lists locales, so `TOKEN_PERMISSIONS` needs no `plugin::i18n.*` action.

## Resolved questions
- **Q1: How do existing rows end up as `uk` when i18n is enabled?** — Use the migration described
  in Decisions: set the default locale to `uk` before schema sync, then re-tag `null` / `en`-only
  rows of the three tables to `uk`. Step 1 still checks Strapi 5.59's actual behaviour on a dump
  of the local `strapidb`, and step 2 is adjusted if it differs (source: user, 2026-10-24).
- **Q2: May `hero.image`, `hero.ctaHref` and `location.mapEmbedUrl` be stored per locale?** —
  Yes. Keep the `hero` / `location` components as they are and localize them whole (Strapi v5
  can't localize single fields inside a component); the seed copies the three values into `en`,
  and the editor docs say to copy them when adding a translation (source: user, 2026-10-24).
- **Q3: Set `lang` on the home page sections too?** — Yes: on the hero, about, location sections
  and the customer-service hours, when the content locale differs from the UI locale, like the
  blog article and cards (source: user, 2026-10-24).
- **Which locale codes?** — `uk` and `en`, identical to the app's `LOCALES` (source: `app/lib/i18n/locales.ts`).
- **Where does the request locale come from?** — `getLocale(request)`: cookie → `Accept-Language`
  → `uk` (source: `app/.server/locale.ts`). The blog loaders already call it.
- **Does the home route set cache headers that would need `Vary`?** — No, it has no `headers`
  export (source: `app/routes/home.tsx`). Blog routes already vary on `Cookie, Accept-Language`
  (source: `app/lib/blog.ts` `BLOG_VARY`).
- **Is a 404 distinguishable?** — Yes: `cmsFetch` throws `CmsError("http", …, { status })` for
  non-2xx (source: `app/.server/cms/client.ts`, `app/.server/cms/errors.ts`).
- **Are site settings used outside the home page?** — No, only `app/routes/home.tsx` calls
  `getSiteSettings` (source: grep of `app/`).
- **Does the read-only token need new permissions?** — No; `locale` is a `find` query param
  (source: `cms/scripts/seed.ts` `TOKEN_PERMISSIONS`; Strapi v5 REST `locale` parameter).
- **Pagination for the English blog list** — solved by paginating over `uk` and overlaying `en`
  siblings by `documentId`, so the issue's preferred behaviour needs no compromise (see Decisions).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `cms/src/api/blog-post/content-types/blog-post/schema.json` | Enable i18n; mark attributes localized / not |
| modify | `cms/src/api/home-page/content-types/home-page/schema.json` | Enable i18n; localize `hero`, `about`, `location` |
| modify | `cms/src/api/site-setting/content-types/site-setting/schema.json` | Enable i18n; localize `customerServiceHours` only |
| modify | `cms/src/index.ts` | `ensureLocales` in `bootstrap` (`uk` default, `en`) |
| create | `cms/database/migrations/2026.10.24T00.00.00.default-locale-uk.js` | Make `uk` the default before i18n is enabled; keep existing rows as `uk` |
| modify | `cms/scripts/seed.ts` | Seed `uk` + `en` home page, settings, one post; keep one `uk`-only post; idempotent |
| modify | `cms/types/generated/contentTypes.d.ts` | Regenerated by `strapi develop` after the schema change |
| modify | `app/.server/cms/client.ts` | `cmsFetch` options `{ locale }` → `locale=<code>` |
| modify | `app/.server/cms/client.test.ts` | Locale param tests |
| modify | `app/.server/cms/schemas.ts` | `locale` on the entries |
| modify | `app/.server/cms/content.ts` | `locale` arguments, `withLocaleFallback`, `notFoundAsNull`, English list overlay |
| modify | `app/.server/cms/content.test.ts` | Locale + fallback tests |
| create | `app/.server/cms/__fixtures__/home-page.en.json`, `site-setting.en.json`, `blog-post-by-slug.en.json`, `blog-posts.en.json` | Recorded `en` responses |
| modify | `app/.server/cms/__fixtures__/*.json` | Re-recorded with `locale: "uk"` |
| modify | `app/lib/cms.ts` | `locale: Locale` on `HomePage`, `SiteSettings`, `BlogPostSummary` |
| modify | `app/lib/blog.ts`, `app/.server/services/blog.ts` | Carry `locale` into card/article views |
| modify | `app/lib/home.ts`, `app/.server/services/home.ts` | `contentLocale` on `HomePageView` |
| modify | `app/features/blog/BlogArticle.tsx`, `app/features/blog/BlogPostCard.tsx` | `lang` when content locale ≠ UI locale |
| modify | `app/features/home/HeroSection.tsx`, `AboutSection.tsx`, `LocationSection.tsx`, `ContactsSection.tsx` | Same `lang` treatment (Q3) |
| modify | `app/routes/home.tsx`, `app/routes/blog.tsx`, `app/routes/blog-post.tsx` | Pass `await getLocale(request)` to the content queries |
| modify | `app/routes/home.test.ts`, `app/routes/blog.test.ts`, `app/routes/blog-post.test.ts` | Assert the request's locale is passed |
| modify | `app/.server/services/*.test.ts`, component tests | DTO `locale` field in test data; `lang` assertions |
| modify | `README.md`, `app/.server/AGENTS.md` | Editor guide for English translations; CMS locale notes |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [x] **1. Spike: confirm Strapi's i18n enable behaviour (Q1).** Dump the local `strapidb`
  (`pg_dump`) into a scratch database, point a throwaway `cms/.env` copy at it, enable
  `pluginOptions.i18n.localized` on `site-setting` only and start `pnpm cms:dev`. Check
  `select document_id, locale from site_settings` and `i18n_locale` / `strapi_core_store_settings`
  (`plugin_i18n_default_locale`). Then repeat with the migration from step 2 in place. Record the
  result in this plan (Decisions) and adjust step 2 if Strapi behaves differently. Don't commit
  the scratch config.

- [x] **2. Strapi locales: migration + bootstrap.**
  - Migration `cms/database/migrations/2026.10.24T00.00.00.default-locale-uk.js`
    (`module.exports = { async up(knex) { … } }`; Strapi v5 runs `.js` user migrations from this
    folder before schema sync). If `i18n_locale` doesn't exist, return (fresh DB). Otherwise insert
    `{ code: "uk", name: "Ukrainian (uk)" }` when missing (with a `document_id` and timestamps,
    matching the table's columns), set the core-store `plugin_i18n_default_locale` value to
    `"uk"`, and for `blog_posts`, `home_pages`, `site_settings` (if they have a `locale` column)
    set `locale = 'uk'` where it is `null`, or `en` with no `uk` row for the same `document_id`.
  - `cms/src/index.ts`: `ensureLocales(strapi)` before `warnAboutPublicAccess` — via
    `strapi.plugin("i18n").service("locales")`: `find()`, `create({ code, name })` for missing
    `uk`/`en`, `setDefaultLocale({ code: "uk" })` if the default isn't `uk`; log what changed.
  - Check: start Strapi on an empty DB → Settings → Internationalization shows Ukrainian (default)
    and English; restart → no duplicates.

- [x] **3. Localize the content types.** Add `"pluginOptions": { "i18n": { "localized": true } }`
  at the top level of the three `schema.json` files and on each attribute:
  `{ "i18n": { "localized": true|false } }` as listed in Decisions. Start `pnpm cms:dev` once so
  `cms/types/generated/*.d.ts` regenerate; commit them. Check on the existing local DB: existing
  content shows as Ukrainian in the admin, nothing is lost, the content-manager locale picker
  offers English, and `curl -H "Authorization: Bearer $STRAPI_API_TOKEN" "$STRAPI_URL/api/home-page?locale=en"`
  answers 404 while `?locale=uk` returns the old content.

- [x] **4. Seed both locales.** In `cms/scripts/seed.ts`:
  - Split each seed record into shared fields and per-locale copy (`{ uk: {...}, en: {...} }`).
    Write real Ukrainian copy for `uk` (hero headline/CTA label, about title/body, address,
    opening hours, customer-service hours, post title/excerpt/content/SEO); the current English
    copy becomes `en`.
  - Home page / site settings: `findFirst({ locale: "uk" })` → else `create({ locale: "uk", data })`;
    then `findFirst({ locale: "en" })` → else `update({ documentId, locale: "en", data })`
    (Strapi v5 creates a localization through `update` with a new `locale`). The `en` hero copies
    `image`, `ctaHref` and `mapEmbedUrl` (Q2).
  - Blog posts: `how-to-choose-a-perfume` gets `uk` + `en` (both published);
    `fragrance-families-explained` stays `uk`-only (the fallback case); the draft stays a `uk`
    draft. Check existence per locale with `findFirst({ filters: { slug }, locale, status: "draft" })`;
    create the `en` localization with `update({ documentId, locale: "en", data, status: "published" })`
    (or `publish({ documentId, locale: "en" })` after it, whichever 5.59 supports).
  - Update the file's header comment and the log lines (`Created en home page`, …).
  - Check: `pnpm cms:seed` twice on a fresh DB → second run creates nothing; `curl` with
    `?locale=en` returns English for the home page, site settings and the first post.

- [x] **5. `cmsFetch` locale option.** `app/.server/cms/client.ts`: add
  `options: { locale?: Locale } = {}` as 4th parameter; build the search with
  `{ ...query, ...(options.locale ? { locale: options.locale } : {}), status: "published" }`.
  Update the JSDoc. Tests in `client.test.ts`: `locale=en` is sent when given, absent when not,
  and a 404 still rejects with `{ kind: "http", status: 404 }`.

- [x] **6. Schemas, DTOs and mappers carry the served locale.** `schemas.ts`: `locale:
  z.string().nullish()` on `homePageEntry`, `siteSettingEntry`, `blogPostSummaryEntry`.
  `app/lib/cms.ts`: `locale: Locale` (import type from `./i18n/locales` to stay isomorphic) on
  `HomePage`, `SiteSettings`, `BlogPostSummary`. Mappers `toHomePage(entry, baseUrl, requested)`,
  `toSiteSettings(entry, requested)`, `toBlogPostSummary(entry, baseUrl, requested)` resolve it
  with `isLocale(entry.locale) ? entry.locale : requested`. Update existing mapper tests and test
  data that build these DTOs (route, service and component tests) so `pnpm typecheck` passes.

- [x] **7. Locale-aware content queries with one fallback helper.** In `content.ts`:
  - `notFoundAsNull(error)`: returns `null` for `CmsError` `http`/404, rethrows anything else.
  - `withLocaleFallback<T>(locale, fetch: (l: Locale) => Promise<T | null>): Promise<T | null>`.
  - `getHomePage(locale = DEFAULT_LOCALE)` / `getSiteSettings(locale = DEFAULT_LOCALE)`: fetch with
    `{ locale: l }`, `.catch(notFoundAsNull)`, through the helper; if even `uk` is missing, throw
    the original 404 `CmsError` so the loader still turns it into a 503 as today.
  - `getBlogPostBySlug(slug, locale = DEFAULT_LOCALE)`: the existing slug query with `{ locale: l }`
    through the helper (`null` when there's no entry).
  - `listBlogPosts({ page, pageSize, locale })`: add `locale` (`z.enum(LOCALES).default(DEFAULT_LOCALE)`)
    to `listBlogPostsInput`; fetch the page with `locale: "uk"`; if `locale !== DEFAULT_LOCALE` and
    the page isn't empty, fetch `blog-posts` with `filters: { documentId: { $in: ids } }`,
    `pagination: { page: 1, pageSize: ids.length }`, `populate: ["coverImage"]`, `{ locale }`, and
    replace entries by `documentId`. Pagination meta always comes from the `uk` query.
  - Update the top-of-file comment and JSDoc (fallback rules).

- [x] **8. Views and `lang` attributes.** `BlogPostCardView` / `BlogPostView` gain `locale`
  (`toCardView` copies it). `HomePageView` gains `contentLocale` (from `homePage.locale`) and
  `contacts` keeps `SiteSettings` (with its `locale`). `BlogArticle`'s `<article>` and
  `BlogPostCard`'s `<article>` get `lang={post.locale !== locale ? post.locale : undefined}` with
  `const { locale } = useT()`; same for the home hero/about/location sections and the
  customer-service hours (Q3). Component tests: under `<I18nProvider locale="en">` a `uk` post has
  `lang="uk"`; with matching locales no `lang` attribute.

- [ ] **9. Loaders pass the request's locale.** `home.tsx`: resolve `getLocale(request)` first,
  then `Promise.all([getHomePage(locale), getSiteSettings(locale)])` (signature gains
  `{ request }: Route.LoaderArgs`). `blog.tsx` / `blog-post.tsx`: await `getLocale(request)` before
  the content call (it's cookie parsing only, so no parallelism lost) and pass it on. Route tests:
  with a `Cookie: locale=en` request, `toHaveBeenCalledExactlyOnceWith(..., "en")`; without one, `"uk"`.

- [x] **10. Fixtures.** Re-record `app/.server/cms/__fixtures__/*.json` from the seeded Strapi
  (`?locale=uk`) and record `*.en.json` (`home-page`, `site-setting`, `blog-post-by-slug`, and
  `blog-posts.en.json` for the documentId overlay). Keep the existing fixture shapes (same query
  strings as `content.ts`).

- [x] **11. Content tests.** In `content.test.ts`, with a `fetch` mock that routes by URL:
  - each query sends `locale=uk` / `locale=en`;
  - `getHomePage("en")` and `getSiteSettings("en")` with an `en` 404 return the `uk` content
    (`locale: "uk"`), two calls; with `en` present, one call and `locale: "en"`;
  - `getBlogPostBySlug(slug, "en")` falls back to `uk` when the `en` query is empty;
  - a `uk` request never retries (one call), and a `uk` 404 on a single type still throws `CmsError`;
  - `listBlogPosts({ locale: "en" })` overlays `en` entries by `documentId`, keeps `uk` ones
    without a translation, keeps `uk` pagination meta, and skips the second call for `uk` or an
    empty page;
  - non-404 errors (timeout, 500) on the `en` call don't fall back (they reject).

- [ ] **12. Docs.** `README.md` "Content (Strapi CMS)": locales (`uk` default, `en`), which fields
  are per language, how editors add an English translation (open the entry → locale dropdown →
  English → "Fill in from another locale" → translate → Save/Publish; copy the hero image, CTA
  link and map URL — Q2), the fallback rule, and that the seed now creates both locales. Mention
  the migration and the bootstrap locale check. `app/.server/AGENTS.md` CMS section: content
  queries take a `Locale`, use `withLocaleFallback`, DTOs carry `locale`, record `uk` and `en` fixtures.

- [ ] **13. Verify.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; then the manual checks below.

## Testing & verification
- Automated (Vitest): `client.test.ts` (locale param, 404 kind/status), `content.test.ts`
  (per-query locale, single-type and slug fallback, no retry for `uk`, no fallback on non-404
  errors, English list overlay), route tests for `home`, `blog`, `blog-post` (locale passed),
  `services/blog` / `services/home` tests (locale carried into views), component tests for
  `lang` on `BlogArticle`, `BlogPostCard` and the home sections.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (with `pnpm aspire run`):
  - Existing local DB after the upgrade: Strapi admin shows the old content as Ukrainian; nothing
    missing in the `uk` locale.
  - Fresh DB + `pnpm cms:seed -- --token`: Settings → Internationalization lists Ukrainian
    (default) and English; seed rerun creates nothing.
  - UI in English (switcher): home hero, about, location and customer-service hours in English;
    `/blog` lists the translated post in English and the `uk`-only post in Ukrainian (with
    `lang="uk"`); `/blog/how-to-choose-a-perfume` in English; `/blog/fragrance-families-explained`
    renders Ukrainian, no 404; switching language keeps the same URL.
  - UI in Ukrainian: pages render exactly as before (compare HTML of `/`, `/blog`, an article).
  - Delete the `en` home page localization in the admin → English UI shows Ukrainian home copy.
  - API token in Settings → API Tokens still lists only the four `find`/`findOne` actions.

## Acceptance criteria
- [ ] Strapi has `uk` (default) and `en` locales after a fresh `pnpm cms:seed` — steps 2, 4
- [ ] `home-page`, `site-setting` and `blog-post` are localized, with only text fields localized and slugs, media, links and contact details shared across locales — step 3 (component fields `hero.image`, `ctaHref`, `mapEmbedUrl` are per locale and copied, per Q2)
- [ ] Existing Ukrainian content is kept as the `uk` localization after enabling i18n (no content lost) — steps 1, 2, 3
- [ ] With the English UI, the home page hero, about, location and customer-service hours come from the `en` localization — steps 4, 7, 9
- [ ] With the English UI, blog list and article pages show `en` content, and `/blog/:slug` is the same URL in both languages — steps 3, 7, 9
- [ ] When an `en` localization is missing, the page renders the `uk` content instead of a 404 or error — steps 7, 11
- [ ] The Ukrainian UI renders exactly as before — steps 8, 9, 13
- [ ] The app's API token still only has read access — step 4 (`TOKEN_PERMISSIONS` unchanged), step 13
- [ ] Vitest covers the locale param and the fallback; `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — steps 5, 11, 13

## Out of scope
- Localizing product data (PostgreSQL today; #40's `product` content type gets its own follow-up).
- Locale-prefixed URLs (`/en/blog/...`) and `hreflang` alternate links.
- Translating media alt text (Strapi media library entries aren't localizable).
- Machine translation of existing content; editors add English translations in the Strapi admin.
- Moving `hero.image`, `ctaHref`, `mapEmbedUrl` out of their components (Q2: they stay per locale).
- Listing posts that exist only in `en` (Ukrainian is the source of truth).
