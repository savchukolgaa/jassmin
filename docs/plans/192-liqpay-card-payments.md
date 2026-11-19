# Plan: Take card payments for orders and gift cards with LiqPay (#192)

Issue: https://github.com/savchukolgaa/jassmin/issues/192
Branch: `issue/192`
Worktree: `.claude/worktrees/issue-192`
Status: Planned

## Goal

Customers can pay for orders and gift cards by card (including Apple Pay and Google Pay) on
LiqPay's hosted payment page instead of only cash on delivery. LiqPay becomes the first real
`PaymentProvider` behind the #44 seam: a pure checkout redirect, a verified server-to-server
callback, sandbox mode for development, the CSP and production settings, and a go-live guide.

## Dependencies & prerequisites

- **#44 card payments** (on `main`): `app/.server/payments/provider.ts`, `simulator.ts`,
  `services/payments.ts`, `routes/payments.callback.ts`, `routes/checkout-pay.ts`. The interface
  needs no change.
- **#125 gift cards** (on `main`): `startGiftCardPayment`, `routes/gift-cards.tsx`,
  `routes/gift-card-success.tsx`.
- **#143 CSP** (on `main`): `app/.server/security-headers.ts` already notes where the provider's
  origin goes (`form-action`).
- **#176 production** (on `main`): `aspire-apphost/production.mts` with secret parameters.
- **#190 (OPEN)**: public offer, delivery/payment and returns pages. LiqPay won't activate the shop
  without them. The code here doesn't depend on #190, but **going live does**: the guide says so,
  and production keeps `PAYMENT_PROVIDER` off until #190 ships and LiqPay approves the shop (see
  Q1).
- No new packages: `node:crypto` (`createHash("sha1")`, `timingSafeEqual`) and zod suffice.
- New env vars: `LIQPAY_PUBLIC_KEY`, `LIQPAY_PRIVATE_KEY`, `LIQPAY_SANDBOX`.
- New migration `0036_liqpay_provider.sql` (next after `0035_product_recommendations.sql`).

## Decisions & assumptions

- **Adapter** `app/.server/payments/liqpay.ts`, `createLiqPay({ publicKey, privateKey, sandbox })`
  returning `PaymentProvider` with `name: "liqpay"`. Signature: `base64(sha1(private + data +
  private))`, compared with `timingSafeEqual` after a length check (same helper shape as the
  simulator).
- **Checkout `data`**: `{ version: 3, public_key, action: "pay", amount, currency, description,
  order_id: reference, result_url, server_url: callbackUrl, language, sandbox?: 1 }`. `amount` is
  sent as a number parsed from the exact decimal string (LiqPay expects a number); `currency` comes
  from the request (always `UAH` today, from the stored row) rather than being hard-coded, so the
  amount/currency check stays meaningful. Redirect:
  `https://www.liqpay.ua/api/3/checkout?data=…&signature=…`.
- **Callback schema** in `app/.server/payments/liqpay.schema.ts` (zod, server-only):
  `public_key`, `order_id`, `status`, `amount` (number or numeric string), `currency`,
  `payment_id` (number or string, optional), `action`, plus `.loose()` for the rest, which is
  stored as `raw`. A callback whose `public_key` isn't ours is `malformed`.
- **Amount normalisation**: LiqPay returns `amount` as a JSON number (`2450` or `2450.5`), while
  `payments.amount` is `"2450.00"`. The adapter converts it to a two-decimal string via
  `fromKopiyky(Math.round(n * 100))` (`app/lib/money.ts`) so the existing strict comparison in
  `handlePaymentCallback` works; a non-finite or negative value is `malformed`.
- **Status mapping** (exported `toOutcome` for tests): `success` → success; `failure`, `error`,
  `reversed` → failure; `processing`, `3ds_verify`, any `wait_*` → pending; anything else is
  `console.warn`ed and pending, never success. `sandbox` status (LiqPay's sandbox success) →
  success **only when the adapter is in sandbox mode**, otherwise pending + warn.
- A `reversed` callback for an attempt that already succeeded is already ignored by
  `handlePaymentCallback` (`payment.status === "succeeded"`), so refunds made in the LiqPay cabinet
  never touch the app (refunds are out of scope).
- **Env** (`app/.server/env.ts`): `PAYMENT_PROVIDERS` in `app/lib/enums.ts` becomes
  `["simulator", "liqpay"]`. `LIQPAY_PUBLIC_KEY` / `LIQPAY_PRIVATE_KEY` optional strings (empty →
  unset), `LIQPAY_SANDBOX` `z.stringbool().optional()`. Refines:
  - `liqpay` without both keys fails with a clear message on `LIQPAY_PUBLIC_KEY` /
    `LIQPAY_PRIVATE_KEY`;
  - effective sandbox = `LIQPAY_SANDBOX ?? NODE_ENV !== "production"`, exposed as a helper
    `isLiqPaySandbox(env)` so production is live unless `LIQPAY_SANDBOX=true` is set on purpose
    (staging). Production with `LIQPAY_SANDBOX=true` is allowed but logs a startup warning.
- **`getPaymentProvider`** takes `Pick<Env, "PAYMENT_PROVIDER" | "SESSION_SECRET" |
  "LIQPAY_PUBLIC_KEY" | "LIQPAY_PRIVATE_KEY" | "LIQPAY_SANDBOX" | "NODE_ENV">` and gets a
  `case "liqpay"`; the switch stays exhaustive.
- **Callback and return URLs use `getSiteUrl(getEnv(), request)`** instead of
  `new URL(request.url).origin` in `routes/checkout.tsx`, `routes/checkout-pay.ts` and
  `routes/gift-cards.tsx`. Behind the production proxy `request.url` can be `http://` or an
  internal host; LiqPay must get the public `https://` `server_url`. Outside production
  `getSiteUrl` still falls back to the request origin, so the simulator is unaffected.
- **LiqPay returns the shopper to `result_url` with a POST** (form with `data`/`signature`) in
  some flows. `routes/checkout-success.tsx` and `routes/gift-card-success.tsx` get a minimal
  `action` that ignores the body and `redirect`s (303) to the same URL, so the shopper lands on the
  GET page and the `SameSite=Lax` session cookie (`app/.server/session.ts`) is sent again, which
  `canViewOrder` / `canViewGiftCard` need. The callback stays the only thing that marks anything
  paid. **(verify in the sandbox; drop the action if LiqPay only GETs)**
- **Migration** `0036_liqpay_provider.sql`: drop and re-add `payments_provider_check` with
  `('simulator', 'liqpay')`, generated with drizzle-kit from `schema.ts` (which already uses
  `oneOf(t.provider, PAYMENT_PROVIDERS)`), plus the updated `schema.test.ts` expectation if it
  lists values.
- **CSP**: `form-action 'self' https://www.liqpay.ua` in `buildCsp` (the redirect after the
  checkout form POST). No `frame-src`/`script-src` change: we use the redirect, not LiqPay's
  embedded widget.
- **Copy** (uk source of truth, en): `checkout.payment.cardNote` names card, Apple Pay and Google
  Pay and says the payment page is LiqPay's (PrivatBank); the gift cards page's `steps.buy` says
  the same; `privacy.sharing` gets a `payments` sentence naming LiqPay as the processor of card
  data (the shop never sees card numbers). The copy is provider-specific, so it's shown only when
  the provider is `liqpay`: the loaders pass the provider name (or a boolean) and the simulator
  keeps today's generic text. **(unconfirmed, see Q3)**
- **Simulator** stays as is for offline development and tests; `docs/setup.md` documents both.

## Open questions

- [ ] **Q1: Should this PR switch production to `PAYMENT_PROVIDER=liqpay`, or only wire the
  secrets and leave card payment off until #190 ships and LiqPay approves the shop?** — Why it
  matters: a deploy with `liqpay` but no approved merchant account shows customers a LiqPay error
  page, and the deploy prompts for keys that don't exist yet. Recommended default: add
  `liqpay-public-key` / `liqpay-private-key` secret parameters and `LIQPAY_SANDBOX=false`, but
  gate `PAYMENT_PROVIDER=liqpay` behind a `card-payments` parameter (`off` by default →
  `PAYMENT_PROVIDER` unset), documented as the go-live switch. Affects steps: 8, 9.
- [ ] **Q2: Duplicate `order_id`s in LiqPay.** References are `<order id>-<attempt>`, so a reset
  development database, or a staging server sharing the account, reuses `1-1`, which LiqPay
  rejects as a duplicate order. Why it matters: sandbox testing breaks after a DB reset.
  Recommended default: optional `LIQPAY_ORDER_PREFIX` (e.g. `dev-olga-`); the adapter prepends it
  to `order_id` and strips it in `parseCallback` (a callback without it is `malformed`).
  Production leaves it empty, so its order ids stay the plain references. Affects steps: 2, 4.
- [ ] **Q3: Provider-specific copy.** Show "card, Apple Pay, Google Pay on LiqPay's page" only
  when LiqPay is the provider (recommended, keeps the simulator honest), or always? Affects
  step: 7.
- [ ] **Q4: Local callbacks.** LiqPay's sandbox POSTs `server_url` from the internet, so on
  `localhost` the callback never arrives and orders stay pending. Recommended default: document a
  tunnel (`cloudflared tunnel --url http://localhost:<port>`) and setting `PUBLIC_SITE_URL` to the
  tunnel URL for sandbox testing; no code for it. Affects step: 9.

## Resolved questions

- **Does the `PaymentProvider` interface need changing?** — No: `createCheckout` is pure and
  `parseCallback(form)` gets the `data`/`signature` form (source:
  `app/.server/payments/provider.ts`, issue Context).
- **Are idempotency and the amount/currency check already handled?** — Yes, in
  `handlePaymentCallback` (row lock, ignores succeeded attempts, strict amount/currency compare,
  `markOrderPaid` only for `pending`/`unpaid`) (source: `app/.server/services/payments.ts`,
  `app/.server/AGENTS.md` → Payments). The adapter only has to normalise the amount format.
- **Can a failed payment be retried?** — Yes, a failed attempt leaves the order `unpaid`; the
  success page's "Try again" (`routes/checkout-pay.ts`) and the gift card page start new attempts
  (source: `services/payments.ts`, `routes/gift-card-success.tsx`).
- **Where does the provider name go in the DB?** — `payments.provider`, constrained by
  `payments_provider_check` from `PAYMENT_PROVIDERS` (source: `app/.server/db/schema.ts:719`,
  `migrations/0010_payments.sql`).
- **Which CSP directive?** — `form-action`; Chrome checks it on the redirect after a form POST
  (source: `app/.server/security-headers.ts:45`, `docs/security.md:50`).
- **Public URL for the callback** — `getSiteUrl(env, request)` already exists and uses the required
  production `PUBLIC_SITE_URL` (source: `app/.server/env.ts:231`, `app/.server/AGENTS.md` notes a
  real provider "probably" needs it).
- **How are production secrets declared?** — `builder.addParameter("<name>", { secret: true })`
  and passed with `.withEnvironment` in the shared `web`/`scheduler` loop (source:
  `aspire-apphost/production.mts:66-160`, `aspire-apphost/AGENTS.md`).
- **Refunds** — made in the LiqPay cabinet, then staff set the order to `refunded` in Strapi,
  which already has that payment status (source: `cms/src/api/order/content-types/order/schema.json`,
  `cms/src/utils/app-sync.ts`). Only documented here.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | `PAYMENT_PROVIDERS = ["simulator", "liqpay"]` |
| create | `app/.server/db/migrations/0036_liqpay_provider.sql` (+ `meta/`) | extend `payments_provider_check` |
| modify | `app/.server/db/schema.test.ts` | expected check values, if listed |
| create | `app/.server/payments/liqpay.schema.ts` | zod schema of the decoded callback `data` |
| create | `app/.server/payments/liqpay.ts` | `createLiqPay`, `sign`, `toOutcome` |
| create | `app/.server/payments/liqpay.test.ts` | signature vector, checkout URL, statuses, bad input |
| modify | `app/.server/payments/provider.ts` | `case "liqpay"`, wider `Pick`, header comment |
| modify | `app/.server/env.ts`, `env.test.ts` | LiqPay vars, refines, `isLiqPaySandbox` |
| modify | `app/.server/services/payments.test.ts` (or new `payments.liqpay.test.ts`) | order + gift card end to end with the adapter |
| modify | `app/routes/checkout.tsx`, `checkout-pay.ts`, `gift-cards.tsx` | `getSiteUrl` for return/callback URLs |
| modify | `app/routes/checkout-success.tsx`, `gift-card-success.tsx` (+ tests) | POST → 303 GET for LiqPay's return |
| modify | `app/.server/security-headers.ts`, `security-headers.test.ts` | `form-action` LiqPay origin |
| modify | `app/lib/i18n/uk.ts`, `en.ts` | checkout, gift card and privacy copy |
| modify | checkout payment UI in `app/features/checkout/`, `routes/gift-cards.tsx`, `routes/privacy.tsx` | show the LiqPay copy when it's the provider |
| modify | `aspire-apphost/production.mts`, `aspire-apphost/AGENTS.md` | secret parameters, `LIQPAY_SANDBOX`, go-live switch |
| create | `docs/payments.md` | card payments / go-live guide |
| modify | `docs/setup.md`, `docs/deploy.md`, `docs/security.md`, `app/.server/AGENTS.md`, `AGENTS.md` | env table, links, CSP, provider notes |

## Steps

- [ ] **1. Provider enum and migration** — Add `"liqpay"` to `PAYMENT_PROVIDERS`; run
  `pnpm db:generate` (drizzle-kit) to produce `0036_liqpay_provider.sql` that drops and re-adds
  `payments_provider_check` with both values; update `schema.test.ts` if it lists them. Update the
  `env.test.ts` case that expects `liqpay` to be refused (it becomes "requires keys"). Check:
  `pnpm typecheck` (the `getPaymentProvider` switch now fails exhaustiveness → fixed in step 3).
- [ ] **2. Callback schema and adapter** — `liqpay.schema.ts` (callback fields above, loose).
  `liqpay.ts`: `sign(privateKey, data)`, `encode(payload)`, constant-time `hasValidSignature`,
  `decode`, `toOutcome(status, { sandbox })`, `normaliseAmount`, and `createLiqPay` with
  `createCheckout` / `parseCallback` (missing fields → `malformed`, bad signature →
  `invalid-signature`, wrong `public_key` or schema failure → `malformed`, never throws; wrap the
  body in try/catch as a backstop). `raw` = the decoded payload. `providerPaymentId` =
  `String(payment_id)` or `null`. Include the Q2 prefix if confirmed.
- [ ] **3. Wire the provider** — `getPaymentProvider` gets `case "liqpay"` (keys are guaranteed by
  `parseEnv`; narrow with a guard that throws a clear error if not, for type-safety);
  `getSimulator` unchanged. Update the header comment and `services/payments.ts`'s `PaymentDeps`
  doc comment.
- [ ] **4. Env rules** — `LIQPAY_PUBLIC_KEY`, `LIQPAY_PRIVATE_KEY` (`z.string().min(1).optional()`),
  `LIQPAY_SANDBOX` (`z.stringbool().optional()`), (Q2: `LIQPAY_ORDER_PREFIX`), empty → unset in
  `parseEnv`. Refine: `PAYMENT_PROVIDER === "liqpay"` requires both keys (message names them).
  Export `isLiqPaySandbox(env)`. Warn once at startup in production when sandbox is on. Tests in
  `env.test.ts`: missing keys, defaults per `NODE_ENV`, explicit `LIQPAY_SANDBOX=true` in
  production accepted, `false` in development accepted.
- [ ] **5. Public URLs and the POST return** — Replace `new URL(request.url).origin` with
  `getSiteUrl(getEnv(), request)` in the three routes. Add an `action` to `checkout-success.tsx`
  and `gift-card-success.tsx` that returns `redirect(new URL(request.url).pathname, 303)` (no
  body parsing, no state change); route tests for it.
- [ ] **6. CSP** — `["form-action", "'self'", LIQPAY_ORIGIN]` with `LIQPAY_ORIGIN =
  "https://www.liqpay.ua"` exported from `payments/liqpay.ts` (or a constant in
  `security-headers.ts`, to keep the middleware free of payment imports); update
  `security-headers.test.ts` and the policy line in `docs/security.md`.
- [ ] **7. Copy** — uk/en keys: `checkout.payment.cardNoteLiqPay`, `giftCards.steps.buyLiqPay` (or
  a `{provider}`-free sentence, per Q3), `privacy.sharing.payments`. Loaders of `/checkout`,
  `/podarunkovi-kartky` and `/privacy` return `cardProvider: provider?.name ?? null` (or
  `isLiqPay`), and the components pick the text. Component tests for both providers, uk and en.
- [ ] **8. Production config** — In `production.mts`: `liqpay-public-key` and
  `liqpay-private-key` secret parameters, `LIQPAY_SANDBOX=false`, and `PAYMENT_PROVIDER` per Q1
  (default: a `card-payments` parameter, `liqpay` only when set to `on`). Update the comment that
  says there is no provider, and `aspire-apphost/AGENTS.md`'s environment list.
- [ ] **9. Documentation** — New `docs/payments.md`: how card payments flow (attempts, callback,
  idempotency); opening the LiqPay account for the ФОП and what it checks (#190 pages, seller
  details); sandbox keys, `LIQPAY_SANDBOX`, LiqPay's sandbox test cards (link to their docs page),
  the tunnel for local callbacks (Q4); the callback URL `https://<site>/payments/callback` and the
  result URLs; switching to live keys and turning payments on in production; refunds in the LiqPay
  cabinet and then `refunded` in Strapi; the ПРРО question for the accountant (LiqPay ПРРО or
  Checkbox, a separate issue). Link it from `docs/deploy.md` (replace "card payments stay off…"),
  `docs/setup.md` (env table rows for the three vars, `PAYMENT_PROVIDER` now `simulator` or
  `liqpay`), `app/.server/AGENTS.md` → Payments (LiqPay notes), and `AGENTS.md` if useful.
- [ ] **10. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; then a sandbox
  run (step list under Testing).

## Testing & verification

- `liqpay.test.ts`:
  - `sign` against LiqPay's documented example (private key + `data` from their API docs / official
    SDK README), and our own fixed vector;
  - `createCheckout` URL: host/path, `data` decodes to every expected field (`version`,
    `public_key`, `action`, `amount` as a number, `currency`, `description`, `order_id`,
    `result_url`, `server_url`, `language` `uk`/`en`, `sandbox: 1` only in sandbox), and the
    signature verifies;
  - each status → outcome, including `wait_secure`, `3ds_verify`, an unknown status (warns,
    pending), and `sandbox` in live vs. sandbox mode;
  - wrong signature, missing fields, non-base64/non-JSON `data`, wrong `public_key`, schema
    failure → the right error, never a throw; amount `2450` → `"2450.00"`, `2450.5` → `"2450.50"`.
- Payments service with the real adapter and the test DB (like the existing #44/#125 tests): an
  order and a gift card paid through a signed LiqPay callback; a repeated callback changes nothing;
  a mismatched amount or currency and a forged signature mark nothing paid; `failure` leaves the
  order `unpaid` and a new attempt can start.
- `env.test.ts`, `security-headers.test.ts`, success-route POST tests, copy tests per provider.
- Manual (sandbox): with `PAYMENT_PROVIDER=liqpay`, sandbox keys, a tunnel and `PUBLIC_SITE_URL`
  set to it: place a card order → LiqPay page → pay with a test card → back on the success page,
  order `paid` in the DB and Strapi; fail with a declining test card → "Try again" works; buy a gift
  card → code email queued; CSP in `enforce` mode doesn't block the redirect.

## Acceptance criteria

- [ ] With `PAYMENT_PROVIDER=liqpay` and sandbox keys, a customer can pay an order by card on
  LiqPay's page, and the order becomes paid through the signed callback — steps 1–5, 10
- [ ] Gift cards can be bought by card the same way — steps 2–5, 10
- [ ] Forged, malformed or mismatched callbacks never mark anything paid, and repeated callbacks
  change nothing twice — step 2 (tests), existing `handlePaymentCallback`
- [ ] Failed and cancelled payments leave the order unpaid, and the customer can try again —
  step 2 (status mapping), step 5 (return to the success page)
- [ ] The CSP allows the LiqPay redirect, and production config takes the keys as secrets —
  steps 6, 8
- [ ] The setup guide explains the account, sandbox testing, the callback URL, going live, refunds
  and the ПРРО question — step 9
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 10

## Out of scope

- Refunds from the app (done in the LiqPay cabinet; staff then mark the order `refunded` in
  Strapi), subscriptions, saved cards.
- A second provider (Monobank acquiring).
- Fiscal receipts (ПРРО): only documented as a question for the accountant.
- LiqPay's embedded widget (`checkout.js`); we use the hosted redirect only.
- The #190 legal pages themselves.
