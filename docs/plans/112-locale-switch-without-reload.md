# Plan: Switching the language only takes effect after a page reload (#112)

Issue: https://github.com/savchukolgaa/jassmin/issues/112
Branch: `issue/112`
Worktree: `.claude/worktrees/issue-112`
Status: Planned

## Goal

When a customer clicks UA or EN, the page should switch language right away, without a manual
reload: the URL, the interface text, the CMS content, the meta tags and `html lang`. This has to
work on every page, in both directions, with and without JavaScript. The scroll position, query
and hash must be kept as before (#82, #84), and tests must stop the bug from coming back.

## Root cause (reproduced while planning)

I reproduced it on a dev server started from this worktree (`origin/main` at `add64f9`), using
headless Edge driven over the DevTools protocol and curl against the routes:

| Start → target | URL | `html lang`, header, h1, title |
|---|---|---|
| `/` → EN (JS) | `/en` ✅ | **stay Ukrainian** ❌ |
| `/en` → UA, `/en/catalog/men` → UA, `/populiarni` ↔ `/en/popular`, `/katalog/zhinochi` → EN, `/koshyk` → EN, `/en/blog` → UA (JS) | ✅ | ✅ |
| `/` → EN, `/en` → UA, `/katalog/zhinochi` → EN (JS disabled) | ✅ | ✅ (full document load) |

The scroll position was kept in every JS case (#82). The `/locale` action is correct: a POST for
every page type returns a 302 to the right translated URL, keeping the query and hash, and sets
the cookie.

**The cause is that React Router v8 hands loaders and middleware the raw request URL of a
single-fetch data request.** After the redirect to `/en`, the client fetches `/en.data`. React
Router matches routes on the *normalized* path (`getNormalizedPath` in
`react-router/dist/*/lib/server-runtime/urls.js` strips `.data` / `_.data` and `_routes`), but it
passes `request` through unchanged. The normalized URL is only available as the separate `url`
argument of loaders, actions and middleware (see `DataFunctionArgs.url` in
`react-router/dist/*/lib/router/utils.d.ts`: "For the raw incoming URL, use `request.url`").

`getLocale(request)` (`app/.server/locale.ts`) runs `localeFromPath(new URL(request.url).pathname)`,
and `localeFromPath("/en.data")` is `"uk"`: the path is neither `/en` nor `/en/…`. So on a client
navigation to the English home page, the root loader, `_shop` loader and `home` loader all return
Ukrainian data (`curl /en.data` → `"uk"`; `curl /en/popular.data` → `"en"`). Every other English
page works only by luck, because `/en/<page>.data` still starts with `/en/`. A reload is a
document request (`/en`, no `.data`), which is why it "fixes itself".

So the bug isn't in `shouldRevalidate`, `I18nProvider`, `useContentLang`, the switcher or #96.
The root `shouldRevalidate` already returns `true` here, and the page routes get a new route id
per locale (`home.uk` → `home.en`), so their loaders always run. The test that should have caught
it, `app/.server/locale.test.ts` "resolves a single-fetch data request like its page", rests on
the wrong comment "React Router strips `.data` before loaders see the request" and never passes a
`.data` URL.

The same raw URL causes two more bugs I confirmed with curl:

- **Login redirect**: a logged-out client navigation to `/kabinet` requests `/kabinet.data`, and
  `requireUser` (`app/.server/services/auth.ts:39`, via `loginRedirectPath(new URL(request.url))`)
  redirects to `/vkhid?redirectTo=%2Fkabinet.data%3F_routes%3D…`. After logging in, the customer
  is sent to the raw data URL.
- **Locale middleware**: `localeRedirectMiddleware` calls `matchPage("/koshyk.data")`, gets
  `null`, and so never sends a visitor who chose English to the English page on client
  navigations (document requests work: `/koshyk` → 302 `/en/cart`).

## Dependencies & prerequisites

- #84 (locale in the URL, `localizedUrl`, `localeRedirectMiddleware`) and #82 (`preventScrollReset`)
  are merged on `origin/main`.
- No new packages, env vars or migrations.

## Decisions & assumptions

- **Fix it at the source, in one server helper.** Add `pageUrl(request): URL` in
  `app/.server/request-url.ts`. It returns the URL of the page a request is for, normalized like
  React Router does it: `…/_.data` → `…/`, a trailing `.data` removed, `_routes` dropped, with the
  origin, other params and `index` kept. `getLocale`, `localeRedirectMiddleware` and
  `requireUser` use it, so every existing caller of `getLocale(request)` (about 20 routes and
  services) is fixed without changing its signature.
  - The alternative is threading React Router's `url` argument through every caller
    (`getLocale(url)`). That's the official API, but it touches every loader, action, service and
    test that builds `{ request, params, context }`. Server helpers such as `shouldSuggestEnglish`
    and the header service only get `request`, so the URL would have to be passed down too. The
    helper duplicates about 10 lines of React Router's private normalization. A test pins it to
    the URLs React Router actually sends (see step 1), so a change in React Router shows up as a
    failing test, not a silent regression.
- **Fix the two side bugs in this issue (confirmed by the owner, 2026-11-03).** The login redirect and the
  locale middleware have the same root cause and a one-line fix each with `pageUrl`. Leaving them
  would keep `.data` URLs leaking into `redirectTo`.
- **Leave other `new URL(request.url)` reads alone**, for search params (catalog, popular, home,
  blog, product, login, register) and the origin (checkout, env, payments). On a data request they
  only gain `_routes`, which none of them reads, and the origin is the same. The analytics
  middleware already skips `.data` requests on purpose (`app/.server/analytics.ts:196`). List them
  in the helper's doc comment so the rule is clear.
- **Make the `shouldRevalidate` functions explicit about a language change.** They're correct
  today only because page route ids differ per locale. The issue asks for tests that cover "after
  an action" and "locale changed" for each one. Add `crossesLocale({ currentUrl, nextUrl })` in
  `app/lib/paths.ts` (isomorphic, next to `localeFromPath`). Then:
  - `root`: use the helper (same behaviour as today).
  - `home`, `popular`, `shouldRevalidateView` (`catalog`, `product`): return `true` first when the
    navigation crosses into the other language. Otherwise behave as today: cart, contact and
    other non-GET form posts stay `false`, so view events (`product_view`, `search`) aren't
    recorded twice and Strapi isn't hit for a quick add.
- **No change to `LocaleSwitcher`, `routes/locale.ts`, `I18nProvider` or `useContentLang`.** They
  behave correctly once the loaders return the right locale.
- Fix the wrong comment and test in `app/.server/locale.test.ts`.
- **Implementation note: steps 5 and 6 are one commit.** The new `crossesLocale` check reads
  `currentUrl`/`nextUrl`, which the existing `shouldRevalidate` tests didn't pass. React Router
  always passes them. Their arg builders had to gain those defaults in the same commit, which is
  where step 6's cases go. The catalog test that expected a `/locale` post to skip reloading now
  expects a reload when it crosses the language. Within one language a non-GET post still skips
  it (checked with `/koshyk` and `/consent` posts).

## Resolved questions

- **Q1: Fix the login `redirectTo` and the locale middleware on data requests in this PR?** —
  Yes, both, with tests (steps 3 and 4), and mention them in the PR. A visitor who chose English
  and follows a Ukrainian link client-side is now redirected to the English page, as #84
  intended. (source: the owner, 2026-11-03)

- **Does a `shouldRevalidate` return `false` after the `/locale` redirect?** — No. Root returns
  `true` (`localeFromPath` differs and `defaultShouldRevalidate` is `true` after an action). The
  page routes get new ids per locale (`pageRouteId`, `app/routes.ts`), so React Router always runs
  their loaders. The request log shows `GET /en.data` without `_routes`, so all loaders run.
  (source: reproduction above; `app/root.tsx`, `app/routes.ts`)
- **Does `localizedUrl` return the same URL for some pages?** — No. Checked with curl for home,
  catalog (with query and hash), product, popular, cart, blog and account in both directions.
  (source: `app/.server/paths.ts`, `app/routes/locale.test.ts`)
- **Does `getLocale` or the middleware prefer the cookie?** — No. `getLocale` reads only the URL,
  and the middleware only redirects GETs it can match. The URL it reads is the raw `.data` one,
  which is the bug. (source: `app/.server/locale.ts`, `app/.server/locale-middleware.ts`)
- **Do `I18nProvider` or `useContentLang` keep old state?** — No. Both derive from the root
  loader's `locale` on every render. (source: `app/lib/i18n/react.tsx`)
- **Did #96 break client-side form handling?** — No. The switch is handled client-side (`POST
  /locale.data`, same document, scroll kept). (source: reproduction)
- **Does it work without JS?** — Yes, in both directions: a document request has no `.data`.
  (source: reproduction)
- **Does React Router v8 normalize `request.url` for loaders?** — No. Only the `url` argument and
  route matching are normalized. (source: `react-router@8.5.0` `server-runtime/server.js`,
  `router/router.js` `callDataStrategyImpl`, `router/utils.d.ts`)

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `app/.server/request-url.ts` | `pageUrl(request)`: the page URL of a document or single-fetch request |
| create | `app/.server/request-url.test.ts` | Normalization cases (`/en.data`, `/_.data`, `_routes`, `index`, origin) |
| modify | `app/.server/locale.ts` | `getLocale` reads `pageUrl(request)` |
| modify | `app/.server/locale.test.ts` | Replace the wrong "strips `.data`" test with real `.data` URLs; `shouldSuggestEnglish` on `/_.data` |
| modify | `app/.server/locale-middleware.ts` | Match `pageUrl(request)` |
| modify | `app/.server/locale-middleware.test.ts` | Redirects a data request for a Ukrainian page to the English page |
| modify | `app/.server/services/auth.ts` | `loginRedirectPath(pageUrl(request))` |
| modify | `app/.server/services/auth.test.ts` | `redirectTo` has no `.data` / `_routes` |
| modify | `app/lib/paths.ts` | `crossesLocale({ currentUrl, nextUrl })` |
| modify | `app/lib/paths.test.ts` (existing paths test) | `crossesLocale` cases |
| modify | `app/root.tsx` | `shouldRevalidate` uses `crossesLocale` |
| modify | `app/root.test.ts` | Root loader returns `en` for `/en.data`; `shouldRevalidate` after an action / locale change |
| modify | `app/routes/home.tsx`, `app/routes/popular.tsx`, `app/lib/analytics.ts` | Return `true` when the navigation crosses into the other language |
| modify | `app/routes/home.test.ts`, `app/routes/popular.test.ts`, `app/routes/catalog.test.ts`, `app/routes/product.test.ts` | `shouldRevalidate`: after the `/locale` action and on a locale change; home loader's `contentLocale` for `/en.data` |
| modify | `app/routes/_shop.test.ts` | Layout loader resolves English for `/en.data` (social links / `suggestEnglish`) |
| modify | `app/routes/locale.test.ts` | Covers every page type in both directions (already covers cookie and redirect) |

## Steps

- [x] **1. Add `pageUrl(request)`.** Create `app/.server/request-url.ts` with one exported function
  mirroring React Router's `getNormalizedPath`:
  ```ts
  /** The URL of the page `request` is for. React Router v8 passes loaders the raw request of a
   *  client navigation (`/en.data?_routes=…`) and normalizes only its `url` argument (#112). */
  export function pageUrl(request: Request): URL
  ```
  It works on a copy of `new URL(request.url)`: if `pathname` ends with `/_.data`, drop the
  `_.data`; else drop a trailing `.data`; then delete `_routes`. Keep `index` and other params, and
  the origin. Doc comment: when to use it (anything reading the *path*) and why search/origin reads
  can keep `request.url`. Tests in `request-url.test.ts`: `/en.data` → `/en`, `/_.data` → `/`,
  `/en/catalog/women.data?_routes=a,b&sort=new` → `/en/catalog/women?sort=new`, `/en.data?index`
  keeps `index`, a document URL is unchanged, and a path merely containing `.data` in the middle
  (`/blog/a.data-b`) is unchanged.
- [x] **2. Use it in `getLocale`.** `app/.server/locale.ts`:
  `localeFromPath(pageUrl(request).pathname)`. Update the doc comment. In `locale.test.ts`, replace
  "resolves a single-fetch data request like its page" with real cases: `/en.data` → `en`,
  `/_.data` → `uk`, `/en/popular.data?_routes=x` → `en`, `/koshyk.data` → `uk`. Add
  `shouldSuggestEnglish` on `/_.data` (true for an English browser without the cookie) and on
  `/en.data` (false). Run `pnpm vitest run app/.server` and check it fails before step 2 and passes
  after.
- [x] **3. Locale middleware on data requests.** `app/.server/locale-middleware.ts`: build
  `url` with `pageUrl(request)`. The redirect target is
  `localizedUrl(url.pathname + url.search, "en")`, which already gives the page URL; React Router
  turns a thrown redirect in a data request into a single-fetch redirect. Tests: a `GET
  /koshyk.data` with the `en` cookie throws a 302 to `/en/cart`, and `GET /en.data` with the `en`
  cookie passes through.
- [x] **4. Login redirect on data requests.** `app/.server/services/auth.ts`:
  `loginRedirectPath(pageUrl(request))`. Test: `requireUser` for a logged-out
  `/kabinet.data?_routes=…` redirects to `/vkhid?redirectTo=%2Fkabinet`, in the existing
  `app/.server/services/auth.test.ts`, following its mock pattern.
- [x] **5. `crossesLocale` and explicit `shouldRevalidate` rules.** In `app/lib/paths.ts` add
  `crossesLocale({ currentUrl, nextUrl }: { currentUrl: URL; nextUrl: URL }): boolean` (the
  `localeFromPath` comparison now inlined in `root.tsx`). Use it in `root.tsx`. In `home.tsx`,
  `popular.tsx` and `shouldRevalidateView` (`app/lib/analytics.ts`) add `currentUrl`/`nextUrl` to
  the destructured args and `if (crossesLocale(args)) return true;` before the existing rules.
  Update their comments. Unit-test `crossesLocale` in the paths test.
- [x] **6. Revalidation tests for every route with a `shouldRevalidate`.** In `root.test.ts`,
  `home.test.ts`, `popular.test.ts`, `catalog.test.ts` and `product.test.ts`, add a
  `describe("… shouldRevalidate")` (extend home's existing one) covering:
  - after the `/locale` action into the other language (`formMethod: "POST"`,
    `formAction: "/locale"`, `currentUrl` `/…` → `nextUrl` `/en/…`, `defaultShouldRevalidate:
    true`) → `true`;
  - a plain navigation that crosses the language (GET, `defaultShouldRevalidate: false` for root)
    → `true`;
  - existing opt-outs still `false` (home: contact form and cart posts; popular: cart posts;
    catalog/product: a cart post within the same language);
  - root after any action within the same language → `true` (`defaultShouldRevalidate`).
- [ ] **7. Loader-level regression tests for `.data` URLs.** These tests reproduce the actual bug:
  - `root.test.ts`: `loader({ request: new Request("http://localhost/en.data") })` returns
    `locale: "en"`, and `/_.data` returns `uk`.
  - `home.test.ts`: the home loader for `/en.data` asks the CMS for English and returns
    `contentLocale` `en` (mock as the existing loader tests do).
  - `_shop.test.ts`: the layout loader for `/en.data` passes `en` to `getSocialLinks` and returns
    `suggestEnglish: false`.
- [ ] **8. Extend the `/locale` action test.** In `app/routes/locale.test.ts`, add a table test
  over home, catalog, product, popular, cart, account and blog in both directions, checking the
  `Location` header, plus the existing cookie assertions. This covers the issue's "route-level
  test" bullet. The redirect logic itself was already correct.
- [ ] **9. Verify in the browser.** Run `pnpm aspire run`, or `pnpm react-router dev` in the worktree
  with the main checkout's DB/Strapi running. Check home, both catalogs, a product, popular, cart,
  account (logged in) and blog, uk → en and en → uk, with JS and with JS disabled. Confirm the URL,
  header text, page text and CMS content, `document.title` and `html lang` all switch with no
  reload. Confirm the scroll position, query (`?sort=…`) and hash are kept. Also check logged-out
  `/kabinet` via a client link → login → back to `/kabinet` (step 4).
- [ ] **10. Checks.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Testing & verification

- New and updated unit tests: steps 1, 2, 3, 4, 5, 6, 7, 8. The key regression tests are the
  `.data` cases in step 2 and step 7. Before the fix they fail (`/en.data` → `uk`).
- A DOM test of clicking the switcher (issue: "if feasible") wouldn't catch this bug. It lives in
  the server's URL handling, and a `createRoutesStub` test never builds a `.data` request. The
  loader tests in step 7 exercise the real failure instead. Don't add a DOM test.
- Manual browser matrix in step 9.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` must pass.
- Note for anyone testing with curl from Git Bash: set `MSYS_NO_PATHCONV=1`. Otherwise
  `-d "redirectTo=/…"` is rewritten to a Windows path, and `/locale` sends every page home, which
  looks like a bug but isn't.

## Acceptance criteria

- [ ] Clicking UA or EN switches the page to that language immediately, without a manual reload:
  the URL, the interface text, the CMS content and `html lang` all update — steps 1, 2, 9
- [ ] It works on every page (home, catalogs, product, popular, cart, account, blog), in both
  directions, with and without JavaScript — steps 2, 8, 9
- [ ] The scroll position and the URL's query and hash are kept (#82, #84) — no change to the
  switcher or action; verified in steps 8, 9
- [ ] Tests cover the revalidation, so the bug can't come back unnoticed — steps 2, 5, 6, 7
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 10

## Out of scope

- The switcher's design and the `LanguageHint` banner (they work once the loaders are fixed).
- Moving loaders to React Router's `url` argument across the app (see Decisions).
- Search-param and origin reads of `request.url` (unaffected by `.data`).
