# Plan: Send order-confirmation email after checkout (#45)

Issue: https://github.com/savchukolgaa/jassmin/issues/45
Branch: `issue/45`
Worktree: `.claude/worktrees/issue-45`
Status: Planned

## Goal
Shoppers, guests and registered users alike, should get an order-confirmation email after checkout
so they have a record of the order, its total and the delivery details. Guests have no account
page, so today the success page is their only record. Every placed order queues one plain-text
confirmation in the language the shopper checked out in. The app tries to send it right after the
order transaction commits, and a retry job delivers anything that failed. A mail failure is logged
and never affects the order or the redirect.

## Dependencies & prerequisites
- #11 (checkout) is merged: `createOrder` in `app/.server/services/orders.ts`, the `/checkout`
  action in `app/routes/checkout.tsx` and the success page `app/routes/checkout-success.tsx`.
- Mail transport is in place: `getMailTransport()` in `app/.server/mail.ts` (`SMTP_URL`, smtp4dev
  under Aspire).
- New migration `0009_order_emails` (with a hand-written rollback), a new CLI job
  `pnpm db:send-order-emails` with its Aspire resource, and a new optional env var `ORDER_FROM`. No
  new packages.

## Decisions & assumptions
- **Outbox table `order_emails`.** The retry queue lives in PostgreSQL, so a queued email survives
  crashes and restarts, and an order and its email are committed together. One row per order and
  email type:
  - `id` serial;
  - `order_id` integer, not null, references `orders` with `on delete cascade`;
  - `type` text, CHECK in `ORDER_EMAIL_TYPES = ["confirmation"]` (#44 can add payment emails);
  - `locale` text, CHECK in `LOCALES`;
  - `status` text, CHECK in `ORDER_EMAIL_STATUSES = ["pending", "sent", "failed"]`, default `pending`;
  - `attempts` integer, default `0`;
  - `next_attempt_at` timestamptz, default `now()`;
  - `last_error` text, nullable;
  - `sent_at` timestamptz, nullable;
  - `created_at`;
  - `updated_at` (`$onUpdate`).

  It has a unique constraint `order_emails_order_id_type_unique` and an index on
  `(status, next_attempt_at)`. The value arrays go in `~/lib/enums`, and the CHECKs follow the
  pattern of `orders.payment_method`, so adding a type is a migration that rewrites the check.
- **Enqueue inside the order transaction.** `createOrder` gets a `locale` and inserts the
  `confirmation` row (`insertOrderEmail(tx, …)`) right after the order and its lines, before the
  cart is marked `converted`. If the order rolls back, so does the row, so a failed order never
  sends anything. A double submit (`placed: false`) inserts nothing, which means exactly one email
  per order.
- **Claiming works as a lease.** `claimOrderEmails(db, { orderId? , limit })` runs one
  `UPDATE … WHERE id IN (SELECT id FROM order_emails WHERE status = 'pending' AND next_attempt_at <= now() [AND order_id = $1] ORDER BY next_attempt_at LIMIT $n FOR UPDATE SKIP LOCKED) RETURNING …`.
  The same `UPDATE` sets `attempts = attempts + 1` and moves `next_attempt_at` to
  `now() + backoff(attempts)`. While one sender holds a row, the others skip it, and if a process
  dies mid-send the row comes back on its own once the backoff passes. No separate lock column is
  needed, and several app instances or the job can run at once.
- **Backoff and give-up:** 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h, 24 h, in
  `ORDER_EMAIL_RETRY_DELAYS_MINUTES`. That's `MAX_ORDER_EMAIL_ATTEMPTS = 8`, about two days. A send
  that fails on the last attempt sets `status = 'failed'`. Each failure saves a short `last_error`
  (the error message, cut to 500 characters; it never contains the email body).
- **Results:** a successful send sets `status = 'sent'` and `sent_at = now()` (`markOrderEmailSent`).
  A failure saves `last_error` (`markOrderEmailFailed`, which also sets `failed` once
  `attempts >= MAX`). Delivery is at least once: if SMTP accepted the message but marking it sent
  failed, the email is sent again. That's acceptable for a confirmation.
- **Immediate attempt after commit.** In the action, when `result.placed` is true, the app calls
  `void deliverOrderEmails({ orderId: result.orderId })` without awaiting it, so the redirect isn't
  delayed, just as `trackEvent` works. It claims only that order's due row. The shopper usually
  gets the email within seconds, and the job only handles the leftovers.
- **Retry job, following the abandoned-cart job (#19).** `pnpm db:send-order-emails`
  (`db/scripts/send-order-emails.ts`, logic in `services/order-email.ts`) claims up to 50 due rows
  per batch, sends them and loops until none are due. It logs `Sent X, failed Y, gave up Z.` Run it
  every 5 minutes from an external scheduler (cron), because the app server only handles requests
  (README "Abandoned carts"). Under Aspire, `db-send-order-emails` is a start-by-hand resource with
  `.withReference(db)`, `SMTP_URL` from smtp4dev and `.waitForCompletion(dbMigrate)`. The script
  needs `SMTP_URL`, `ORDER_FROM`, `CONTACT_FROM` and `CONTACT_INBOX` as well as the database. It
  reads them through `parseEnv`'s mail fields: a small `parseMailEnv(source)` exported from
  `env.ts`, so the job doesn't need `SESSION_SECRET`.
- **Missing `SMTP_URL`:** nothing is claimed and rows stay `pending`, so they go out once SMTP is
  configured. The app logs
  `console.info("[order-email] SMTP_URL is not set; order {id}'s confirmation stays queued")`, and
  the job exits with that message and code 0. Unlike the contact form, the shopper never sees an
  error.
- **The email is built from the stored order, not the form input.** It's rendered at send time from
  the same queries the success page uses (`findOrder` + `listOrderLines`), so it shows what was
  saved: `price_at_purchase`, the SQL totals and the normalised phone. `getOrderConfirmation` is
  split into a viewer-free `loadOrderConfirmation(orderId, db)`, plus the existing viewer check.
- **Locale:** `await getLocale(request)` in the action is passed to `createOrder` and stored on the
  outbox row. The sender uses `createTranslator(row.locale)`.
- **Pure builder plus injectable deps**, mirroring `services/contact.ts`:
  `buildOrderConfirmationEmail(order, translator, env): Mail.Options` is pure.
  `deliverOrderEmails(options, deps = defaultDeps())` takes
  `{ db, mailer: MailSender | null, env, now }`. `MailSender` moves to `mail.ts` and is shared with
  `contact.ts`.
- **Headers:** `to: { name: stripLineBreaks(fullName), address: email }`. The subject only holds
  the order number and the brand (`orderEmail.subject`: "Замовлення №{id} прийнято — Jassmin").
  `from` is `ORDER_FROM ?? CONTACT_FROM`, and `replyTo` is `CONTACT_INBOX`. `stripLineBreaks`
  (`/[\r\n]+/g` → space) moves into `mail.ts`, and `contact.ts` uses it too.
- **`ORDER_FROM`:** optional; when unset it falls back to `CONTACT_FROM` (confirmed).
- **Content** (plain text, every label from `orderEmail.*`):
  1. Greeting with the name, and "Your order №{id} of {date} has been received" (`formatDate(createdAt.toISOString())`, Kyiv time).
  2. Lines: `{title} — {volume}, {quantity} × {unitPrice} = {lineTotal}`. The volume comes from
     `formatVolume` (`~/lib/products`); `title === null` → `checkout.deletedProduct`; `volumeMl === null` drops the volume.
  3. Subtotal, delivery (`checkout.shippingFree` when `freeShipping`, otherwise
     `checkout.shippingCarrierRate`) and total (`totalAmount`), all through `formatPrice`.
  4. Payment: the method label and the card/cod note. These reuse `checkout.payment.*`;
     `PAYMENT_KEYS` moves from `checkout-success.tsx` to `~/lib/checkout`.
  5. Delivery: Nova Poshta, then `fullName, phone`, then `shippingAddress`.
  6. Contact line: "Questions? Reply to this email or write to {email}" with `CONTACT_INBOX`, and no
     CMS call (confirmed).
- New keys: `orderEmail.subject`, `greeting`, `intro`, `itemsHeading`, `line`, `subtotal`,
  `shipping`, `total`, `paymentHeading`, `deliveryHeading`, `deliveryCarrier`, `contact` and
  `signature`, added to both `uk.ts` and `en.ts`.
- **Analytics:** `order_emails` is operational, not an ML feature table, so there's no mirror in
  `~/lib/commerce`. Its row type is inferred in `db/queries/order-emails.ts`.

## Open questions
- [ ] **Q4: How often should `db:send-order-emails` run in production, and who sets up the cron?**
  Why it matters: the gap between a failed first attempt and the retry depends on it. Recommended
  default: every 5 minutes, documented in the README next to the abandoned-cart cron. The plan
  doesn't need it answered to proceed. Affects steps: 7.

## Resolved questions
- **Q1: Sender address:** an optional `ORDER_FROM` that falls back to `CONTACT_FROM` (confirmed by
  the user).
- **Q2: Contact line:** reply-to plus `CONTACT_INBOX`, with no CMS call (confirmed by the user).
- **Q3: Fire-and-forget or a retry queue?** A persistent retry queue now (requested by the user). It's
  the `order_emails` outbox above.
- **Double submit:** no second email. `createOrder` returns `placed: false` before any insert, and
  `order_emails` is unique per order and type (source: `app/.server/services/orders.ts`).
- **How background work runs here:** the app server only handles requests. Periodic jobs are
  `pnpm db:*` CLI scripts run by an external cron, with a start-by-hand Aspire resource (source:
  `README.md` "Abandoned carts", `aspire-apphost/apphost.mts`,
  `app/.server/db/scripts/mark-abandoned-carts.ts`).
- **Migrations:** `pnpm db:generate --name order_emails`, plus `db/rollbacks/0009_order_emails.sql`
  (source: `app/.server/AGENTS.md` "Database").
- **Shipping line:** the amount is always 0, so the email uses the free/carrier-rate wording based
  on `orders.free_shipping` (source: `app/.server/AGENTS.md` "Orders", `app/lib/checkout.ts`).
- **Card/cod note wording:** reuse `checkout.payment.cardNote` / `codNote` (source:
  `app/routes/checkout-success.tsx`).
- **`formatDate` on the server:** it always formats in `Europe/Kyiv` (source:
  `app/lib/i18n/translator.ts`).
- **Header sanitising and test fakes:** follow `services/contact.ts` and `contact.test.ts`.
- **Payment-status emails (paid/failed):** out of scope, they belong to #44. The `type` column
  leaves room for them.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | `ORDER_EMAIL_TYPES`, `ORDER_EMAIL_STATUSES` |
| modify | `app/.server/db/schema.ts` | `orderEmails` table |
| modify | `app/.server/db/schema.test.ts` | CHECK values match the enums |
| create | `app/.server/db/migrations/0009_order_emails.sql` (+ `meta/`) | Generated migration |
| create | `app/.server/db/rollbacks/0009_order_emails.sql` | `drop table order_emails` |
| create | `app/.server/db/queries/order-emails.ts` | `insertOrderEmail`, `claimOrderEmails`, `markOrderEmailSent`, `markOrderEmailFailed` |
| create | `app/.server/db/queries/order-emails.test.ts` | Integration: claim, lease, skip-locked, give up |
| modify | `app/.server/env.ts` (+ `env.test.ts`) | `ORDER_FROM`; `parseMailEnv` for the job |
| modify | `.env.example`, `README.md` | `ORDER_FROM`, the order-email job and its cron |
| modify | `app/.server/mail.ts` (+ `mail.test.ts`) | `stripLineBreaks`, shared `MailSender` |
| modify | `app/.server/services/contact.ts` | Use the shared helpers (no behaviour change) |
| modify | `app/.server/services/orders.ts` (+ `orders.test.ts`) | `locale` input, enqueue in the transaction, `loadOrderConfirmation` |
| modify | `app/lib/checkout.ts`, `app/routes/checkout-success.tsx` | Shared `PAYMENT_KEYS` |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `orderEmail.*` |
| create | `app/.server/services/order-email.ts` | `buildOrderConfirmationEmail`, `deliverOrderEmails`, `retryDelayMinutes` |
| create | `app/.server/services/order-email.test.ts` | Body (uk/en), headers, backoff, delivery outcomes with fakes |
| create | `app/.server/db/scripts/send-order-emails.ts` | CLI wrapper |
| modify | `package.json` | `db:send-order-emails` script |
| modify | `aspire-apphost/apphost.mts` | `db-send-order-emails` explicit-start resource |
| modify | `app/routes/checkout.tsx` (+ `checkout.test.ts`) | Pass the locale; immediate attempt for placed orders |
| modify | `app/.server/AGENTS.md`, `aspire-apphost/AGENTS.md` if it lists resources | Document the outbox and the job |

## Steps
- [x] **1. Schema and migration.** Add the enum arrays to `~/lib/enums`. Add the `orderEmails`
  table to `schema.ts`, with `orderId` cascading, the CHECKs (types, `LOCALES`, statuses), an
  explicitly named unique constraint and the `(status, next_attempt_at)` index. Then run
  `pnpm db:generate --name order_emails`, write the rollback, and extend `schema.test.ts`. Check:
  `pnpm db:migrate`, then `pnpm db:rollback`, then migrate again; `pnpm typecheck`.
- [x] **2. Queue queries.** Create `db/queries/order-emails.ts`:
  - `insertOrderEmail(tx, { orderId, type, locale })`
  - `claimOrderEmails(db, { orderId?, limit, delays })`: the single `UPDATE … FOR UPDATE SKIP LOCKED … RETURNING id, orderId, type, locale, attempts`. The backoff comes from `attempts` with a SQL `CASE` or array index into the delays.
  - `markOrderEmailSent(db, id)`
  - `markOrderEmailFailed(db, id, error, maxAttempts)`

  Add integration tests (`describe.skipIf(!hasDatabase)`, `createTestDatabase()`) covering:
  - only due `pending` rows are claimed, and a claim pushes `next_attempt_at` out;
  - two concurrent claims never return the same row;
  - the last failed attempt becomes `failed`;
  - a `sent` row is never claimed again.
- [x] **3. Env and shared mail helpers.** Add `ORDER_FROM` (optional, empty → unset) to
  `envSchema`, and export `parseMailEnv(source)`, which validates only
  `SMTP_URL`/`ORDER_FROM`/`CONTACT_FROM`/`CONTACT_INBOX`/`NODE_ENV` and is reused by `envSchema`
  through `.extend`/`.shape`. Move `stripLineBreaks` and `MailSender` into `mail.ts`. Switch
  `contact.ts` over to them. Document `ORDER_FROM` in `.env.example` and the README, and add tests
  to `env.test.ts`. Check: `pnpm test`.
- [x] **4. Enqueue at checkout.** Add `locale: Locale` to `CreateOrderInput`, and call
  `insertOrderEmail(tx, { orderId, type: "confirmation", locale })` inside the transaction. Extract
  `loadOrderConfirmation`. Move `PAYMENT_KEYS` to `~/lib/checkout`. Extend the `orders.test.ts`
  integration tests: a placed order has exactly one `pending` confirmation row with the locale; an
  `insufficient-stock` or `cart-empty` result, or a double submit, adds none; a thrown error rolls
  the row back too.
- [ ] **5. Translations and the email builder.** Add `orderEmail.*` to `uk.ts` and `en.ts`. In the
  new `services/order-email.ts`, write the pure
  `buildOrderConfirmationEmail(order: OrderConfirmation, translator: Translator, env: Pick<Env, "ORDER_FROM" | "CONTACT_FROM" | "CONTACT_INBOX">): Mail.Options`
  with the content listed under the decisions, plus `retryDelayMinutes(attempts)`. Check: exact
  `toEqual` text tests for uk and en.
- [ ] **6. Delivery.** Add
  `deliverOrderEmails({ orderId?, limit = 50 }, deps = defaultDeps()): Promise<{ sent; failed; gaveUp; skipped }>`:
  1. Without a mailer, log the skip and return without claiming.
  2. Otherwise, claim due rows. For each row, `loadOrderConfirmation`, then build and `sendMail`.
     On success `markOrderEmailSent`, otherwise `markOrderEmailFailed` with the cut error message.
     A missing order (deleted) counts as failed and isn't retried.
  3. Loop until a batch comes back smaller than `limit` (the job only; the immediate path passes
     `orderId` and claims at most one row).
  4. Catch everything, including `defaultDeps()`: the function never rejects. Errors are logged
     with `[order-email]` and never include the email body.

  Check: unit tests with a fake `MailSender` and stubbed query functions (passed as deps), for
  each outcome and for no SMTP.
- [ ] **7. Retry job.** Create `db/scripts/send-order-emails.ts` (load `.env`, `getDatabaseUrl`,
  `parseMailEnv`, `createDb(url, 1)`, an SMTP transport from `smtpOptionsFromUrl`, run
  `deliverOrderEmails({}, deps)`, log the counts, then close the pool and the transport). Add the
  `db:send-order-emails` script to `package.json` and the `db-send-order-emails` resource to
  `aspire-apphost/apphost.mts`, with its `SMTP_URL` from smtp4dev. Write a README section "Order
  emails" covering the outbox, the backoff, `failed` rows and a cron line
  (`*/5 * * * * … pnpm db:send-order-emails`). Check: start the resource under
  `pnpm aspire run`.
- [ ] **8. Wire into `/checkout`.** In the action, call `const locale = await getLocale(request)`
  and pass it to `createOrder`. In `if (result.placed)`, next to the `purchase` event, add
  `void deliverOrderEmails({ orderId: result.orderId })`. In `checkout.test.ts`, mock
  `~/.server/services/order-email` and `~/.server/locale`, and check:
  - `createOrder` gets the locale (a `locale=en` cookie → `"en"`);
  - delivery is attempted once for a placed order;
  - nothing is attempted for `placed: false`, `cart-empty`, `insufficient-stock` or validation
    errors;
  - a rejecting mock still gives the redirect.
- [ ] **9. Docs and full verification.** Update `app/.server/AGENTS.md`:
  - "Orders": the confirmation is enqueued in the transaction;
  - "mail": `order-email.ts`, `ORDER_FROM`, never fails checkout;
  - "Database": the `order_emails` outbox and lease semantics.

  Update `aspire-apphost/AGENTS.md` if it lists resources. Run `pnpm typecheck`, `pnpm lint`,
  `pnpm test` and `pnpm build`, then do the manual check below.

## Testing & verification
- Unit tests:
  - `order-email.test.ts`:
    - the uk and en bodies for a `cod` order under the threshold and a `card` order over it, plus
      a deleted product and a missing volume;
    - CR/LF stripped in `to`, no user input in the subject, `from` falling back to `CONTACT_FROM`,
      `replyTo`;
    - `retryDelayMinutes`;
    - delivery outcomes with fakes: sent, failed, gave up, missing order, no SMTP, and a throwing
      dependency resolving.
  - `env.test.ts`: `ORDER_FROM` and `parseMailEnv`.
  - `checkout.test.ts`: the wiring above.
- Integration tests (with a database): `order-emails.test.ts` (claim/lease/skip-locked/give up)
  and `orders.test.ts` (enqueue in the transaction, nothing on failure or double submit, rollback).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and a migrate → rollback →
  migrate round trip.
- Manual under `pnpm aspire run`:
  1. Place one uk and one en guest order. smtp4dev shows one email each, and their rows are `sent`.
  2. Stop smtp4dev and place an order. The redirect works, and the row is `pending` with
     `attempts = 1` and a `last_error`.
  3. Start smtp4dev again, wait past the backoff and start `db-send-order-emails`. The email
     arrives, the row is `sent`, and running the job again sends nothing.

## Acceptance criteria
- [ ] After a successful checkout, the order's email address receives one confirmation email — steps 4, 6, 7, 8
- [ ] The email contains the order number, lines, totals, payment method and delivery address — step 5
- [ ] The email is in the language the shopper checked out in (uk or en) — steps 4, 5, 8
- [ ] A mail failure or missing `SMTP_URL` never fails the order or the redirect — steps 6, 8 (and failures are retried, step 7)
- [ ] No email is sent when order creation fails — step 4 (the row rolls back with the order), step 8

## Out of scope
- Payment-status emails (paid/failed), which belong to #44. The `type` column is ready for them.
- HTML email templates.
- An `/admin` view or resend button for `failed` emails, and alerting on them.
- An in-process scheduler: retries run from the external cron, as the abandoned-cart job does.
- Store-side notification emails for new orders.
