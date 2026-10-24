# Plan: Implement session tracking and behavioural event recording (#18)

Issue: https://github.com/savchukolgaa/jassmin/issues/18
Branch: `issue/18`
Worktree: `.claude/worktrees/issue-18`
Status: Planned (questions answered 2026-10-24)

## Goal

As a data analyst, I want every visitor session and key behavioural event recorded automatically,
so I can build conversion funnels and LTV/churn features. Sessions and `user_events` are written on
the server where requests are handled (React Router middleware, loaders and actions), plus a small
client tracker that beacons client-side page views to a resource route. Tracking only runs after
the visitor accepts analytics cookies in a cookie banner, is fire-and-forget, and must never break a
page load, the cart or login.

## Dependencies & prerequisites

- **#5 (schema)** — done. `sessions` and `user_events` exist (`0002_analytics_schema.sql`), row
  types are mirrored in `app/lib/analytics.ts`, `EVENT_TYPES` in `app/lib/enums.ts`. This issue
  adds one migration (`0006`) for traffic attribution columns (D4).
- **#8 (catalog)** — done. Hook comments already sit in `app/routes/catalog.tsx` (`search`) and
  `app/routes/product.tsx` (`product_view`).
- **#9 (auth)** — done. `onUserAuthenticated` (`app/.server/services/auth.ts`) is the reserved
  place for linking visitors and the `login` event.
- **#10 (cart)** — done. It shipped the minimal `getVisitor` / `readVisitor` in
  `app/.server/analytics.ts` and the cookie names in `app/.server/visitor-cookie.ts`.
- **#11 (checkout)** — **not on `main`, built in parallel.** `checkout_start` and `purchase` are out
  of scope here: this issue ships `trackEvent` with a stable API, and #11 calls it (see "Hand-off to
  #11").
- Packages: none new. `isbot` is already a dependency; React Router 8.5 supports route `middleware`
  and `createContext` without a future flag.
- Env vars: none new.

## Decisions & assumptions

- **D1. Visitor middleware on the `_shop` layout.** `app/routes/_shop.tsx` exports `middleware`
  that, when tracking is allowed (D13), calls `getVisitor(request)`, stores it in a React Router
  context (`visitorContext`), and after `next()` appends the visitor's `Set-Cookie` headers to the
  response. Every public page, the cart, login and register (all under `_shop`) are covered;
  `/admin` is not tracked. Errors are caught and logged: the context then holds `null` and the
  request carries on.
- **D2. `page_view` on document requests from the middleware, client navigations from the
  tracker.** The server can't tell a client navigation's `.data` request from a revalidation after
  an action, so it only records `page_view` for document GETs (`Sec-Fetch-Dest: document`, falling
  back to `Accept: text/html`). Client-side navigations are beaconed to `/api/events` (Q2: yes).
- **D3. 30-minute sessions; `sessions.ended_at` = last activity** (Q7: confirmed). `getVisitor`
  replaces `hasVisitorSession` with one statement that checks and touches: `UPDATE sessions SET
  ended_at = now() WHERE session_id = $1 AND anonymous_id = $2 AND coalesce(ended_at, started_at) >
  now() - interval '30 minutes' RETURNING session_id, traffic_source, traffic_medium,
  traffic_campaign`. No row → a new session (same `anonymous_id`, new `analytics_session` cookie).
  A request that arrives with a `utm_source` different from the session's also starts a new session
  (a new campaign click is a new visit). The cookie stays a browser-session cookie; the server check
  is authoritative.
- **D4. Traffic attribution: this visit on sessions and events, first visit on users** (Q6). One
  migration (`0006_traffic_attribution`) adds:
  - `sessions.traffic_medium text`, `sessions.traffic_campaign text` (next to the existing
    `traffic_source`). A new pure `resolveTrafficAttribution(url, referer)` in
    `app/lib/analytics.ts` returns `{ source, medium, campaign }`: `source` reuses
    `resolveAcquisitionChannel` (`app/lib/auth.ts`: UTM source → external referrer host →
    `"direct"`), `medium` is `utm_medium` → `"referral"` (external referrer) → `"none"`, `campaign`
    is `utm_campaign` or `null`. All trimmed, lowercased, max 100 chars.
  - `users.first_touch_source`, `users.first_touch_medium`, `users.first_touch_campaign` (`text`,
    nullable): how the person first came to the site. Filled once, when still `null`, by
    `linkVisitorToUser` from the visitor's earliest session (`order by started_at limit 1`).
    Existing users stay `null` until their first login after this ships. `users.acquisition_channel`
    is kept unchanged (it's an ML feature, set at registration).
  - Every `user_events` row gets `source` / `medium` / `campaign` = the **current session's**
    attribution (where the person came from this time), while `referrer` and `device_type` come from
    the event's own request. Because `touchActiveSession` returns the attribution, this costs no
    extra query.
  New sessions also store `landing_page` (path + query, max 500 chars), `device_type` from a pure
  `resolveDeviceType(userAgent)` (`"mobile" | "tablet" | "desktop"`, regex, no dependency) and
  `user_id` when the request carries a logged-in user.
- **D5. `trackEvent` API.** `trackEvent(args, type, { productId?, properties?, userId? })`, where
  `args` is the loader/action/middleware `{ request, context }`. It takes the visitor (ids +
  attribution) from `visitorContext` and is a no-op when it's `null` (no consent, a bot, or a failed
  lookup). `user_id` comes from `options.userId` or the auth cookie (`getUserId`). It returns a
  `Promise<void>` that **never rejects** (catches and `console.error`s); routes call it with `void
  trackEvent(…)` so a slow insert never delays the response. Tests `await` it.
- **D6. One visitor per request.** `ensureVisitor({ request, context })` returns the context
  visitor, or creates one with `getVisitor` and stores it in the context, so the middleware sends
  its cookies exactly once. The cart action uses it instead of calling `getVisitor` directly.
- **D7. No duplicate view events after cart fetchers.** Adding to cart revalidates every loader,
  which would re-record `product_view` / `search`. `product.tsx` and `catalog.tsx` export
  `shouldRevalidate` returning `false` for POSTs to `/cart` (the pattern from `home.tsx`); the cart
  doesn't reserve stock, so those pages don't need fresh data. The `_shop` loader still revalidates
  (cart badge).
- **D8. Cart events** (Q4: default). `add` → `add_to_cart`; `remove` → `remove_from_cart`; stepper
  `update` → `add_to_cart` or `remove_from_cart` by the sign of the quantity delta, with
  `properties.source = "stepper"` (nothing when the delta is 0). Properties: `{ variantId,
  volumeMl, quantity }` (units added/removed). `addItem`, `updateQuantity` and `removeItem` return
  `{ ok: true, change: { productId, variantId, volumeMl, quantityDelta } }`; `respond()` in
  `routes/cart.tsx` still only sends `{ ok, intent }` to the client.
- **D9. Login linking.** `linkVisitorToUser(anonymousId, userId)` runs in one transaction: sets
  `user_id` on that visitor's `sessions` and `user_events` rows where `user_id is null`, and fills
  the `users.first_touch_*` columns (D4) when they're `null`. It runs in `onUserAuthenticated`
  before the `login` event, in its own `try/catch` next to the guest-cart merge, so neither can fail
  a login. Register also records `login` with `properties.method = "register"` (Q5: default).
  Linking needs the visitor's `anonymous_id`, so it runs even without analytics consent only if the
  visitor already has one (from a guest cart); the `login` event itself needs consent.
- **D10. Client endpoint `/api/events`.** Action-only resource route outside the `_shop` layout
  (like `logout.ts` / `locale.ts`). Accepts a JSON batch from `navigator.sendBeacon`; 413 for bodies
  over 16 KB, 400 for more than 20 events or any `type` outside `CLIENT_EVENT_TYPES = ["page_view"]`
  (Q3), 429 per IP via `createRateLimiter`. Without consent it answers 204 and writes nothing.
  Otherwise it calls `getVisitor` itself (no middleware there) and returns 204 with its headers.
  Never 500.
- **D11. Bots are not tracked.** `isbot(userAgent)` → no visitor in the middleware and no events.
- **D12. Caching.** Blog pages are publicly cacheable for visitors without personal cookies
  (`blogCacheHeaders`). The consent cookie changes the HTML (banner shown or not), so it joins
  `PERSONAL_COOKIES` in `session-cookie.ts`. When the middleware adds `Set-Cookie`, it also sets
  `Cache-Control: private, no-store`.
- **D13. Cookie banner and consent** (Q1: add now).
  - Consent cookie `cookie_consent` (`"granted" | "denied"`, 1 year, httpOnly, sameSite lax, not
    signed: it's a preference, not an identity), names/values in `app/lib/consent.ts`
    (`CONSENT_COOKIE`, `CONSENT_VALUES`, `ConsentValue`), read by `getConsent(request)` in
    `app/.server/consent.ts`.
  - `isTrackingAllowed(request)` = consent is `"granted"` **and** not a bot. It gates the
    middleware, `trackEvent`, `/api/events` and the client tracker.
  - **Strictly necessary cookies don't need consent:** the auth session, `locale`, and the guest
    cart's `anonymous_id` + `analytics_session`. Without consent, `ensureVisitor` in the cart action
    still creates a `sessions` row (the cart's FK needs it) but stores **no** attribution, device or
    landing page, and no events are recorded.
  - `app/routes/consent.ts`: action-only (like `locale.ts`), zod-validated `{ consent: "granted" |
    "denied" | "reset", redirectTo? }`. `granted` → sets the cookie, creates the visitor and records
    a `page_view` for `redirectTo` (the page where the visitor accepted, otherwise lost); `denied` →
    sets the cookie and clears `analytics_session`; `reset` → deletes the cookie so the banner shows
    again. Redirects back with `safeRedirect`.
  - UI: `app/features/consent/CookieBanner.tsx`, rendered by `ShopLayout` when the `_shop` loader
    returns `consent: null`. A `fetcher.Form` posting to `/consent` (works without JS), fixed to the
    bottom, white panel with `ink` text and a `line` border, `role="region"` with an `aria-label`,
    `animate-fade-up`. Two equally prominent buttons: `Button` `primary` "Accept" and `Button` `dark`
    "Decline" (`sm` size, design rules in `docs/design.md`). It hides optimistically while the
    fetcher submits. Footer gets a "Cookie settings" button (a form posting `consent=reset`).
  - Copy goes in `uk.ts` / `en.ts` under a new `consent` namespace (`title`, `message`, `accept`,
    `decline`, `settings`); no privacy-policy link, since the site has no such page (Q8).

### Hand-off to #11

#11 records, inside its checkout loader/action and **after** the order transaction commits:

```ts
void trackEvent({ request, context }, "checkout_start");
void trackEvent({ request, context }, "purchase", {
  properties: { orderId, totalAmount, itemCount, paymentMethod },
});
```

`/checkout` is under `_shop`, so the visitor is already in the context and consent is already
checked. Whichever PR merges second resolves the import; `app/.server/AGENTS.md` documents the call
shape.

## Open questions

- [ ] **Q8: Should the banner link to a privacy/cookie policy page?** — Why it matters: consent is
  usually expected to be informed, but no such page exists (and its text is legal content). Recommended
  default: no link now; the banner text says what is collected (visits, viewed products, cart
  actions, for improving the store). A policy page can be a separate issue (likely CMS-backed).
  Affects step: 10.
- [ ] **Q9: OK to treat `anonymous_id` + `analytics_session` as strictly necessary for guest carts
  (set without consent, but with no tracking data)?** — Why it matters: the alternative is that
  guests can't use the cart until they accept cookies. Recommended default: yes, as in D13. Affects
  steps: 3, 7.

## Resolved questions

- **Q1 cookie consent** → add a banner now (user, 2026-10-24) — D13.
- **Q2 client navigations as `page_view`** → yes (user) — D2.
- **Q3 client event types** → only `page_view` (user) — D10.
- **Q4 cart stepper changes** → default: tracked as add/remove with the delta (user) — D8.
- **Q5 register records `login`** → default: yes, `method: "register"` (user) — D9.
- **Q6 attribution** → events use their own request for referrer/device, but their source is where
  the person came from this visit (session), and the first-ever source is stored on `users` (user)
  — D4.
- **Q7 `ended_at` as last activity** → yes (user) — D3.
- **Do the event types need a migration?** — No: all event types in the acceptance criteria are
  already in `EVENT_TYPES` and the CHECK (source: `app/.server/db/schema.ts`,
  `0002_analytics_schema.sql`). Only the attribution columns need one (D4).
- **Can `getVisitor` / `readVisitor` and the cookie names change?** — Signatures and cookie names
  stay; #18 extends behaviour (source: `app/.server/analytics.ts`, `app/.server/AGENTS.md`).
  `Visitor` gains an `attribution` field.
- **Format of the source?** — Reuse `resolveAcquisitionChannel` so it matches
  `users.acquisition_channel` (source: `app/lib/auth.ts`).
- **Does a 30-minute session rotation break guest carts?** — No: a guest cart is found by
  `anonymous_id` through any of their sessions (source: `app/.server/AGENTS.md` "Cart").
- **Where do the login hooks go?** — `onUserAuthenticated`, which must never fail a login (source:
  `app/.server/services/auth.ts`).
- **Is middleware available?** — Yes, React Router 8.5, no flag (source: `package.json`, installed
  types).
- **How to avoid re-running loaders after a fetcher post?** — `shouldRevalidate` as in
  `app/routes/home.tsx`.
- **`review_submit`?** — Not in the acceptance criteria; no review feature exists. Out of scope.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/analytics.ts` | `DEVICE_TYPES`, `resolveDeviceType`, `resolveTrafficAttribution`, `CLIENT_EVENT_TYPES`, `clientEventBatchSchema`, `SESSION_TIMEOUT_MINUTES`; `AnalyticsSession` gains `trafficMedium`, `trafficCampaign` |
| create | `app/lib/analytics.test.ts` | Unit tests for the pure helpers and the batch schema |
| create | `app/lib/consent.ts` (+ `.test.ts`) | Consent cookie name, values, form schema |
| modify | `app/.server/db/schema.ts` | New `sessions` and `users` columns; `ended_at` comment |
| create | `app/.server/db/migrations/0006_traffic_attribution.sql` (+ snapshot, journal) | Generated by `pnpm db:generate --name traffic_attribution` |
| create | `app/.server/db/rollbacks/0006_traffic_attribution.sql` | Drops the five columns |
| modify | `app/.server/db/schema.test.ts` | New columns in `users` / `sessions` expectations |
| modify | `app/.server/db/queries/analytics.ts` | `touchActiveSession`, extended `insertSession`, `insertEvents`, `linkAnonymousRows`, `fillFirstTouch` |
| modify | `app/.server/analytics.ts` | 30-min window, attribution, `visitorContext`, `ensureVisitor`, `isTrackingAllowed`, `isDocumentRequest`, `trackEvent`, `trackEvents`, `linkVisitorToUser` |
| modify | `app/.server/analytics.test.ts` | Integration tests for the above |
| create | `app/.server/consent.ts` (+ `.test.ts`) | Consent cookie, `getConsent` |
| create | `app/.server/analytics-middleware.ts` (+ `.test.ts`) | The `_shop` visitor middleware |
| modify | `app/.server/session-cookie.ts` (+ test) | Consent cookie counts as personal (D12) |
| modify | `app/routes/_shop.tsx` | `middleware`, `consent` in loader data, banner, client tracker |
| modify | `app/routes/product.tsx`, `app/routes/catalog.tsx` | `product_view` / `search` + `shouldRevalidate` |
| modify | `app/.server/services/cart.ts` (+ test) | Return the change from add/update/remove |
| modify | `app/routes/cart.tsx` (+ test) | `ensureVisitor`, cart events |
| modify | `app/.server/services/auth.ts` (+ test) | `linkVisitorToUser` + `login` event |
| modify | `app/routes/login.tsx`, `app/routes/register.tsx` | Pass `{ request, context }` to `onUserAuthenticated` |
| create | `app/routes/api.events.ts` (+ test) | Client events resource route |
| create | `app/routes/consent.ts` (+ test) | Consent action |
| modify | `app/routes.ts` (+ `routes.test.ts`) | `api/events` and `consent` outside the layout |
| create | `app/features/consent/CookieBanner.tsx` (+ test) | The banner |
| modify | `app/components/layout/Footer.tsx` (+ test) | "Cookie settings" button |
| create | `app/features/analytics/useClientPageViews.ts`, `client-events.ts` (+ test) | Client tracker |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `consent` namespace |
| modify | `app/.server/AGENTS.md` | "Visitor" section: middleware, consent, `trackEvent`, attribution, #11 hand-off |

## Steps

- [ ] **1. Pure helpers.** In `app/lib/analytics.ts`: `SESSION_TIMEOUT_MINUTES = 30`,
  `DEVICE_TYPES` + `resolveDeviceType(ua)` (tablet: `iPad|Tablet|Android(?!.*Mobile)`; mobile:
  `Mobi|iPhone|Android`; else desktop), `resolveTrafficAttribution(url, referer)` (D4),
  `CLIENT_EVENT_TYPES = ["page_view"] as const satisfies readonly EventType[]`,
  `clientEventBatchSchema` (zod: 1–20 `{ type: z.enum(CLIENT_EVENT_TYPES), path: string ≤ 2048
  starting with "/", referrer?: string ≤ 2048 }`). `app/lib/consent.ts`: `CONSENT_COOKIE =
  "cookie_consent"`, `CONSENT_VALUES = ["granted", "denied"] as const`, `consentFormSchema`. Unit
  tests for both. Check: `pnpm test app/lib`.
- [ ] **2. Migration.** In `schema.ts` add `sessions.trafficMedium`, `sessions.trafficCampaign`,
  `users.firstTouchSource`, `users.firstTouchMedium`, `users.firstTouchCampaign` (all `text()`,
  nullable, with doc comments), and document `ended_at` as last activity. `pnpm db:generate --name
  traffic_attribution`; hand-write `rollbacks/0006_traffic_attribution.sql` (`ALTER TABLE … DROP
  COLUMN …`). Update `AnalyticsSession` in `app/lib/analytics.ts` and `schema.test.ts`. Check:
  `pnpm db:migrate` then `pnpm db:rollback` and migrate again on a dev DB; `pnpm test
  app/.server/db`.
- [ ] **3. Queries.** In `db/queries/analytics.ts`: replace `hasVisitorSession` with
  `touchActiveSession(db, sessionId, anonymousId)` (D3, returns the attribution or `undefined`);
  extend `insertSession` with `trafficSource`, `trafficMedium`, `trafficCampaign`, `deviceType`,
  `userId` (all optional, for the no-consent cart case); add `insertEvents(db, rows)`;
  `linkAnonymousRows(tx, anonymousId, userId)` (sessions + events where `user_id is null`);
  `fillFirstTouch(tx, anonymousId, userId)` (`UPDATE users SET first_touch_* = s.traffic_* FROM
  (earliest session of anonymousId with a traffic_source) s WHERE users.id = userId AND
  first_touch_source IS NULL`).
- [ ] **4. Consent server helpers.** `app/.server/consent.ts`: `consentCookie` (`createCookie`,
  1 year, httpOnly, lax, secure in production), `getConsent(request): Promise<ConsentValue | null>`
  (zod-validated). Add `CONSENT_COOKIE` to `PERSONAL_COOKIES` in `session-cookie.ts`. Tests.
- [ ] **5. Extend `app/.server/analytics.ts`.** Keep `readVisitor`/`getVisitor` signatures; add
  `attribution` to `Visitor`. `getVisitor(request, db, { track = true })`: uses
  `touchActiveSession`; starts a new session on timeout, missing row, or a different `utm_source`;
  new sessions get the D4 attributes only when `track` is true. Add `visitorContext =
  createContext<Visitor | null>(null)`, `isTrackingAllowed(request)` (`getConsent === "granted" &&
  !isbot`), `isDocumentRequest(request)`, `ensureVisitor({ request, context })` (passes `track:
  await isTrackingAllowed(request)`), `trackEvent` (D5), `trackEvents(visitor, request, events)`
  (for `/api/events` and `/consent`), and `linkVisitorToUser(anonymousId, userId, db)` running
  `linkAnonymousRows` + `fillFirstTouch` in `db.transaction`. Event rows: `source/medium/campaign`
  from `visitor.attribution`, `device_type` from the request UA, `referrer` from `Referer` (max 500).
  Integration tests (`createTestDatabase`): >30 min → new session, same anonymous id; recent →
  `ended_at` touched, no cookie; new `utm_source` mid-session → new session; attribution stored
  (`?utm_source=instagram&utm_medium=cpc&utm_campaign=autumn`, external referrer → host +
  `referral`, nothing → `direct` + `none`); `track: false` → session without attribution; event row
  carries the session's attribution and its own referrer; `trackEvent` resolves when the insert
  fails and is a no-op without a visitor; `linkVisitorToUser` fills `user_id` only on that
  visitor's userless rows and sets `first_touch_*` from the earliest session once (a second call
  doesn't overwrite).
- [ ] **6. Middleware.** `app/.server/analytics-middleware.ts`: if `await
  isTrackingAllowed(request)`, `try { context.set(visitorContext, await getVisitor(request)) } catch
  { log; null }`; on a document GET, `void trackEvent(…, "page_view", { properties: { path } })`;
  `const response = await next()`; append the context visitor's `Set-Cookie` headers (it may have
  been created later by `ensureVisitor`) and, when any were added, set `Cache-Control: private,
  no-store`. `_shop.tsx`: `export const middleware = [visitorMiddleware]`. Tests: consented document
  request → cookies + session + `page_view`; no consent → no cookies, no rows; `.data`-style request
  → no `page_view`; bot → nothing; `getVisitor` throwing → response still returned.
- [ ] **7. Cart events.** `services/cart.ts` returns `{ ok: true, change }` (D8); update
  `CartChangeResult` and `cart.test.ts`. `routes/cart.tsx`: `ensureVisitor` for `add` (drop
  `visitor.headers` from `respond`, the middleware sends them); after a successful change, `void
  trackEvent` (`add_to_cart` / `remove_from_cart`). Tests: add → `add_to_cart` with product id and
  quantity; stepper −1 → `remove_from_cart` with `source: "stepper"`; remove → `remove_from_cart`;
  failed change → nothing; no consent → cart works, no events, session row without attribution.
- [ ] **8. `product_view` and `search`.** `product.tsx` loader: `void trackEvent({ request, context
  }, "product_view", { productId: <internal id>, properties: { publicId } })` (keep the internal id
  server-side if the DTO doesn't already expose it). `catalog.tsx` loader: when
  `hasActiveFilters(search)`, `void trackEvent(…, "search", { properties: { gender, ...search,
  total } })`. Both export `shouldRevalidate` (D7) with unit tests like `home.test.ts`.
- [ ] **9. Login linking and `login` event.** `onUserAuthenticated({ request, context }, userId,
  kind)` (update `login.tsx` / `register.tsx`); visitor = `context.get(visitorContext)` falling back
  to `readVisitor(request)` for the anonymous id. After the cart merge, in a separate `try/catch`:
  `await linkVisitorToUser(anonymousId, userId)`, then `await trackEvent(…, "login", { userId,
  properties: { method: kind } })` (the auth cookie isn't on this request yet, hence `userId`).
  Tests: earlier anonymous rows get the user id; `first_touch_*` filled; a `login` row exists; a
  failing link doesn't throw.
- [ ] **10. Consent route, banner and footer.** `app/routes/consent.ts` (D13): action only, loader
  redirects to `/` like `locale.ts`; `granted` → `Set-Cookie` consent + `getVisitor` cookies and
  `trackEvents(visitor, request, [{ type: "page_view", path: redirectTo }])`; `denied` → consent
  cookie + expire `analytics_session`; `reset` → expire the consent cookie. `_shop` loader returns
  `{ ...header, consent }`. `CookieBanner` + Footer "Cookie settings" button as in D13, `consent.*`
  keys in `uk.ts` and `en.ts`. Register `consent` in `routes.ts` outside the layout. Tests: route
  (each value, invalid → 400, unsafe `redirectTo` → `/`), banner renders in Ukrainian and English
  (`<I18nProvider locale="en">`), hidden when consent is set.
- [ ] **11. `/api/events`.** `app/routes/api.events.ts` (D10): 405 non-POST; 413 when
  `Content-Length` or the read text exceeds 16 KB; parse the text as JSON (sendBeacon sends
  `text/plain`) with `clientEventBatchSchema` → 400; 429 via a module-level `createRateLimiter`
  (`clientKey(request)`, 60 batches/min); not allowed → 204; else `getVisitor`, `await
  trackEvents(…)`, 204 with the visitor's headers; `try/catch` → 204. Register in `routes.ts`
  outside the layout. Tests: valid batch → rows; `purchase` → 400; 21 events → 400; oversized →
  413; no consent → 204, no rows.
- [ ] **12. Client tracker.** `app/features/analytics/client-events.ts` (plain queue/flush module:
  `navigator.sendBeacon("/api/events", JSON.stringify({ events }))`, fallback `fetch(…, { method:
  "POST", keepalive: true })`, errors swallowed) and `useClientPageViews(enabled)` used in
  `ShopLayout` with `enabled = consent === "granted"`: skips the first render (the server counted
  the document load; after accepting, `/consent` counted it), then queues `{ type: "page_view",
  path, referrer: previousPath }` on each pathname/search change and flushes immediately and on
  `pagehide`. Unit tests for the queue (batching to 20, no-op when disabled).
- [ ] **13. Docs.** `app/.server/AGENTS.md` "Visitor": middleware + consent gate, `trackEvent({
  request, context }, …)`, `ensureVisitor`, attribution rules, `ended_at` = last activity,
  `first_touch_*`, `/api/events` (`CLIENT_EVENT_TYPES`), the #11 call shape. Remove the "#18 extends
  it" note in `analytics.ts`. Mention the consent banner in `docs/design.md` if it adds a reusable
  pattern.
- [ ] **14. Verify.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; manual run below.

## Testing & verification

- Unit: `app/lib/analytics.test.ts`, `app/lib/consent.test.ts`, `shouldRevalidate` tests,
  `client-events.test.ts`, `CookieBanner` / `Footer` render tests (uk + en).
- DB integration (`describe.skipIf(!hasDatabase)`, `createTestDatabase`): `analytics.test.ts`,
  `analytics-middleware.test.ts`, `api.events.test.ts`, `consent.test.ts` (route),
  `cart.test.ts`, `services/auth.test.ts`, `schema.test.ts`.
- Failure safety: tests that make the insert or `getVisitor` fail and assert the page/action still
  responds normally.
- Migration: `pnpm db:migrate`, `pnpm db:rollback`, `pnpm db:migrate` on the dev DB.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`, private window, then query the DB): open
  `/?utm_source=instagram&utm_medium=cpc` → banner shows, nothing recorded; Decline → no rows, cart
  still works; Cookie settings → banner again; Accept → one `sessions` row (`instagram` / `cpc`,
  device, landing page) and a `page_view`; click to a product → `page_view` (via `/api/events`)
  and `product_view`; filter the catalog → `search`; add/remove/stepper in the cart → cart events,
  no extra `product_view`; every event has `source = instagram`; register → earlier rows get
  `user_id`, `users.first_touch_source = instagram`, a `login` row with `method: register`; break a
  query → pages still render. A blog page's first consented response has `Cache-Control: private,
  no-store`.

## Acceptance criteria

- [ ] Each visit creates a session row with source, device and landing page — steps 2, 3, 5, 6
  (for visitors who accepted analytics cookies)
- [ ] `page_view`, `product_view`, `search`, `add_to_cart`, `remove_from_cart`, `checkout_start`,
  `purchase` and `login` events are recorded — steps 6, 7, 8, 9, 10, 11, 12; **`checkout_start`
  and `purchase` are delivered by #11** using `trackEvent` from step 5 (see "Hand-off to #11")
- [ ] Anonymous events are linked to the user after login — steps 3, 5, 9
- [ ] Tracking failures never break the shopping experience — steps 5, 6, 7, 9, 11 (never-rejecting
  `trackEvent`, `try/catch` in middleware and login, 204 fallback in `/api/events`)
- [ ] (added) Cookie consent is respected — steps 4, 5, 10, 12

## Out of scope

- `checkout_start` / `purchase` hooks — added by #11.
- A privacy/cookie policy page (Q8) and `review_submit` (no review feature yet).
- Tracking `/admin` pages and bots.
- Backfilling `first_touch_*` for users who don't log in again; analytics dashboards or exports.
