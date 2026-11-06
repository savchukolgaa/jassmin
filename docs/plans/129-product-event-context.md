# Plan: Record list, position, price, stock and dwell time on product events for recommendations (#129)

Issue: https://github.com/savchukolgaa/jassmin/issues/129
Branch: `issue/129`
Worktree: `.claude/worktrees/issue-129`
Status: Planned

## Goal

As a data analyst, I want product events to record where a product was shown and how the visitor
reacted, so that I can train a product recommendation model on implicit feedback. To do that,
`user_events.event_properties` gets one typed, zod-validated contract per event type. Product
events carry list context, position, price and stock. Three new client events are added:
`product_impression`, `product_click` and `product_dwell`. The contract is documented in
`docs/analytics-events.md` for the later ETL issue.

## Dependencies & prerequisites

- Event tracking already exists on `origin/main`: #5 (schema), #18 (`trackEvent`, `/api/events`,
  the client tracker in `app/features/analytics/`, consent) and #46.
- #128 (merged, `39d45fb`) added `order_items.discount_allocated`. `createOrder`
  (`app/.server/services/orders.ts`) computes each line's share as `priced.allocation[index]`, so
  the `purchase` items can reuse it.
- One migration (`0029`): it rewrites `user_events_event_type_check` and has a hand-written
  rollback.
- No new packages or env vars, and no new external origins, so the CSP is unchanged.

## Decisions & assumptions

- **Property keys are snake_case for every event type**, as the issue spells them
  (`product_public_id`, `list_position`, …). That includes the existing events: `page_view`
  `{ path }`, `login` `{ method }`, `checkout_start` and `purchase` (`order_id`, `subtotal`,
  `total_amount`, …). Rows recorded before this change keep their camelCase keys, and
  `docs/analytics-events.md` lists the old-to-new mapping. **(unconfirmed, Q1)**
- **One typed map.** `app/lib/analytics.ts` replaces `EventProperties = Record<string, unknown>`
  with `interface EventPropertiesMap { [T in EventType]: … }` and
  `type EventProperties<T extends EventType = EventType> = EventPropertiesMap[T]`.
  `trackEvent` / `EventInput` become generic in the event type, so a call with the wrong shape
  fails `tsc`. `user_events.event_properties` is typed as the union of all shapes in `schema.ts`.
- **Validation in two places.** `app/lib/analytics.schema.ts` defines
  `eventPropertiesSchemas: { [T in EventType]: z.ZodType<EventPropertiesMap[T]> }`, and
  `.strict()` objects reject unknown keys, which keeps personal data out.
  1. `trackEvents` (server) parses every event before inserting it. An invalid event is dropped and
     logged, and the others are still inserted. Tracking never throws.
  2. `clientEventBatchSchema` becomes a discriminated union on `type` over `CLIENT_EVENT_TYPES`,
     with `properties` from the same schemas.
- **Shared product properties** (`ProductEventContext`): `product_public_id` (uuid), `variant_id`
  (uuid, nullable), `volume_ml`, `price` (an exact decimal string like the rest of the money
  fields, nullable for a product with no sizes), `in_stock`, plus optional `list_id`,
  `list_position` and `search_id`. `LIST_IDS = ["catalog", "popular", "offers", "similar",
  "search", "trio", "home"]` goes in `app/lib/analytics.ts`.
- **Which list is which:**

  | List | `list_id` |
  |------|-----------|
  | `/catalog` with no filters | `catalog` |
  | `/catalog` with a filter or sort (`hasActiveFilters`) | `search` |
  | Popular page | `popular` |
  | Popular page opened from the trio builder (with `family` params) | `trio` |
  | Offers page cards | `offers` |
  | Archived product's similar perfumes | `similar` |
  | Home bestsellers | `home` |

  The site has no free-text search, so the "search" list is the filtered catalog, which is
  already what records the `search` event (#18).
- **`list_position` is 1-based and absolute across pages:** `(page − 1) × pageSize + index + 1`.
  This matters for position bias.
- **`search_id`** is a `randomUUID()` made in the catalog loader whenever it records `search`. It
  is returned in loader data and carried by that page's impressions, clicks and add-to-cart posts.
  `shouldRevalidateView` already stops form posts from re-running the loader, so the id stays
  stable while the page is open.
- **`search` properties:** `search_id`, `query` (always `null` for now, reserved for a future text
  search), `gender`, `fragrance_family`, `brand`, `sort`, `page`, `result_count`, and
  `product_public_ids` of the results shown (at most 24; a catalog page holds 12,
  `CATALOG_PAGE_SIZE`).
- **Impressions** are client events, sent only when `_shop`'s `consent === "granted"`:
  - A card counts once at least 50% of it is visible (one `IntersectionObserver` per list,
    threshold 0.5).
  - Duplicates are dropped per list render. The key is `renderKey:product_public_id`, and
    `renderKey` is new whenever the list's product ids, page or `search_id` change.
  - They go into the existing queue and are flushed every 5 s, when the queue reaches
    `MAX_CLIENT_EVENTS`, and on `visibilitychange` → hidden or `pagehide`. That is one beacon per
    flush, well under the limit of 60 per minute and the 16 KB body.
  - An impression describes the card's default size (`defaultVariant`).
- **Clicks** (`product_click`) are client events sent from the card's image and title links
  (`onClick`, plus `onAuxClick` for middle-click). They are pushed and flushed right away, since
  `sendBeacon` survives the navigation, and they carry the size picked on the card. `product_view`
  stays a server event, and the ETL joins it to the click by session and time.
- **Dwell** (`product_dwell`) is sent once per product page view, from a
  `useProductDwell(product, enabled)` hook:
  - It counts only time while the page is visible and is capped at 30 min (`MAX_DWELL_MS`).
  - It is sent on the first of `visibilitychange` → hidden, `pagehide`, or unmount (a client-side
    navigation away).
  - `max_scroll_pct` is 0–100, rounded.
  - The event also carries the shared properties for the default size.
- **Client events are trusted only as far as their shape.** `/api/events` resolves
  `product_public_id` to `products.id` in one query (`findProductIdsByPublicIds`). That fills the
  `product_id` column and drops events for unknown products. `price` / `in_stock` are what the
  client showed, which is what the issue asks for.
- **Server product events gain price and stock:**
  - `product_view` gets the default size's `variant_id`, `volume_ml`, `price` and `in_stock`.
  - `add_to_cart` / `remove_from_cart` get the variant's `price` and `in_stock` before the change,
    `product_public_id`, and `cart_value_after`, the cart subtotal after the change from
    `cartTotals` in the same transaction. `CartChange` grows to carry these.
  - Add-to-cart forms on list cards post optional `listId`, `listPosition` and `searchId` hidden
    fields, so `add_to_cart` gets `list_id` (and the position and search id). These are optional in
    `cart.schema.ts`, and the product page sends none.
- **`purchase`** gains:
  - `items`: `[{ variant_id, quantity, unit_price, discount_allocated }]`, built in `createOrder`
    from `lines` and `priced.allocation` and returned in `PlacedOrderTotals`.
  - `is_first_order`: no earlier order with the same `user_id` or, for a guest, the same
    lower-cased email, checked inside the order transaction. **(unconfirmed, Q2)**
- **Everything else follows existing patterns.** No new user-facing strings, so no i18n keys, and
  no zod in client code: `app/features/analytics/*` imports only types and constants from
  `~/lib/analytics`, which `client-bundle.guard.test.ts` already enforces.

## Open questions

- [ ] **Q1: Rename the existing camelCase property keys to snake_case, and backfill old rows?** —
  Why it matters: the issue names snake_case keys, but today's rows use `publicId`, `variantId`,
  `orderId`, … One contract is cleaner for the ETL, while a rename leaves two key styles in
  history. A jsonb backfill migration would fix the history but adds a data migration and its
  rollback. Recommended default: snake_case for every event type from now on, **no backfill**,
  and an old-to-new key table in `docs/analytics-events.md`. Affects steps: 1, 2, 7, 10.
- [ ] **Q2: How should `is_first_order` identify a returning guest?** — Why it matters: guests have
  no `user_id`. Matching only by user misses repeat guests, and matching by email links a guest to
  their registered history. Recommended default: an earlier order with the same `user_id`, or with
  the same lower-cased `orders.email`, counting every status (cancelled ones too). Affects step: 7.
- [ ] **Q3: What threshold makes an impression?** — Why it matters: it decides which "negatives"
  the model learns from. Recommended default: 50% of the card visible, with no minimum time. A
  1-second dwell (the IAB standard) can be added later. Affects step: 5.

## Resolved questions

- **Is there a DB CHECK on `event_type`?** — Yes, `user_events_event_type_check` (migration
  `0002_analytics_schema.sql`). Adding a type is a migration that rewrites it (source:
  `app/.server/AGENTS.md` → Analytics tables).
- **How are client events limited?** — `CLIENT_EVENT_TYPES` (today only `page_view`),
  `MAX_CLIENT_EVENTS = 20` per request, 16 KB per body and 60 batches per minute per IP (source:
  `app/lib/analytics.ts`, `app/.server/client-events.ts`).
- **Where does the client learn about consent?** — `_shop`'s loader returns `consent`, and
  `ShopLayout` already calls `useClientPageViews(consent === "granted")`; the server re-checks
  `isTrackingAllowed` and bots (source: `app/routes/_shop.tsx`, `app/routes/api.events.ts`).
- **Is there a text search with a `query`?** — No. The only search is the catalog's filters and
  sort, recorded as `search` when `hasActiveFilters` (source: `app/routes.ts`,
  `app/routes/catalog.tsx`, `app/lib/catalog.ts`).
- **What is the "trio" list?** — The trio builder shows no products. It links to the popular page
  filtered by its families and gender, so that filtered page is the `trio` list (source:
  `app/features/home/TrioBuilder.tsx`, `app/routes/popular.tsx`).
- **Where do per-line discounts come from?** — `priced.allocation` in `createOrder`, stored as
  `order_items.discount_allocated` since #128 (source: `app/.server/services/orders.ts`).
- **Do cached pages (offers) break list tracking?** — No. Impressions and clicks are sent from the
  client with data already in the page, so a publicly cached page still reports them (source:
  `app/routes/offers.tsx` → `blogResponseHeaders`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts`, `app/lib/enums.test.ts` | add `product_impression`, `product_click`, `product_dwell` to `EVENT_TYPES` |
| create | `app/.server/db/migrations/0029_product_event_types.sql` (+ meta snapshot/journal) | rewrite `user_events_event_type_check` |
| create | `app/.server/db/rollbacks/0029_product_event_types.sql` | delete rows of the new types, restore the old check |
| modify | `app/.server/db/schema.ts`, `app/.server/db/schema.test.ts` | `eventProperties` typed as the union of the contract |
| modify | `app/lib/analytics.ts`, `app/lib/analytics.test.ts` | `EventPropertiesMap`, `ProductEventContext`, `LIST_IDS`, `MAX_DWELL_MS`, new `CLIENT_EVENT_TYPES`, position helper |
| modify | `app/lib/analytics.schema.ts`, `app/lib/analytics.schema.test.ts` (create) | per-type zod schemas; client batch as a discriminated union |
| modify | `app/.server/analytics.ts`, `app/.server/analytics.test.ts` | generic `trackEvent` / `EventInput`; validate before insert |
| modify | `app/.server/db/queries/analytics.ts` (or `queries/products.ts`) | `findProductIdsByPublicIds` |
| modify | `app/routes/api.events.ts`, `app/routes/api.events.test.ts` | accept product events, resolve `product_id`, drop unknown products |
| modify | `app/.server/analytics-middleware.ts`, `app/routes/consent.ts`, `app/.server/services/auth.ts` | snake_case properties (`page_view`, `login`) |
| modify | `app/features/analytics/client-events.ts`, `client-events.test.ts` | timed flush, flush on hidden |
| create | `app/features/analytics/product-tracking.ts(x)` + test | `ProductListProvider`, `useProductImpression`, `trackProductClick`, dedupe store |
| create | `app/features/analytics/useProductDwell.ts` + test | dwell and scroll depth |
| modify | `app/features/catalog/ProductCard.tsx` | `position` prop, impression ref, click handlers, list fields on `AddToCartForm` |
| modify | `app/features/cart/AddToCartForm.tsx` | optional hidden `listId` / `listPosition` / `searchId` |
| modify | `app/lib/cart.schema.ts` (+ test) | optional list fields on `intent: "add"` |
| modify | `app/.server/services/cart.ts`, `app/.server/db/queries/*` (cart lines / variant lookup) | `CartChange` gets `productPublicId`, `variantPublicId`, `price`, `inStock`, `cartValueAfter` |
| modify | `app/routes/cart.tsx`, `app/routes/cart.test.ts` | new `add_to_cart` / `remove_from_cart` properties |
| modify | `app/routes/product.tsx`, `app/routes/product.test.ts` | `product_view` properties; dwell hook; `similar` list |
| modify | `app/routes/catalog.tsx`, `app/routes/catalog.test.ts` | `search_id`, new `search` properties, `catalog`/`search` list |
| modify | `app/features/popular/PopularPage.tsx`, `app/features/offers/OfferCard.tsx`, `app/features/home/Bestsellers.tsx`, `app/features/product/ProductArchived.tsx` | wrap lists in `ProductListProvider`, pass positions |
| modify | `app/.server/services/orders.ts` (+ test), `app/.server/db/queries/orders.ts` | `items`, `is_first_order` in `PlacedOrderTotals` |
| modify | `app/routes/checkout.tsx`, `app/routes/checkout.test.ts` | snake_case `checkout_start` / `purchase` with the new fields |
| create | `docs/analytics-events.md` | the event contract |
| modify | `app/.server/AGENTS.md` | "Visitor and events" section: new events, contract, validation |

## Steps

- [ ] **1. Typed contract and zod schemas** — In `app/lib/analytics.ts`, add `LIST_IDS` / `ListId`,
  `ProductEventContext`, `EventPropertiesMap` for all event types, `MAX_DWELL_MS = 30 * 60_000` and
  `absoluteListPosition(page, pageSize, index)`. Add the three new types to `EVENT_TYPES` and
  extend `CLIENT_EVENT_TYPES` to `page_view`, `product_impression`, `product_click` and
  `product_dwell`. In `analytics.schema.ts`, add `eventPropertiesSchemas` (strict objects;
  `price` as a decimal-string regex; `list_position` int ≥ 1; `dwell_ms` int 0..`MAX_DWELL_MS`;
  `max_scroll_pct` 0..100; `items` non-empty) and `parseEventProperties(type, value)`. Rewrite
  `clientEventBatchSchema` as `z.discriminatedUnion("type", …)` with `path`, an optional `referrer`
  and `properties`. Check: new `analytics.schema.test.ts` cases accept and reject each shape,
  including unknown keys and an email-looking extra field.
- [ ] **2. Server tracking uses the contract** — Make `trackEvent<T>` / `EventInput<T>` generic in
  `app/.server/analytics.ts`, and have `trackEvents` validate each row with
  `parseEventProperties`, dropping and logging invalid ones. Type `schema.ts`'s `eventProperties`
  with the union. Move the current callers to snake_case: `page_view` (middleware, `consent.ts`,
  `api.events.ts`) and `login` (`auth.ts`). Check: `pnpm typecheck` and the existing analytics,
  consent and auth tests, updated for the new keys.
- [ ] **3. Migration** — Add the three types to the drizzle `check(...)` in `schema.ts`, run
  `pnpm db:generate --name product_event_types`, and write
  `db/rollbacks/0029_product_event_types.sql`: delete `user_events` rows of the new types, then
  restore the old check. Update `enums.test.ts` / `schema.test.ts`. Check: `migrator.test.ts`
  applies and rolls back.
- [ ] **4. `/api/events` accepts product events** — Add `findProductIdsByPublicIds(db, ids)`. In
  the action, map each event to an `EventInput` with its `properties`. For product events, set
  `productId` from the lookup and drop events whose product is unknown. Check:
  `api.events.test.ts` covers an impression batch recorded with `product_id`, an unknown product
  dropped, an invalid shape giving 400, no consent giving 204 with nothing stored, and more than
  20 events giving 400.
- [ ] **5. Client list tracking** — Extend `createEventQueue` with a timed flush (5 s, injectable
  timer for tests) and a flush on `visibilitychange` → hidden. Add a `ProductListProvider` with
  `{ listId, searchId?, page, pageSize, renderKey, enabled }`, where `enabled` is `_shop`'s
  consent read through `useRouteLoaderData("routes/_shop")`. Add `useProductImpression(ref,
  product, position)`, which uses one shared `IntersectionObserver` (threshold 0.5) per provider
  and a dedupe set keyed by `renderKey`. Add `trackProductClick(context, product, position,
  variantId)`. Outside a provider, or without consent, everything is a no-op. Check: unit tests
  show impressions deduplicated per render and sent again after `renderKey` changes, nothing
  queued without consent, and batches capped at `MAX_CLIENT_EVENTS`.
- [ ] **6. Wire the lists** — Give `ProductCard` a `position` prop, attach the impression ref to
  the `<article>`, and add click handlers on both links (reporting the selected size).
  `AddToCartForm` takes an optional `list` prop for the hidden fields. Wrap the lists:
  - `catalog.tsx`: `search` with `search_id` when filtered, else `catalog`.
  - `PopularPage`: `trio` when `view.families.length > 0`, else `popular`.
  - `OfferCard`: `offers`.
  - `Bestsellers`: `home`.
  - `SimilarProducts`: `similar`.

  Check: the component tests still pass, and in the running app (consent accepted) scrolling the
  catalog sends `product_impression` beacons with the right positions on page 2.
- [ ] **7. Server product events get price, stock and list** — Do each of these:
  - Catalog loader: make `searchId`, record the new `search` shape, and return `searchId`.
  - Product loader: `product_view` with the default size's context.
  - `cart.schema.ts`: optional `listId` (enum), `listPosition` and `searchId` on `add`.
  - `services/cart.ts`: carry `productPublicId`, `variantPublicId`, `price`, `inStock` (before
    the change) and `cartValueAfter` (`cartTotals(tx, cartId).subtotal`) in `CartChange`.
  - `cart.tsx` `trackChange`: send them, plus the list fields when posted.
  - `createOrder`: return `items` and `isFirstOrder` (Q2), via a query in `queries/orders.ts` run
    in the transaction.
  - `checkout.tsx`: snake_case `checkout_start` and `purchase` with `items` and `is_first_order`.

  Check: route tests assert the recorded properties, and `orders.test.ts` covers a first order and
  a second one.
- [ ] **8. Product dwell** — Add `useProductDwell(product, enabled)`. It tracks visible time with
  `performance.now()` across visibility changes, tracks max scroll depth with a passive `scroll`
  listener, and sends once on the first of hidden, `pagehide` or unmount, capped at
  `MAX_DWELL_MS`. Call it in `routes/product.tsx`. Check: fake-timer tests cover visible time
  only, the cap, sending once, and nothing without consent.
- [ ] **9. Docs** — Write `docs/analytics-events.md`. For each event type it gives: who records it
  (server or client), when it fires, a property table, and an example. Add the shared
  product-context table, the `list_id` table, position and dedupe rules, the consent and
  no-personal-data rules, and the old-to-new key mapping (Q1). Update the "Visitor and events"
  section of `app/.server/AGENTS.md` and link the doc from it.
- [ ] **10. Verify** — Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, then do the
  manual checks below.

## Testing & verification

- Unit tests:
  - `analytics.schema.test.ts`: each event's valid and invalid shapes, and the client batch union.
  - `analytics.test.ts`: `absoluteListPosition`.
  - `client-events.test.ts`: the timed and hidden flushes.
  - `product-tracking.test.ts`: dedupe per list render, no consent, batching.
  - `useProductDwell.test.ts`: visible time only, the cap, sending once.
- Integration tests (DB):
  - `api.events.test.ts`: product events, unknown product, consent, limits.
  - `analytics.test.ts`: invalid properties dropped and the rest inserted.
  - `cart.test.ts`: `add_to_cart` with `price`, `in_stock`, `cart_value_after` and `list_id`.
  - `catalog.test.ts`: `search` with `search_id` and `product_public_ids`.
  - `product.test.ts`: `product_view` with price and stock.
  - `checkout.test.ts` / `orders.test.ts`: `purchase` with `items` and `is_first_order`.
  - `migrator.test.ts`: 0029 applies and rolls back.
- `client-bundle.guard.test.ts` must still pass (no zod in `features/analytics`).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual, under `pnpm aspire run`:
  1. Accept cookies, scroll the catalog, filter it, click a card, stay on the product page and
     switch tabs, add to cart from a card, and check out.
  2. In `user_events`, check the impressions and click, matching `search_id`, one
     `product_dwell`, and `add_to_cart` with `list_id`.
  3. Decline cookies and confirm that no `/api/events` beacons are sent.

## Acceptance criteria

- [ ] Catalog, popular, offers, similar and search lists send `product_impression` events with
  `list_id` and `list_position`, in batches, only with consent — steps 1, 4, 5, 6
- [ ] Clicking a product from a list records `product_click` with the same
  `list_id`/`list_position`, and searches carry a `search_id` linking the results to the clicks —
  steps 5, 6, 7
- [ ] Product pages send `product_dwell` on leave — step 8
- [ ] Every product event has `price` and `in_stock` as shown at that moment — steps 1, 5, 7, 8
- [ ] `event_properties` is typed and validated per event type, and `docs/analytics-events.md`
  documents the contract — steps 1, 2, 9
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 10

## Out of scope

- The recommendation model, and showing recommendations on the site.
- The ETL / export of events (a later issue that reads `docs/analytics-events.md`).
- Backfilling or rewriting the properties of rows recorded before this change (see Q1).
- A free-text product search (`query` is reserved as `null`).
- Wishlist events: the TLDR mentions "wishlist-style signals", but the site has no wishlist and the
  Technical section defines none.
