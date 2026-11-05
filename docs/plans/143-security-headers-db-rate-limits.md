# Plan: Send security headers with a nonce-based CSP and keep rate limits in the database (#143)

Issue: https://github.com/savchukolgaa/jassmin/issues/143
Branch: `issue/143`
Worktree: `.claude/worktrees/issue-143`
Status: Planned

## Goal

As the store owner, I want every response to carry the standard browser security headers and the
login and form rate limits to survive restarts, so that customer accounts and data are protected
from common web attacks before the shop goes online. Concretely, the app sends a per-request
nonce-based Content-Security-Policy (report-only first, enforced by a flag), HSTS in production and
the other hardening headers. The rate-limit counters move from process memory into a PostgreSQL
`rate_limits` table, and the client IP is read from `X-Forwarded-For` only as far as
`TRUSTED_PROXY_HOPS` allows.

## Dependencies & prerequisites

- No open dependency issues. Builds on the existing root middleware (`localeRedirectMiddleware`
  in `app/root.tsx`), `visitorMiddleware`'s pattern of editing the response after `next()`
  (`app/.server/analytics-middleware.ts`), and `readLimitedBody` (`app/.server/client-events.ts`).
- `app/entry.server.tsx` doesn't exist yet. Create it with `pnpm react-router reveal entry.server`
  and keep the default streaming code (`renderToPipeableStream`, `isbot` → `onAllReady`).
- New env vars: `TRUSTED_PROXY_HOPS` (int ≥ 0, default 0) and `CSP_MODE`
  (`report-only` | `enforce`, default `report-only`).
- One migration (`0024_rate_limits`) plus its reverse in `db/rollbacks/`.
- The worktree has no `node_modules` yet: run `pnpm install` in it before step 1.

## Decisions & assumptions

**Headers and CSP**

- **Where the headers are set: a root middleware, `securityHeadersMiddleware`**
  (`app/.server/security-headers.ts`), listed first in `root.tsx`'s `middleware` so it wraps
  `localeRedirectMiddleware` and every route. Root middleware runs for pages, `.data` requests,
  every resource route (sitemap, robots, OG images, `/cms/*`, `/payments/*`, `/api/events`), the
  `*` redirects/404 route, and error-boundary responses, because they're all children of `root`.
  It generates the nonce (`randomBytes(16).toString("base64")`), stores it in a `nonceContext`
  (`createContext<string>()`), awaits `next()`, then sets headers on the returned response.
- **CSP only on HTML responses** (`Content-Type` starts with `text/html`). Every response gets the
  other headers. A CSP on XML/PNG/JSON does nothing, and the issue lists the non-CSP headers for
  resource routes.
- **Nonce plumbing.** `entry.server.tsx` reads `loadContext.get(nonceContext)` (with middleware,
  `loadContext` is the `RouterContextProvider`). It passes the nonce to `renderToPipeableStream({ nonce })`
  (React's own inline streaming scripts) and `<ServerRouter nonce>`, and wraps the tree in
  `<NonceProvider value={nonce}>`. `NonceProvider` / `useNonce()` live in `app/lib/nonce.tsx`
  (isomorphic React context). The root `Layout` puts `nonce` on the inline `JS_CLASS_SCRIPT`
  script, `<Links nonce>`, `<ScrollRestoration nonce>` and `<Scripts nonce>`. The nonce is **not**
  returned from a loader, so it never appears in the serialized loader data.
  **Hydration (found in step 4):** browsers hide a `<script>`'s nonce attribute (it reads `""`) but
  keep a `<link>`'s. So in the browser `useNonce()` reads the real nonce back from a nonced
  script's `nonce` property (scripts on the page can read it anyway), which makes `<Links>` match,
  and the inline theme script has `suppressHydrationWarning` for its hidden attribute.
- **Policy** (`buildCsp({ nonce, mode, env })`, a pure function):
  - `default-src 'self'`
  - `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-inline`). `<script type="application/ld+json">`
    data blocks (`components/JsonLd.tsx`) aren't executed, so CSP doesn't apply to them and they get
    no nonce (implementation: dropped the earlier "for consistency" idea, it only added noise).
  - `style-src 'self' 'unsafe-inline'`: **kept**. React `style={…}` attributes
    (`features/account/OrderProgress.tsx`'s progress width) and Vite dev's injected `<style>` tags
    need it, and style injection is low risk next to scripts. `docs/security.md` records how to
    remove it later (`style-src-attr` / a CSS-variable class).
  - `img-src 'self' data: <origin of STRAPI_URL>`: CMS and product images are absolute
    `STRAPI_URL` upload URLs (`cms/content.ts`, `routes/cms.products.ts`). OG images are same-origin.
  - `font-src 'self' data:`: fonts are bundled by `@fontsource` (`root.tsx`, `app.css`), and Vite
    inlines the subsets under 4 KB as `data:` URIs in the stylesheet (found in step 4; `data:` fonts
    can't run code).
  - `connect-src 'self'`, plus `ws:` in development only (Vite HMR). `/api/events` beacons are same-origin.
  - `frame-src https://www.google.com https://maps.google.com`: the home page's map `<iframe>` (`features/home/LocationSection.tsx`)
    loads Strapi's `mapEmbedUrl`, a Google Maps embed in the seed (`cms/scripts/seed.ts`).
  - `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`
  - Report-only mode: header `Content-Security-Policy-Report-Only`, `report-uri /csp-report` and
    `report-to csp` with `Reporting-Endpoints: csp="/csp-report"`. Enforced mode sends
    `Content-Security-Policy` and keeps the report directives, so violations are still logged.
- **Other headers** (`buildSecurityHeaders`): `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`,
  `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`.
  `Strict-Transport-Security: max-age=31536000; includeSubDomains` only when
  `NODE_ENV === "production"` **and** `PUBLIC_SITE_URL` is `https:`. The request's own scheme is
  `http` behind a TLS-terminating proxy, so it can't decide this. There's no `preload`.
- **`CSP_MODE`** defaults to `report-only` everywhere, so the first deploy can't break pages
  (issue assumption). It switches to `enforce` after a week of clean reports. Development and CI can
  set `enforce` to catch problems early.
- **`/csp-report`** (`routes/csp-report.ts`, action-only, outside the layout): accepts
  `application/csp-report` (`report-uri`) and `application/reports+json` (`report-to`). The body
  can be at most 16 KB (`readLimitedBody`), and requests are limited to 30 per IP per minute. The
  body is validated with a zod schema in `app/lib/csp-report.schema.ts`, and each violation is
  logged as one `console.warn("[csp]", { directive, blockedUri, documentPath, sourceFile, line })`.
  The document's query string is dropped, so no tokens or emails end up in logs. The route always
  answers 204, and 413/429 when it refuses a request. It makes **no DB writes**, so its limiter uses
  the in-memory store, not the table (a report flood mustn't become a write flood).
- **Static files** that `react-router-serve` serves with `express.static` (`/assets/*`, `public/`)
  never reach the app, so they don't get these headers. That's acceptable: securityheaders.com
  grades the HTML document, and hashed JS/CSS can't be framed or sniffed into HTML.

**Rate limits**

- **Table** `rate_limits`: `key varchar(200) primary key`, `count integer not null`,
  `reset_at timestamptz not null`, and an index on `reset_at` for pruning. It's an ordinary
  (logged) table, because an `UNLOGGED` one is emptied after a PostgreSQL crash. It isn't an ML
  table.
- **Keys don't store personal data.** The stored key is `<limiter name>:<sha256 hex of the key>`,
  e.g. `login-email:9f…`, so login emails and IPs never sit in the table in plain text. The name
  prefix keeps the limiters apart and readable when debugging.
- **Interface.** `createRateLimiter({ name, limit, windowMs, store, now })` keeps
  `isBlocked` / `hit` / `reset`, all returning `Promise`s. `RateLimitStore` has two
  implementations:
  - `createPgRateLimitStore(getDb)` does each hit as one atomic statement:
    `INSERT … VALUES (key, 1, now + window) ON CONFLICT (key) DO UPDATE SET count = CASE WHEN rate_limits.reset_at <= now THEN 1 ELSE rate_limits.count + 1 END, reset_at = CASE WHEN rate_limits.reset_at <= now THEN excluded.reset_at ELSE rate_limits.reset_at END`.
    Concurrent hits on the same key serialize on the row, so they're counted exactly.
    `isBlocked` is one `SELECT`; `reset` is a `DELETE`.
  - `createMemoryRateLimitStore()` is today's `Map` logic, kept for `/csp-report` and unit tests.

  Time comes from the injectable `now` (JS clock), as today, so the existing tests keep their fake
  clock. Every instance's clock is NTP-synced, which is good enough for 1–15 min windows.
- **Importing `rate-limit.ts` must not require an env.** Today `rate-limit.test.ts` and
  `contact.test.ts` import it without a DB. The app limiters get their store as
  `createPgRateLimitStore(() => import("./db").then((m) => m.db))`, so `db/index.ts` (and
  `getEnv()`) only loads on the first real call.
- **All app limiters move to the DB**, not only the three the issue names: `loginLimiters`
  (email and IP), the contact form, `/api/events`, `profilePasswordLimiter`, `promoCodeLimiter` and
  `giftCardCodeLimiter`. They share the module, and an in-memory profile or gift-card limiter would
  have the same restart and multi-instance hole. The `globalThis` HMR caches go away: the state now
  lives in the database.
- **Pruning.** `pruneRateLimits(db, now)` (`db/queries/rate-limits.ts`) runs
  `DELETE … WHERE reset_at < now`. It's run by a new `pnpm db:prune-rate-limits` job: daily cron in
  production, plus an explicit-start Aspire resource like `db-expire-gift-cards`. An expired row is
  harmless meanwhile, because the upsert restarts its window.

**Client IP**

- `getClientIp(request, hops = getEnv().TRUSTED_PROXY_HOPS)`, moved to `app/.server/client-ip.ts`
  so its pure core `clientIpFromHeader(header, hops)` is testable without an env.
  `rate-limit.ts` re-exports it, so the callers' imports don't change.
  - `hops = N ≥ 1`: split `X-Forwarded-For` on commas and trim. The client is the **N-th entry
    from the right** (`entries[length - N]`), because each trusted proxy appends the address it
    received the request from. Anything to its left is client-supplied and ignored. If there are
    fewer than N entries, or the picked value isn't an IP (`net.isIP`), the result is `undefined`.
  - `hops = 0`: `X-Forwarded-For` is ignored entirely, so it can't be spoofed. The issue wants
    "the socket address" here, but `react-router-serve` (`@react-router/express`'s
    `createRequestHandler` without `getLoadContext`) gives the app only a Fetch `Request`, with no
    remote address. So with 0 hops the IP is `undefined`, and callers fall back as they do today
    (the visitor id, or `"anonymous"`).

## Resolved questions

- **Q1 (owner, 2026-11-05: defaults): the IP with `TRUSTED_PROXY_HOPS=0`.** Keep
  `react-router-serve`. 0 means "ignore `X-Forwarded-For`, IP unknown", and callers fall back as
  today. Production behind a proxy must set `TRUSTED_PROXY_HOPS=1` (documented), and the app logs
  one startup warning when `NODE_ENV=production` and hops is 0. A custom Express server that reads
  the socket address is left for the hosting decision.
- **Q2 (owner: default): headers on static files.** Not added. Only app responses get them, and
  `docs/security.md` says the hosting proxy may add `X-Content-Type-Options` for `/assets/*` and
  `public/`.
- **Q3 (owner: default): map origins.** `frame-src https://www.google.com https://maps.google.com`,
  and `docs/security.md` explains how to add another map provider's origin.
- **Q4 (owner: default): payment provider and `form-action`.** `form-action 'self'` for now. A
  comment in `buildCsp` and `docs/security.md` say the provider's origin must be added together with
  a real provider.
- **Which rate limiters exist?** Seven instances in three files: `loginLimiters.byEmail/byIp`,
  `profilePasswordLimiter`, `promoCodeLimiter` and `giftCardCodeLimiter` (`app/.server/rate-limit.ts`),
  the contact limiter (`services/contact.ts`) and `eventsLimiter` (`client-events.ts`). Their callers
  are `routes/login.tsx`, `account.profile.tsx`, `cart.tsx`, `checkout.tsx`, `home.tsx` (via
  `submitContactMessage`) and `api.events.ts`. All of them move to the DB (see Decisions).
- **Is there an `entry.server.tsx` or a custom server?** Neither: `app/` has no entry files and
  `pnpm start` is `react-router-serve ./build/server/index.js` (`package.json`).
- **Can middleware set headers on every response?** Yes. Root `middleware` already exists
  (`app/root.tsx`), and `visitorMiddleware` already edits `response.headers` after `next()`
  (`app/.server/analytics-middleware.ts`).
- **Does `<Scripts>` / `<ScrollRestoration>` accept a nonce?** Yes, both take `nonce?: string`
  (`react-router` 8.5 type declarations).
- **Which external origins does the page load?** Images from `STRAPI_URL`
  (`app/.server/cms/content.ts`, `routes/cms.products.ts`), and the map iframe from `mapEmbedUrl`
  (Google Maps in `cms/scripts/seed.ts`). Fonts are self-hosted via `@fontsource`. There's no
  third-party analytics: the tracker posts to same-origin `/api/events`
  (`features/analytics/client-events.ts`).
- **Does Strapi use a cloud upload provider (another image origin)?** No. `cms/config/plugins.ts`
  configures no upload provider, so uploads are served by Strapi at `STRAPI_URL/uploads/…`.
- **Where are env vars documented?** In `.env.example` and the table in `docs/setup.md`, with a
  case in `env.test.ts` (`app/.server/AGENTS.md` → Environment).
- **Is HSTS decided by the request scheme?** No. Behind a proxy the app sees `http`, so
  `PUBLIC_SITE_URL` (required in production, `env.ts`) decides.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `app/.server/security-headers.ts` | `nonceContext`, `buildCsp`, `buildSecurityHeaders`, `securityHeadersMiddleware` |
| create | `app/.server/security-headers.test.ts` | headers per response type, modes, HSTS rule, nonce uniqueness |
| create | `app/lib/nonce.tsx` | `NonceProvider`, `useNonce()` (isomorphic) |
| create | `app/entry.server.tsx` | revealed default, plus the nonce for React, `ServerRouter` and `NonceProvider` |
| create | `app/entry.server.test.ts` | full render: every inline `<script>` / `modulepreload` carries the response's nonce |
| modify | `app/root.tsx` | middleware order, `useNonce()` on the theme script, `ScrollRestoration`, `Scripts` |
| create | `app/routes/csp-report.ts` | report endpoint (log only) |
| create | `app/routes/csp-report.test.ts` | both report formats, size and rate limit, log shape |
| create | `app/lib/csp-report.schema.ts` | zod schemas for both report bodies |
| create | `app/.server/csp-report.ts` | parsing, query stripping, `[csp]` logging, the in-memory limiter (route-module state must stay on the server, like `client-events.ts`) |
| modify | `app/routes.ts` | `route("csp-report", "routes/csp-report.ts")` |
| modify | `app/.server/env.ts`, `env.test.ts` | `TRUSTED_PROXY_HOPS`, `CSP_MODE` |
| modify | `vitest.config.ts` | `TRUSTED_PROXY_HOPS=1` for the test run (the app behind one proxy), `setupFiles` |
| create | `vitest.setup.ts` | the app limiters on an in-memory store for every test file |
| modify | `.env.example`, `docs/setup.md` | document the new vars and the prune cron |
| modify | `app/.server/db/schema.ts` | `rateLimits` table |
| create | `app/.server/db/migrations/0024_rate_limits.sql` (+ `meta/`) | generated migration |
| create | `app/.server/db/rollbacks/0024_rate_limits.sql` | `DROP TABLE rate_limits` |
| modify | `app/.server/db/migrator.test.ts` | the new table and migration in the migrate/rollback tests |
| create | `app/.server/db/queries/rate-limits.ts`, `.test.ts` | `hitRateLimit`, `readRateLimit`, `deleteRateLimit`, `pruneRateLimits` |
| create | `app/.server/db/scripts/prune-rate-limits.ts` | `pnpm db:prune-rate-limits` |
| modify | `package.json` | `db:prune-rate-limits` script |
| modify | `aspire-apphost/` (apphost + `AGENTS.md`) | explicit-start `db-prune-rate-limits` resource |
| modify | `app/.server/rate-limit.ts`, `rate-limit.test.ts` | async limiter, stores, hashed keys, app limiters on the DB |
| create | `app/.server/client-ip.ts`, `client-ip.test.ts` | `getClientIp` with `TRUSTED_PROXY_HOPS` |
| modify | `app/.server/client-events.ts`, `services/contact.ts` (+ tests) | DB-backed limiters, `await` |
| modify | `app/routes/login.tsx`, `account.profile.tsx`, `cart.tsx`, `checkout.tsx`, `api.events.ts`, `home.tsx` (+ their tests) | `await` the limiter calls |
| create | `docs/security.md` | headers, adding an origin, reading CSP reports, switching `CSP_MODE`, proxy hops |
| modify | `app/.server/AGENTS.md`, `README.md` | rate-limit and auth notes (no longer per process), link to `docs/security.md` |

## Steps

- [x] **1. Pure header builders.** In `app/.server/security-headers.ts`, write
  `buildCsp({ nonce, mode, strapiOrigin, isDev })` and `buildSecurityHeaders({ env, html, nonce })`.
  The second returns a `Headers` with the CSP (or `-Report-Only`) only when `html`, the
  `Reporting-Endpoints` header and HSTS only in production over `https:`. Add `CSP_MODE` to
  `envSchema` (+ `.env.example`, `docs/setup.md`, `env.test.ts`). Unit-test every directive, both
  modes, the HSTS rule (dev, prod + http, prod + https) and that `'unsafe-inline'` never appears in
  `script-src`.
- [x] **2. Middleware.** Add `nonceContext` and `securityHeadersMiddleware`: nonce →
  `context.set` → `await next()` → set headers on the response, with `html` from the response's
  `Content-Type`. Register it **first** in `root.tsx`'s `middleware`. Test with a fake `next`: an
  HTML page, an XML resource response (no CSP, all other headers), a thrown-`Response` / 500 error
  page, a redirect, and two calls getting different nonces.
- [x] **3. Nonce context and `entry.server.tsx`.** Create `app/lib/nonce.tsx`. Run
  `pnpm react-router reveal entry.server` and pass the nonce to `renderToPipeableStream`,
  `<ServerRouter nonce>` and `<NonceProvider>`. In `root.tsx`'s `Layout`, use `useNonce()` on the
  `JS_CLASS_SCRIPT` script, `<ScrollRestoration>` and `<Scripts>`. `entry.server.test.ts`
  (Vitest only collects `*.test.ts`) stubs `ServerRouter` and checks that the context's nonce reaches
  `ServerRouter`, `useNonce()` and every inline `<script>` React streams. The whole-page check
  (every real `<script>` and `modulepreload` matches the header) is done against the built server
  in step 4, since a unit test can't render a full server build.
- [x] **4. Check the site with the CSP enforced.** `pnpm build && CSP_MODE=enforce pnpm start`,
  and with `pnpm dev`. In the browser console, check for CSP violations and React hydration
  warnings on home (map, theme script, contact form), catalog, product, cart (promo code),
  checkout (gift card, simulator payment), account, blog and blog post, the 404 page, and the cookie
  banner and client page-view beacons. Fix the policy or the code, never by adding `unsafe-inline`
  to scripts.
  *Done with headless Edge (console log) against `pnpm build` + `react-router-serve` and the Vite dev
  server, both with `CSP_MODE=enforce`. Every page listed above renders with no CSP violation and no
  hydration warning, and the theme script runs. Strapi couldn't start outside Aspire, so home and
  blog were checked as their 503 page, and the map frame and CMS images only by the policy tests.
  The dev database has no listed products, so the product page was checked as its 404. Fixed along
  the way: `data:` fonts, and the nonce hydration mismatch (above). Note: `vite.config.ts` ignores
  `**/.claude/worktrees/**`, so a dev server started inside a worktree doesn't pick up edits;
  restart it after each change.*
- [x] **5. `/csp-report`.** zod schemas in `app/lib/csp-report.schema.ts`, and the route with
  `readLimitedBody(request, 16 * 1024)`, a memory-store limiter (30/min per
  `getClientIp(request) ?? "anonymous"`), sanitized `console.warn`, and 204. Register it in
  `routes.ts` outside the layout. Test both formats, an oversize body (413), a rate-limited client
  (429), invalid JSON (400) and a log line without a query string.
- [x] **6. `TRUSTED_PROXY_HOPS` and `getClientIp`.** Add the env var (`z.coerce.number().int().min(0).max(10).default(0)`,
  + `.env.example`, `docs/setup.md`, `env.test.ts`). Create `client-ip.ts` with
  `clientIpFromHeader(header, hops)` and `getClientIp(request, hops?)`, and re-export it from
  `rate-limit.ts`. Rewrite the `getClientIp` tests: 0 hops ignores the header, 1 and 2 hops pick
  the right entry, a spoofed left-hand entry is ignored, too few entries or a non-IP value gives
  `undefined`. Add the production startup warning for 0 hops (`warnIfNoTrustedProxy`, called
  once from `entry.server.tsx` when the server loads). `vitest.config.ts` sets
  `TRUSTED_PROXY_HOPS=1` for the test run, so route tests can keep sending `X-Forwarded-For` to
  stand for different clients.
- [x] **7. `rate_limits` table.** Add `rateLimits` to `db/schema.ts`, run
  `pnpm db:generate --name rate_limits`, and write `db/rollbacks/0024_rate_limits.sql`. Put
  `hitRateLimit(db, key, windowMs, now)` (the upsert, `RETURNING count, reset_at`),
  `readRateLimit`, `deleteRateLimit` and `pruneRateLimits` in `db/queries/rate-limits.ts`. Their
  DB tests use `createTestDatabase` and check that 50 parallel `hitRateLimit` calls give
  `count = 50`, an expired window restarts at 1, and prune deletes only expired rows.
  The table also has a `count > 0` CHECK. `migrator.test.ts` lists it in `ALL_TABLES`, rolls back
  `0024` first in every rollback chain, and has its own test for the migration.
- [x] **8. Async, store-backed limiter.** Rewrite `createRateLimiter` over `RateLimitStore` with
  hashed keys (`name:sha256(key)`), and add `createMemoryRateLimitStore` and
  `createPgRateLimitStore(getDb)`. Rebuild the app limiters on the pg store (lazy `import("./db")`),
  dropping the `globalThis` caches. Unit tests run on the memory store (the existing cases, now
  async). A DB test checks that a limit hit through one limiter instance blocks a **new** instance
  on the same table (simulated restart, and a second instance).
  *Implementation:* steps 8 and 9 went into one commit, because an un-awaited `isBlocked()` is a
  Promise, which is always truthy, so step 8 alone would have blocked every caller.
- [x] **9. Callers.** Add `await` in `login.tsx`, `account.profile.tsx`, `cart.tsx`, `checkout.tsx`,
  `api.events.ts`, `services/contact.ts` and `client-events.ts`. *Implementation:* instead of a
  `vi.mock` per route test, the app limiters' store can be swapped (`setAppRateLimitStore`), and
  `vitest.setup.ts` gives every test file a fresh in-memory store. Otherwise any test reaching a
  limiter, today's or a future one, would write counters to the development database. The
  contact service keeps taking its limiter through `deps`. `login.test.ts` and
  `account.profile.test.ts` `await` their `reset` calls. Run the whole suite.
- [ ] **10. Pruning job.** Add `db/scripts/prune-rate-limits.ts` (same shape as
  `expire-gift-cards.ts`), the `db:prune-rate-limits` script in `package.json`, an explicit-start
  `db-prune-rate-limits` Aspire resource (following `aspire-apphost/AGENTS.md`), and a cron
  example in `docs/setup.md` (daily).
- [ ] **11. Docs.** Write `docs/security.md`: what each header does and why; the CSP directives and
  how to add an allowed origin in `buildCsp` (map provider, payment provider, image CDN);
  report-only vs `enforce` and when to switch; reading `[csp]` log lines and which ones are noise
  (browser extensions); `TRUSTED_PROXY_HOPS` per hosting setup; and the static-file and
  securityheaders.com check after hosting. Update `app/.server/AGENTS.md`
  (rate limiting: DB-backed, hashed keys, memory store only for `/csp-report`; auth: counters
  survive restarts; client IP) and link `docs/security.md` from `README.md`.
- [ ] **12. Full check.** `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, then the
  manual pass of step 4 in report-only mode (`curl -I` on `/`, `/sitemap.xml`, `/robots.txt`,
  `/og/products/<handle>.png` and a 404 URL to confirm the headers).

## Testing & verification

- Unit: `security-headers.test.ts` (directives, modes, HSTS, per response type, nonce per request),
  `client-ip.test.ts` (0/1/2 hops, spoofed and short headers), `rate-limit.test.ts` (memory store,
  key hashing), `csp-report.test.ts`, `env.test.ts` (new vars and their defaults).
- Render: `entry.server.test.ts` checks the nonce on every inline script, matching the header
  and different per request.
- DB integration (`describe.skipIf(!hasDatabase)`, `createTestDatabase`):
  `db/queries/rate-limits.test.ts` (exact concurrent counting, window restart, prune) and the
  restart/second-instance test in `rate-limit.test.ts` (or a sibling `rate-limit.db.test.ts`).
- Existing route tests (login, profile, cart, checkout, home, api.events) still pass with `await`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: step 4 (enforced CSP across all listed pages, dev and production build), `curl -I` on a
  page, a resource route and a 404, and a `[csp]` log line in report-only mode from a deliberately
  injected inline script in dev.

## Acceptance criteria

- [ ] Every page and resource route sends the security headers above, HSTS only in production — steps 1, 2, 12
- [ ] The CSP uses a per-request nonce, with no `unsafe-inline` for scripts, and the site works with it enforced (checked on home, catalog, product, cart, checkout, account, blog, and with the theme script) — steps 1, 3, 4
- [ ] CSP can run in report-only mode, with violations logged — steps 1, 5
- [ ] Login, contact and events rate limits persist across a restart and are shared between instances — steps 7, 8, 9 (also profile, promo and gift card limits)
- [ ] A spoofed `X-Forwarded-For` can't bypass the per-IP limits — step 6
- [ ] securityheaders.com rates the deployed site A or better (checked after hosting) — step 11 documents the check; done after hosting
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 12

## Out of scope

- WAF/CDN (e.g. Cloudflare), two-factor authentication, CAPTCHA (per the issue).
- A custom Node server to read the socket address or to add headers to static files (Q1, Q2;
  decided with hosting).
- Removing `style-src 'unsafe-inline'` (documented as a follow-up).
- HSTS `preload` (until the domain is final).
- Storing CSP reports in the database or a dashboard; they're only logged.
- Switching `CSP_MODE` to `enforce` in production (an ops change after a week of reports).
