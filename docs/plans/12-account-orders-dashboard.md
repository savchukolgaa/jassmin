# Plan: Build user account dashboard with current and previous orders (#12)

Issue: https://github.com/savchukolgaa/jassmin/issues/12
Branch: `issue/12`
Worktree: `.claude/worktrees/issue-12`
Status: Planned

## Goal

A registered customer opens `/account` and sees their orders, split into **Current orders**
(`pending`, `paid`, `shipped`, with a pending → paid → shipped → completed progress indicator) and
**Previous orders** (`completed`, `cancelled`, `returned`, `unclaimed`, as a list with date, total,
status and expandable items). Each order opens at `/account/orders/:id`, which answers 404 unless
the order is the user's. Everything is loaded server-side in loaders, and line prices come from
`order_items.price_at_purchase`. Logged-out visitors are redirected to `/login`.

## Dependencies & prerequisites

- **#9 (closed, on `main`)**: `requireUser(request)` in `app/.server/services/auth.ts` throws a
  redirect to `/login?redirectTo=<path>`; login returns to `redirectTo` or `/account`.
  `PublicUser` (`app/.server/db/queries/users.ts`) has `id`, `fullName`, `email`, `role`.
- **#11 (closed, on `main`)**: `orders` / `order_items` are filled by `createOrder`;
  `orders.user_id` is set for logged-in buyers. `listOrderLines` and `findOrder` in
  `app/.server/db/queries/orders.ts`, `OrderSummaryLine` / `OrderConfirmation` in
  `app/lib/checkout.ts`, and `features/checkout/OrderSummary.tsx` already exist and are reused.
- `orders_user_id_idx` already exists, so listing a user's orders needs no migration.
- No new packages, env vars or migrations.
- Note: #17 (admin order management) was closed as superseded by **#40 (open)**, which moves
  order management to Strapi and syncs status changes back to the app DB for this dashboard.
  Until #40 lands, every order is `pending` in practice, so tests create orders in other
  statuses directly in the DB. #12 doesn't depend on #40: it reads `orders.status` whatever sets it.
- Follow-ups filed from this plan: #54 (account profile page) and #55 (special offers page).

## Decisions & assumptions

- **Route structure (as the issue asks).** `app/routes.ts` turns the flat `route("account", …)`
  inside the `_shop` layout into a nested layout:
  `route("account", "routes/account.tsx", [index("routes/account._index.tsx"), route("orders/:id", "routes/account.orders.$id.tsx")])`.
  `account.tsx` becomes the layout (C+ hero band + account side nav + `<Outlet />`).
- **Every account loader calls `requireUser(request)`**, not only the layout: child loaders run
  in parallel with the layout's, so the layout can't protect them (same rule as `/admin`,
  `app/.server/AGENTS.md`).
- **Ownership in SQL.** Orders are always queried with `where user_id = <user.id>`
  (and `id = <orderId>` for details), so another user's order and guest orders placed with the
  same email are never loaded. Linking guest orders is out of scope (issue Context).
- **Current/previous split lives in `app/lib/account.ts`** (isomorphic): `CURRENT_ORDER_STATUSES`,
  `PREVIOUS_ORDER_STATUSES`, `ORDER_PROGRESS_STEPS = ["pending", "paid", "shipped", "completed"]`,
  `isCurrentOrder(status)` and `orderProgressIndex(status)`. A test checks that the two status
  lists partition `ORDER_STATUSES` exactly, so a new status can't silently disappear.
- **Status timestamps = the columns that exist:** `created_at` (placed), `paid_at`,
  `cancelled_at`, `refunded_at`, `updated_at`. There is no `shipped_at` / `completed_at`, so the
  progress indicator shows dates only for steps that have one (placed, paid) **(unconfirmed, Q1)**.
- **No N+1.** The dashboard loads the user's orders in one query (with an `item_count`
  aggregate) and all their lines in a second query with `inArray(order_items.order_id, ids)`,
  grouped in the service.
- **Prices.** Lines use `order_items.price_at_purchase` as `unitPrice` and
  `price_at_purchase * quantity` computed in SQL as `numeric(10, 2)` (same as `listOrderLines`);
  order totals use `orders.total_amount`. Products are left-joined, so lines of deleted products
  still show (title `null` → a "product no longer available" label).
- **Expandable items without JS:** previous orders use `<details>` / `<summary>` (pattern already
  used in `components/layout/CatalogMenu.tsx`), so the page works before hydration.
- **Design: C+ Account** (`docs/design.md`, canvas page `AccountPlus`): deep-pink hero band
  ("My account" eyebrow, "Hi, {firstName}." heading, email, `outline-light` log-out button in a
  `<Form method="post" action="/logout">`); left account nav as pill links (Orders active,
  Continue shopping); current orders as `blush` `rounded-card-lg` cards with a status pill
  (`primary`), the 4-step progress bar, product thumbnails (`products.image_url`) and a `dark`
  "Order details →" `ButtonLink`; previous orders as a bordered list of `<details>` rows; empty
  state as a `blush` panel. Status pills: `completed` = `success-bg` / `success`, `cancelled` /
  `returned` / `unclaimed` = `card` / `body`, current statuses = `primary` / white. Only existing tokens are used (`primary`, `ink`, `muted`, `body`,
  `blush`, `card`, `line`, `success` / `success-bg`) and the existing `Button` / `ButtonLink`;
  animations are disabled under `prefers-reduced-motion`.
- **First name** for the greeting = the first word of `users.full_name`.
- **Order detail page** `/account/orders/:id`: order number, date, status (progress indicator for
  current orders, a status pill for previous ones), status timestamps, delivery
  (`guest_full_name`, `guest_phone`, `shipping_address`), payment method, and the lines/amounts via
  the existing `OrderSummary` component. Ids are validated with the same `^\d{1,10}$` and
  `≤ 2_147_483_647` rule as `checkout-success.tsx`; that parser moves to
  `parseOrderId()` in `app/lib/checkout.ts` and both routes use it. The payment labels
  (`PAYMENT_KEYS`) move there too, so the detail page shows the same text as the success page.
- **Privacy:** account routes export `meta` with `robots: noindex` and a `headers` export with
  `Cache-Control: private, no-store`, since they show personal data.
- **No analytics events** are added (the `_shop` middleware already records `page_view`).
- All copy goes to a new `account` namespace in `app/lib/i18n/uk.ts` and `en.ts`; dates use
  `formatDate`, amounts `formatPrice`. The obsolete `account.ordersSoon` key is removed.

## Open questions

- [ ] **Q1: Should we add `shipped_at` / `completed_at` columns?** — Why it matters: the issue asks
  for "status timestamps", but only `paid_at`, `cancelled_at` and `refunded_at` exist, so the
  shipped and completed steps can't show a date. #17 was closed as superseded by #40 (order
  management in Strapi), so the question is asked on #40
  (https://github.com/savchukolgaa/jassmin/issues/40#issuecomment-6397082580), together with the
  status-name mismatch (#40 lists `delivered`, the app has `completed` / `returned` /
  `unclaimed`). Default for #12 (applies until #40 answers): no new columns; show dates for placed
  (`created_at`) and paid (`paid_at`), plus `cancelled_at` / `refunded_at` on previous orders.
  `OrderProgress` takes an optional date per step, so dates for later steps are a small change.
  Affects steps: 2, 3, 6, 7.

## Resolved questions

- **How do `returned` / `unclaimed` / `cancelled` look?** — The default was accepted:
  `completed` = `success-bg` / `success`; `cancelled`, `returned`, `unclaimed` = `card` / `body`
  neutral pill (no new colour for the canvas's amber `returned` pill); previous orders show only
  the pill, no progress bar (source: user decision, 2026-10-25).
- **Keep the canvas's "Profile details" nav link?** — Not in #12. The profile page is its own
  issue, #54, which adds `/account/profile` and the side-menu link. #12's side menu has "Orders"
  and "Continue shopping" (`/`), built as a list so #54 can add an item (source: user decision;
  #54).
- **Empty-state call to action?** — The canvas's tester-trio offer becomes the special-offers
  page, #55. Until #55 lands, the "No orders yet" panel links to `/catalog/women` and
  `/catalog/men` (no Unisex); #55 repoints it to `/offers` (source: user decision; #55).

- **Which statuses are current vs previous?** — Current: `pending`, `paid`, `shipped`; previous:
  `completed`, `cancelled`, `returned`, `unclaimed` (source: #12 Context; `ORDER_STATUSES` in
  `app/lib/enums.ts` has exactly these seven).
- **How are logged-out users redirected?** — `requireUser` throws
  `redirect("/login?redirectTo=<path>")`, and login returns there (source:
  `app/.server/AGENTS.md` Auth; #9).
- **Where do historical prices come from?** — `order_items.price_at_purchase`, copied from the
  variant at checkout; size from the `order_items.volume_ml` snapshot (source:
  `app/.server/db/schema.ts`, `app/.server/AGENTS.md` Database; #11).
- **Should guest orders with the same email appear?** — No, out of scope (source: #12 Context).
- **Is an index on `orders.user_id` needed?** — Already exists, `orders_user_id_idx` (source:
  `app/.server/db/schema.ts`).
- **What does the page look like?** — C+ Account canvas page `AccountPlus` (source:
  `docs/design.md` "Pages and issues").
- **Can the detail page reuse the checkout order summary?** — Yes: `OrderSummary` takes
  `OrderSummaryLine[]`, `subtotal`, `total`, `freeShipping`, and `listOrderLines` already reads
  `price_at_purchase` (source: `app/features/checkout/OrderSummary.tsx`,
  `app/.server/db/queries/orders.ts`).
- **Is a `<details>` disclosure acceptable?** — Yes, already used for the catalog menu so it works
  without JS (source: `app/components/layout/CatalogMenu.tsx`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `app/lib/account.ts` | Status groups, progress steps, `AccountOrder` / `AccountOrderLine` / `AccountOrderDetail` DTOs, `firstName()` |
| create | `app/lib/account.test.ts` | Partition of statuses, progress index, first name |
| modify | `app/lib/checkout.ts` (+ test) | `parseOrderId()` shared by the success and account detail routes |
| modify | `app/.server/db/queries/orders.ts` | `listUserOrders`, `listOrderLinesByOrderIds`, `findUserOrder` |
| modify | `app/.server/services/orders.ts` | `getAccountOrders(userId)`, `getAccountOrder(userId, orderId)` |
| modify | `app/.server/services/orders.test.ts` | DB integration tests for ownership, split, prices |
| modify | `app/routes.ts` | Nest `account` index + `orders/:id` |
| modify | `app/routes/account.tsx` | Layout: `requireUser`, hero, side nav, `<Outlet />`, `headers`, `meta` |
| create | `app/routes/account._index.tsx` (+ `.test.ts`) | Dashboard loader + current/previous sections |
| create | `app/routes/account.orders.$id.tsx` (+ `.test.ts`) | Detail loader (404 unless owned) + page |
| modify | `app/routes/checkout-success.tsx` | Use `parseOrderId()` |
| create | `app/features/account/OrderProgress.tsx` | 4-step progress indicator (accessible `<ol>`) |
| create | `app/features/account/OrderStatusPill.tsx` | Status pill with token colours |
| create | `app/features/account/CurrentOrderCard.tsx` | Current order card |
| create | `app/features/account/PreviousOrdersList.tsx` | `<details>` rows with items |
| create | `app/features/account/account-ui.test.ts` | Component tests (uk default, en wrapper) |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `account.*` copy; drop `account.ordersSoon` |
| modify | `app/.server/AGENTS.md` | Short "Account" note under Orders |

## Steps

- [x] **1. Shared account types and helpers** — In `app/lib/account.ts` add
  `CURRENT_ORDER_STATUSES` / `PREVIOUS_ORDER_STATUSES` (`as const satisfies readonly OrderStatus[]`),
  `ORDER_PROGRESS_STEPS`, `isCurrentOrder`, `orderProgressIndex` (index in the steps, or `-1` for
  statuses off the path), `firstName(fullName)`, and the DTOs:
  `AccountOrderLine extends OrderSummaryLine { imageUrl: string | null }`;
  `AccountOrder { id, status, createdAt, paidAt, cancelledAt, refundedAt, totalAmount, itemCount, lines }`;
  `AccountOrderDetail` = `AccountOrder` + delivery/payment fields + `subtotal`, `freeShipping`.
  Add `parseOrderId(param): number | null` to `app/lib/checkout.ts` and switch
  `checkout-success.tsx` to it (its tests must still pass). Tests in `account.test.ts` /
  `checkout.test.ts`. Check: `pnpm typecheck && pnpm test`.
- [x] **2. Queries** — In `app/.server/db/queries/orders.ts`:
  `listUserOrders(db, userId)` selects the order columns above plus
  `itemCount = coalesce(sum(order_items.quantity), 0)::int` (left join + group by), ordered by
  `created_at desc, id desc`; `listOrderLinesByOrderIds(db, orderIds)` returns `orderId`, the
  `OrderSummaryLine` fields (`unitPrice = price_at_purchase`, `lineTotal` in SQL) and
  `products.image_url`, ordered by `order_items.id` (returns `[]` without a query for no ids);
  `findUserOrder(db, userId, orderId)` = `findOrder`'s columns plus `status`, timestamps, filtered
  by both ids. Keep them typed via the query builder (dates come back as `Date`).
- [x] **3. Service** — In `app/.server/services/orders.ts`: `getAccountOrders(userId, db)` →
  `{ current: AccountOrder[]; previous: AccountOrder[] }` (lines grouped by `orderId`, split with
  `isCurrentOrder`); `getAccountOrder(userId, orderId, db)` → `AccountOrderDetail | undefined`
  (lines via `listOrderLinesByOrderIds([orderId])`). Integration tests in `orders.test.ts`
  (inside the existing `describe.skipIf(!hasDatabase)` with its throwaway DB): two users each
  place orders; set statuses with a direct `update(orders)`; assert a user only gets their own
  orders, the split by status, newest first, and that changing `product_variants.price` after the
  order doesn't change `unitPrice` / `lineTotal`; `getAccountOrder` returns `undefined` for
  another user's order and for a guest order with the user's email.
- [x] **4. i18n** — Add the `account` namespace to `uk.ts` (source of truth) and `en.ts`:
  eyebrow, `greeting` ("Вітаємо, {name}."), nav labels, section headings, order number, placed
  date, plural `items` (`{ one, few, many, other }` / `{ one, other }`), status labels for all
  seven statuses (keyed by `OrderStatus` so the map is exhaustive), progress step labels,
  timestamp labels (placed/paid/cancelled/refunded), "Order details", "Back to orders", deleted
  product label, empty state, detail meta title. Remove `account.ordersSoon`. Check:
  `pnpm typecheck` (dictionary shapes must match).
- [x] **5. Routes and layout** — Update `app/routes.ts` as in Decisions. Rewrite
  `routes/account.tsx` as the layout: `loader` → `requireUser` → `{ firstName, email }`; `meta`
  with `noindex`; `headers` → `Cache-Control: private, no-store`; hero band + side nav
  (`NavLink` to `/account` with `end`, and Continue shopping) + `<Outlet />`. Check: `pnpm
  typecheck` (route typegen) and `/account` still renders when logged in.
- [x] **6. Dashboard** — `routes/account._index.tsx`: `loader` → `requireUser` →
  `getAccountOrders(user.id)`; renders `CurrentOrderCard`s (number, date, item count, total,
  `OrderStatusPill`, `OrderProgress`, up to 3 thumbnails, "Order details →" to
  `/account/orders/:id`), then `PreviousOrdersList` (`<details>` rows: number, date, total, pill;
  body lists lines with title/brand/volume/qty and `unitPrice` from `price_at_purchase`, plus a
  link to the detail page), or the empty state when both lists are empty (links to `/catalog/women` and `/catalog/men`
  until #55 adds `/offers`). Hide a section
  that is empty while the other has orders. `OrderProgress` is an `<ol>` with
  `aria-current="step"` on the current step and visually hidden "done" text, so status isn't
  shown by colour alone.
- [x] **7. Order detail** — `routes/account.orders.$id.tsx`: `loader` → `requireUser` →
  `parseOrderId(params.id)` (null → `throw data(null, { status: 404 })`) →
  `getAccountOrder(user.id, id)` (undefined → 404). Page: "Back to orders" link, heading with the
  order number, date, progress or pill, timestamps list, delivery and payment `<dl>` (payment
  labels as in `checkout-success.tsx`), and `OrderSummary` with the lines and amounts; `meta`
  with the order number and `noindex`.
- [x] **8. Route and component tests** — `account._index.test.ts` and
  `account.orders.$id.test.ts`, mocking `~/.server/services/auth` and `~/.server/services/orders`
  like `checkout-success.test.ts`: logged-out → `requireUser`'s redirect propagates; loaders pass
  the logged-in user's id; detail answers 404 for a missing/foreign order and for malformed ids
  without a lookup; `meta` is `noindex`. `account-ui.test.ts`: progress marks steps for
  `pending` / `paid` / `shipped`, status pill labels in uk and en, previous rows show
  `price_at_purchase` formatted with `formatPrice`, empty state.
- [ ] **9. Docs and final checks** — Add an "Account (#12)" bullet list to the Orders section of
  `app/.server/AGENTS.md` (ownership via `user_id` in SQL, status split in `~/lib/account`, every
  account loader calls `requireUser`). Run `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`; manual check under `pnpm aspire run`.

## Testing & verification

- Unit: `app/lib/account.test.ts`, `parseOrderId` in `app/lib/checkout.test.ts`.
- Integration (DB, `describe.skipIf(!hasDatabase)`): `app/.server/services/orders.test.ts`.
- Route loaders: `app/routes/account._index.test.ts`, `app/routes/account.orders.$id.test.ts`;
  existing `checkout-success.test.ts` keeps passing after the `parseOrderId` refactor.
- Components: `app/features/account/account-ui.test.ts` (Ukrainian by default, English via
  `<I18nProvider locale="en">`).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, then `pnpm build`.
- Manual (`pnpm aspire run`): log out and open `/account` and `/account/orders/1` → redirected to
  `/login?redirectTo=…` and back after login; place two orders, set one to `shipped` and one to
  `completed` with SQL, check the split, progress bar, expandable items and detail page; change a
  variant price and confirm the old price still shows; open another user's order id → 404;
  switch locale to English; check phone width and keyboard focus rings; disable JS and confirm
  `<details>` still expands.

## Acceptance criteria

- [ ] Logged-in users see only their own orders — steps 2, 3, 6, 7, 8 (`user_id` filter in SQL,
  404 on foreign ids)
- [ ] Orders are split into current and previous by status — steps 1, 3, 6
- [ ] Historical prices come from `order_items.price_at_purchase` — steps 2, 3, 6, 7
- [ ] Logged-out users are redirected to login — steps 5, 6, 7, 8 (`requireUser` in every
  account loader)

## Out of scope

- Linking earlier guest orders placed with the same email to the account (#12 Context).
- Profile editing, password change, addresses (#54).
- The special offers page and its link from the empty state (#55).
- Cancelling, returning or re-ordering from the account.
- New lifecycle columns (`shipped_at`, `completed_at`) and status changes (#40, Q1).
- Nova Poshta tracking numbers / live delivery tracking.
- Pagination of the order history (a small store's customers have few orders; revisit if needed).
