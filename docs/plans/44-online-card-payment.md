# Plan: Integrate online card payment provider for checkout orders (#44)

Issue: https://github.com/savchukolgaa/jassmin/issues/44
Branch: `issue/44`
Worktree: `.claude/worktrees/issue-44`
Status: Planned

## Goal
A shopper who pays by card should pay online right after checkout. Then the order is paid and can ship without a separate payment step. Orders with `payment_method = 'card'` go to a hosted payment page. A verified provider callback marks the order `paid`. The success page shows whether the payment is paid, pending or failed, and offers a retry. Cash-on-delivery stays exactly as it is.

For now the only provider is a **local payment simulator**: a fake hosted page served by the app in development. It sends signed callbacks just as a real provider would. Everything goes through a provider adapter, so a real Ukrainian provider (LiqPay, WayForPay or monobank) can be added later without touching checkout, the callback route or the success page.

## Dependencies & prerequisites
- **#11 Checkout** is on `main`: `createOrder` in `app/.server/services/orders.ts`, `routes/checkout.tsx`, `routes/checkout-success.tsx`, `orders.payment_status` / `paid_at` / `status`.
- **#45 Order emails** is on `main`. The confirmation email shows `checkout.payment.cardNote`, so that copy changes (step 10).
- **#18 Analytics** records the `purchase` event in the checkout action. This plan doesn't change it.
- One new env var: `PAYMENT_PROVIDER` (optional, `simulator`).
- One new migration, `0010_payments`, with a hand-written rollback.
- No new npm packages. Signatures use `node:crypto` HMAC-SHA256. No merchant account, tunnel or network access is needed.

## Decisions & assumptions
- **Provider: a local simulator only (Q1, answered).** `PAYMENT_PROVIDER=simulator` turns it on. Real providers are out of scope and will be a follow-up issue.
  - The simulator's shape copies LiqPay's: a hosted-page URL with base64 JSON `data` plus a `signature`, and a callback form-POST with `data` and `signature`. That keeps the eventual swap small.
  - **It never runs in production.** `parseEnv` rejects `PAYMENT_PROVIDER=simulator` when `NODE_ENV=production`, and the simulator route answers 404 unless the simulator is the active provider.
- **Provider adapter.** `app/.server/payments/provider.ts` defines a `PaymentProvider` interface with these members:
  - `name`
  - `createCheckout({ reference, amount, currency, description, resultUrl, callbackUrl, locale }) → { redirectUrl }`
  - `parseCallback(formData) → { ok: true, event: { reference, outcome: "success" | "failure" | "pending", amount, currency, providerPaymentId, raw } } | { ok: false, error: "invalid-signature" | "malformed" }`

  `getPaymentProvider(env)` returns the configured provider, or `null` when `PAYMENT_PROVIDER` isn't set. The service and the routes only see the interface.
- **Simulator signing.** The signature is `base64(HMAC-SHA256(key, data))`, where `key = HMAC-SHA256(SESSION_SECRET, "payment-simulator")`. Deriving the key from `SESSION_SECRET` avoids another secret. The derived key keeps the simulator's signature separate from session-cookie signing. Verification uses `crypto.timingSafeEqual`.
- **Simulator hosted page:** `payments/simulator` (`routes/payments.simulator.tsx`), outside `_shop`.
  - The loader verifies the checkout `data`/`signature` (a bad signature returns 400). It shows the reference, the amount and the currency, plus these buttons:
    - **Pay** (success)
    - **Pay, send callback twice** (to check idempotency by hand)
    - **Decline** (failure)
    - **Return without paying** (no callback, so the payment stays pending)
  - The action is validated with zod (`outcome` plus the original `data`/`signature`, re-verified). For each outcome, it builds a signed callback and POSTs it **over HTTP** with `fetch(callbackUrl)`, so the real callback route is exercised. Then it redirects the browser to `result_url`.
  - The page uses i18n keys (`payments.simulator.*`) like everything else, and has a visible "test mode" banner.
- **A `payments` table records each attempt (Q2, answered).** The columns are `id`, `order_id` (FK, cascade), `provider`, `reference` (unique), `status` (`PAYMENT_ATTEMPT_STATUSES = ["pending", "succeeded", "failed"]`, with a CHECK), `amount numeric(10,2)`, `currency`, `provider_payment_id`, `last_callback jsonb`, `created_at`, `updated_at` and `completed_at`.
  - `provider` has a CHECK over `PAYMENT_PROVIDERS = ["simulator"]`, so adding a real provider later means a migration that rewrites that check, as with `order_emails`.
  - The reference is `${orderId}-${attemptNo}`, for example `42-1`. Real providers need a unique id for every attempt, and the success page needs the latest attempt to tell "failed" from "pending".
- **Amount comes from the server.** `startPayment(orderId)` reads `orders.total_amount` and `currency` from the database. No amount is ever read from a form. A callback is ignored when its amount or currency differs from the stored attempt. In that case the attempt isn't marked succeeded, and an error is logged.
- **Idempotent callback.** One transaction does the following:
  1. It locks the `payments` row by `reference` with `FOR UPDATE`.
  2. If the row is already `succeeded`, it changes nothing.
  3. On `success`, it marks the attempt `succeeded`. Then it runs `UPDATE orders SET payment_status = 'paid', paid_at = now(), status = 'paid' WHERE id = $1 AND payment_status = 'unpaid' AND status = 'pending'`.
  4. On `failure`, it marks the attempt `failed` and leaves the order `unpaid`.
  5. On `pending`, it only stores `last_callback`.

  A repeated callback therefore never updates the order twice. A late success for an order that is no longer `pending` is recorded on the attempt, and a warning is logged. The order isn't touched.
- **Callback route:** `payments/callback` (`routes/payments.callback.ts`). It's action-only and sits outside `_shop`, like `logout` and `consent`, with `loader` redirecting to `/`.
  - An invalid signature or malformed body returns 400 and writes nothing.
  - A verified callback returns 200, even for an unknown reference (logged).
  - The route has no session or consent dependency.
- **Card payment is optional.** Without `PAYMENT_PROVIDER`, the app boots as today. The checkout loader passes `cardPaymentAvailable: false`, and `PaymentMethodField` disables the card option with a note. The action also rejects `card` server-side with the field error `checkout.errors.cardUnavailable`.
- **Checkout redirect.** After `createOrder` succeeds, a `card` order whose `payment_status` is `unpaid` gets `startPayment` and a redirect to the provider URL. The response still sets `rememberOrder` and still runs `deliverOrderConfirmation` and `purchase` for `placed` orders. This also covers `placed: false`, because the browser follows the last submit. `cod` orders keep the current redirect to `/checkout/success/:orderId`. If `startPayment` fails, the shopper goes to the success page, which shows the retry button.
- **Retry route:** `checkout/pay/:orderId` (`routes/checkout-pay.ts`). It's action-only (POST), inside `_shop`. It checks access like the success page (`canViewOrder` with `getUser` and `getSessionOrderIds`). Then it requires a `card` / `unpaid` / `pending` order, creates a new attempt and redirects to the provider. Any other case redirects to the success page.
- **Return URL** is `/checkout/success/:orderId`, reached by GET, so the `sameSite: lax` session cookie keeps the access check working.
- **Success page payment state.** `getPaymentView(orderId)` returns:
  - `"paid"` when `orders.payment_status = 'paid'`
  - `"failed"` when the latest attempt is `failed`
  - `"pending"` otherwise

  `cod` orders get `null` and render exactly as today. In the simulator, the callback finishes before the redirect, so the state is final on return. Pending still shows a "Refresh" link and a "Pay" button, for real providers' delayed callbacks and for "Return without paying".
- **Absolute URLs** (`callbackUrl`, `resultUrl`) come from `new URL(request.url).origin`. The simulator calls back to the same app, so no `PUBLIC_URL` is needed yet. A real provider will add one.
- Status labels and copy are i18n keys in both `uk.ts` and `en.ts`.
- **Failed card orders (Q3, answered)** stay `pending`/`unpaid` with their stock held until an admin cancels them. There's no auto-cancel.

## Resolved questions
- **Q1: Which provider?** For now, a local simulator that needs no merchant account, behind the adapter. A real provider comes in a follow-up. (source: user's answer while planning)
- **Q2: May the plan add a `payments` table?** Yes. (source: user's answer while planning)
- **Q3: What happens to failed card orders?** They're left as they are, with no auto-cancel and the stock still held. (source: user's answer while planning)
- **Where do provider settings go, and must the app boot without them?** In `envSchema`, optional, with `.env.example`, the README table and `env.test.ts`. Without them, card payment is unavailable. (source: #44 Technical, `app/.server/AGENTS.md` → Environment)
- **Which amount is charged?** `orders.total_amount` in `UAH`. It's computed in SQL by `createOrder` and never taken from the client. (source: #44, `app/.server/services/orders.ts`)
- **Where does the callback route go?** Action-only, outside the `_shop` layout, following `logout` / `consent` / `api/events`. (source: #44, `app/routes.ts`)
- **Who may view or retry an order?** The rule from `canViewOrder`. (source: `app/routes/checkout-success.tsx`, `services/orders.ts`)
- **How are `updated_at` and transactions handled?** Through the query builder (`$onUpdate`), with `tx` passed down. (source: `app/.server/AGENTS.md` → Database)
- **Do refunds and partial payments matter here?** No, they're out of scope. (source: #44)
- **Does the `cod` flow change?** No. (source: #44 acceptance criteria)

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | `PAYMENT_ATTEMPT_STATUSES`, `PAYMENT_PROVIDERS = ["simulator"]` |
| modify | `app/lib/commerce.ts` (+ `app/.server/db/schema.test.ts`) | Mirror the `Payment` row type |
| modify | `app/.server/db/schema.ts` | `payments` table |
| create | `app/.server/db/migrations/0010_payments.sql` (+ meta) | Generated by `pnpm db:generate --name payments` |
| create | `app/.server/db/rollbacks/0010_payments.sql` | Drops the table |
| modify | `app/.server/env.ts`, `env.test.ts` | `PAYMENT_PROVIDER` (optional, `simulator`, refused in production) |
| modify | `.env.example`, `README.md` | Document the var and a "Card payments (simulator)" section |
| create | `app/.server/payments/provider.ts` | `PaymentProvider` interface, `getPaymentProvider(env)` |
| create | `app/.server/payments/simulator.ts`, `simulator.test.ts` | Signing, checkout URL, checkout/callback verification, `buildSimulatorCallback` |
| create | `app/.server/db/queries/payments.ts`, `payments.test.ts` | Insert attempt, lock by reference, mark attempt, mark order paid, latest attempt |
| create | `app/.server/services/payments.ts`, `payments.test.ts` | `startPayment`, `handlePaymentCallback`, `getPaymentView`, `isCardPaymentAvailable` |
| modify | `app/lib/checkout.ts` | `PaymentView` type |
| modify | `app/routes/checkout.tsx`, `checkout.test.ts` | Card availability in loader/action, redirect to provider |
| modify | `app/features/checkout/CheckoutForm.tsx` | Disable card when unavailable |
| create | `app/routes/payments.callback.ts`, `payments.callback.test.ts` | Provider webhook |
| create | `app/routes/payments.simulator.tsx`, `payments.simulator.test.ts` | Fake hosted payment page (dev only) |
| create | `app/routes/checkout-pay.ts`, `checkout-pay.test.ts` | Start a new payment attempt (retry) |
| modify | `app/routes.ts` | Register the three routes |
| modify | `app/routes/checkout-success.tsx`, `checkout-success.test.ts` | Show the payment state and the retry button |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | New `checkout.payment.*`, `checkout.success.payment*`, `payments.simulator.*` keys, updated `cardNote` |
| modify | `app/.server/AGENTS.md` | Document payments (Orders section and new Payments section) |

## Steps
- [ ] **1. Schema: `payments` table.** Add `PAYMENT_ATTEMPT_STATUSES` and `PAYMENT_PROVIDERS` to `~/lib/enums`. Add the `payments` table to `db/schema.ts`:
  - CHECKs via `oneOf` for `status` and `provider`, plus `amount >= 0`
  - `unique("payments_reference_unique")`
  - `index("payments_order_id_idx")`
  - `updatedAt()`

  Mirror the row type in `~/lib/commerce` and extend `schema.test.ts`. Run `pnpm db:generate --name payments` and write `rollbacks/0010_payments.sql` (`DROP TABLE payments;`). Check that `pnpm db:migrate` / `pnpm db:rollback` round-trip.
- [ ] **2. Env.** Add an optional `PAYMENT_PROVIDER: z.enum(PAYMENT_PROVIDERS)` (empty = unset) with a refinement that rejects `simulator` when `NODE_ENV=production`. Add `env.test.ts` cases: unset (boots), `simulator` in development, `simulator` in production (error), and an unknown value (error). Update `.env.example` (`PAYMENT_PROVIDER=simulator`, commented) and the README table.
- [ ] **3. Provider adapter and simulator.** Add `payments/provider.ts` with the interface and `getPaymentProvider(env)`. Add `payments/simulator.ts`:
  - `signingKey(sessionSecret)`
  - `sign(data)`
  - `createCheckout`: builds `{ reference, amount, currency, description, result_url, callback_url, locale }`, base64-encodes it, signs it and returns `/payments/simulator?data=…&signature=…`
  - `verifyCheckout(data, signature)`
  - `buildSimulatorCallback(checkout, outcome)`: `{ data, signature }` with `status: "success" | "failure"` and a random `payment_id`
  - `parseCallback`: verifies, decodes and validates with zod, then maps the status to an outcome

  `simulator.test.ts` covers these:
  - a URL that round-trips its data
  - a valid callback accepted
  - a tampered `data` or `signature` rejected
  - a malformed body
  - a key derived from a different secret rejected
- [ ] **4. Payment queries.** Add `db/queries/payments.ts`:
  - `countPayments(tx, orderId)`
  - `insertPayment`
  - `lockPaymentByReference` (`FOR UPDATE`)
  - `markPayment(tx, id, { status, providerPaymentId, lastCallback })`
  - `markOrderPaid(tx, orderId)`: the conditional update, which returns whether a row changed
  - `findLatestPayment(db, orderId)`
  - `findPayableOrder(tx, orderId)` (`FOR UPDATE`)
- [ ] **5. Payments service.** Add `services/payments.ts`, with the provider and db injectable:
  - `startPayment({ orderId, locale, origin })`: in a transaction, it locks the order, checks that it's `card`/`unpaid`/`pending`, inserts the attempt `${orderId}-${n+1}` with the stored total and calls `provider.createCheckout`. It returns `{ ok: true, redirectUrl }` or `{ ok: false, error: "not-payable" | "unavailable" }`.
  - `handlePaymentCallback(formData)`: performs the idempotent transition described under Decisions. It returns `{ ok: false, error: "invalid-signature" | "malformed" }` or `{ ok: true, result: "paid" | "failed" | "pending" | "ignored" }`.
  - `getPaymentView(order)`
  - `isCardPaymentAvailable()`
- [ ] **6. Callback route.** Add `routes/payments.callback.ts`. `action` reads `request.formData()` (a bad body returns 400), calls `handlePaymentCallback` and answers 400 on a failed check or `200 ok` otherwise. `loader` redirects to `/`. Register it in `app/routes.ts` outside `_shop`, with a comment.
- [ ] **7. Simulator page.** Add `routes/payments.simulator.tsx`, outside `_shop`. Every request answers 404 unless the active provider is the simulator.
  - The loader verifies `data`/`signature` from the query (400 if invalid) and returns the reference, the amount (formatted with `formatPrice`) and the result URL.
  - The component uses design tokens and `Button`, with a test-mode banner and the four buttons, each in a `Form method="post"`.
  - The action parses `{ outcome, data, signature }` with zod and re-verifies the checkout. For `success` / `success-twice` / `failure`, it POSTs `buildSimulatorCallback(...)` to `callback_url` with `fetch` (twice for `success-twice`) and logs a non-200 answer. Then it redirects to `result_url`, which must be same-origin, checked with `safeRedirect`.
  - Register the route in `app/routes.ts` with a "dev only" comment.
- [ ] **8. Checkout redirect and card availability.** The loader returns `cardPaymentAvailable`. In the action, `card` without a provider returns a 400 field error `checkout.errors.cardUnavailable`. After a successful `createOrder` for `card`, it calls `startPayment` and redirects to `redirectUrl` with the `rememberOrder` `Set-Cookie`, keeping the email and the `purchase` event for `placed` orders. If the payment can't start, it falls back to the success page. `CheckoutForm` / `PaymentMethodField` takes `cardAvailable` and disables the card radio with the `checkout.payment.cardUnavailable` note.
- [ ] **9. Retry route.** Add `routes/checkout-pay.ts` (POST) at `checkout/pay/:orderId` inside `_shop`. It parses the id with `parseOrderId` and returns 404 unless `canViewOrder`. Then `startPayment` either redirects to the provider or redirects back to `/checkout/success/:orderId`. Register it in `app/routes.ts`.
- [ ] **10. Success page and copy.** The loader adds `payment: PaymentView | null`. For card orders, the component renders a status block using the design tokens (`success`/`success-bg` for paid, `blush` for failed, neutral for pending):
  - **paid:** "Оплачено"
  - **pending:** "Очікуємо підтвердження оплати", with a refresh link and a "Pay" button
  - **failed:** "Оплата не пройшла", with a `Form method="post" action={`/checkout/pay/${id}`}` button "Спробувати ще раз"

  Change `checkout.payment.cardNote` to online-payment copy ("Оплата карткою онлайн одразу після оформлення замовлення"), which also fixes the confirmation email. Add every key to `uk.ts` and `en.ts`. `cod` stays unchanged.
- [ ] **11. Docs.** Add a Payments section to `app/.server/AGENTS.md`: the adapter, the simulator being dev-only, the idempotency rule, the never-trust-client-amounts rule and the reference format. Update the Orders bullet "online payment is #44". In the README, add "Card payments (simulator)": set `PAYMENT_PROVIDER=simulator`, what each button does, and a note that a real provider is a follow-up.
- [ ] **12. Verify.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, then do the manual simulator run below.

## Testing & verification
- **Unit:**
  - `simulator.test.ts`: signing, URL, verification
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
  - `payments.simulator.test.ts`: 404 when the simulator is off, 400 on a tampered checkout, the action posts the callback (`fetch` stubbed) and redirects to the result URL
  - `checkout.test.ts`: card redirects to the provider URL with `Set-Cookie`, cod redirects to the success page as before, card without a provider returns 400
  - `checkout-pay.test.ts`: 404 for a stranger, redirect for the owner
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **Manual** (`PAYMENT_PROVIDER=simulator`, `pnpm aspire run`):
  1. Check out by card. You should land on the simulator showing the exact total.
  2. Click **Pay**. The success page should show paid, and the DB should have `paid_at` set.
  3. On a new order, click **Pay, send callback twice**. The order should be paid once, with `paid_at` unchanged by the second callback.
  4. Click **Decline**. The page should show failed. **Try again** should open attempt `-2`, and Pay should then succeed.
  5. Click **Return without paying**. The page should show pending with a Pay button.
  6. Check out with cod. It should go straight to the success page as before.
  7. Unset `PAYMENT_PROVIDER`. The card option should be disabled and `/payments/simulator` should answer 404.

## Acceptance criteria
- [ ] A shopper who chooses card is sent to the provider's payment page for the exact order total — steps 3, 5, 7, 8
- [ ] A verified successful callback marks the order `paid` and sets `paid_at` — steps 4, 5, 6
- [ ] Callbacks with an invalid signature are rejected and change nothing — steps 3, 6
- [ ] Repeated callbacks for the same payment don't change the order twice — steps 4, 5, 7
- [ ] A failed or cancelled payment leaves the order `unpaid`, and the shopper can retry — steps 5, 9, 10
- [ ] Cash-on-delivery checkout works exactly as before — steps 8, 10 (regression tests in `checkout.test.ts`)

## Out of scope
- A real payment provider (LiqPay / WayForPay / monobank), its credentials and `PUBLIC_URL`. That's a follow-up issue that adds a `PaymentProvider` implementation and a migration extending the `provider` CHECK.
- Refunds, partial payments and `refunded_at`.
- Auto-cancelling unpaid card orders or releasing their stock.
- Polling a provider's status API, or client-side polling on the success page.
- Admin views of payment attempts (#17).
