# Plan: Put the language in the URL with translated paths (/katalog/zhinochi, /en/catalog/women) and hreflang (#84)

Issue: https://github.com/savchukolgaa/jassmin/issues/84
Branch: `issue/84`
Worktree: `.claude/worktrees/issue-84`
Status: Planned

## Goal

Each language version of every page gets its own URL in that language. Ukrainian pages stay
unprefixed with transliterated Ukrainian segments (`/katalog/zhinochi`), and English pages live
under `/en/` with English segments (`/en/catalog/women`). The URL alone decides the language. The
switcher moves to the same page in the other language, every indexable page declares its
`hreflang` alternates, and old URLs answer with a 301, so English becomes indexable and links keep
the language they were shared in.

## Dependencies & prerequisites

- **#83 (readable product slugs) is OPEN and not implemented.** Branch `issue/83` has no commits
  beyond `main`. This plan assumes #83 is merged first. It provides the `products/:handle` route
  with slug/UUID/slug-history redirects, `product_slug_history`, and the `productHref(product)`
  helper. #84 renames the segment (`/parfumy/:handle`, `/en/perfumes/:handle`) and turns
  `productHref` into a call to `pathFor("product", …)`. **Do not start `/implement 84` until #83 is
  on `origin/main`;** rebase `issue/84` onto it first.
- #43 (per-locale Strapi content, `withLocaleFallback`), #28 (locale cookie, `app/.server/locale.ts`)
  and #82 (scroll kept on language switch, `LocaleSwitcher.dom.test.ts`) are merged.
- No new packages or env vars. React Router 8's typegen supports one module registered under
  several routes: `+types/<file>` gets the union of those routes (`fileToRoutes` in
  `@react-router/dev` typegen). No Drizzle migration. One Strapi schema change plus a Strapi DB
  migration (blog slugs).
- #85 (metadata), #87 (sitemap/robots) build on the path table defined here and stay out of scope.

## Decisions & assumptions

### Path table (final)

One table in `app/lib/paths.ts` (isomorphic) is the single source of truth. Patterns are
React Router path patterns without a leading slash. English patterns get the `en/` prefix when
registered and when building URLs.

| Page key | Ukrainian | English | Indexable |
|---|---|---|---|
| `home` | `` (index) | `en` | yes |
| `catalog` | `katalog/:gender` | `catalog/:gender` | yes |
| `product` | `parfumy/:handle` | `perfumes/:handle` | yes |
| `offers` | `aktsii` | `offers` | yes |
| `popular` | `populiarni` | `popular` | yes |
| `blog` | `blog` | `blog` | yes |
| `blogPost` | `blog/:slug` | `blog/:slug` | yes |
| `cart` | `koshyk` | `cart` | no |
| `checkout` | `oformlennia` | `checkout` | no |
| `checkoutSuccess` | `oformlennia/uspikh/:orderId` | `checkout/success/:orderId` | no |
| `checkoutPay` | `oformlennia/oplata/:orderId` | `checkout/pay/:orderId` | no (POST only) |
| `login` | `vkhid` | `login` | no |
| `register` | `reiestratsiia` | `register` | no |
| `account` | `kabinet` | `account` | no |
| `accountOrder` | `kabinet/zamovlennia/:id` | `account/orders/:id` | no |
| `accountProfile` | `kabinet/profil` | `account/profile` | no |
| `privacy` | `konfidentsiinist` | `privacy` | yes |

- Transliteration follows KMU resolution No. 55 (2010): `ї`/`й`/`я`/`є` inside a word → `i`/`i`/`ia`/`ie`,
  `ц` → `ts`, `х` → `kh`, `ж` → `zh`, `ь` dropped (e.g. `реєстрація` → `reiestratsiia`,
  `конфіденційність` → `konfidentsiinist`).
- **Translated parameter values:** the catalog's `:gender` is a logical value (`women`/`men`,
  `isCatalogGender`) mapped per locale (`women` → `zhinochi`/`women`, `men` → `cholovichi`/`men`)
  in the same file (`PARAM_SEGMENTS`). `pathFor` takes the logical value; matching returns it, so
  `catalog.tsx` keeps working with `women`/`men` after one `parseCatalogSegment(params.gender, locale)` call.
- **`checkout/pay/:orderId` becomes localized** (it's not in the issue's untranslated list, sits
  inside the layout, and must redirect to the success page in the visitor's language). It is not
  indexable.

### Helpers (`app/lib/paths.ts`)

- `pathFor(page, params, locale, { search?, hash? })`: builds every internal URL. It's named
  `pathFor` and not `href` to avoid clashing with React Router's own exported `href()` (the issue
  only proposed the name). Params are typed per page from the pattern (`PageParams<"product">` =
  `{ handle: string }`) and URI-encoded.
- `localeFromPath(pathname)`: `en` for `/en` and `/en/…`, else `uk`. Isomorphic, so `root.tsx`'s
  `<html lang>` and `I18nProvider` follow the URL on client navigations even when the root
  loader doesn't revalidate.
- `matchPage(pathname)`: `{ page, params, locale } | null` against the table (React Router's
  `matchPath`), with param values translated back to logical ones.
- `translatePath(pathnameWithSearchAndHash, toLocale)`: same page in the other locale, keeping
  query and hash. Isomorphic, so it can't translate blog slugs. The server wrapper below does.
- `matchLegacyPath(pathname)`: the 301 rules (see Redirects).
- `localizeInternalPath(path, locale)`: for **editor-written** app paths from Strapi (hero
  `ctaHref`/`secondaryCtaHref`, offer `ctaUrl`, seeded as `/popular`, `/catalog/women`,
  `/register`). It maps a legacy, Ukrainian or English path to the current locale's URL, so CMS
  links don't bounce English visitors to Ukrainian pages. It's used by `resolveCtaHref` /
  `toInternalPath` consumers. Seeds are updated to the new Ukrainian paths too.
- `usePathFor()` hook in `app/lib/i18n/react.tsx` (or next to `useT`): `(page, params, opts) =>
  pathFor(page, params, locale, opts)` with the locale from context. Components use the hook,
  server code uses `pathFor(…, await getLocale(request))`.

### Routing (`app/routes.ts`)

- `localizedRoute(page, file, children?)` generates two `route()` entries per page, uk and
  `en/…`, with explicit ids `<page>.uk` / `<page>.en`. `home` uses `index(file, { id: "home.uk" })`
  plus `route("en", file, { id: "home.en" })`. Account generates two trees (`account.uk` with
  children `accountOrder.uk`/`accountProfile.uk`, the same for `en`); its index child gets ids too.
- Layout ids are unchanged (`routes/_shop`, used by `useRouteLoaderData`). No other code looks up
  page route ids.
- Action-only, untranslated, unprefixed: `/locale`, `/logout`, `/consent`, `/api/events`,
  `/payments/*`, `/cms/*`. `logout` currently redirects to `/`. Its form gets a hidden `locale`
  field (zod `z.enum(LOCALES).catch("uk")`) so it lands on the right home page. `consent`'s action
  already returns to `redirectTo`.
- A top-level splat `route("*", "routes/redirects.tsx")`, outside `_shop` like today's unmatched
  URLs, applies the legacy 301s and otherwise throws a 404. That keeps the current 404 page and
  doesn't run the visitor middleware for bot probes. Its GET loader also answers HEAD.

### Locale resolution (`app/.server/locale.ts`)

- `getLocale(request)` returns `localeFromPath(new URL(request.url).pathname)` (same `Locale`
  type, so translators don't change). Single-fetch `.data` requests carry the page path once
  React Router strips `.data`; step 3 verifies this in a test.
- `parseAcceptLanguage` stays, now used only for the "View in English" hint.
- **Cookie redirect** (`localeRedirectMiddleware` in `app/.server/locale-middleware.ts`, exported as
  `middleware` from `root.tsx`): on GET/HEAD to a matched Ukrainian page when the `locale` cookie
  is `en` → `302` to `localizedUrl(request, "en")`. It never redirects on `Accept-Language`, and
  never when the cookie is `uk` or absent. The issue only asks for the English direction: the
  default language has nothing to "opt in" to.
- **Hint:** the root loader returns `suggestEnglish: boolean`. It's true on a Ukrainian URL with no
  `locale` cookie when `parseAcceptLanguage` gives `en`. `LanguageHint` (`app/components/layout/`)
  renders a small dismissible bar in English (`<I18nProvider locale="en">` around it, keys under
  `locale.hint.*` in both dictionaries). **(unconfirmed, Q1)**: "View in English" posts to `/locale`
  with `locale=en` (cookie + redirect), and dismiss posts `locale=uk` (cookie, same page), so the
  bar never returns.

### Switching language

- `LocaleSwitcher` still posts `redirectTo` (path + search + hash) to `/locale` with
  `preventScrollReset` (#82). The action validates with zod as today, sets the cookie, then
  redirects to `await localizedUrl(redirectTo, locale)` instead of `redirectTo`.
- `app/.server/paths.ts` → `localizedUrl(pathWithQuery, locale)`: `translatePath` for every page
  except `blogPost`. For a post it looks up the post by slug in its URL locale, takes its
  `documentId`, reads the other locale (`getBlogPostSlug(documentId, locale)`), and falls back
  to `pathFor("blog", {}, locale)` when there's no translation. Unknown paths go to the target
  locale's home. The cookie middleware and the hreflang data use the same function.

### Blog slugs (Strapi)

- `blog-post.slug` → `pluginOptions.i18n.localized: true` (`type: "uid"`, unique per locale in
  Strapi 5). Existing rows already hold the slug in every locale row (non-localized fields are
  copied per locale), so the migration
  `cms/database/migrations/2026.11.0xT00.00.00.localized-blog-slugs.js` only fills a missing
  locale slug from the Ukrainian row of the same `document_id`. It's idempotent and a no-op on a
  fresh DB, in the style of `shared-home-images.js`. Regenerate `cms/types/generated`.
- `getBlogPostBySlug(slug, locale)` in `app/.server/cms/content.ts`:
  1. Look up the slug in `locale` and render it if found.
  2. Otherwise, if `locale` is `en`, look it up in `uk`. If that post has an English translation,
     return `{ redirectTo: <en slug> }` (the route answers 301). If not, return the Ukrainian post
     (fallback under its Ukrainian slug, as the issue says).
  3. Otherwise `null` → 404.
- The post DTO gains `alternates: Partial<Record<Locale, string>>` (slug per locale it exists
  in), read via `documentId` + `locale`. The blog list's card links use the card's served slug
  under the current locale's prefix.

### hreflang & `<html lang>`

- `HreflangLinks` is rendered in `root.tsx`'s `<head>`. It uses `useLocation()` + `matchPage()`;
  for indexable pages it outputs `<link rel="alternate" hreflang="uk|en|x-default">` (absolute
  URLs; `x-default` = the Ukrainian URL). The origin comes from the root loader (`url.origin`).
  `blogPost` reads `alternates` from its loader data via `useMatches()`; a missing locale is
  omitted, and so is `x-default` when there's no Ukrainian version. Hreflang URLs drop the query
  string except catalog/blog/popular `?page=`, consistent with the existing canonicals.
- `<html lang>` = `localeFromPath(location.pathname)` (in place of the root loader value).
- Existing canonicals (`blog`, `blogPost`, `offers`, `popular`) switch to `pathFor(…, locale)`.
  Fuller metadata is #85.

### Redirects (`matchLegacyPath`, 301, query kept)

1. `/uk` and `/uk/…` → the same path without `/uk` (then resolved by the rules below in the same
   response, so there's only one hop).
2. Today's unprefixed English-segment paths (`/catalog/women`, `/products/<handle>`, `/offers`,
   `/popular`, `/cart`, `/checkout`, `/checkout/success/:id`, `/login`, `/register`,
   `/account…`, `/privacy`) → their Ukrainian path. `/products/<uuid>` lands on
   `/parfumy/<uuid>`, where #83's loader sends it on to the slug (a second 301, which is
   acceptable).
3. `/en/` + Ukrainian segments (e.g. `/en/koshyk`) → `/en/cart`. Unprefixed path with English
   segments is rule 2.
4. Anything else, including unknown `/en/…` → 404.

`/blog` and `/blog/:slug` are identical in uk, so they never hit the splat.

### Hard-coded paths guard

`app/lib/paths.guard.test.ts` scans `app/**/*.{ts,tsx}` (excluding `*.test.*`, `app/lib/paths.ts`,
`app/routes.ts`) for string/template literals starting with `/` followed by a table segment (uk
or en) or `to="/"`/`redirect("/")`, and fails with file:line. Action-only paths (`/locale`,
`/logout`, `/consent`, `/api/events`, `/payments/…`, `/cms/…`) are allowed. Doc comments are
skipped by matching only after `=`, `(`, `:` or `,` tokens.

### Caching

`BLOG_VARY` stays `Cookie, Accept-Language`: the cookie still decides the 302 and the session
header, and `Accept-Language` the hint. Update its comment.

## Open questions

- [ ] **Q1: What does dismissing the "View in English" hint do?** Why it matters: it decides
  whether a cookie is written and whether the bar ever returns. Recommended default: dismiss sets
  `locale=uk` via `/locale` (the visitor answered the question), and "View in English" sets
  `locale=en` and goes to the English URL. Affects step 8.
- [ ] **Q2: Should the hint also show on English URLs for browsers preferring Ukrainian?**
  Why it matters: it's a symmetric UX. Recommended default: no, as the issue only describes the
  English hint. Affects step 8.
- [ ] **Q3: Is the localized `checkoutPay` path (`/oformlennia/oplata/:orderId`) OK?** Why it
  matters: it's not in the issue's table. It's a POST-only URL, never shown. Recommended default:
  yes, localize it so its redirect keeps the language. Affects steps 2, 6.

## Resolved questions

- **Can one route module serve two route ids with usable `+types`?** Yes. RR 8 typegen maps a file
  to all its route ids and unions their params (source: `@react-router/dev` typegen,
  `fileToRoutes`).
- **Do order emails contain site links that need a locale?** No, `order-email.ts` builds no app
  URLs (source: `app/.server/services/order-email.ts`). The payment `resultUrl` does (source:
  `app/.server/services/payments.ts:102`) and gets `pathFor("checkoutSuccess", …, locale)`.
- **Where is the locale read today?** In `getLocale` (cookie → Accept-Language → uk), called by the
  root loader and individual loaders (source: `app/.server/locale.ts`, `app/root.tsx`). Keeping
  its signature means callers don't change.
- **Do CMS-authored links contain app paths?** Yes, `ctaHref`, `secondaryCtaHref` and offer `ctaUrl`
  (source: `cms/scripts/seed.ts`, `app/lib/links.ts`). They're handled by `localizeInternalPath`.
- **Is the blog slug currently shared?** Yes, `slug` is `localized: false` (source:
  `cms/src/api/blog-post/content-types/blog-post/schema.json`, `content.ts:340`).
- **Does #82 rely on the redirect going to the same path?** It relies on `preventScrollReset` on
  the switcher form (source: `LocaleSwitcher.tsx`, `LocaleSwitcher.dom.test.ts`). The test gets a
  case where the redirect goes to a different pathname.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `app/lib/paths.ts` (+ `paths.test.ts`) | Path table, `pathFor`, `localeFromPath`, `matchPage`, `translatePath`, `matchLegacyPath`, `localizeInternalPath` |
| create | `app/lib/paths.guard.test.ts` | Fails on hard-coded internal paths |
| create | `app/.server/paths.ts` (+ test) | `localizedUrl` incl. blog slug translation |
| create | `app/.server/locale-middleware.ts` (+ test) | Cookie → 302 to English URL |
| create | `app/routes/redirects.tsx` (+ test) | Splat: legacy 301s / 404 |
| create | `app/components/layout/HreflangLinks.tsx` (+ test) | `<link rel=alternate hreflang>` |
| create | `app/components/layout/LanguageHint.tsx` (+ test) | "View in English" bar |
| create | `cms/database/migrations/2026.11.0xT00.00.00.localized-blog-slugs.js` | Fill per-locale slugs |
| modify | `app/routes.ts` | `localizedRoute` helper, ids, splat |
| modify | `app/.server/locale.ts` (+ test) | URL-based `getLocale`, export hint check |
| modify | `app/root.tsx` | Middleware, `lang` from URL, hreflang, hint, origin in loader |
| modify | `app/routes/locale.ts` (+ test) | Redirect to translated URL |
| modify | `app/routes/logout.ts`, `account.tsx` | Hidden `locale` field, localized home redirect |
| modify | `app/routes/catalog.tsx` | Translate `:gender` segment |
| modify | `app/routes/product.tsx` | Rename segment, localized links (on top of #83) |
| modify | `app/routes/blog-post.tsx`, `blog.tsx`, `app/lib/blog.ts`, `app/.server/services/blog.ts` | Per-locale slug lookup, 301 to translated slug, alternates, localized hrefs/canonicals |
| modify | `app/.server/cms/content.ts`, `schemas.ts` (+ tests, fixtures) | Slug lookup by locale, `documentId`, alternates |
| modify | `cms/src/api/blog-post/content-types/blog-post/schema.json`, `cms/types/generated/*` | Localized `slug` |
| modify | `cms/scripts/seed.ts` | Ukrainian CTA paths, per-locale blog slugs |
| modify | `app/components/layout/nav.ts`, `Header.tsx`, `Footer.tsx`, `LocaleSwitcher.tsx` (+ dom test) | Localized links |
| modify | `app/lib/consent.ts`, `offers.ts`, `popular.ts`, `trio.ts`, `links.ts`, `auth.ts` | Replace `*_PATH` constants and `loginRedirectPath`/`safeRedirect` fallback with locale-aware helpers |
| modify | `app/features/**` (account, auth, blog, cart, catalog `ProductCard`, checkout `PaymentStatus`, consent `CookieBanner`, home `Bestsellers`/`CategoryTiles`, offers, popular, privacy) | `usePathFor()` for every link/form action |
| modify | `app/routes/{account,account._index,account.orders.$id,checkout,checkout-pay,checkout-success,consent,offers,popular,register}.tsx/ts`, `app/.server/services/auth.ts`, `payments.ts`, `session.ts` | Server redirects and links via `pathFor` |
| modify | `app/lib/i18n/uk.ts`, `en.ts` | `locale.hint.*` keys |
| modify | existing route/component tests | New paths |

## Steps

- [ ] **0. Rebase on #83.** Confirm #83 is merged and run `git -C "$WT" rebase origin/main`.
  Stop and tell the user if it isn't merged.
- [ ] **1. Path table and helpers.** Write `app/lib/paths.ts` with `PAGES` (`as const satisfies`,
  typed param names), `PARAM_SEGMENTS`, `pathFor`, `localeFromPath`, `matchPage`,
  `translatePath`, `matchLegacyPath`, `localizeInternalPath`. Tests: every page has both
  locales; segments match `^[a-z0-9-]+$` or `:param`; uk/en patterns are unique across pages; the
  `pathFor` ↔ `matchPage` round-trip for every page and locale; query/hash kept; legacy table
  cases.
- [ ] **2. Register localized routes.** `localizedRoute` in `app/routes.ts`, explicit ids, two
  account trees, `home.en`, localized `checkoutPay`, splat `redirects.tsx`. Run
  `pnpm typecheck` to confirm `+types` param unions compile. Old paths now 404 until step 4.
- [ ] **3. URL-based locale.** `getLocale` → `localeFromPath`. `root.tsx`: `lang`/`I18nProvider`
  from `useLocation()`; the loader returns `origin` and `suggestEnglish`. Update `locale.test.ts`:
  URL beats cookie and `Accept-Language`, and a `.data` request URL resolves like its page.
- [ ] **4. Legacy redirects and 404.** `routes/redirects.tsx` loader: `matchLegacyPath` → `301`
  with the query, else `throw data(null, { status: 404 })`. Tests per rule (old English paths,
  `/uk/…`, `/en/<uk segments>`, unknown `/en/x` → 404, query kept).
- [ ] **5. Server-side localized URL and cookie redirect.** `app/.server/paths.ts` `localizedUrl`
  (blog via step 7's content functions, mocked in tests). `locale-middleware.ts` exported from
  `root.tsx` `middleware`. Tests: cookie `en` on a uk page → 302 to the en URL; no cookie or
  `Accept-Language: en` only → no redirect; cookie `en` on an en page or a POST → no redirect.
- [ ] **6. Replace hard-coded paths.** Add `usePathFor()`. Convert, in this order: `nav.ts` (nav
  items become `{ page, params?, hash? }` resolved in `Header`/`Footer`), lib path constants
  (`OFFERS_PATH`, `POPULAR_PATH`, `PRIVACY_POLICY_PATH`, `popularHref`, `blogHref`,
  `blogPostHref`, `trio` target, `FALLBACK_CTA_PATH` → take a `locale`), features, routes, and
  server redirects (`checkout`, `checkout-pay`, `auth.ts` login redirect + `safeRedirect`
  fallback, `session.ts`, `payments.ts` `resultUrl`, `logout` with its hidden `locale`). CMS CTA
  links go through `localizeInternalPath`. Product links use #83's `productHref`, which now
  calls `pathFor("product", { handle }, locale)`. Update the affected tests.
- [ ] **7. Localized blog slugs.** Strapi schema + migration + `cms/types/generated` regen +
  seeds. `content.ts`: slug lookup per locale, the Ukrainian-slug-under-`/en` case
  (redirect / fallback), `alternates`. `blog-post.tsx` handles `redirectTo` with a 301. Update the
  `content.test.ts` fixtures.
- [ ] **8. Switcher and hint.** `/locale` action redirects to `localizedUrl(redirectTo, locale)`.
  Extend `LocaleSwitcher.dom.test.ts` so scroll is kept when the path changes (#82). Add
  `LanguageHint` with i18n keys in both dictionaries (Q1 default). Tests: the switch target for
  every page key, and a blog post with and without a translation.
- [ ] **9. hreflang.** `HreflangLinks` in the root `<head>`, with the canonicals moved to
  `pathFor`. Tests: an indexable page renders uk/en/x-default absolute URLs; a non-indexable page
  renders none; a uk-only blog post omits `en`.
- [ ] **10. Guard test.** `paths.guard.test.ts`, then fix anything it finds.
- [ ] **11. Verify.** `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, then the manual
  checks below.

## Testing & verification

- Unit: `paths.test.ts`, `paths.guard.test.ts`, `.server/paths.test.ts`,
  `locale.test.ts`, `locale-middleware.test.ts`, `redirects.test.ts`, `locale.ts` action test,
  `content.test.ts` (slug per locale), `HreflangLinks`/`LanguageHint` component tests (English via
  `<I18nProvider locale="en">`), the updated route tests, and `LocaleSwitcher.dom.test.ts`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`):
  - `/katalog/zhinochi` and `/en/catalog/women` render in their language whatever the browser
    language is.
  - Switching language on a scrolled catalog page keeps the scroll and lands on the other URL.
  - A blog post switches to its English slug, and a uk-only post falls back to `/en/blog`.
  - With `locale=en` set, opening `/koshyk` gives a 302 to `/en/cart`.
  - `curl -I /catalog/women` gives `301 /katalog/zhinochi`, and `/en/nope` gives 404.
  - View source shows hreflang links, and `<html lang="en">` under `/en`.
  - Login from `/en/account` returns to `/en/account`.
  - A card payment via the simulator returns to the localized success page.

## Acceptance criteria

- [ ] Every page has a Ukrainian URL with transliterated Ukrainian segments and an English `/en/...` URL with English segments, as in the finalized path table: steps 1, 2
- [ ] The URL alone decides the language, regardless of `Accept-Language`: step 3
- [ ] Switching language navigates to the same page's URL in the other language (blog posts use their translated slug, or fall back to the blog list), and the scroll position is kept (#82): steps 5, 7, 8
- [ ] A visitor with the `locale=en` cookie who opens a Ukrainian URL is redirected (302) to its English URL. Without the cookie there is no redirect: step 5
- [ ] Old URLs (`/catalog/women`, `/products/...`, `/cart`, …) and `/uk/...` redirect 301 to the new Ukrainian URLs, and unknown `/en/...` paths give 404: steps 2, 4
- [ ] Every internal link, form and server redirect keeps the current language. No hard-coded internal paths remain outside `app/lib/paths.ts`: steps 6, 10
- [ ] Every indexable page has `hreflang` links for `uk`, `en` and `x-default`: step 9
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass: step 11

## Out of scope

- Page metadata (titles, descriptions, OG tags beyond moving existing canonicals to `pathFor`):
  #85.
- Sitemap and robots.txt: #87.
- Localized product slugs (they stay shared, #83).
- Translating action-only endpoint paths.
- Redirecting by `Accept-Language`.
