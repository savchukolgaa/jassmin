# Plan: Integrate online card payment provider for checkout orders (#44)

Issue: https://github.com/savchukolgaa/jassmin/issues/44
Branch: `issue/44`
Worktree: `.claude/worktrees/issue-44`
Status: Planned

## Goal
A shopper who pays by card should pay online right after checkout. Then the order is paid and can ship without a separate payment step. Orders with `payment_method = 'card'` go to a Ukrainian provider's hosted payment page. A verified provider callback marks the order `paid`. The success page shows whether the payment is paid, pending or failed, and offers a retry. Cash-on-delivery stays exactly as it is.

## Dependencies & prerequisites
- **#11 Checkout** is on `main`: `createOrder` in `app/.server/services/orders.ts`, `routes/checkout.tsx`, `routes/checkout-success.tsx`, `orders.payment_status` / `paid_at` / `status`.
- **#45 Order emails** is on `main`. The confirmation email shows `checkout.payment.cardNote`, so that copy changes (step 9).
- **#18 Analytics** records the `purchase` event in the checkout action. This plan doesn't change it.
- New env vars (all optional): `LIQPAY_PUBLIC_KEY`, `LIQPAY_PRIVATE_KEY` and `PUBLIC_URL`.
- One new migration, `0010_payments`, with a hand-written rollback.
- No new npm packages. The LiqPay signature uses `node:crypto` (SHA-1 and base64), and creating a payment needs no HTTP call.

## Decisions & assumptions
- **Provider: LiqPay (PrivatBank)** **(unconfirmed, Q1)**. It's the most common choice for small Ukrainian stores. Its hosted checkout is a signed URL built locally (`https://www.liqpay.ua/api/3/checkout?data=…&signature=…`), so creating a payment is a pure function and easy to test. Its signature is `base64(sha1(private_key + data + private_key))`. Sandbox keys (`sandbox_…`) take test cards. The callback (`server_url`) is a form POST with `data` and `signature`.
- **Provider adapter.** `app/.server/payments/` holds a `PaymentProvider` interface with these members:
  - `name`
  - `createCheckout({ reference, amount, currency, description, resultUrl, callbackUrl, locale }) → { redirectUrl }`
  - `parseCallback(formData) → { ok: true, event: { reference, outcome: "success" | "failure" | "pending", amount, currency, providerPaymentId, raw } } | { ok: false, error: "invalid-signature" | "malformed" }`

  `liqpay.ts` implements it. `getPaymentProvider(env)` returns it, or `null` when the keys are missing. The service and the routes only see the interface, so the provider can be swapped later.
- **Card payment is optional.** When no provider is configured, the app still boots. The checkout loader passes `cardPaymentAvailable: false`, and `PaymentMethodField` disables the card option with a note. The checkout action also rejects `card` server-side with the field error `checkout.errors.cardUnavailable`.
- **A `payments` table records each attempt.** The issue only requires order columns, but this plan adds the table for three reasons:
  - LiqPay needs a unique `order_id` for every attempt. A retry after a failure can't reuse the order id.
  - The success page has to tell "failed" from "pending". The browser comes back from LiqPay with no status.
  - Attempts and failures are useful for the LTV and churn analytics.

  The columns are `id`, `order_id` (FK, cascade), `provider`, `reference` (unique), `status` (`PAYMENT_ATTEMPT_STATUSES = ["pending", "succeeded", "failed"]`, with a CHECK), `amount numeric(10,2)`, `currency`, `provider_payment_id`, `last_callback jsonb`, `created_at`, `updated_at` and `completed_at`. The reference is `${orderId}-${attemptNo}`, for example `42-1`. The issue says "order id as the reference", and the provider's order id still starts with ours. **(unconfirmed, Q2)**
- **Amount comes from the server.** `startPayment(orderId)` reads `orders.total_amount` and `currency` from the database. No amount is ever read from the form. A callback is ignored when its amount or currency differs from the stored attempt. In that case the attempt isn't marked succeeded, and an error is logged.
- **Idempotent callback.** One transaction does the following:
  1. It locks the `payments` row by `reference` with `FOR UPDATE`.
  2. If the row is already `succeeded`, it changes nothing.
  3. On `success`, it marks the attempt `succeeded`. Then it runs `UPDATE orders SET payment_status = 'paid', paid_at = now(), status = 'paid' WHERE id = $1 AND payment_status = 'unpaid' AND status = 'pending'`.
  4. On `failure`, it marks the attempt `failed` and leaves the order `unpaid`.
  5. On `pending` (`wait_secure`, `processing`, …), it only stores `last_callback`.

  A repeated callback therefore never updates the order twice. A late success for an order that is no longer `pending` (for example cancelled) is recorded on the attempt, and a warning is logged for a manual refund. The order isn't touched.
- **Callback route:** `payments/callback` (`routes/payments.callback.ts`). It's action-only and sits outside `_shop`, like `logout` and `consent`, with `loader` redirecting to `/`.
  - An invalid signature or malformed body returns 400 and writes nothing.
  - A verified callback returns 200, even for an unknown reference (logged), so the provider stops retrying.
  - The route has no session or consent dependency.
- **Checkout redirect.** After `createOrder` succeeds, a `card` order whose `payment_status` is `unpaid` gets `startPayment` and a redirect to the provider URL. The response still sets `rememberOrder` and still runs `deliverOrderConfirmation` and `purchase` for `placed` orders. This also covers `placed: false`, because the browser follows the last submit. `cod` orders keep the current redirect to `/checkout/success/:orderId`. If `startPayment` throws (provider misconfigured), the shopper goes to the success page, which shows the retry button.
- **Retry route:** `checkout/pay/:orderId` (`routes/checkout-pay.ts`). It's action-only, inside `_shop` so the visitor middleware still runs. It checks access like the success page (`canViewOrder` with `getUser` and `getSessionOrderIds`). Then it requires a `card` order with `payment_status = 'unpaid'` and `status = 'pending'`, creates a new attempt and redirects to the provider. Any other case redirects to the success page. Starting a payment is a write, so it's a POST `Form` and not a link. The issue's "try again link" is a button styled with `buttonClasses`.
- **Return URL.** LiqPay `result_url` is `/checkout/success/:orderId`. The browser returns by GET, so the `sameSite: lax` session cookie is sent and access checks keep working.
- **Success page payment state.** `getPaymentView(orderId)` returns:
  - `"paid"` when `orders.payment_status = 'paid'`
  - `"failed"` when the latest attempt is `failed`
  - `"pending"` otherwise, which covers no attempt yet and a pending attempt

  `cod` orders get `null` and render exactly as today. The callback may arrive a few seconds after the browser returns. While the state is `pending`, the page shows a "Refresh" link that reloads the page. There's no polling.
- **Absolute URLs** (`server_url`, `result_url`) use `PUBLIC_URL` when it's set. Otherwise they use `new URL(request.url).origin`. Locally, LiqPay can only reach the callback through a tunnel URL in `PUBLIC_URL`.
- The provider page's language follows the checkout locale: LiqPay `language: "uk" | "en"`.
- Status labels and copy are i18n keys in both `uk.ts` and `en.ts`.

## Open questions
- [ ] **Q1: Which provider: LiqPay, WayForPay or monobank acquiring?** Why it matters: it decides the adapter, the env names and the signature scheme. monobank needs an API call to create the invoice and ECDSA verification against a fetched public key. WayForPay returns the shopper by POST, which would need a different return route. Does the store already have a merchant account with one of them? Recommended default: **LiqPay**. Affects steps: 2, 3, 11.
- [ ] **Q2: Is a `payments` table acceptable, or must it stay order columns only?** Why it matters: without it, retries can't get a unique provider reference, and the page can't tell "failed" from "pending" without asking the provider's status API. Recommended default: **add `payments`** (one migration). Affects steps: 1, 4.
- [ ] **Q3: What should a failed payment do to stock and order status?** The order keeps its reserved stock and stays `pending`/`unpaid` indefinitely, unless an admin cancels it (#17). Recommended default: **leave it** (no auto-cancel job in this issue). Affects steps: none (out of scope).

## Resolved questions
- **Where do credentials go, and must the app boot without them?** In `envSchema`, optional, with `.env.example`, the README table and `env.test.ts`. Without them, card payment is unavailable. (source: #44 Technical, `app/.server/AGENTS.md` → Environment)
- **Which amount is charged?** `orders.total_amount` in `UAH`. It's computed in SQL by `createOrder` and never taken from the client. (source: #44, `app/.server/services/orders.ts`)
- **Where does the callback route go?** Action-only, outside the `_shop` layout, following `logout` / `consent` / `api/events`. (source: #44, `app/routes.ts`)
- **Who may view or retry an order?** The rule from `canViewOrder`: the order's user, or the browser it was placed in. (source: `app/routes/checkout-success.tsx`, `services/orders.ts`)
- **How are `updated_at` and transactions handled?** Through the query builder (`$onUpdate`), with `tx` passed down. (source: `app/.server/AGENTS.md` → Database)
- **Do refunds and partial payments matter here?** No, they're out of scope. (source: #44)
- **Does the `cod` flow change?** No. Its redirect and copy stay the same. (source: #44 acceptance criteria)

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | `PAYMENT_ATTEMPT_STATUSES`, `PAYMENT_PROVIDERS = ["liqpay"]` |
| modify | `app/lib/commerce.ts` (+ `app/.server/db/schema.test.ts`) | Mirror the `Payment` row type |
| modify | `app/.server/db/schema.ts` | `payments` table |
| create | `app/.server/db/migrations/0010_payments.sql` (+ meta) | Generated by `pnpm db:generate --name payments` |
| create | `app/.server/db/rollbacks/0010_payments.sql` | Drops the table |
| modify | `app/.server/env.ts`, `env.test.ts` | `LIQPAY_PUBLIC_KEY`, `LIQPAY_PRIVATE_KEY`, `PUBLIC_URL` (optional, empty = unset) |
| modify | `.env.example`, `README.md` | Document the vars and a "Card payments" section (sandbox keys, tunnel for callbacks) |
| create | `app/.server/payments/provider.ts` | `PaymentProvider` interface, `getPaymentProvider(env)` |
| create | `app/.server/payments/liqpay.ts`, `liqpay.test.ts` | Signing, checkout URL, callback parsing and verification, status mapping |
| create | `app/.server/db/queries/payments.ts`, `payments.test.ts` | Insert attempt, lock by reference, mark attempt, mark order paid, latest attempt |
| create | `app/.server/services/payments.ts`, `payments.test.ts` | `startPayment`, `handlePaymentCallback`, `getPaymentView`, `isCardPaymentAvailable` |
| modify | `app/lib/checkout.ts` | `PaymentView` type, `cardUnavailable` handling |
| modify | `app/routes/checkout.tsx`, `checkout.test.ts` | Card availability in loader/action, redirect to provider |
| modify | `app/features/checkout/CheckoutForm.tsx` | Disable card when unavailable |
| create | `app/routes/payments.callback.ts`, `payments.callback.test.ts` | Provider webhook |
| create | `app/routes/checkout-pay.ts`, `checkout-pay.test.ts` | Start a new payment attempt (retry) |
| modify | `app/routes.ts` | Register both routes |
| modify | `app/routes/checkout-success.tsx`, `checkout-success.test.ts` | Show the payment state and the retry button |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | New `checkout.payment.*` / `checkout.success.payment*` keys, updated `cardNote` |
| modify | `app/.server/AGENTS.md` | Document payments (Orders section and new Payments section) |

## Steps
- [ ] **1. Schema: `payments` table.** Add `PAYMENT_ATTEMPT_STATUSES` and `PAYMENT_PROVIDERS` to `~/lib/enums`. Add the `payments` table to `db/schema.ts`:
  - CHECKs via `oneOf` for `status` and `provider`, plus `amount >= 0`
  - `unique("payments_reference_unique")`
  - `index("payments_order_id_idx")`
  - `updatedAt()`

  Mirror the row type in `~/lib/commerce` and extend `schema.test.ts`. Run `pnpm db:generate --name payments`, write `rollbacks/0010_payments.sql` (`DROP TABLE payments;`) and check that `pnpm db:migrate` / `pnpm db:rollback` round-trip on a dev database.
- [ ] **2. Env.** Add optional `LIQPAY_PUBLIC_KEY`, `LIQPAY_PRIVATE_KEY` and `PUBLIC_URL` (`z.url()`) to `envSchema`. Empty values count as unset, as `STRAPI_API_TOKEN` does. Add `env.test.ts` cases for these:
  - unset (boots)
  - both keys set
  - an empty value
  - an invalid `PUBLIC_URL`

  Update `.env.example` and the README table.
- [ ] **3. Provider adapter and LiqPay.** Add `payments/provider.ts` with the interface and `getPaymentProvider(env)` (`null` unless both keys are set). Add `payments/liqpay.ts`:
  - `sign(data, privateKey)`
  - `createCheckout`: builds `{ version: 3, public_key, action: "pay", amount, currency, description, order_id, result_url, server_url, language }`, base64-encodes it, signs it and returns the checkout URL
  - `parseCallback`: verifies with `crypto.timingSafeEqual`, decodes, validates with zod, then maps `success`/`sandbox` → `success`, `failure`/`error`/`reversed` → `failure` and others → `pending`

  `liqpay.test.ts` covers these:
  - the known-vector signature from LiqPay's docs
  - a URL that round-trips its data
  - a valid callback accepted
  - a tampered `data` or `signature` rejected
  - a malformed body
  - status mapping
- [ ] **4. Payment queries.** Add `db/queries/payments.ts`:
  - `countPayments(tx, orderId)`, for the attempt number
  - `insertPayment`
  - `lockPaymentByReference` (`FOR UPDATE`)
  - `markPayment(tx, id, { status, providerPaymentId, lastCallback })`
  - `markOrderPaid(tx, orderId)`: the conditional update, which returns whether a row changed
  - `findLatestPayment(db, orderId)`
  - `findPayableOrder(db, orderId)`: `id`, `userId`, `paymentMethod`, `paymentStatus`, `status`, `totalAmount`, `currency`
- [ ] **5. Payments service.** Add `services/payments.ts`. The provider and db are injectable, as in `contact.ts` / `orders.ts`, so tests pass a fake provider.
  - `startPayment({ orderId, locale, origin })`: in a transaction, it locks the order row, checks that it's `card`/`unpaid`/`pending`, inserts the attempt `${orderId}-${n+1}` with the stored total and calls `provider.createCheckout`. It returns `{ ok: true, redirectUrl }` or `{ ok: false, error: "not-payable" | "unavailable" }`.
  - `handlePaymentCallback(formData)`: performs the idempotent transition described under Decisions. It returns `{ ok: false, error: "invalid-signature" | "malformed" }` or `{ ok: true, result: "paid" | "failed" | "pending" | "ignored" }`.
  - `getPaymentView(order)`
  - `isCardPaymentAvailable()`
- [ ] **6. Callback route.** Add `routes/payments.callback.ts`. `action` reads `request.formData()` (a bad body returns 400), calls `handlePaymentCallback` and answers 400 on a failed check or `200 ok` otherwise. `loader` redirects to `/`. Register it in `app/routes.ts` outside `_shop`, with a comment like the neighbours'.
- [ ] **7. Checkout redirect and card availability.** The loader returns `cardPaymentAvailable`. In the action, `card` without a provider returns a 400 field error `checkout.errors.cardUnavailable`. After a successful `createOrder` for `card`, it calls `startPayment` and redirects to `redirectUrl` with the `rememberOrder` `Set-Cookie`, keeping the email and the `purchase` event for `placed` orders. If the payment can't start, it falls back to the success page. `CheckoutForm` / `PaymentMethodField` takes `cardAvailable` and disables the card radio with the `checkout.payment.cardUnavailable` note.
- [ ] **8. Retry route.** Add `routes/checkout-pay.ts` (POST) at `checkout/pay/:orderId` inside `_shop`. It parses the id with `parseOrderId` and returns 404 unless `canViewOrder`. Then `startPayment` either redirects to the provider or redirects back to `/checkout/success/:orderId`. Register it in `app/routes.ts`.
- [ ] **9. Success page.** The loader adds `payment: PaymentView | null` (from `getPaymentView`). For card orders, the component renders a status block using the design tokens (`success`/`success-bg` for paid, `blush` for failed, neutral for pending):
  - **paid:** "Оплачено"
  - **pending:** "Очікуємо підтвердження оплати", with a refresh link
  - **failed:** "Оплата не пройшла", with a `Form method="post" action={`/checkout/pay/${id}`}` button "Спробувати ще раз"

  Pending also shows a "Pay" button, for when the shopper never reached the provider. Change `checkout.payment.cardNote` to online-payment copy ("Оплата карткою онлайн на захищеній сторінці LiqPay"), which also fixes the confirmation email. Add every key to `uk.ts` and `en.ts`. `cod` stays unchanged.
- [ ] **10. Docs.** Add a Payments section to `app/.server/AGENTS.md`: the adapter, the idempotency rule, the never-trust-client-amounts rule and the reference format. Update the Orders bullet "online payment is #44". In the README, add "Card payments (LiqPay)": sandbox keys and `PUBLIC_URL` with a tunnel for local callbacks.
- [ ] **11. Verify.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, then do the manual sandbox run below.

## Testing & verification
- **Unit:**
  - `liqpay.test.ts`: signature, URL, verification, status mapping
  - `env.test.ts`
  - `checkout-success.test.ts`: renders paid, pending and failed; a cod order has no block (Ukrainian by default, plus one English case)
  - `CheckoutForm`: card disabled when unavailable
- **Service/DB integration** (`describe.skipIf(!hasDatabase)`, `createTestDatabase()`), in `services/payments.test.ts`:
  - `startPayment` charges the stored `total_amount`, numbers attempts `42-1`, `42-2`, and refuses cod or paid orders
  - a valid success callback sets `payment_status = 'paid'`, `status = 'paid'` and `paid_at`
  - the same callback again leaves `paid_at` and `updated_at` unchanged
  - an invalid signature changes nothing
  - a failure callback leaves the order `unpaid` and the attempt `failed`, and a retry then succeeds
  - an amount mismatch is ignored
- **Routes:**
  - `payments.callback.test.ts`: 400 on a bad signature, 200 on a valid one
  - `checkout.test.ts`: card redirects to the provider URL with `Set-Cookie`, cod redirects to the success page as before, card without keys returns 400
  - `checkout-pay.test.ts`: 404 for a stranger, redirect for the owner
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **Manual:**
  1. Set the LiqPay sandbox keys and `PUBLIC_URL` (a tunnel, e.g. `cloudflared`), then run `pnpm aspire run`.
  2. Check out by card. You should land on LiqPay with the exact total.
  3. Pay with the sandbox success card. You should return to the success page, which shows paid after a refresh, and the DB row should be paid.
  4. Pay with a failure card. The page should show failed with a retry that opens a new attempt.
  5. Check out with cod. It should go straight to the success page as before.
  6. Remove the keys. The app should boot and the card option should be disabled.

## Acceptance criteria
- [ ] A shopper who chooses card is sent to the provider's payment page for the exact order total — steps 3, 5, 7
- [ ] A verified successful callback marks the order `paid` and sets `paid_at` — steps 4, 5, 6
- [ ] Callbacks with an invalid signature are rejected and change nothing — steps 3, 6
- [ ] Repeated callbacks for the same payment don't change the order twice — steps 4, 5
- [ ] A failed or cancelled payment leaves the order `unpaid`, and the shopper can retry — steps 5, 8, 9
- [ ] Cash-on-delivery checkout works exactly as before — steps 7, 9 (regression tests in `checkout.test.ts`)

## Out of scope
- Refunds, partial payments and `refunded_at`.
- Auto-cancelling unpaid card orders or releasing their stock (Q3).
- Polling the provider's status API, or client-side polling on the success page.
- Admin views of payment attempts (#17).
- A second provider implementation. Only the adapter seam is built.
