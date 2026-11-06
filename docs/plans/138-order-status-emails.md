# Plan: Email customers when their order is shipped, arrives at the branch, or is cancelled (#138)

Issue: https://github.com/savchukolgaa/jassmin/issues/138
Branch: `issue/138`
Worktree: `.claude/worktrees/issue-138`
Status: Planned

## Goal

Customers should hear from the shop when their order changes, without having to ask. When an
order is shipped (with the waybill number and a tracking link), arrives at the Nova Poshta branch,
is cancelled or is refunded, the app queues one email of that type in the existing `order_emails`
outbox, in the same transaction as the change and in the order's language. The existing sender and
`pnpm db:send-order-emails` deliver it, with the same retries.

## Dependencies & prerequisites

- **#45 order email outbox**: done. `order_emails` already has `unique (order_id, type)`
  (`order_emails_order_id_type_unique`, `app/.server/db/schema.ts:525`), so that index needs no
  migration. Only the type CHECK has to be rewritten.
- **#134 shared email layout + production SMTP**: done (closed, completed). `composeEmail` /
  `EmailBlock` in `app/.server/email/layout.ts`.
- **#40 CMS sync**: done. Status changes arrive at `POST /cms/orders/:id` →
  `applyCmsOrderChange` (`app/.server/services/cms-sync.ts:216`) → `nextOrderState`
  (`app/lib/order-status.ts`).
- **#137 Nova Poshta waybills and tracking**: **closed as not planned** (postponed by the owner on
  2026-11-05). So the app has no waybill number, no `arrived_at` and no tracking job. This plan adds
  the two order fields itself (staff fill them in Strapi), so #137 can later write the same columns
  from its job (confirmed by the owner, see Resolved questions).
- **#136 branch picker**: **closed as not planned**. The branch is only in the free-text
  `orders.shipping_address` (built by `formatShippingAddress` at checkout), so "the branch" in the
  emails is that text.
- Migration `0027_order_status_emails` with a hand-written rollback. No new env vars or packages.

## Decisions & assumptions

- **Email types.** `ORDER_EMAIL_TYPES` (`app/lib/enums.ts`) gains `shipped`, `arrived`,
  `cancelled`, `refunded`. The migration rewrites `order_emails_type_check`.
- **Which change queues what.** A pure function `orderStatusEmailTypes(before, patch)` in a new
  isomorphic module `app/lib/order-status-emails.ts` (no zod, no server imports) maps a lifecycle
  patch to email types:
  - `patch.status === "shipped"` → `shipped`
  - `patch.arrivedAt` set (it was `null`) → `arrived`
  - `patch.status === "cancelled"` → `cancelled`
  - `patch.paymentStatus === "refunded"` → `refunded`
  - nothing for `paid`, `completed`, `returned`, `unclaimed`, or edits that change nothing
    (`nextOrderState` returns an empty patch for "asking for the current value").
  Cancelling a paid card order and refunding it in one save queues both emails (owner: two emails).
- **At most once per order.** Queuing uses `insert … on conflict (order_id, type) do nothing`. A
  status that goes back and forth, or a second save, never queues a second row, even if the first
  one `failed`.
- **Locale.** The new row copies the locale of the order's `confirmation` row
  (`insert … select locale from order_emails where order_id = $1 and type = 'confirmation'`),
  falling back to `uk` when there is none (orders older than #45). `orders` has no locale column and
  this plan doesn't add one.
- **Same transaction.** `applyCmsOrderChange` queues the rows after `updateOrderLifecycle`, inside
  its transaction, so a refused or rolled-back change queues nothing. The route then calls
  `void deliverOrderEmails({ orderId })` after the commit (like checkout), and the cron retries.
- **Refunds come only from Strapi today.** `handlePaymentCallback` never refunds (the simulator has
  no refund callback, `app/.server/services/payments.ts`), so there's nothing to hook there. The
  queuing helper takes a `tx` and the before/after lifecycle, so a future provider refund callback
  and #137's job call the same function.
- **Emails are built at send time** from the order's current row (like the confirmation), so a
  waybill number entered after the status change but before delivery is still included. Once a
  `shipped` email is sent, adding a waybill later sends nothing new.
- **New order columns** (added here because #137 is postponed):
  - `orders.waybill_number` `varchar(20)`, nullable, CHECK `waybill_number ~ '^[0-9]{14}$'`
    (Nova Poshta ТТН is 14 digits). Edited in Strapi as `waybillNumber`; the app strips spaces
    before validating and refuses anything else (`invalid-waybill`, Ukrainian message in Strapi).
  - `orders.arrived_at` `timestamptz`, nullable: a delivery-time ML feature next to `shipped_at` /
    `completed_at` (never drop or rename). Staff tick a boolean `arrivedAtBranch` in Strapi; the
    app sets `arrived_at = now` when it's ticked and still `null`. Allowed only while the order is
    (or in the same save becomes) `shipped`; otherwise `arrived-not-shipped`. Unticking clears it
    (a staff mistake) but never sends anything.
- **Templates** live in `services/order-email.ts` beside the confirmation, built with
  `composeEmail` in the row's locale, from `ORDER_FROM ?? CONTACT_FROM`, reply-to `CONTACT_INBOX`.
  Subjects contain only the order number. Each has: greeting, a one-line status, the order number,
  the items (shared helper extracted from `buildOrderConfirmationEmail`), the delivery block and the
  next step:
  - **shipped**: the ТТН as a `code` block and a `button` to
    `https://novaposhta.ua/tracking/?cargo_number=<ttn>` when known. Without one it promises no
    later number: it says the parcel is on its way and to expect a Nova Poshta SMS.
  - **arrived**: the branch (`shipping_address`), the ТТН if known, "kept free for
    `NOVA_POSHTA_FREE_STORAGE_DAYS` days" (constant = 7), bring the ТТН or ID,
    and for `cod` the amount to pay at the branch (`total_amount`, plus "Nova Poshta's delivery fee"
    when `free_shipping` is false).
  - **cancelled**: the order is cancelled; for a paid card order "the money will be returned to
    your card"; when a gift card paid part of it, "the amount is back on your gift card"
    (`restoreGiftCardRedemptions` already does this, #125); contact line.
  - **refunded**: the refunded amount (`total_amount`, what the card paid) and "banks usually take
    3–7 working days".
  - Registered customers (`user_id` set) also get a `button` to their order page
    (`/account/orders/:id`, localized like `authLink` builds its links). Guests get none (their
    success page only works in the browser they ordered from).
- **Transactional email.** No marketing consent check, same as the confirmation. Suppressed
  addresses are still skipped by `getMailer()` (#134).
- **Not shown in the storefront.** The waybill isn't added to the account order page here (that was
  #137's scope).

## Resolved questions

- **Does the `(order_id, type)` unique index exist?** Yes, `order_emails_order_id_type_unique`
  from #45; only the type CHECK needs rewriting (source: `app/.server/db/schema.ts:521-525`).
- **Where do refunds come from?** Only from staff setting `paymentStatus = refunded` in Strapi
  (`PAYMENT_STATUS_TRANSITIONS` `paid → refunded`, `app/lib/order-status.ts`); the payment
  callback has no refund path (source: `app/.server/services/payments.ts`, #44).
- **Is #137 available for `arrived_at` / the ТТН?** No: closed as not planned on 2026-11-05
  ("Postponed by the owner", #137 comment).
- **Do staff enter the ТТН in Strapi now?** Yes: `orders.waybill_number` and an editable
  `waybillNumber` on the Strapi order, 14 digits, filled in the same save as "Shipped" (owner,
  2026-11-06).
- **How do staff mark "arrived at the branch"?** A checkbox `arrivedAtBranch` on the Strapi order
  that sets `orders.arrived_at`, allowed only while the order is `shipped`; no new order status
  (owner, 2026-11-06).
- **Cancel + refund in one save?** Two emails, `cancelled` then `refunded`; the cancelled email for
  a paid card order says the refund will follow (owner, 2026-11-06).
- **Free storage days at the branch?** 7, as the constant `NOVA_POSHTA_FREE_STORAGE_DAYS` in
  `app/lib/checkout.ts` (owner, 2026-11-06).
- **What is "the branch"?** The free-text `orders.shipping_address`; #136's branch ids were not
  built (closed as not planned, #136; `app/.server/services/orders.ts:163`).
- **What language?** The `locale` stored on the order's `confirmation` row; orders have no locale
  column (source: `app/.server/services/orders.ts:176`, issue assumptions).
- **New job?** No: `deliverOrderEmails` claims any `pending` row whatever its type, so
  `pnpm db:send-order-emails` sends the new types once `buildEmail` knows them (source:
  `app/.server/services/order-email.ts`, `db/queries/order-emails.ts`).
- **Marketing consent?** Not needed: transactional, like the confirmation (issue assumptions).
- **Which statuses send nothing?** `paid`, `completed`, `returned`, `unclaimed`: review requests
  and other notifications are out of scope (issue).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | Add `shipped`, `arrived`, `cancelled`, `refunded` to `ORDER_EMAIL_TYPES` |
| modify | `app/.server/db/schema.ts` | `orders.waybill_number` (+ CHECK), `orders.arrived_at`; type CHECK follows the enum |
| create | `app/.server/db/migrations/0027_order_status_emails.sql` (+ `meta/`) | Generated: columns, CHECKs |
| create | `app/.server/db/rollbacks/0027_order_status_emails.sql` | Delete rows of the new types, restore the old CHECK, drop the columns |
| modify | `app/lib/commerce.ts` | Mirror the two new order columns (`schema.test.ts` checks it) |
| modify | `app/lib/order-status.ts` | `OrderLifecycle` gains `arrivedAt` / `waybillNumber`; `OrderStatusChange` gains `arrivedAtBranch` / `waybillNumber`; new errors `arrived-not-shipped` |
| modify | `app/lib/order-status.test.ts` | Arrival and waybill rules |
| create | `app/lib/order-status-emails.ts` | `orderStatusEmailTypes(before, patch)` (pure) |
| create | `app/lib/order-status-emails.test.ts` | Each transition → its type; unrelated edits → none |
| modify | `app/lib/cms-sync.ts` | `cmsOrderChangeSchema` (+ `waybillNumber`, `arrivedAtBranch`), `CmsOrderState` (+ `waybillNumber`, `arrivedAt`, `arrivedAtBranch`) |
| modify | `app/lib/cms-sync.test.ts` (or the schema's test) | Waybill normalisation and refusal |
| modify | `app/.server/db/queries/orders.ts` | Select/update the new columns in `lockOrderLifecycle`, `updateOrderLifecycle`, `findOrderSyncState`; new `findOrderStatusEmail` |
| modify | `app/.server/db/queries/order-emails.ts` | `queueOrderStatusEmails(tx, orderId, types)`: insert-select with the confirmation's locale, `on conflict do nothing` |
| modify | `app/.server/db/queries/order-emails.test.ts` | Locale copy, fallback `uk`, no duplicates |
| modify | `app/.server/services/cms-sync.ts` | Queue the emails in `applyCmsOrderChange`'s transaction; return whether any were queued |
| modify | `app/.server/services/cms-sync.test.ts` | Each transition queues once; refused change queues nothing |
| modify | `app/.server/services/cms-push.ts` (+ test) | `toStrapiOrderData` carries the new fields |
| modify | `app/routes/cms.orders.$id.ts` | `void deliverOrderStatusEmails(orderId)` after the commit |
| modify | `app/.server/services/order-email.ts` | Four builders, shared items/delivery helpers, `buildEmail` dispatch, generic log text |
| modify | `app/.server/services/order-email.test.ts` | Templates in uk and en, ТТН/link present or absent, cod amount, gift card line |
| modify | `app/.server/services/orders.ts` | `deliverOrderStatusEmails(orderId)` wiring (like `deliverOrderConfirmation`) |
| modify | `app/lib/checkout.ts` | `NOVA_POSHTA_FREE_STORAGE_DAYS`, `novaPoshtaTrackingUrl(ttn)`, `OrderStatusEmail` DTO |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `orderStatusEmail.*` (shared lines + `shipped`/`arrived`/`cancelled`/`refunded`) |
| modify | `cms/src/api/order/content-types/order/schema.json` | `waybillNumber` (string, editable), `arrivedAtBranch` (boolean), `arrivedAt` (datetime) |
| modify | `cms/src/sync/middleware.ts` (+ its test) | Send `waybillNumber` / `arrivedAtBranch`; Ukrainian messages for the new refusals |
| modify | `cms/src/index.ts` (if field hints live there) | Admin hints for the two new fields |
| modify | `app/.server/AGENTS.md`, `docs/email.md` | Document the new types, columns and the once-per-type rule |

## Steps

Each step is small, ordered, and leaves the app in a working state.

- [ ] **1. Schema and migration.** Extend `ORDER_EMAIL_TYPES`; add `orders.waybillNumber`
  (`varchar({ length: 20 })`, CHECK `orders_waybill_number_check`) and `orders.arrivedAt`
  (`timestamp({ withTimezone: true })`) with doc comments (ML feature note on `arrived_at`). Mirror
  them in `~/lib/commerce`. `pnpm db:generate --name order_status_emails`; check the SQL rewrites
  `order_emails_type_check`. Write `db/rollbacks/0027_order_status_emails.sql`
  (`delete from order_emails where type in (…new…)`, restore the old CHECK, drop the CHECK and the
  two columns). Run `pnpm db:migrate`, then `pnpm db:rollback` and migrate again.
  `schema.test.ts` passes.
- [ ] **2. Lifecycle rules.** In `app/lib/order-status.ts`, add `arrivedAt` and `waybillNumber` to
  `OrderLifecycle` and `arrivedAtBranch?: boolean`, `waybillNumber?: string | null` to
  `OrderStatusChange`. `nextOrderState`: a changed waybill goes into the patch; `arrivedAtBranch:
  true` sets `arrivedAt = now` when it's `null` and the resulting status is `shipped`, otherwise
  `{ ok: false, error: "arrived-not-shipped" }`; `false` clears it. In `~/lib/cms-sync`, extend
  `cmsOrderChangeSchema` (waybill: trim, remove spaces, `''` → `null`, else `/^\d{14}$/` with a
  `msg(…)` key) and `CmsOrderState`. Update `lockOrderLifecycle`, `updateOrderLifecycle`,
  `findOrderSyncState`, `toCmsOrderState` and `toStrapiOrderData`. Tests in `order-status.test.ts`
  and the cms-sync tests.
- [ ] **3. Which emails.** Create `app/lib/order-status-emails.ts` with
  `orderStatusEmailTypes(before: OrderLifecycle, patch: OrderLifecyclePatch): OrderEmailType[]`
  (rules in Decisions). Unit-test every transition in the table, cod `pending → shipped`, a
  waybill-only edit, an empty patch, and cancel + refund together.
- [ ] **4. Queue in the transaction.** Add `queueOrderStatusEmails(db, orderId, types)` to
  `db/queries/order-emails.ts`: one `insert into order_emails (order_id, type, locale) select …,
  coalesce((select locale from order_emails where order_id = $1 and type = 'confirmation'), 'uk')
  … on conflict (order_id, type) do nothing`. Call it in `applyCmsOrderChange` after
  `updateOrderLifecycle`, with `orderStatusEmailTypes(current, next.patch)`, and return
  `emailsQueued: boolean` beside the order (not sent to Strapi). Integration tests
  (`createTestDatabase`): shipped → one `shipped` row with the confirmation's locale;
  `paid → cancelled` and repeated saves → still one row;
  refused transition → no row; a `failed` row is not re-queued.
- [ ] **5. Strapi.** Add `waybillNumber`, `arrivedAtBranch` and `arrivedAt` to the order content
  type (descriptions in Ukrainian), send the first two from `syncOrder` in
  `cms/src/sync/middleware.ts`, map the app's answer back (`toOrderData`), and add Ukrainian texts
  for `invalid-waybill` / `arrived-not-shipped`. Update the middleware tests. In the route
  `cms.orders.$id.ts`, after the commit, `void deliverOrderStatusEmails(orderId)` when
  `emailsQueued`, next to `void pushToCms()`.
- [ ] **6. Templates.** In `app/lib/checkout.ts` add `NOVA_POSHTA_FREE_STORAGE_DAYS = 7`,
  `novaPoshtaTrackingUrl(ttn)` and the `OrderStatusEmail` DTO (`OrderConfirmation` + `status`,
  `paymentStatus`, `waybillNumber`, `userId`, `paidByCard`). Add `findOrderStatusEmail(db, id)` in
  `db/queries/orders.ts` (reuse `findOrderConfirmation`'s lines query). In
  `services/order-email.ts`: extract `orderItemBlocks` / `deliveryBlock` from the confirmation,
  add `buildOrderShippedEmail`, `buildOrderArrivedEmail`, `buildOrderCancelledEmail`,
  `buildOrderRefundedEmail` and an `ORDER_STATUS_BUILDERS` map; `OrderEmailDeps` gets
  `loadOrderStatus`; `buildEmail` dispatches by type (exhaustive switch, so a new type fails
  `tsc`); make the "SMTP_URL is not set" log say "order N's emails". Add
  `deliverOrderStatusEmails` to `services/orders.ts`. Add `orderStatusEmail.*` to `uk.ts` (source)
  and `en.ts` (plural-free; days via `{ one, few, many, other }` if counted).
- [ ] **7. Template tests.** In `order-email.test.ts`, for each type in uk and en: subject with the
  order number only, the status line, the items, the ТТН `code` block and tracking `button` only
  when `waybillNumber` is set, the branch and the storage days in `arrived`, the cod amount only for
  cod, the gift-card line in `cancelled`, the account link only with a `user_id`, and HTML/text
  parity via `htmlWords` / `words`. A `deliverOrderEmails` test with fake deps sends a `shipped`
  row and marks it sent.
- [ ] **8. Docs.** Update the order email outbox bullet and the CMS sync bullet in
  `app/.server/AGENTS.md` (new types, once per type, locale rule, the two columns, `arrived_at` is
  an ML feature), the email list in `docs/email.md`, and staff notes on filling the ТТН in Strapi.
- [ ] **9. Verify.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; manual run under
  `pnpm aspire run` (below).

## Testing & verification

- Unit: `order-status.test.ts`, `order-status-emails.test.ts`, the cms-sync schema test,
  `order-email.test.ts` (templates in both languages), middleware tests in `cms/`.
- Integration (`describe.skipIf(!hasDatabase)`, `createTestDatabase()`): `order-emails.test.ts`
  (insert-select locale, fallback, `on conflict`), `cms-sync.test.ts` (each transition queues the
  right type once; no email for a waybill-only or unchanged save; refused changes queue nothing;
  rollback of the transaction leaves no row).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; `pnpm db:migrate` then
  `pnpm db:rollback` and migrate again.
- Manual (Aspire, smtp4dev): place a cod order in English, in Strapi set "Shipped" with a ТТН →
  English shipped email with the number and link in smtp4dev; tick "Arrived at branch" → arrived
  email with the branch and 7 days; set it back and forth → no second email. Place a card order
  (simulator), pay, cancel and refund → cancelled and refunded emails. Run
  `pnpm db:send-order-emails` with SMTP stopped then started to see the retry.

## Acceptance criteria

- [ ] Moving an order to shipped, arrived, cancelled or refunded queues one matching email, in the
  order's language — steps 2, 3, 4, 5
- [ ] The shipped email has the waybill number and a tracking link when the order has one —
  steps 1, 2, 5, 6, 7
- [ ] The same email is never sent twice for one order — steps 3, 4 (existing unique index +
  `on conflict do nothing`)
- [ ] Emails go through the existing outbox with retries — steps 4, 6
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 9

## Out of scope

- SMS/Viber notifications, review requests after delivery (issue).
- Creating waybills through the Nova Poshta API and polling tracking (#137, postponed); this plan
  only adds the columns #137 would fill.
- Showing the ТТН or arrival on the account order page or success page.
- Emails for `paid`, `completed`, `returned` or `unclaimed`.
- A provider refund callback (no real payment provider yet).
