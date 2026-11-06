# Plan: Store the full order lifecycle, discount per line and customer attributes for ML (#128)

Issue: https://github.com/savchukolgaa/jassmin/issues/128
Branch: `issue/128`
Worktree: `.claude/worktrees/issue-128`
Status: Planned

## Goal
As a data analyst, I want the order lifecycle, discounts and customer attributes stored explicitly
so LTV, churn and BI models can be built without guessing. Add `orders.returned_at`,
`orders.cancel_reason`, `order_items.discount_allocated`, `users.city`, `users.marketing_opt_in`
and an `order_status_history` table with one row per status change. Every code path that changes
an order's status writes a history row in the same transaction, and the migration backfills
existing rows.

## Dependencies & prerequisites
- #3, #4, #5 (schema), #11 (checkout), #40 (CMS sync), #44 (payments), #59 (pricing), #125 (gift
  cards): all merged on `origin/main`.
- #131 (synthetic data generator) **depends on this issue** and writes the same columns and
  `order_status_history`. Its prototype writes history rows without `source` and a `pending` row
  first; #131 must add `source` when it's implemented (no change needed here).
- One new migration `0027_order_lifecycle_ml` (`pnpm db:generate --name order_lifecycle_ml`),
  hand-extended with backfill SQL, plus `db/rollbacks/0027_order_lifecycle_ml.sql`.
- Strapi content-type change (`cms/src/api/order/content-types/order/schema.json`) for the cancel
  reason and `returnedAt`; regenerate `cms/types/generated/*` with Strapi's type generation.
- No new env vars or packages.

## Decisions & assumptions
- **Enums** in `app/lib/enums.ts`: `CANCEL_REASONS = ["customer_request", "out_of_stock",
  "no_answer", "payment_failed", "other"]` and `ORDER_STATUS_SOURCES = ["checkout", "payment",
  "cms", "job"]`, with types `CancelReason` / `OrderStatusSource`. Both enforced by CHECK
  constraints via the existing `oneOf()` helper (same style as `auth_tokens_purpose_check`), not
  `pgEnum`, so adding a value later is a CHECK rewrite like the other text enums.
- **`order_status_history`**: `id serial`, `order_id integer not null` FK → `orders.id` on delete
  cascade, `status order_status not null` (reuses `orderStatusType`), `changed_at timestamptz not
  null default now()`, `source text not null` (CHECK `order_status_history_source_check`). Index
  `order_status_history_order_id_changed_at_idx` on `(order_id, changed_at)`. Only `status`
  changes are recorded; a payment-status-only change (e.g. `paid → refunded` with the order
  status unchanged) writes no row — the issue scopes history to the order status, and
  `refunded_at` already records refunds.
- **One writer**: `insertOrderStatusHistory(tx, { orderId, status, source, changedAt })` in a new
  `app/.server/db/queries/order-status-history.ts`. Callers pass the same `now` they used for the
  lifecycle timestamps, so `changed_at` equals `paid_at` / `shipped_at` / … exactly.
- **Where rows are written** (each inside the existing transaction):
  - Checkout (`createOrder`): one row with the status the order is created in — `pending`, or
    `paid` for an order a gift card paid in full (`insertOrder` creates it `paid`). Source
    `checkout`. No artificial `pending` row before `paid` for gift-card orders.
  - Payment callback (`handlePaymentCallback` → `markOrderPaid`): a `paid` row, source `payment`,
    only when `markOrderPaid` returned `true` (a repeated callback writes nothing).
  - Strapi edit (`applyCmsOrderChange`): a row when `next.patch.status` is set, source `cms`. A
    payment change that moves a `pending` order to `paid` (`nextOrderState`) counts too, since the
    status changed.
  - Jobs: **no job changes an order's status today** (the abandoned-cart job only touches
    `carts`; there is no unclaimed job — staff mark `unclaimed` in Strapi). `job` stays in the
    enum for a future job (e.g. expiring unpaid card orders) and the helper is ready for it.
    See Q1.
- **`returned_at`**: set by `nextOrderState` when the status becomes `returned` or `unclaimed` and
  the column is still `null` (same `reached(...)` mechanism). Add `returnedAt` to
  `OrderLifecycle`, `lockOrderLifecycle`, `updateOrderLifecycle`, `CmsOrderState` and the Strapi
  order (read-only datetime, like `shippedAt`).
- **`cancel_reason`**: staff choose it in Strapi. Add a `cancelReason` enumeration to the Strapi
  order type; the middleware sends it with the status; `cmsOrderChangeSchema` gets
  `cancelReason: z.enum(CANCEL_REASONS).optional()`; `OrderStatusChange` gets `cancelReason?`.
  `nextOrderState` refuses a move to `cancelled` without a reason with a new error
  `cancel-reason-required` (422; Ukrainian message in `cms/src/utils/app-sync.ts`), and stores
  the reason in the patch. A reason sent with any other status is ignored. A CHECK
  `orders_cancel_reason_check` allows only `null` or a `CANCEL_REASONS` value. **(unconfirmed,
  Q2)**
- **`discount_allocated`**: `numeric(10,2) not null default 0` with CHECK `>= 0`.
  `priceCart` returns `allocation: number[]` (kopiyky per input line, same order as `lines`):
  - The rule's saving is split over the **units the rule actually discounted**: all qualifying
    units for `percent` / `fixed_amount`; the units inside the counted sets for
    `fixed_price_set`; the discounted (n-th) units for `percent_every_nth`. To know that,
    `discountSaving` is refactored to keep each unit's line index (an internal
    `discountedUnits()` returning `{ lineIndex, price }[]` plus the saving), and the public
    `discountSaving` signature stays.
  - Each line gets `floor(saving × its discounted value / total discounted value)`; the leftover
    kopiyky go to the line with the largest discounted value (ties: the first such line). The sum
    equals `priced.discount` exactly; lines without a discount get 0. **(unconfirmed, Q3)**
  - `createOrder` passes the allocation (converted with `fromKopiyky`) into `insertOrderItems`.
    `priceAndRedeem` maps lines 1:1 with `lockCartLinesForOrder`'s output, so the index lines up.
- **`users.city`**: `text` nullable, the latest delivery city. `createOrder` sets it for a
  logged-in user (`userId !== null`) to the trimmed checkout `city`, in the order transaction
  (`setUserCity(tx, userId, city)` in `db/queries/users.ts`). Registration has no city field, so
  a new user's city stays `null` until their first order (the issue's "for new registrations
  **and** orders": opt-in at registration, city at order). Guest orders don't touch `users`.
- **`users.marketing_opt_in`**: `boolean not null default false`. A checkbox (unchecked by
  default) on `/register`, posted as `marketingOptIn`; `registerSchema` gets
  `marketingOptIn: z.literal("on").optional().transform(Boolean)` (or the codebase's existing
  checkbox pattern if there is one), and `registerUser` / `insertUser` store it. Copy under
  `auth.register.marketingOptIn` in `uk.ts` and `en.ts`. Nothing sends marketing email yet.
- **Backfill (in the migration SQL)**:
  - `returned_at = updated_at` for orders whose status is `returned` or `unclaimed`.
  - `cancel_reason` stays `NULL` for existing cancelled orders (unknown; the issue says leave
    what can't be derived `NULL`). The "cancelled has a reason" criterion applies to new
    cancellations.
  - `discount_allocated`: for orders with `discount_amount > 0`, split it over all lines in
    proportion to `price_at_purchase × quantity`, rounded down to kopiyky, remainder on the
    largest line (window functions: `sum() over (partition by order_id)` and
    `row_number() over (partition by order_id order by line_total desc, id)`). Historic rules may
    have changed, so re-pricing isn't possible; proportional over all lines is the honest
    approximation.
  - `users.city`: `split_part(shipping_address, ', ', 1)` of each user's latest order
    (`formatShippingAddress` writes `${city}, ${branch}`). A city containing `", "` would be cut;
    acceptable for a backfill.
  - `order_status_history`: one row per known timestamp, in time order:
    `created_at` → `pending` (`checkout`; `paid` for `payment_method = 'gift_card'`),
    `paid_at` → `paid` when the order went through `paid` (card: `payment`, else `cms`; skipped
    for gift-card orders, already covered), `shipped_at` → `shipped` (`cms`), `completed_at` →
    `completed` (`cms`), `cancelled_at` → `cancelled` (`cms`), `returned_at` → `returned` /
    `unclaimed` (`cms`). A COD order's `paid_at` set on completion is a payment change, not a
    `paid` status, so it's skipped when `paid_at = completed_at`. **(unconfirmed, Q4)**
- **Mirrors**: add the new columns to `Order` / `OrderItem` in `~/lib/commerce`, and an
  `OrderStatusHistoryRow` there too, so `schema.test.ts` keeps catching drift. Users have no
  full-row mirror (only `PublicUser`), so `PublicUser` stays unchanged.
- **Docs**: `app/.server/AGENTS.md` (new columns as ML features never to drop/rename, the
  history writers, allocation rule), root `AGENTS.md` feature-column list, and the privacy page
  copy if Q5 says so.

## Open questions
- [ ] **Q1: Should this issue add a job that changes order status (e.g. auto-cancel unpaid card orders after N hours with `payment_failed`, source `job`)?** — Why it matters: the acceptance criterion lists "job", but no job changes an order's status today. Recommended default: no new job; keep `job` in `ORDER_STATUS_SOURCES` and document that a future job must call `insertOrderStatusHistory`. Affects steps: 5, 10.
- [ ] **Q2: Must staff pick a cancel reason when cancelling in Strapi, or should a missing reason default to `other`?** — Why it matters: requiring it blocks a save until staff choose (better data); defaulting never blocks but fills the column with `other`. Recommended default: required (422 `cancel-reason-required`, Ukrainian message in the admin). Affects steps: 6, 7.
- [ ] **Q3: Allocate the discount over the units the rule actually discounted, or proportionally over all qualifying lines?** — Why it matters: for the tester trio's leftover units and the couple offer's cheaper bottle, the two give different per-product margins. Recommended default: the units actually discounted (exact attribution); the backfill uses proportional over all lines since old rules can't be replayed. Affects steps: 3, 4.
- [ ] **Q4: Should backfilled history rows get their own `source` (e.g. `backfill`) so analysts can tell approximate rows (`returned_at` from `updated_at`, guessed `cms`/`payment`) from recorded ones?** — Why it matters: adds a fifth enum value not in the issue. Recommended default: no new value; derive `checkout` / `payment` / `cms` as above and note the approximation in `AGENTS.md`. Affects steps: 2.
- [ ] **Q5: Does the marketing opt-in need a privacy-page update and a way to withdraw it (e.g. a toggle on `/account/profile`)?** — Why it matters: consent to marketing should be withdrawable and described in the privacy notice, but nothing sends marketing yet. Recommended default: add one sentence to the privacy page's purposes list (uk/en) now; the profile toggle is a follow-up issue when marketing email is built. Affects steps: 9.

## Resolved questions
- **Is there an unclaimed-order job?** — No. `unclaimed` is set by staff in Strapi through `applyCmsOrderChange`; the only scheduled jobs are `db:mark-abandoned-carts` (carts only), `db:expire-gift-cards`, `db:send-order-emails`, `db:sync-cms`, `db:prune-rate-limits` (source: `app/.server/db/scripts/`, `app/.server/AGENTS.md`).
- **Where does the delivery city come from?** — The checkout form's required `city` field (max 100), stored inside `orders.shipping_address` as `${city}, ${branch}` (source: `app/lib/checkout.schema.ts`, `app/lib/checkout.ts:56`).
- **Which code paths change order status?** — `insertOrder` (initial `pending`, or `paid` for gift-card orders), `markOrderPaid` (payment callback), `updateOrderLifecycle` via `applyCmsOrderChange` (source: `app/.server/db/queries/orders.ts`, `app/.server/db/queries/payments.ts:108`, `app/.server/services/cms-sync.ts:216`).
- **Does pricing know which units a rule discounted?** — Yes, `discountSaving` builds the qualifying units sorted dearest first and takes sets / n-th units from that list; it only needs to keep each unit's line index (source: `app/.server/services/pricing.ts`).
- **Rounding**: all pricing is whole kopiyky (`toKopiyky` / `fromKopiyky`); allocation follows the issue's rule (rest on the largest line) (source: issue body, `app/lib/money`).
- **Device type on orders?** — Not copied; reachable via `orders.cart_id → carts.session_id → sessions.device_type` (source: issue assumptions).
- **Birth year?** — Not collected (source: issue assumptions).
- **Does #131 conflict?** — #131 depends on #128 and writes `returned_at`, `cancel_reason`, `users.city`, `marketing_opt_in` and `order_status_history` with the same values (source: #131 prototype `lifecycle()`).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` (+ `enums.test.ts`) | `CANCEL_REASONS`, `ORDER_STATUS_SOURCES` and types |
| modify | `app/.server/db/schema.ts` | new columns, CHECKs, `orderStatusHistory` table |
| create | `app/.server/db/migrations/0027_order_lifecycle_ml.sql` (+ `meta/`) | generated DDL + hand-written backfill |
| create | `app/.server/db/rollbacks/0027_order_lifecycle_ml.sql` | reverse migration |
| modify | `app/lib/commerce.ts`, `app/.server/db/schema.test.ts` | mirror types for new columns and the history row |
| create | `app/.server/db/queries/order-status-history.ts` (+ test) | `insertOrderStatusHistory`, `listOrderStatusHistory` (tests) |
| modify | `app/.server/services/pricing.ts` (+ `pricing.test.ts`) | per-line `allocation` in `PricedCart` |
| modify | `app/.server/db/queries/orders.ts` | `insertOrderItems` takes `discountAllocated`; lifecycle lock/update include `returnedAt`, `cancelReason` |
| modify | `app/.server/services/orders.ts` (+ test) | allocation into lines, history row, `users.city` |
| modify | `app/.server/db/queries/users.ts` | `setUserCity`; `insertUser` takes `marketingOptIn` |
| modify | `app/.server/db/queries/payments.ts`, `app/.server/services/payments.ts` (+ tests) | history row after `markOrderPaid` |
| modify | `app/lib/order-status.ts` (+ test) | `returnedAt`, `cancelReason`, `cancel-reason-required` |
| modify | `app/lib/cms-sync.ts`, `app/.server/services/cms-sync.ts`, `routes/cms.orders.$orderId.ts` (+ tests) | cancel reason in, `returnedAt`/`cancelReason` out, history row |
| modify | `cms/src/api/order/content-types/order/schema.json`, `cms/src/sync/middleware.ts`, `cms/src/utils/app-sync.ts`, `cms/types/generated/*` (+ tests) | Strapi fields, send reason, error message |
| modify | `app/lib/auth.schema.ts`, `app/.server/services/auth.ts`, `app/routes/register.tsx` (+ tests) | marketing opt-in checkbox |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | checkbox label (and privacy sentence, Q5) |
| modify | `AGENTS.md`, `app/.server/AGENTS.md` | document the new ML columns and history writers |

Exact route file names for `/cms/orders/:id` are taken from `app/routes.ts` during implementation.

## Steps
- [ ] **1. Enums** — Add `CANCEL_REASONS` / `CancelReason` and `ORDER_STATUS_SOURCES` / `OrderStatusSource` to `app/lib/enums.ts`; extend `enums.test.ts`.
- [ ] **2. Schema + migration** — In `schema.ts`: `orders.returnedAt timestamptz`, `orders.cancelReason text $type<CancelReason>` + `orders_cancel_reason_check`; `orderItems.discountAllocated numeric(10,2) notNull default "0"` + `order_items_discount_allocated_check (>= 0)`; `users.city text`, `users.marketingOptIn boolean notNull default false`; table `orderStatusHistory` as in Decisions. Run `pnpm db:generate --name order_lifecycle_ml`, then append the backfill SQL (returned_at, discount_allocated with window functions, users.city, history rows ordered by `changed_at`). Write the rollback (drop table, drop columns/constraints). Update `~/lib/commerce` mirrors and `schema.test.ts`. Check: `pnpm typecheck`, migrator tests.
- [ ] **3. Per-line allocation in pricing** — Refactor `discountSaving` around an internal `discountedUnits(lines, discount)` that returns the saving and the discounted units with their line index; add `allocateDiscount(saving, units, lineCount): number[]` (floor shares, remainder on the largest line) and `allocation: number[]` on `PricedCart` (all zeros without a discount). Keep `discountSaving`'s public result unchanged.
- [ ] **4. Store the allocation at checkout** — `insertOrderItems` takes `discountAllocated: string` per line; `createOrder` zips `priced.allocation` (via `fromKopiyky`) with `lines`. Assert in code (throw → rollback) that the allocation sums to `priced.discount`.
- [ ] **5. History writer + checkout row + city** — Create `db/queries/order-status-history.ts` with `insertOrderStatusHistory`. In `createOrder`, after `insertOrder`, write one row (`pending`, or `paid` when `paymentMethod === "gift_card"`; source `checkout`; `changedAt: now`, and pass `now` to `insertOrder`'s `paidAt` so they match). When `userId !== null`, `setUserCity(tx, userId, customer.city.trim())`.
- [ ] **6. Lifecycle rules** — In `~/lib/order-status`: add `returnedAt` and `cancelReason` to `OrderLifecycle` / patch; `reached("returnedAt", patch.status === "returned" || patch.status === "unclaimed")`; `OrderStatusChange.cancelReason?`; moving to `cancelled` without `cancelReason` → `{ ok: false, error: "cancel-reason-required" }` (Q2), else `patch.cancelReason = change.cancelReason`.
- [ ] **7. CMS sync** — `cmsOrderChangeSchema` gets `cancelReason`; `CmsOrderState` gets `returnedAt` and `cancelReason`; `lockOrderLifecycle` / `updateOrderLifecycle` / `findOrderSyncState` / `toCmsOrderState` / `toStrapiOrderData` carry them. `applyCmsOrderChange` writes a history row (`cms`, `now`) when `next.patch.status` is set; the route maps `cancel-reason-required` to 422. Strapi: add `cancelReason` (enumeration of `CANCEL_REASONS`) and `returnedAt` (datetime) to the order schema, update the description; middleware sends `cancelReason: data.cancelReason ?? undefined`; `app-sync.ts` gets a Ukrainian message for `cancel-reason-required` and reason labels; regenerate Strapi types.
- [ ] **8. Payment callback** — In `handlePaymentCallback`, when `markOrderPaid` returns `true`, write a `paid` row with source `payment`; make `markOrderPaid` take `now` so `paid_at` and `changed_at` match.
- [ ] **9. Marketing opt-in at registration** — `registerSchema.marketingOptIn` (checkbox → boolean, default false); `registerUser` → `insertUser({ …, marketingOptIn })`; an unchecked checkbox on `/register` above the privacy notice, using the shared form checkbox styling from `docs/design.md`; copy in `uk.ts` / `en.ts` (`auth.register.marketingOptIn`). Privacy sentence per Q5.
- [ ] **10. Docs** — `app/.server/AGENTS.md`: Database section (new ML columns, history table and its writers, the `job` source contract, backfill approximations), Orders/CMS sync/Payments/Discounts bullets; root `AGENTS.md` ML-column list (`orders.returned_at`, `order_items.discount_allocated`, `users.city`, `users.marketing_opt_in`, `order_status_history`).
- [ ] **11. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; run the migration against the dev DB (`pnpm db:migrate` or Aspire) and the manual checks below.

## Testing & verification
- `pricing.test.ts`: allocation sums exactly to `discount` for every kind (percent with odd kopiyky, fixed amount larger than a line, tester trio with a leftover 4th unit getting 0, couple offer allocating only to the cheaper bottle's line, `max_sets`), remainder lands on the largest line, no discount → all zeros, allocation length = lines length.
- `order-status.test.ts`: `returnedAt` set for `returned` and `unclaimed` and not overwritten; `cancel-reason-required`; reason stored on cancel and ignored otherwise.
- DB integration (`createTestDatabase()`, `describe.skipIf(!hasDatabase)`):
  - `orders.test.ts`: a placed order's `sum(discount_allocated) = discount_amount`; one `checkout` history row (`pending`; `paid` for a gift-card order); `users.city` updated for a user, untouched for a guest.
  - `payments.test.ts`: a successful callback adds one `payment`/`paid` row; a repeated callback adds none.
  - `cms-sync.test.ts`: each accepted status change adds one `cms` row; a refused change and a payment-only change (no status move) add none; `unclaimed` sets `returned_at`.
  - Migration backfill test: seed orders before 0027 (via migrating to 0026, inserting rows, then migrating), then assert `returned_at`, the allocation sums, `users.city` and history rows; rollback test drops cleanly.
- `register.test.ts` / auth tests: checked box stores `true`, missing stores `false`; uk and en label render.
- `cms/src/sync/middleware.test.ts` and `app-sync.test.ts`: `cancelReason` is sent; the new error message.
- Manual: under `pnpm aspire run`, place a COD order with a promo (check `order_items` and history), pay a card order in the simulator, then in Strapi move an order to shipped → unclaimed and another to cancelled with and without a reason; register with the box checked.

## Acceptance criteria
- [ ] A returned or unclaimed order has `returned_at`, and a cancelled one has a `cancel_reason` — steps 2, 6, 7
- [ ] For every order, the sum of `order_items.discount_allocated` = `orders.discount_amount` — steps 2 (backfill), 3, 4
- [ ] Every status change (checkout, payment, Strapi edit, job) adds an `order_status_history` row — steps 5, 7, 8 (job: Q1, step 10)
- [ ] `users.city` and `users.marketing_opt_in` are filled for new registrations and orders — steps 5, 9
- [ ] No existing column is renamed or dropped, and the migration backfills existing rows — step 2
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 11

## Out of scope
- Inventory history (#130), event tracking changes, the analytics warehouse (#132), the synthetic
  generator (#131).
- Sending marketing email or a profile toggle for the opt-in (Q5).
- Birth year / age; copying device type onto `orders`.
- History of `payment_status` changes that don't change the order status.
- Showing the status history or the cancel reason to customers.
