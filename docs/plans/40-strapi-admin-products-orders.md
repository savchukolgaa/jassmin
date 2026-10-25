# Plan: Replace in-app admin with Strapi CMS for product and order management (#40)

Issue: https://github.com/savchukolgaa/jassmin/issues/40
Branch: `issue/40`
Worktree: `.claude/worktrees/issue-40`
Status: Planned

## Goal

Store admins should manage products and orders only in the Strapi admin panel. The placeholder
`/admin` area (layout, pages, feature components, tests, i18n keys) is deleted. Strapi gets
`product` and `order` content types. The storefront shows the products edited in Strapi, orders
placed at checkout show up in Strapi, and a status change made there reaches the customer's
account dashboard (#12). This issue also takes over the scope of the closed #16 and #17.

## Dependencies & prerequisites

- #20 (Strapi CMS), #43 (CMS i18n), #55 (offers by product `public_id`), #11 (checkout), #12
  (account dashboard), #44 (payments) and #45 (order email outbox) are all merged on `origin/main`
  (`a4e98e1`). This plan builds on their code: `cms/`, `app/.server/cms/`,
  `services/orders.ts`, `services/payments.ts` and the `order_emails` outbox pattern.
- Strapi 5.59 (`cms/package.json`): content types are `schema.json` files under `cms/src/api/`,
  components under `cms/src/components/`, and server code is registered in `cms/src/index.ts`.
- **New env vars**
  - App (`app/.server/env.ts`, `.env.example`, README table, `env.test.ts`):
    - `CMS_SYNC_SECRET`: shared secret that Strapi sends to the app's sync routes. At least 32
      characters, optional (without it the routes answer 503).
    - `STRAPI_SYNC_TOKEN`: a Strapi API token that can write products and orders (custom
      permissions on `api::product.product` and `api::order.order`), kept apart from the
      read-only `STRAPI_API_TOKEN`. Optional: without it, CMS pushes stay queued.
  - CMS (`cms/.env.example`, read in `cms/src/utils/env.ts`): `JASSMIN_APP_URL` and
    `CMS_SYNC_SECRET`.
  - Aspire (`aspire-apphost/apphost.mts`): pass `web`'s endpoint to `cms` as `JASSMIN_APP_URL` and
    one generated `CMS_SYNC_SECRET` parameter to both. `cms` must **not** `waitFor(web)`, because
    `web` already references `cms`.
- **App DB migration** `0011_cms_catalog_and_orders` (plus a hand-written rollback):
  - `products.slug` (`varchar(255)`, unique `products_slug_unique`, nullable for existing rows
    until the import fills it)
  - `products.active` (`boolean not null default true`)
  - `orders.shipped_at` and `orders.completed_at` **(unconfirmed, Q1)**
  - the `cms_outbox` table (step 4)
- **Strapi**: two new content types and three components. No Strapi DB migration is needed;
  Strapi creates the tables itself.

## Decisions & assumptions

1. **The app's PostgreSQL stays the system of record for stock and orders. Strapi is the admin UI
   that writes through it.** Checkout already locks variant rows, checks and decrements stock and
   creates the order in one transaction (`createOrder`), and carts, order lines, offers (#55) and
   analytics all point at `products.id` / `public_id`. Moving products into Strapi would break
   every one of those transactions and foreign keys. The issue allows this: step 5 says products
   may be "kept as a read cache", and the acceptance criterion reads "sourced from Strapi (or
   synced from it)". **(unconfirmed, Q2)**
2. **Synchronous write-through from Strapi to the app.** A Strapi *document service middleware*
   (`strapi.documents.use`, registered in `cms/src/index.ts` `register()`) sees every admin
   create, update or delete of a `product` or `order`. Before Strapi saves, it POSTs the change
   to an app resource route. The app validates it with zod, applies it in one DB transaction and
   answers with the authoritative values, which the middleware merges into `params.data` before
   calling `next()`. When the app rejects the change, the middleware throws Strapi's
   `errors.ApplicationError(message)`, which the Strapi admin shows as an error. Nothing is saved
   on either side. This is how "invalid transitions are rejected in the Strapi admin" and "stock
   is restored atomically" are met: the transition check and the stock restore happen in the
   app's transaction. When the app is unreachable, admin edits fail closed with a clear message.
3. **App → Strapi pushes go through an outbox** (`cms_outbox`), using the same claim/lease and
   retry pattern as `order_emails` (#45). An order placed at checkout, paid by card callback or
   changed in Strapi, and a variant whose stock changed at checkout or on a restore, each queue
   a row inside the transaction that made the change. After the commit the row is delivered
   (`void deliverCmsSync(...)`), and `pnpm db:sync-cms` (cron every 5 minutes, plus an Aspire
   explicit-start resource) retries failures. A push sends the entity's *current* state (an
   idempotent upsert by `orderId` / `publicId`), so duplicates and reordering are harmless.
4. **Telling app writes from admin writes inside Strapi.** The middleware passes a write through
   untouched when the request was authenticated with an API token (the app's
   `STRAPI_SYNC_TOKEN`, checked via `strapi.requestContext.get()?.state.auth.strategy.name ===
   "api-token"`) or when there is no request context (the import script / seed). This stops sync
   loops. Admin `create` and `delete` on `order` are rejected: orders only come from checkout.
5. **Product identity.** The Strapi `product` has a `publicId` string (UUID, same regex as
   `offers.product-ref`). On an admin `create`, the app inserts the product and returns the
   `publicId` that `uuidv7()` generated, and the middleware stores it. Variants are matched by
   `(product, volumeMl)`, which is already unique in `product_variants`, so the Strapi component
   doesn't need its own id. Removing a size in Strapi deletes that `product_variants` row: its
   cart lines cascade, and order lines keep their `volume_ml` snapshot with `variant_id` set to
   null.
6. **Stock edits in Strapi are applied as deltas.** The middleware sends the admin's new stock
   value and the value Strapi had before (`expectedStock`, read from the stored document). The
   app applies `stock_quantity = stock_quantity + (new - expected)`, clamped at 0, under a row
   lock, and returns the real number. A sale between opening and saving the form is then never
   overwritten. Stock pushes (decision 3) keep the numbers in Strapi fresh. **(unconfirmed, Q3)**
7. **Deleting and archiving never delete app rows.** Deleting a product in Strapi, or turning off
   `active`, sets `products.active = false`. Catalog, filter, offer and product queries only list
   active products, and the product page answers 404 for inactive ones. Order history keeps
   joining `products` for the title and image (`listOrderLinesByOrderIds`), so historical orders
   still render, and `price_at_purchase` is untouched. At checkout, a cart line of an inactive
   product counts as `available: 0` and goes through the existing `insufficient-stock` result.
8. **Field mapping.** Strapi's `name` maps to `products.title`. `image` is a Strapi media field,
   and the sync stores its absolute URL (the same base as `cms/content.ts`) in
   `products.image_url`. `packSize` is added because the app needs it. The issue's product-level
   `price` and `stock` are **not** separate Strapi fields: those app columns are deprecated
   (#26, `app/.server/AGENTS.md`), so the app fills them from the smallest variant. `volumeMl` is
   an integer field (Strapi enumerations must be string identifiers), and the app rejects values
   outside `PERFUME_VOLUMES_ML` with a message shown in the admin. Products aren't localized
   (the app's catalog is single-language today) and don't use draft & publish (`active` takes
   that role). Orders use neither either.
9. **Order statuses use the app's `ORDER_STATUSES`**, not the issue's `delivered` list (see the
   resolved questions). The transition rules live in a new isomorphic `app/lib/order-status.ts`,
   so the account UI and the sync use the same table:

   | from | allowed `status` targets |
   |---|---|
   | `pending` | `paid` (card, sets `payment_status = paid`), `shipped`, `cancelled` |
   | `paid` | `shipped`, `cancelled` |
   | `shipped` | `completed`, `returned`, `unclaimed` |
   | `completed` | `returned` |
   | `cancelled`, `returned`, `unclaimed` | none (final) |

   `payment_status`: `unpaid → paid` and `paid → refunded` only. Lifecycle timestamps are set by
   the app, never taken from Strapi: `paid_at` when payment becomes `paid`, `cancelled_at` on
   `cancelled`, `refunded_at` on `refunded`, and `shipped_at` / `completed_at` on those statuses
   **(Q1)**. Each one is set only if it is still null. A `cod` order may be marked `paid` together
   with `completed` (cash collected on delivery). **(rules unconfirmed, Q4)**
10. **Stock is restored when an order moves to `cancelled` or `unclaimed`** (the parcel comes back
    unopened), not on `returned` (an opened perfume may not be resellable). The restore adds each
    line's quantity back to its `variant_id` (lines whose variant was deleted are skipped), in the
    same transaction as the status change, and queues stock pushes. **(unconfirmed, Q5)**
11. **The app's sync endpoints are resource routes**, like `payments/callback`: action-only POST,
    outside the `_shop` layout, authenticated by `Authorization: Bearer <CMS_SYNC_SECRET>`
    (constant-time compare). They answer 401 on a bad secret, 400 on bad input, 422 with
    `{ error: <code>, … }` for a rule violation, and 200 with the authoritative entity. These
    aren't a public REST layer: only Strapi calls them.
12. **Admin-facing error text** is formatted in the CMS (`cms/src/utils/app-sync.ts`), in
    Ukrainian with the error code, e.g. `Не можна змінити статус «cancelled» на «shipped»
    (invalid-transition)`, because the Strapi admin is staff-only and outside the app's i18n.
13. **Kept as the issue asks:** `requireAdmin`, the `admin` role, `pnpm db:make-admin` and the
    403 handling in `route-error.ts`. Their comments that mention `/admin` are reworded to "future
    admin-only endpoints".
14. **Migrating existing data**: `pnpm db:sync-cms --all` queues every product and every order
    and pushes them to Strapi with the sync token (upsert by `publicId` / `orderId`). It runs
    against an existing database and after `pnpm db:seed`, and is documented in the README.
    `pnpm cms:seed --token` also creates the write token (`jassmin-sync`) next to the read-only
    one and prints it once.

## Open questions

- [ ] **Q1: Add `orders.shipped_at` and `orders.completed_at`?** (asked in the issue comment)
  Why it matters: without them the #12 progress indicator can't date the shipped and completed
  steps, and delivery time is a useful LTV/churn feature. Recommended default: **yes**. They go
  in migration 0011 with a rollback, the app sets them on those transitions, they're mirrored on
  the Strapi `order`, and `AccountOrder` plus `OrderProgress` show the dates. Affects steps: 2, 3,
  6, 12.
- [ ] **Q2: OK that the app DB stays the source of truth, with Strapi as a write-through admin
  UI, rather than the storefront reading products live from the Strapi API?** Why it matters:
  reading live from Strapi would mean rewriting cart, checkout locking, offers and analytics, and
  would lose transactional stock. Recommended default: write-through plus a synced copy
  (decisions 1–3). Affects steps: all.
- [ ] **Q3: How should a stock number edited in Strapi be applied?** Why it matters: an absolute
  overwrite loses sales made while the admin had the form open. Recommended default: as a delta
  against the value the admin saw (decision 6). Affects steps: 5, 8.
- [ ] **Q4: Are the transition rules in decision 9 right?** For example: may `pending` go straight
  to `shipped` for cash on delivery? Can a `completed` order become `returned`? Must an order be
  `refunded` before or after `cancelled`? Recommended default: the table in decision 9. Affects
  steps: 3, 6.
- [ ] **Q5: Which statuses put stock back?** Recommended default: `cancelled` and `unclaimed`,
  not `returned` (decision 10). Affects steps: 6.
- [ ] **Q6: Should the account dashboard update be instant, or is "within a few minutes" enough?**
  Why it matters: with write-through it's instant and no webhook or polling is needed. If the
  team prefers Strapi-first saves with an async webhook, the rejection and atomicity guarantees
  get weaker. Recommended default: synchronous write-through. Affects steps: 6, 8.

## Resolved questions

- **Which status names does the Strapi `order` use?** The app's `ORDER_STATUSES` (`pending`,
  `paid`, `shipped`, `completed`, `cancelled`, `returned`, `unclaimed`), with no mapping. #12
  already uses them. (source: issue #40 comment; `app/lib/enums.ts`; `app/lib/account.ts`)
- **Is there an "Admin" link in the storefront header to remove?** No. Nothing outside the admin
  modules links to `/admin` (`app/components/layout/*`, `services/header.ts`), so step 8 of the
  issue is only about comments and docs. (source: grep of `app/`)
- **What breaks historical orders when a product is deleted?** Order lines read the title and
  image by joining `products` (`listOrderLinesByOrderIds` in `db/queries/orders.ts`), and
  `order_items.product_id` is `on delete set null`. A hard delete would lose the title, so
  products are archived instead (decision 7). (source: `app/.server/db/schema.ts`,
  `db/queries/orders.ts`)
- **Do products need a product-level price and stock in Strapi?** No. They're deprecated in favour
  of `product_variants` (#26). (source: `app/.server/AGENTS.md` → Database)
- **Do the seed products have images to move?** No. `SAMPLE_PRODUCTS` has no `imageUrl`, so the
  import doesn't need to upload media. (source: `app/.server/db/seed-data.ts`)
- **Do offers keep working?** Yes. They reference products by `public_id` (`offers.product-ref`),
  which the Strapi `product` keeps. `getProductSummaries` also has to skip inactive products.
  (source: `cms/src/components/offers/product-ref.json`, `services/offers.ts`)
- **Should the existing content types change?** No (issue, out of scope). The only change in
  `cms/src/index.ts` is adding `api::product.product` and `api::order.order` to
  `PROTECTED_UIDS`, so a public-role grant is warned about.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| delete | `app/routes/admin.tsx`, `admin._index.tsx`, `admin.products.tsx`, `admin.orders.tsx`, `admin.test.ts` | In-app admin routes |
| delete | `app/features/admin/` (`AdminLayout.tsx`, `AdminPlaceholder.tsx`, `admin-nav.ts`, `admin-nav.test.ts`) | Admin UI |
| modify | `app/routes.ts`, `app/routes.test.ts` | Drop the `admin` block; add `cms/products` and `cms/orders/:id` sync routes |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | Remove the `admin` namespace; add `account` labels for the shipped/completed dates (Q1) |
| modify | `app/root.tsx`, `app/routes/_shop.tsx`, `app/lib/enums.ts`, `app/.server/services/auth.ts`, `app/lib/route-error.ts` | Reword comments that mention the admin area |
| modify | `app/.server/db/schema.ts`, `app/lib/commerce.ts`, `app/.server/db/schema.test.ts` | `products.slug`/`active`, `orders.shipped_at`/`completed_at`, `cms_outbox` |
| create | `app/.server/db/migrations/0011_cms_catalog_and_orders.sql` (+ meta), `db/rollbacks/0011_cms_catalog_and_orders.sql` | Migration and rollback |
| create | `app/lib/order-status.ts`, `app/lib/order-status.test.ts` | Transition table, `nextOrderState()`, restock rule |
| create | `app/lib/cms-sync.ts` | zod schemas and DTOs for the sync requests and responses (shared with tests) |
| create | `app/.server/db/queries/cms-outbox.ts` (+ test) | Enqueue, claim (lease), mark done or failed |
| modify | `app/.server/db/queries/products.ts`, `services/products.ts`, `services/offers.ts` | `active` filter; upsert from CMS; stock delta; variant replace |
| modify | `app/.server/db/queries/orders.ts`, `services/orders.ts` | Inactive lines count as `available: 0`; enqueue the order and stock pushes in `createOrder`; `applyCmsOrderChange` |
| modify | `app/.server/services/payments.ts` | `markOrderPaid` enqueues an order push |
| create | `app/.server/services/cms-sync.ts` (+ test) | `applyCmsProductChange`, `applyCmsOrderChange`, `deliverCmsSync`, push mappers |
| create | `app/.server/cms/writer.ts` (+ test) | `cmsWrite()`: PUT/POST to Strapi with `STRAPI_SYNC_TOKEN`, timeout, `CmsError` |
| create | `app/routes/cms.products.ts`, `app/routes/cms.orders.$id.ts` (+ tests) | Sync endpoints for Strapi's middleware |
| create | `app/.server/db/scripts/sync-cms.ts`; modify `package.json` | `pnpm db:sync-cms [--all]` |
| modify | `app/.server/env.ts`, `env.test.ts`, `.env.example`, `README.md` | `CMS_SYNC_SECRET`, `STRAPI_SYNC_TOKEN`; replace the `/admin` README section with "Managing products and orders in Strapi" |
| modify | `app/lib/account.ts`, `services/orders.ts`, `features/account/OrderProgress.tsx`, `account-ui.test.ts` | Shipped/completed dates (Q1) |
| create | `cms/src/api/product/**` (schema, controller, route, service) | `product` content type |
| create | `cms/src/api/order/**` | `order` content type |
| create | `cms/src/components/catalog/variant.json`, `cms/src/components/orders/item.json` | Repeatable components |
| create | `cms/src/sync/middleware.ts`, `cms/src/utils/app-sync.ts` | Document middleware, app client, error messages |
| modify | `cms/src/index.ts`, `cms/src/utils/env.ts`, `cms/.env.example`, `cms/scripts/seed.ts` | Register the middleware, protected UIDs, sync token, edit-view config (read-only order fields) |
| modify | `aspire-apphost/apphost.mts`, `aspire-apphost/AGENTS.md` | Sync env vars; `db-sync-cms` explicit-start resource |
| modify | `AGENTS.md`, `app/.server/AGENTS.md` | Document the new data flow; drop the `/admin` rules |

## Steps

Each step leaves the app building and the tests green.

- [ ] **1. Delete the in-app admin.** Remove the five `app/routes/admin*` files, `app/features/admin/`,
  the `route("admin", …)` block and its comment in `app/routes.ts`, and the admin test in
  `routes.test.ts`. Remove the `admin` namespace from `uk.ts`/`en.ts` (the dictionaries test
  keeps them in step). Reword the comments in `root.tsx`, `_shop.tsx`, `enums.ts` (`USER_ROLES`),
  `services/auth.ts` (`requireAdmin`) and `route-error.ts`. Keep `requireAdmin` and its tests.
  Check: `grep -rn "features/admin\|routes/admin\|admin\.nav" app` is empty, and typecheck, lint
  and test pass.
- [ ] **2. Schema and migration 0011.** In `schema.ts` add `products.slug` (unique, nullable),
  `products.active`, `orders.shippedAt` / `completedAt` (Q1), and `cmsOutbox` (`id`,
  `entity` ∈ `CMS_SYNC_ENTITIES = ["order", "product"]` with a CHECK, `entityId` int,
  `attempts`, `nextAttemptAt`, `lastError`, `syncedAt`, `createdAt`/`updatedAt`, unique
  `(entity, entity_id)`, index `(synced_at, next_attempt_at)`). Run `pnpm db:generate --name
  cms_catalog_and_orders`, write the rollback, and mirror the row types in `~/lib/commerce` so
  `schema.test.ts` stays green. Check: `pnpm db:migrate`, then `pnpm db:rollback`, then migrate
  again on a scratch DB (`migrator.test.ts`).
- [ ] **3. Transition rules (`app/lib/order-status.ts`).** Export `ORDER_STATUS_TRANSITIONS`,
  `PAYMENT_STATUS_TRANSITIONS`, `RESTOCK_STATUSES` and a pure `nextOrderState(current, change,
  now)` that returns `{ ok: true, patch, restock: boolean }` or `{ ok: false, error:
  "invalid-transition" | "invalid-payment-transition", from, to }`. `patch` holds the new
  statuses and the timestamps that are due (only the null ones). Unit-test every allowed and
  rejected pair, the timestamps and the restock flag.
- [ ] **4. CMS outbox and writer.** `db/queries/cms-outbox.ts`: `enqueueCmsSync(tx, entity, ids)`
  upserts rows back to pending (`synced_at = null`, `next_attempt_at = now()`, attempts reset),
  and `claimCmsSync(db, { limit, entity?, ids? })` uses the same `FOR UPDATE SKIP LOCKED` lease
  as `claimOrderEmails`, plus `markCmsSynced` and `markCmsSyncFailed`. `cms/writer.ts`:
  `cmsWrite(method, path, body, schema)` with `STRAPI_SYNC_TOKEN` and `CMS_TIMEOUT_MS`, throwing
  `CmsError` (`not_configured` without the token). Add both env vars to `env.ts`, `.env.example`,
  the README table and `env.test.ts`. Integration-test the queue on `createTestDatabase()`.
- [ ] **5. Product sync on the app side.**
  - `~/lib/cms-sync.ts`: `cmsProductChangeSchema` (`action: "create" | "update" | "delete"`,
    `publicId?`, `name`, `slug`, `brand`, `description?`, `gender` ∈ `GENDERS`,
    `fragranceFamily?`, `imageUrl?`, `packSize ≥ 1`, `active`, and `variants[]` with `volumeMl` ∈
    `PERFUME_VOLUMES_ML` (unique), a `price` decimal string > 0, `stock ≥ 0` and
    `expectedStock?`).
  - `services/cms-sync.ts` → `applyCmsProductChange(input, db)`, in one transaction:
    - create: insert the product (deprecated columns from the smallest variant)
    - update: lock the product, update its fields, lock its variants, upsert variants by
      `(product_id, volume_ml)` applying stock deltas (decision 6), delete the variants that
      were removed, and refresh the deprecated columns
    - delete: `active = false`

    It returns the authoritative product with each variant's real stock, or a typed error
    (`unknown-product`, `slug-taken` via `23505`, `invalid-volume`).
  - Route `app/routes/cms.products.ts` (POST): check the secret, parse with zod, call the
    service, answer with JSON.
  - Unit-test the route (401, 400, 422, 200 with mocked services) and integration-test the
    service (the delta with a concurrent decrement, removing a size whose cart line cascades, and
    an archive that keeps order history readable).
- [ ] **6. Order sync on the app side.**
  - `cmsOrderChangeSchema`: `{ status?, paymentStatus? }`.
  - `applyCmsOrderChange(orderId, change, db)`, in one transaction: lock the order
    (`SELECT … FOR UPDATE`), run `nextOrderState`, update the order with `patch`. When `restock`
    is set, add `order_items.quantity` back to `product_variants.stock_quantity` for the lines
    with a `variant_id` (in variant id order, like checkout), then enqueue the order and the
    touched products. It returns the full order DTO for Strapi, `unknown-order`, or a transition
    error.
  - Route `app/routes/cms.orders.$id.ts` (POST) as in step 5. A no-op change (same status)
    returns 200 unchanged.
  - Integration-test: cancelling restores stock exactly once (a second cancel is rejected as a
    final state), a rejected transition writes nothing, `cancelled_at`, `refunded_at` and
    `shipped_at` are set, and a concurrent checkout doesn't deadlock.
- [ ] **7. Pushing app changes to Strapi.**
  - Enqueue in the transactions that change state: `createOrder` (the order plus the products
    whose stock dropped), `markOrderPaid` (the order) and `applyCmsOrderChange` (step 6).
  - `deliverCmsSync({ entity?, ids? })` claims rows and upserts each to Strapi:
    - orders: `PUT /api/orders/<documentId>`, found by `filters[orderId]`, else `POST`, with
      the order fields, the lines as `items` (product public id, title snapshot, brand,
      volume, quantity, unit price) and every timestamp
    - products: their fields and variants with current stock

    It never rejects. Call `void deliverCmsSync(...)` after the commit in `routes/checkout.tsx`,
    `payments.callback.ts` and the two sync routes.
  - `db/scripts/sync-cms.ts` → `pnpm db:sync-cms` (due rows) and `--all` (enqueue every product
    and order first: the data migration, decision 14). It must not import `db/index.ts` (same
    rule as `send-order-emails`).
  - Unit-test the mappers and the delivery against a fake `fetch`.
- [ ] **8. Strapi content types and middleware (`cms/`).**
  - `api::product.product` (collection, no draft & publish, not localized): `publicId`
    (string, UUID regex, unique, set by sync), `name` (required, ≤ 255), `slug` (uid from
    `name`, required), `brand` (required), `description` (text), `gender` (enum `women`,
    `men`, `unisex`), `fragranceFamily` (string), `image` (single image), `packSize` (integer,
    min 1, default 1), `active` (boolean, default true), and `variants` (repeatable
    `catalog.variant`: `volumeMl` integer required, `price` decimal min 0.01, `stock` integer
    min 0).
  - `api::order.order` (collection, no draft & publish): `orderId` (integer, unique,
    required), `status` (enum = `ORDER_STATUSES`), `paymentStatus` (enum = `PAYMENT_STATUSES`),
    `paymentMethod` (enum `card`, `cod`), `customerName`, `customerEmail`, `customerPhone`,
    `userId` (integer, null for guests), `shippingAddress` (text), `freeShipping`, `subtotal`,
    `discountAmount`, `shippingAmount`, `totalAmount` (decimal), `currency`, `placedAt`,
    `paidAt`, `cancelledAt`, `refundedAt`, `shippedAt`, `completedAt` (datetime), and `items`
    (repeatable `orders.item`: `productPublicId`, `productName`, `brand`, `volumeMl`,
    `quantity`, `unitPrice`).
  - Controllers, routes and services use `factories.createCore*`, like `offer`.
  - `cms/src/sync/middleware.ts`, registered in `register()` with `strapi.documents.use`:
    - skip unless the uid is product or order and the write comes from the admin (decision 4)
    - product create/update/delete: load the stored document (for `expectedStock` and
      `publicId`), call `POST {JASSMIN_APP_URL}/cms/products`, merge the response into
      `params.data`, then `next()`
    - order update: call `POST /cms/orders/:orderId` with only `status`/`paymentStatus`, and
      replace `params.data` with the app's order
    - order create/delete from the admin: throw

    `cms/src/utils/app-sync.ts` has the fetch with a timeout and the bearer secret, and maps
    error codes to messages (decision 12).
  - In `bootstrap()`, add both UIDs to `PROTECTED_UIDS`, and set the content-manager edit view
    of `order` so every field except `status` and `paymentStatus` is read-only
    (`plugin::content-manager` configuration; best effort, since the middleware is the real
    guard).
  - `scripts/seed.ts --token`: also create or update the `jassmin-sync` token with
    find/findOne/create/update on product and order, and print `STRAPI_SYNC_TOKEN=…` once.
  - Check: `pnpm cms:build`; in `pnpm aspire run`, create a product, change a stock number,
    archive it, and move an order through `pending → shipped → completed`, then try `cancelled
    → shipped` and see the error in the admin.
- [ ] **9. Storefront reads only active products.** Add `eq(products.active, true)` to
  `whereFilters`, `listFilterOptions`, `listProductSummariesByPublicIds`, `findProductByPublicId`
  (the product page answers 404) and `checkVariantForCart`. In `lockCartLinesForOrder`, join
  `products` and report inactive lines as `stockQuantity: 0`, so checkout answers
  `insufficient-stock`. Update the catalog, product, offers and checkout tests.
- [ ] **10. Aspire.** In `apphost.mts`: add a `cmsSyncSecret` parameter (secret, generated)
  passed to `cms` and `web` as `CMS_SYNC_SECRET`; give `cms` `JASSMIN_APP_URL` from `web`'s
  `http` endpoint (create `web` first or use an endpoint reference, with no `waitFor` cycle); add
  the `db-sync-cms` explicit-start resource (like `db-send-order-emails`, with `STRAPI_URL` and
  `STRAPI_SYNC_TOKEN`). Update `aspire-apphost/AGENTS.md`. Check: `pnpm aspire:build`.
- [ ] **11. Docs.** README: replace the `/admin` section with "Managing products and orders in
  Strapi" (setup: `pnpm cms:seed -- --token` for both tokens, `pnpm db:seed`, then `pnpm
  db:sync-cms --all`; cron for `db:sync-cms`; what is editable where; failure behaviour). Update
  `AGENTS.md`, plus `app/.server/AGENTS.md` (CMS: "products and orders are edited in Strapi and
  written through to PostgreSQL"; the `users.role` and `requireAdmin` bullets; the analytics
  "`/admin` isn't tracked" line; new "CMS sync" bullets) and the `cms/package.json` description.
- [ ] **12. Account dates (Q1).** Add `shippedAt` and `completedAt` to `AccountOrder` (via
  `listUserOrders` / `findUserOrder`), show them in `OrderProgress`, add the i18n keys to both
  dictionaries, and update `account-ui.test.ts`. Skip this step if Q1 is answered "no".
- [ ] **13. Final check.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`,
  `pnpm cms:build` and `pnpm aspire:build`; grep for dead imports (`features/admin`,
  `routes/admin`, `strapiAdminUrl`, `ADMIN_NAV_ITEMS`); then run the manual end-to-end pass from
  "Testing & verification".

## Testing & verification

- **Unit:**
  - `order-status.test.ts`: the full transition matrix, timestamps and restock
  - the sync route tests: auth, zod errors, codes
  - the `cms-sync` mappers and delivery with a fake fetch
  - `cms/writer.test.ts`
  - `env.test.ts`: the new variables
  - `routes.test.ts`: no admin, the sync routes are top level
  - `account-ui.test.ts`: the new dates
- **Integration** (`describe.skipIf(!hasDatabase)`, `createTestDatabase()`):
  - `applyCmsProductChange`: create, update with a delta, removing a size, archiving
  - `applyCmsOrderChange`: cancelling restores stock atomically, rejections leave nothing
    behind
  - the outbox claim/lease
  - `createOrder` enqueues
  - inactive products are hidden from the catalog and blocked at checkout
  - migration 0011 applies and rolls back
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm cms:build`,
  `pnpm aspire:build`.
- **Manual (`pnpm aspire run`):**
  1. Seed both sides and run `db-sync-cms --all`: products and orders appear in Strapi.
  2. Edit a product's name, price and stock in Strapi: the storefront shows them.
  3. Archive the product: it disappears from the catalog, and old orders still show it on
     `/account`.
  4. Place an order: it appears in Strapi, and the stock drop shows on the product.
  5. Ship and complete it in Strapi: the `/account` progress updates.
  6. Cancel another order: the stock comes back in both systems.
  7. Try an invalid transition: the Strapi admin shows the error and nothing changes.
  8. Stop `web` and edit an order in Strapi: a clear "app unreachable" error.
  9. `/admin` answers 404.

## Acceptance criteria

- [ ] Strapi has a `product` content type with all fields needed to manage the perfume catalogue (name, slug, brand, description, gender, fragrance family, image, price, stock, active, volume variants) — step 8 (price and stock per variant, decision 8)
- [ ] Strapi has an `order` content type with all fields needed to view and update order status, including lifecycle timestamps (`paid_at`, `cancelled_at`, `refunded_at`) — steps 2, 6, 8
- [ ] Invalid order status transitions are rejected in the Strapi admin — steps 3, 6, 8
- [ ] Cancelling an order in Strapi restores product/variant stock atomically — steps 6, 7, 8
- [ ] The `/admin` route and all nested admin routes are removed from the app — step 1
- [ ] All admin UI files (`app/features/admin/`, admin route modules) are deleted — step 1
- [ ] Product data displayed on the storefront is sourced from Strapi (or synced from it) — steps 5, 8, 9
- [ ] Orders created at checkout are visible and manageable in the Strapi admin panel — steps 4, 7, 8
- [ ] Order status changes in Strapi are reflected in the customer's order dashboard — steps 6, 8, 12
- [ ] Deleting/archiving a product does not break historical order data — steps 5, 9 (decision 7)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 13
- [ ] No dead imports or references to deleted admin modules remain — steps 1, 13

## Out of scope

- Changing product URLs to slugs (`/products/:id` stays the `public_id`; `slug` is stored for
  later).
- Localizing product content (uk/en product descriptions).
- Emailing customers on a status change (shipped, cancelled).
- Real refunds through the payment provider: `refunded` is a bookkeeping status set by the admin.
- Strapi users or roles for staff (they use Strapi's own admin accounts), and any admin-only app
  endpoint behind `requireAdmin`.
- Dropping the deprecated `products.price` / `volume_ml` / `stock_quantity` columns.
- The existing `blog-post`, `home-page`, `site-setting` and `offer` content types.
