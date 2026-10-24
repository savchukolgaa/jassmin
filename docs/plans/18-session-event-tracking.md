# Plan: Implement session tracking and behavioural event recording (#18)

Issue: https://github.com/savchukolgaa/jassmin/issues/18
Branch: `issue/18`
Worktree: `.claude/worktrees/issue-18`
Status: Planned

## Goal

As a data analyst, I want every visitor session and key behavioural event recorded automatically,
so I can build conversion funnels and LTV/churn features. Sessions and `user_events` are written on
the server where requests are handled (React Router middleware, loaders and actions), plus a small
client tracker that beacons client-only events to a resource route. Tracking is fire-and-forget and
must never break a page load, the cart or login.

## Dependencies & prerequisites

- **#5 (schema)** — done. `sessions` and `user_events` exist (`0002_analytics_schema.sql`), row
  types are mirrored in `app/lib/analytics.ts`, `EVENT_TYPES` in `app/lib/enums.ts`. **No migration
  is needed** (see decision D3).
- **#8 (catalog)** — done. Hook comments already sit in `app/routes/catalog.tsx` (`search`) and
  `app/routes/product.tsx` (`product_view`).
- **#9 (auth)** — done. `onUserAuthenticated` (`app/.server/services/auth.ts`) is the reserved
  place for linking visitors and the `login` event.
- **#10 (cart)** — done. It shipped the minimal `getVisitor` / `readVisitor` in
  `app/.server/analytics.ts` and the cookie names in `app/.server/visitor-cookie.ts`.
- **#11 (checkout)** — **not on `main`, built in parallel.** `checkout_start` and `purchase` are out
  of scope here: this issue ships `trackEvent` with a stable API, and #11 calls it (see "Hand-off to
  #11" below).
- Packages: none new. `isbot` is already a dependency (bot filtering); React Router 8.5 supports
  route `middleware` and `createContext` without a future flag.
- Env vars: none new.

## Decisions & assumptions

- **D1. Visitor middleware on the `_shop` layout.** `app/routes/_shop.tsx` exports `middleware`
  that, for non-bot requests, calls `getVisitor(request)`, stores it in a React Router context
  (`visitorContext`), and after `next()` appends the visitor's `Set-Cookie` headers to the response.
  Every public page, the cart, login and register (all under `_shop`) get a visitor; `/admin` is not
  tracked. Errors are caught and logged: the context then holds `null` and the request carries on.
- **D2. `page_view` on document requests from the middleware, client navigations from the
  tracker.** The server can't tell a client navigation's `.data` request from a revalidation after
  an action, so it only records `page_view` for document GETs (`Sec-Fetch-Dest: document`, falling
  back to `Accept: text/html`). Client-side navigations are beaconed by the client tracker to
  `/api/events` **(unconfirmed, Q2)**.
- **D3. 30-minute sessions without a migration: `sessions.ended_at` = last activity.**
  `getVisitor` replaces `hasVisitorSession` with one statement that both checks and touches:
  `UPDATE sessions SET ended_at = now() WHERE session_id = $1 AND anonymous_id = $2 AND
  coalesce(ended_at, started_at) > now() - interval '30 minutes' RETURNING session_id`. No row → a
  new session (same `anonymous_id`, new `analytics_session` cookie). The cookie itself stays a
  browser-session cookie; the server check is authoritative **(unconfirmed, Q7)**.
- **D4. Session attributes.** New sessions get `landing_page` (path + query, capped at 500 chars),
  `traffic_source` from the existing `resolveAcquisitionChannel(url, referer)` in `app/lib/auth.ts`
  (UTM source → external referrer host → `"direct"`, the same format as `users.acquisition_channel`),
  `device_type` from a new pure `resolveDeviceType(userAgent)` (`"mobile" | "tablet" | "desktop"`,
  regex, no new dependency) and `user_id` when the request carries a logged-in user.
- **D5. `trackEvent` API.** `trackEvent(args, type, { productId?, properties? })`, where `args` is
  the loader/action/middleware `{ request, context }`. It takes the visitor from `visitorContext`
  (no-op when `null`, e.g. bots or a failed visitor lookup), `user_id` from the auth cookie
  (`getUserId`), UTM fields from the request URL (falling back to the `Referer` URL for `.data` and
  POST requests), `device_type` from the user agent and `referrer` from the `Referer` header. It
  returns a `Promise<void>` that **never rejects** (catches and `console.error`s); routes call it
  with `void trackEvent(…)` so a slow insert never delays the response. Tests `await` it.
- **D6. One visitor per request.** `ensureVisitor({ request, context })` returns the context
  visitor, or creates one with `getVisitor` and stores it in the context, so the middleware sends
  its cookies exactly once. The cart action uses it instead of calling `getVisitor` directly (today a
  first-ever request that is a POST to `/cart` would otherwise create two sessions).
- **D7. No duplicate view events after cart fetchers.** Adding to cart from a product or catalog
  page revalidates every loader, which would re-record `product_view` / `search`. `product.tsx` and
  `catalog.tsx` export `shouldRevalidate` returning `false` for POSTs to `/cart` (the pattern from
  `home.tsx`); stock isn't reserved by the cart, so those pages don't need fresh data. The `_shop`
  loader still revalidates (cart badge).
- **D8. Cart events.** `add` → `add_to_cart`; `remove` → `remove_from_cart`; stepper `update` →
  `add_to_cart` or `remove_from_cart` with the quantity delta **(unconfirmed, Q4)**. Properties:
  `{ variantId, volumeMl, quantity }` (quantity = units added/removed). To get the product id and
  delta, `addItem`, `updateQuantity` and `removeItem` return `{ ok: true, change: { productId,
  variantId, volumeMl, quantityDelta } }`; `respond()` in `routes/cart.tsx` still only sends
  `{ ok, intent }` to the client.
- **D9. Login linking.** `linkVisitorToUser(anonymousId, userId)` runs in one transaction: sets
  `user_id` on that visitor's `sessions` and `user_events` rows where `user_id is null`. It runs in
  `onUserAuthenticated` **before** the `login` event is recorded, and both sit in their own
  `try/catch` next to the guest-cart merge so neither can fail a login. Register also records
  `login` with `properties: { method: "register" }` (`"login"` otherwise) **(unconfirmed, Q5)**.
- **D10. Client endpoint `/api/events`.** Action-only resource route outside the `_shop` layout
  (like `logout.ts` / `locale.ts`). Accepts a JSON batch from `navigator.sendBeacon`; rejects bodies
  over 16 KB (413), more than 20 events, and any `type` outside `CLIENT_EVENT_TYPES` — a subset of
  `EVENT_TYPES` that is only `["page_view"]` for now, so a client can't forge `purchase` or
  `add_to_cart` **(unconfirmed, Q3)**. Rate-limited per IP with `createRateLimiter`. Responds 204;
  it calls `getVisitor` itself (no middleware there) and returns its headers.
- **D11. Bots are not tracked.** `isbot(userAgent)` → no visitor in the middleware and no events.
  The cart action still gets a visitor through `ensureVisitor`.
- **D12. Caching.** Blog pages are publicly cacheable for visitors without cookies
  (`blogCacheHeaders`). When the middleware adds `Set-Cookie`, it also sets
  `Cache-Control: private, no-store`, so a shared cache never stores another visitor's cookies.
- **D13. Cookie consent: no consent gate in this issue** **(unconfirmed, Q1)**. All cookies are
  first-party and no IP addresses are stored. The tracking switch is one function
  (`isTrackingAllowed(request)`, today `!isbot(ua)`) so a consent check can be added there later.

### Hand-off to #11

#11 records, inside its checkout loader/action and **after** the order transaction commits:

```ts
void trackEvent({ request, context }, "checkout_start");
void trackEvent({ request, context }, "purchase", {
  properties: { orderId, totalAmount, itemCount, paymentMethod },
});
```

`/checkout` is under `_shop`, so the visitor is already in the context. Whichever PR merges second
resolves the import; this plan notes the call shape in `app/.server/AGENTS.md` so #11 can follow it.

## Open questions

- [ ] **Q1: Is a cookie-consent banner required before analytics cookies/events?** — Why it
  matters: under GDPR-style rules (and Ukraine's draft alignment) analytics cookies may need opt-in,
  which would gate the middleware and the client tracker and needs UI. Recommended default: no
  banner in this issue; tracking goes through `isTrackingAllowed()` so a follow-up issue can add
  consent. Affects steps: 4, 9.
- [ ] **Q2: Should client-side navigations count as `page_view`?** — Why it matters: without them
  only full page loads are counted and funnels miss most in-app browsing. Recommended default: yes,
  via the client tracker (D2). Affects steps: 9, 10.
- [ ] **Q3: Which event types may the client endpoint accept?** — Why it matters: the issue says
  "validate against the shared union", but accepting all of `EVENT_TYPES` lets anyone forge
  `purchase`/`add_to_cart` rows. Recommended default: only `page_view` (`CLIENT_EVENT_TYPES`).
  Affects steps: 1, 9.
- [ ] **Q4: Should cart stepper changes (+/−) be recorded?** — Why it matters: they change cart
  contents as much as add/remove. Recommended default: yes, as `add_to_cart` / `remove_from_cart`
  with the quantity delta and `properties.source = "stepper"`. Affects step: 7.
- [ ] **Q5: Does registration record a `login` event?** — Why it matters: `EVENT_TYPES` has no
  `register`; adding one needs a migration rewriting the CHECK. Recommended default: record `login`
  with `properties.method = "register"`. Affects step: 8.
- [ ] **Q6: Should later events in a session carry the landing UTMs?** — Why it matters: only the
  landing URL has `utm_*`, so `purchase` rows would have empty UTM columns unless the attribution is
  persisted (cookie or new `sessions` columns + migration). Recommended default: per-request UTMs;
  analysts join events to `sessions.traffic_source` for attribution. Affects step: 3.
- [ ] **Q7: OK to use `sessions.ended_at` as "last activity"?** — Why it matters: it's an ML
  feature column; the alternative is a new `last_seen_at` column (migration + rollback). Recommended
  default: reuse `ended_at` (= time of the last request in the session) and document it in
  `schema.ts`. Affects step: 2.

## Resolved questions

- **Do the tables or the event CHECK need a migration?** — No: all event types in the acceptance
  criteria are already in `EVENT_TYPES` and the CHECK; D3 avoids a new column (source:
  `app/.server/db/schema.ts`, `0002_analytics_schema.sql`).
- **Can `getVisitor` / `readVisitor` and the cookie names change?** — Signatures and cookie names
  stay; #18 extends behaviour only (source: comment in `app/.server/analytics.ts`,
  `app/.server/AGENTS.md` "Visitor").
- **Format of `traffic_source`?** — Reuse `resolveAcquisitionChannel` so it matches
  `users.acquisition_channel` (source: `app/lib/auth.ts`, `routes/register.tsx`).
- **Does a 30-minute session rotation break guest carts?** — No: a guest cart is found by
  `anonymous_id` through any of their sessions (source: `app/.server/AGENTS.md` "Cart").
- **Where do the login hooks go?** — `onUserAuthenticated`, which must never fail a login (source:
  `app/.server/services/auth.ts`, `app/.server/AGENTS.md` "Auth").
- **Is middleware available?** — Yes, React Router 8.5 exposes route `middleware` without a flag
  (source: `package.json`, installed `react-router` types).
- **How to avoid re-running loaders after a fetcher post?** — `shouldRevalidate` as in
  `app/routes/home.tsx`.
- **Bot detection?** — `isbot` is already a dependency (source: `package.json`).
- **`review_submit`?** — In `EVENT_TYPES` but not in this issue's acceptance criteria; no review
  feature exists. Out of scope.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/analytics.ts` | `DEVICE_TYPES`/`DeviceType`, `resolveDeviceType`, `utmFrom`, `CLIENT_EVENT_TYPES`, zod schema for client batches, `SESSION_TIMEOUT_MINUTES` |
| create | `app/lib/analytics.test.ts` | Unit tests for the pure helpers and the batch schema |
| modify | `app/.server/db/queries/analytics.ts` | `touchActiveSession`, extended `insertSession`, `insertEvents`, `linkAnonymousRows` |
| modify | `app/.server/analytics.ts` | 30-min window, session attributes, `visitorContext`, `ensureVisitor`, `isTrackingAllowed`, `isDocumentRequest`, `trackEvent`, `trackEvents`, `linkVisitorToUser` |
| modify | `app/.server/analytics.test.ts` | Integration tests for the above |
| create | `app/.server/analytics-middleware.ts` | The `_shop` visitor middleware (keeps the route file small, testable) |
| create | `app/.server/analytics-middleware.test.ts` | Middleware tests |
| modify | `app/routes/_shop.tsx` | Export `middleware` |
| modify | `app/routes/product.tsx` | `product_view` + `shouldRevalidate` |
| modify | `app/routes/catalog.tsx` | `search` + `shouldRevalidate` |
| modify | `app/.server/services/cart.ts` | Return the change (product id, variant, delta) from add/update/remove |
| modify | `app/.server/services/cart.test.ts` | Assert the returned change |
| modify | `app/routes/cart.tsx` | `ensureVisitor`, `add_to_cart` / `remove_from_cart` |
| modify | `app/routes/cart.test.ts` | Event assertions |
| modify | `app/.server/services/auth.ts` | `linkVisitorToUser` + `login` event in `onUserAuthenticated` |
| modify | `app/.server/services/auth.test.ts` | Linking, login event, never throws |
| modify | `app/routes/login.tsx`, `app/routes/register.tsx` | Pass `context` to `onUserAuthenticated` |
| create | `app/routes/api.events.ts` | Client events resource route (action only) |
| create | `app/routes/api.events.test.ts` | Validation, limits, inserts |
| modify | `app/routes.ts` | `route("api/events", "routes/api.events.ts")` outside the layout |
| modify | `app/routes.test.ts` | Route list, if it asserts it |
| create | `app/features/analytics/useClientPageViews.ts` | Client tracker hook (sendBeacon on client navigations) |
| create | `app/features/analytics/client-events.test.ts` | Tracker queue/batching logic |
| modify | `app/.server/db/schema.ts` | Comment: `ended_at` = last activity |
| modify | `app/.server/AGENTS.md` | Update the "Visitor" section: middleware, `trackEvent`, hand-off to #11 |

## Steps

- [ ] **1. Pure helpers in `app/lib/analytics.ts`.** Add `SESSION_TIMEOUT_MINUTES = 30`,
  `DEVICE_TYPES = ["mobile", "tablet", "desktop"] as const`, `resolveDeviceType(ua: string | null)`
  (tablet: `iPad|Tablet|Android(?!.*Mobile)`; mobile: `Mobi|iPhone|Android`; else desktop),
  `utmFrom(url: URL)` → `{ source, medium, campaign }` (trimmed, lowercased, max 100 chars, `null`
  when absent), `CLIENT_EVENT_TYPES = ["page_view"] as const satisfies readonly EventType[]`, and
  `clientEventBatchSchema` (zod: `{ events: [{ type: z.enum(CLIENT_EVENT_TYPES), path: string ≤ 2048
  starting with "/", referrer?: string ≤ 2048 }] }`, 1–20 events). Tests in
  `app/lib/analytics.test.ts`. Check: `pnpm test app/lib/analytics`.
- [ ] **2. Queries.** In `db/queries/analytics.ts`: replace `hasVisitorSession` with
  `touchActiveSession(db, sessionId, anonymousId)` (the single `UPDATE … RETURNING` from D3, using
  `SESSION_TIMEOUT_MINUTES`); extend `insertSession` values with `trafficSource`, `deviceType`,
  `userId`; add `insertEvents(db, rows)` (multi-row insert into `userEvents`); add
  `linkAnonymousRows(tx, anonymousId, userId)` updating `sessions` and `user_events` where
  `anonymous_id = ? and user_id is null`. Update the `ended_at` comment in `schema.ts` (no column
  change, so `pnpm db:generate` must produce nothing).
- [ ] **3. Extend `app/.server/analytics.ts`.** Keep `readVisitor`/`getVisitor` signatures. In
  `getVisitor`: use `touchActiveSession`; new sessions get the D4 attributes (`getUserId` from
  `session.ts` for `userId`). Add:
  - `visitorContext = createContext<Visitor | null>(null)` (from `react-router`).
  - `isTrackingAllowed(request)` (`!isbot(user-agent)`), `isDocumentRequest(request)`.
  - `ensureVisitor({ request, context })` (D6).
  - `trackEvent({ request, context }, type, { productId?, properties? })` (D5) and
    `trackEvents(visitor, request, events)` used by `/api/events`; both build rows with a shared
    `eventContext(request)` (UTMs via `utmFrom` on the URL, else the `Referer` URL; device; referrer
    capped at 500 chars) and swallow errors with `console.error("Tracking … failed", error)`.
  - `linkVisitorToUser(anonymousId, userId, db = defaultDb)` in `db.transaction` (D9).
  Tests (DB integration, `createTestDatabase`): session older than 30 minutes → new session and
  cookie, same anonymous id; recent session → `ended_at` touched, no cookie; new session stores
  traffic source (`?utm_source=instagram` → `instagram`, external referrer → host, none →
  `direct`), device type and landing page; `trackEvent` inserts a row with UTMs/device/referrer;
  `trackEvent` resolves (doesn't reject) when the insert fails (e.g. unknown session id) and is a
  no-op without a visitor; `linkVisitorToUser` fills `user_id` only on that visitor's userless
  rows. Update the existing "reuses both ids" test for the touch.
- [ ] **4. Middleware.** `app/.server/analytics-middleware.ts` exports `visitorMiddleware:
  Route.MiddlewareFunction`-compatible function: if `isTrackingAllowed`, `try { context.set(
  visitorContext, await getVisitor(request)) } catch { log; context.set(visitorContext, null) }`;
  if it's a document GET, `void trackEvent(…, "page_view", { properties: { path } })`; `const
  response = await next()`; then append the context visitor's `Set-Cookie` headers (it may have been
  created later by `ensureVisitor`) and, when any were added, set `Cache-Control: private,
  no-store` (D12). Export it from `_shop.tsx` as `export const middleware = [visitorMiddleware]`.
  Tests: document request → cookies + `page_view` row; `.data`-style request (no
  `Sec-Fetch-Dest: document`) → no `page_view`; bot UA → no cookies, no rows; `getVisitor` throwing
  → response still returned. Check manually with `pnpm aspire run`: first visit sets both cookies, a
  `sessions` row and a `page_view` row.
- [ ] **5. `product_view`.** In `routes/product.tsx` loader take `{ params, request, context }`,
  replace the `#18` comment with `void trackEvent({ request, context }, "product_view", { productId:
  product.id, properties: { publicId: product.publicId } })` (use whatever the product DTO exposes
  for the internal id; add it to the loader's server-side data only, don't send it to the client if
  it isn't already). Add `shouldRevalidate` (D7) with a unit test like `home.test.ts`.
- [ ] **6. `search`.** In `routes/catalog.tsx`, when `hasActiveFilters(search)`, `void
  trackEvent(…, "search", { properties: { gender, ...search, total } })`. Add `shouldRevalidate`
  (D7) + test.
- [ ] **7. Cart events.** `services/cart.ts`: `addItem` / `updateQuantity` / `removeItem` return
  `{ ok: true, change }` (D8); update `CartChangeResult` and `cart.test.ts`. `routes/cart.tsx`
  action: use `ensureVisitor` for `add` (drop `visitor.headers` from `respond`, the middleware sends
  them); after a successful change, `void trackEvent` with `add_to_cart` / `remove_from_cart`
  (stepper: sign of `quantityDelta`, `source: "stepper"`, nothing when the delta is 0). Tests in
  `routes/cart.test.ts`: add → one `add_to_cart` with product id and quantity; remove →
  `remove_from_cart`; failed change → no event.
- [ ] **8. Login linking and `login` event.** `onUserAuthenticated(args, userId, kind)` takes
  `{ request, context }` (update `login.tsx` / `register.tsx`); visitor = `context.get(
  visitorContext)` falling back to `readVisitor(request)`. After the cart merge, in a separate
  `try/catch`: `await linkVisitorToUser(anonymousId, userId)` then `await trackEvent(…, "login", {
  properties: { method: kind } })` with `user_id` forced to the new `userId` (the auth cookie isn't
  set on this request yet — add an optional `userId` override to `trackEvent` options). Tests in
  `services/auth.test.ts`: anonymous `page_view` rows get the user id after login; a `login` row
  exists; a failing link doesn't throw.
- [ ] **9. `/api/events` resource route.** `app/routes/api.events.ts` with only `action`: 405 for
  non-POST; 413 when `Content-Length` > 16 KB or the read text exceeds it; parse JSON (sendBeacon
  sends `text/plain`, so don't require `application/json`) with `clientEventBatchSchema` → 400 on
  failure; 429 via a module-level `createRateLimiter` keyed by `clientKey(request)` (e.g. 60
  batches/min); `!isTrackingAllowed` → 204 without writing; otherwise `getVisitor(request)`, `await
  trackEvents(…)` and return `new Response(null, { status: 204, headers: visitor.headers })`. Never
  500: wrap in `try/catch` → 204. Register in `routes.ts` outside the `_shop` layout with a comment
  like the `logout`/`locale` ones. Tests: valid batch → rows with `page_view` and path; unknown or
  server-only type (`purchase`) → 400, no rows; 21 events → 400; oversized body → 413.
- [ ] **10. Client tracker.** `app/features/analytics/useClientPageViews.ts`: a hook used in
  `ShopLayout` that watches `useLocation()`; skips the first render (the server already counted the
  document load); on each later pathname/search change, queues `{ type: "page_view", path,
  referrer: previousPath }` and flushes with `navigator.sendBeacon("/api/events",
  JSON.stringify({ events }))` (falling back to `fetch(…, { keepalive: true, method: "POST" })`;
  swallow errors). Flush immediately per navigation, and on `pagehide` for anything queued. Keep the
  queue/batching in a plain module (`client-events.ts`) so it's unit-testable without a DOM. No
  user-facing strings, so no i18n keys.
- [ ] **11. Docs.** Update `app/.server/AGENTS.md` "Visitor": middleware creates visitors for
  `_shop` routes; loaders/actions use `trackEvent({ request, context }, …)` and `ensureVisitor`;
  `ended_at` = last activity; bots are skipped; client events go through `/api/events`
  (`CLIENT_EVENT_TYPES`); the #11 call shape. Remove the "#18 extends it" note from
  `analytics.ts`.
- [ ] **12. Verify.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; manual run (below).

## Testing & verification

- Unit: `app/lib/analytics.test.ts` (device, UTMs, batch schema), `shouldRevalidate` tests for
  product and catalog, `client-events.test.ts`.
- DB integration (`describe.skipIf(!hasDatabase)`, `createTestDatabase`): `analytics.test.ts`,
  `analytics-middleware.test.ts`, `api.events.test.ts`, `cart.test.ts`, `services/auth.test.ts`.
- Failure safety: tests that make the insert or `getVisitor` fail and assert the page/action still
  responds normally.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`, then query the DB): open `/?utm_source=instagram` in a private window →
  one `sessions` row (`traffic_source = instagram`, `device_type`, `landing_page`) and a `page_view`;
  click to a product → `page_view` (via `/api/events`) and `product_view`; filter the catalog →
  `search`; add/remove in the cart → `add_to_cart` / `remove_from_cart` and no extra
  `product_view`; log in → earlier rows get `user_id`, plus a `login` row; stop the database
  briefly or break a query → pages still render. Check a blog page's first response has
  `Cache-Control: private, no-store` with the cookies.

## Acceptance criteria

- [ ] Each visit creates a session row with source, device and landing page — steps 2, 3, 4
- [ ] `page_view`, `product_view`, `search`, `add_to_cart`, `remove_from_cart`, `checkout_start`,
  `purchase` and `login` events are recorded — steps 4, 5, 6, 7, 8, 9, 10; **`checkout_start` and
  `purchase` are delivered by #11** using `trackEvent` from step 3 (see "Hand-off to #11")
- [ ] Anonymous events are linked to the user after login — steps 3, 8
- [ ] Tracking failures never break the shopping experience — steps 3, 4, 7, 8, 9 (never-rejecting
  `trackEvent`, `try/catch` in middleware, 204 fallback in `/api/events`)

## Out of scope

- `checkout_start` / `purchase` hooks — added by #11.
- A cookie-consent banner (Q1) and `review_submit` (no review feature yet).
- Tracking `/admin` pages and bots.
- Persisting landing UTMs across a session (Q6), new `sessions` columns, analytics dashboards or
  exports.
