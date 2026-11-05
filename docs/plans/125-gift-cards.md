# Plan: Sell gift cards of 500, 1000 and 2000 ₴ and accept them at checkout (#125)

Issue: https://github.com/savchukolgaa/jassmin/issues/125
Branch: `issue/125`
Worktree: `.claude/worktrees/issue-125`
Status: Planned

## Goal

A customer can buy a Jassmin gift card of 500, 1000 or 2000 ₴ online, paid by card. When the
payment succeeds, the card is activated and the buyer gets its unique code by email. Whoever holds
the code enters it at checkout, and its balance comes off what they pay (after discounts and
delivery), across as many orders as it takes, for 12 months. Staff can see cards and balances in
Strapi (read-only), and buyers can see them on `/account`.

## Dependencies & prerequisites

- Checkout (#11), card payments with the `simulator` provider (#44), discounts (#59), the order
  email outbox (#45), the Strapi sync (#40) and the account page (#12) are all on `origin/main`.
- #124 (couple offer, migration 0022) is merged, so the next migration is **0023**.
- **#126** (offers page copy) is planned in parallel and links to this issue's page through the
  page key `giftCards` (agreed: uk `podarunkovi-kartky`, en `gift-cards`). #126 owns the offers
  copy, the `gifts-by-budget` → `gift-cards` offer and the offers fixtures: this issue **doesn't
  touch the Strapi offers seed or `offers*.json`**. A CTA of `/podarunkovi-kartky` in Strapi becomes
  `/en/gift-cards` in English through `translatePath` (`~/lib/links`, #84), so #126 needs nothing
  more from here than the path table entry.
- No new packages and no new env vars. One Drizzle migration with a hand-written rollback. One new
  Strapi content type (`gift-card`) and one new field on `order`; regenerate
  `cms/types/generated/contentTypes.d.ts`.
- Card payment needs `PAYMENT_PROVIDER=simulator` locally; without a provider the gift card page
  says buying is unavailable.

## Decisions & assumptions

**Data model**

- **Gift cards are not orders and never enter a cart.** A purchase is a `gift_cards` row paid by
  its own `payments` attempts. That satisfies "can't share a cart with perfumes" by construction,
  keeps gift card sales out of `orders` / `order_items` revenue (the issue's analytics rule), and
  avoids fake shipping addresses. No `purchase` event is recorded for a gift card purchase.
- `gift_cards`: `id`, `code` (`varchar(16)`, unique `gift_cards_code_unique`), `initial_amount`
  and `balance` (`numeric(10, 2)`), `currency` (`UAH`), `status` (`GIFT_CARD_STATUSES`: `pending`
  | `active` | `used_up` | `expired`, CHECK), `buyer_user_id` (FK `users`, `on delete restrict`,
  like orders), `buyer_email`, `locale` (the purchase language, for the email), `payment_id` (FK
  `payments`, `set null`: the attempt that paid it), `activated_at`, `expires_at` (set on
  activation: `activated_at + 12 months`), `created_at`, `updated_at`. CHECKs:
  `initial_amount in (500, 1000, 2000)`, `0 <= balance <= initial_amount`, and
  `status = 'pending' or expires_at is not null`. `balance` starts at `initial_amount`; `status`
  alone keeps a pending card unusable. Plus an optional `recipient_email` (`varchar(255)`,
  nullable): the person the buyer is giving the card to (Q4).
- `gift_card_redemptions`: `id`, `gift_card_id` (FK, restrict), `order_id` (FK `orders`, cascade),
  `amount` (`numeric(10, 2)`, CHECK `> 0`), `created_at`, unique `(gift_card_id, order_id)`.
- `orders.gift_card_amount` (`numeric(10, 2)`, default `0`), included in `orders_amounts_check`.
  **`total_amount` becomes the amount to pay:** `subtotal − discount + shipping − gift_card_amount`.
  `free_shipping` stays `subtotal − discount ≥ FREE_SHIPPING_THRESHOLD`, so the gift card never
  changes the threshold. Revenue analyses use `total_amount + gift_card_amount`; this is noted in
  `app/.server/AGENTS.md`.
- `carts.gift_card_id` (FK, `on delete set null`): the card applied at checkout, like
  `carts.discount_id` for promo codes. That way the checkout summary shows the deduction across
  reloads, and `createOrder` reads it from the locked cart.
- `payments.order_id` becomes nullable and gains `payments.gift_card_id` (FK, cascade), with CHECK
  `payments_target_check` (exactly one is set). A gift card attempt's reference is
  `G<gift card id>-<attempt>`, so it can never clash with an order's `<order id>-<attempt>`.
- `order_emails` is reused for the code email (the issue says to reuse the order-email service):
  `order_id` becomes nullable, plus `gift_card_id` (FK, cascade), CHECK `order_emails_target_check`
  (exactly one), unique `order_emails_gift_card_id_type_unique`, and `ORDER_EMAIL_TYPES` gains
  `gift_card` (to the buyer) and `gift_card_recipient` (to the recipient, only when one was given)
  (rewrite `order_emails_type_check`).
- **New payment method `gift_card` (Q1).** `PAYMENT_METHODS` becomes `card` | `cod` |
  `gift_card`, and migration 0023 rewrites `orders_payment_method_check`. Shoppers never choose
  it: a separate `SELECTABLE_PAYMENT_METHODS = ["card", "cod"]` feeds the checkout radios and the
  zod enum, and the server sets `gift_card` itself when the card covers the whole order. Partly
  covered orders keep the chosen `card` / `cod` for the rest. Strapi's order `paymentMethod` enum
  gains `gift_card`, and `PAYMENT_KEYS` gains its label and note.
- `CMS_SYNC_ENTITIES` gains `gift_card` (rewrite `cms_outbox_entity_check`).

**Codes**

- 16 characters drawn with `crypto.randomInt` from a 32-symbol alphabet without look-alikes
  (`ABCDEFGHJKMNPQRSTVWXYZ23456789` plus two more, Crockford-style, no `0/O/1/I/L`), so 80 random
  bits: not guessable. Stored without separators and shown as `XXXX-XXXX-XXXX-XXXX`.
  `normalizeGiftCardCode` (uppercase, remove spaces and dashes) runs before every lookup. A clash
  on the unique index (`23505`) retries with a new code.
- Code attempts at checkout count against a new `giftCardCodeLimiter` (10 per client per 15
  minutes, like `promoCodeLimiter`), so codes can't be brute-forced.
- The code is generated when the card is created, but it only works and is only shown once the
  card is `active`.

**Purchase and payment**

- The gift card page (`giftCards`) has a form with the three amounts (radio), the buyer's email
  (pre-filled for a logged-in user) and an **optional "Recipient's email"** field (Q4). It's
  always on the form, but it can stay blank. When it's filled, the code is also sent to that
  address once the payment succeeds. The buyer always gets their own email with the code, which
  says whether a copy went to the recipient. The recipient's email shows the amount, the code, the
  expiry date and how to use it. It doesn't show the buyer's address or any free text, so nothing
  user-typed ends up in it apart from the address it's sent to. A recipient email that equals the
  buyer's is stored as `null`, so nobody gets the same email twice. Its action is zod-validated (`app/lib/gift-cards.schema.ts`),
  refuses when no payment provider is configured (there's no cash on delivery here at all),
  creates a `pending` card, remembers its id in the cookie session (`SessionData.giftCardIds`,
  like `orderIds`) and sends the buyer to the provider.
- `startPayment` is generalised into a shared attempt starter (target `order` or `giftCard`) and a
  new `startGiftCardPayment`. The amount is always the card's stored `initial_amount`, never the
  request's.
- `handlePaymentCallback`: an attempt with `gift_card_id` runs `activateGiftCard` (only while the
  card is `pending`: `status = active`, `activated_at`, `expires_at`, `payment_id`), queues the
  `gift_card` email (plus `gift_card_recipient` when there's a recipient) and the Strapi sync in
  the same transaction, and returns
  `{ result: "paid", giftCardId }`. The callback route then calls `void deliverGiftCardEmail(id)`
  and `void pushToCms()`. A failed attempt leaves the card `pending`; its page offers "Try again".
- A new page `giftCardSuccess` (uk `podarunkovi-kartky/uspikh/:giftCardId`, en
  `gift-cards/success/:giftCardId`, not indexable) is the provider's return URL. Only the buyer's
  user or the browser that bought it may see it (404 otherwise). It shows `pending` / `failed` with
  a "Pay" / "Try again" button (a POST to the same route's action), or, once active, the amount,
  the code and the expiry date.

**Redemption**

- The checkout page gets a gift card form next to the summary (outside `CheckoutForm`, since forms
  can't nest), with the intents `apply-gift-card` and `remove-gift-card` on the `/checkout`
  action. Applying checks the card (`unknown`, `not-active` for a pending card, `expired`,
  `used-up`) and stores it on the cart only when it's usable. Otherwise the action returns a
  translated error key and writes nothing.
- The amount taken is `min(balance, subtotal − discount + shipping)` in whole kopiyky
  (`~/lib/money`). Any rest stays on the card.
- `createOrder`, in its existing transaction after `priceAndRedeem`: lock the cart's gift card
  `FOR UPDATE` (after the cart and variant locks, so the lock order is the same everywhere), check
  it again against `now`, take the amount, insert the redemption, lower the balance (and set
  `used_up` at 0), and store `gift_card_amount` on the order. A second order racing for the same
  card waits for the lock, sees the lower balance, and gets `total-changed` through the existing
  `expectedTotal` check. That covers "two orders can't spend more than the balance". The
  `balance >= 0` CHECK is the backstop.
- **A card that covers the whole order:** `total_amount = 0`, `payment_method = 'gift_card'`
  (Q1), and the order is inserted `paid` / `paid` with `paid_at`. `isPayable` only accepts `card`,
  so there's no provider redirect and the action goes straight to the success page. If the
  shopper's form showed something still to pay but the order comes out at 0 (it can't come out
  higher, because of `expectedTotal`), the server switches to `gift_card` too. If an order was
  shown as fully covered but would now cost something, it's `total-changed`.
  `nextOrderState` (`~/lib/order-status`) needs no new rule: a `gift_card` order is already paid,
  so `card-not-paid` and "completing COD marks paid" don't apply. A test pins that.
- **Cancellation (Q2):** when an order moves to `cancelled` / `unclaimed` (where stock goes back,
  `next.restock`), `applyCmsOrderChange` adds each redemption back to the card's balance in the
  same transaction and sets `gift_card_redemptions.reversed_at`. A `used_up` card becomes `active`
  again; an expired card stays `expired`. The card is queued for Strapi. `returned` doesn't
  restore it, like stock.
- Expiry: every check compares `expires_at` with `now`, so correctness never depends on a job.
  `pnpm db:expire-gift-cards` (like `db:mark-abandoned-carts`) marks expired active cards
  `expired` and queues them for Strapi, so Strapi and analytics show the right status.

**Display**

- `OrderSummary` gets an optional `giftCardAmount` row ("Gift card −X"), and the total row reads
  "To pay" when a card was used. It's used on checkout, the success page and the account order
  page. The confirmation email gets the same line.
- `/account` gets a "Gift cards" section listing the cards the user bought: amount, balance,
  status, expiry, the recipient's email when there is one, and the code for non-pending cards
  (Q3). The gift card's result page shows the code once it's active (Q3). Both pages are limited
  to the buyer (user id or this browser's session). A pending card links to its page to pay.
- Strapi: a read-only `gift-card` collection type (the app pushes it with the sync token, and staff
  can't create, edit, delete or clone it), plus `giftCardAmount` on `order`.
- No header or menu link: the offers page (#126) links to the gift card page.
- The UI is built from the Option C+ tokens and components (`docs/design.md`). No canvas page
  exists for gift cards, like cart and checkout. The card visual reuses the shop's generic bottle
  photo / label styling, not a new image (memory: shop bottle photos are generic).

**Implementation notes (deviations from the first draft)**

- The code alphabet is Crockford's base 32 (`0–9`, `A–Z` without `I`, `L`, `O`, `U`), still 80
  bits in 16 symbols. `normalizeGiftCardCode` reads a typed `O` as `0` and `I` / `L` as `1`, so
  look-alikes can't cause a wrong-code error.
- All gift card copy (`giftCards`, `checkout.giftCard`, `giftCardEmail`, `giftCardRecipientEmail`,
  `account.giftCards`, `payments.giftCardDescription`, `checkout.payment.giftCard*`) was added in
  step 1, because the typed keys in `~/lib/gift-cards` need it. Step 13 only adjusts it.
- `ORDER_EMAIL_TYPES` and `CMS_SYNC_ENTITIES` gain their values in the steps that handle them
  (6 and 11), so every commit typechecks.
- `robots.ts` blocks a private page with parameters from its static prefix
  (`/podarunkovi-kartky/uspikh`), since `giftCardSuccess` has no private parent page.

## Resolved questions

Answered by the owner on 2026-11-05:

- **Q1: Which `payment_method` does an order fully paid by a gift card store?** — A new
  `gift_card` method (migration rewrites `orders_payment_method_check`; Strapi enum and labels
  updated; shoppers can't pick it). Steps 1, 2, 7, 8, 11.
- **Q2: Does a cancelled or unclaimed order give the gift card amount back?** — Yes, the
  default: restored where stock is restored, with `reversed_at` on the redemption; not on
  `returned`. Steps 2, 3, 11.
- **Q3: May the code be shown on the result page and `/account` too?** — Yes, for non-pending
  cards, only to the buyer. Steps 9, 10.
- **Q4: Recipient?** — An optional recipient email is always offered on the purchase form; when
  given, the recipient also gets the code by email. Steps 2, 5, 6, 9.

From the codebase and issues:

- **Page key and paths?** — `giftCards`: uk `podarunkovi-kartky`, en `gift-cards`, indexable, in
  `app/lib/paths.ts`. Agreed with #126 (source: the user's instruction for this plan).
- **Does this issue change the offers page or its seed?** — No. #126 owns the offers copy, the
  Strapi offers seed and the fixtures (source: the user's instruction; #126 Technical).
- **Is a gift card an order or a cart line?** — Neither. It's bought "in its own order" with card
  only, has no delivery and isn't product revenue, so it's its own table paid through `payments`
  (source: #125 Assumptions; `payments` / `orders` in `app/.server/db/schema.ts`).
- **Is the gift card a discount?** — No, it's a means of payment applied after `priceCart`. It
  doesn't touch `discounts`, `redemption_count` or the free-delivery rule (source: #125 Context;
  `app/.server/AGENTS.md` → Orders, Discounts).
- **How is delivery counted?** — `shipping_amount` is always `0` (the recipient pays Nova
  Poshta), so "after delivery" means the card covers at most `subtotal − discount` (source:
  `app/.server/AGENTS.md` → Orders; `insertOrder` in `db/queries/orders.ts`).
- **How are emails sent?** — Through the `order_emails` outbox and `deliverOrderEmails`, extended
  with a `gift_card` type, so `pnpm db:send-order-emails` retries them too (source:
  `services/order-email.ts`, #125 Technical).
- **How do staff see the cards?** — A push-only Strapi type like `order`, synced through
  `cms_outbox` / `deliverCmsSync`, with admin writes refused in `cms/src/sync/middleware.ts`
  (source: #40; `services/cms-push.ts`).
- **Does the gift card page go in the sitemap?** — Yes, it's indexable, so it joins
  `SITEMAP_PAGES`. `giftCardSuccess` joins `ROBOTS_PRIVATE_PAGES`. Tests check both lists against
  the path table (source: `services/sitemap.ts`, `seo/robots.ts`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/paths.ts` | `giftCards`, `giftCardSuccess` page keys |
| modify | `app/routes.ts` | Register both pages |
| create | `app/routes/gift-cards.tsx` (+ `.test.ts`) | Purchase page: loader and buy action |
| create | `app/routes/gift-card-success.tsx` (+ `.test.ts`) | Status/code page; "Pay"/"Try again" action |
| create | `app/lib/gift-cards.ts` (+ `.test.ts`) | `GIFT_CARD_AMOUNTS`, validity, `formatGiftCardCode`, `normalizeGiftCardCode`, DTO types, error keys |
| create | `app/lib/gift-cards.schema.ts` | zod: purchase form, apply-code form |
| modify | `app/lib/enums.ts` | `GIFT_CARD_STATUSES`; `PAYMENT_METHODS` + `gift_card`, `SELECTABLE_PAYMENT_METHODS`; `ORDER_EMAIL_TYPES` + `gift_card`, `gift_card_recipient`; `CMS_SYNC_ENTITIES` + `gift_card` |
| modify | `app/lib/commerce.ts` | `GiftCard`, `GiftCardRedemption` row types; `Payment.orderId` nullable + `giftCardId`; `Order.giftCardAmount` |
| modify | `app/.server/db/schema.ts` (+ `schema.test.ts`) | New tables and columns, checks |
| create | `app/.server/db/migrations/0023_gift_cards.sql` (+ `meta/`) | Generated migration |
| create | `app/.server/db/rollbacks/0023_gift_cards.sql` | Hand-written reverse |
| create | `app/.server/db/queries/gift-cards.ts` (+ `.test.ts`) | Insert, find by code, lock, activate, redeem, list by user, expire, sync state |
| create | `app/.server/services/gift-cards.ts` (+ `.test.ts`) | `createGiftCard`, `checkGiftCardForCart`, apply/remove on cart, `giftCardAmountFor`, views, `deliverGiftCardEmail` |
| create | `app/.server/db/expire-gift-cards.ts` (+ `.test.ts`), `db/scripts/expire-gift-cards.ts` | Expiry job |
| modify | `package.json` | `db:expire-gift-cards` script |
| modify | `app/.server/db/queries/payments.ts`, `services/payments.ts` (+ tests) | Gift card attempts, activation on callback |
| modify | `app/routes/payments.callback.ts` (+ test) | Deliver the code email after a gift card is paid |
| modify | `app/.server/db/queries/order-emails.ts`, `services/order-email.ts` (+ tests) | `gift_card` email type and builder |
| modify | `app/.server/db/queries/orders.ts`, `services/orders.ts` (+ tests) | `gift_card_amount`, redemption in `createOrder`, fully-paid orders, confirmation and account DTOs |
| modify | `app/.server/db/queries/cart.ts`, `services/cart.ts` (+ tests) | `carts.gift_card_id` set/clear; `mergeGuestCart` carries it |
| modify | `app/.server/rate-limit.ts` | `giftCardCodeLimiter` |
| modify | `app/.server/session.ts` (+ test) | `giftCardIds`, `rememberGiftCard`, `getSessionGiftCardIds` |
| modify | `app/routes/checkout.tsx` (+ test) | Gift card intents, loader preview, `expectedTotal` after the card |
| modify | `app/lib/checkout.ts`, `app/lib/checkout.schema.ts` | `OrderConfirmation.giftCardAmount`; `PAYMENT_KEYS.gift_card`; selectable methods only; intent-aware parsing |
| create | `app/features/checkout/GiftCardField.tsx` | Apply/remove form at checkout |
| modify | `app/features/checkout/OrderSummary.tsx`, `CheckoutForm.tsx` (+ `checkout-ui.test.ts`) | Gift card row, "To pay"; hide the payment choice at 0 |
| modify | `app/routes/checkout-success.tsx`, `app/routes/account.orders.$id.tsx` | Pass `giftCardAmount` |
| create | `app/features/gift-cards/GiftCardPurchaseForm.tsx`, `GiftCardStatus.tsx`, `AccountGiftCards.tsx` (+ `gift-cards-ui.test.ts`) | Gift card UI |
| modify | `app/routes/account._index.tsx` (+ test), `app/lib/account.ts` | Gift cards section |
| modify | `app/lib/cms-sync.ts`, `services/cms-push.ts` (+ tests), `db/queries/cms-outbox.ts` | `CmsGiftCardState`, `toStrapiGiftCardData`, push `gift_card`; `giftCardAmount` on orders |
| modify | `app/.server/services/cms-sync.ts` (+ test) | Restore the balance on cancel/unclaimed (Q2) |
| modify | `app/features/checkout/PaymentMethodField.tsx` | Iterate `SELECTABLE_PAYMENT_METHODS` (Q1) |
| modify | `app/.server/services/sitemap.ts`, `app/.server/seo/robots.ts` | New pages in the lists |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `giftCards` namespace, `giftCardEmail`, checkout/account/payments keys |
| create | `cms/src/api/gift-card/{content-types/gift-card/schema.json,controllers,routes,services}` | Strapi read-only type |
| create | `cms/src/components/gift-cards/redemption.json` | Redemption rows in Strapi |
| modify | `cms/src/api/order/content-types/order/schema.json` | `giftCardAmount`; `gift_card` payment method |
| modify | `cms/src/sync/middleware.ts` (+ test), `cms/src/index.ts` | Refuse staff writes to gift cards; read-only edit view |
| modify | `cms/scripts/seed.ts` | **Only** `SYNC_TOKEN_PERMISSIONS` for `api::gift-card.gift-card.*` (no offers changes) |
| modify | `cms/types/generated/contentTypes.d.ts`, `cms/types/generated/components.d.ts` | Regenerated |
| modify | `app/.server/AGENTS.md`, `README.md` | Gift cards section, the new script, the Strapi type |

## Steps

- [x] **1. Paths and shared types** — Add `giftCards: { uk: "podarunkovi-kartky", en: "gift-cards",
  indexable: true }` and `giftCardSuccess: { uk: "podarunkovi-kartky/uspikh/:giftCardId", en:
  "gift-cards/success/:giftCardId", indexable: false }` to `PAGES`. Add `giftCards` to
  `SITEMAP_PAGES` and `giftCardSuccess` to `ROBOTS_PRIVATE_PAGES`. Create `app/lib/gift-cards.ts`:
  `GIFT_CARD_AMOUNTS = [500, 1000, 2000] as const`, `GIFT_CARD_VALIDITY_MONTHS = 12`, the code
  alphabet and length, `normalizeGiftCardCode`, `formatGiftCardCode`, `parseGiftCardId`, DTOs
  (`GiftCardView`, `AccountGiftCard`, `CheckoutGiftCard`) and `GiftCardError` keys. Extend
  `~/lib/enums` (`GIFT_CARD_STATUSES`, `ORDER_EMAIL_TYPES` + `gift_card` / `gift_card_recipient`,
  `CMS_SYNC_ENTITIES`, `PAYMENT_METHODS` + `gift_card` and `SELECTABLE_PAYMENT_METHODS`). Add
  `PAYMENT_KEYS.gift_card` (label + note) in `~/lib/checkout`. No zod here.
  Check: `paths.test.ts`, `paths.guard.test.ts`, the sitemap and robots tests pass.
- [ ] **2. Schema and migration 0023** — In `db/schema.ts`: `giftCards`, `giftCardRedemptions`
  (with `reversedAt`), `giftCards.recipientEmail`, `orders.giftCardAmount` (+ amounts check), the
  rewritten `orders_payment_method_check` (with `gift_card`),
  `carts.giftCardId`, `payments.orderId` nullable + `giftCardId` + `payments_target_check`,
  `orderEmails.orderId` nullable + `giftCardId` + `order_emails_target_check` + unique, and the
  rewritten type/entity checks. Give every constraint an explicit snake_case name. Mirror the row
  types in `~/lib/commerce` and update `schema.test.ts`. Run `pnpm db:generate --name gift_cards`,
  write `db/rollbacks/0023_gift_cards.sql` (drop the columns and tables, and restore the old checks
  and NOT NULLs, which fails loudly if gift card rows exist), and update the header comment. Check:
  `migrator.test.ts` (migrate + rollback) passes.
- [ ] **3. Gift card queries** — `db/queries/gift-cards.ts`: `insertGiftCard` (returns id;
  `23505` on the code → the service retries), `findGiftCardByCode`, `lockGiftCard(tx, id)`
  (`FOR UPDATE`), `activateGiftCard(tx, id, paymentId, now)` (conditional on `pending`, returns
  whether it changed), `redeemGiftCard(tx, { giftCardId, orderId, amount })` (insert the
  redemption, `balance = balance - amount`, `status = case when balance - amount = 0 then
  'used_up' …`, in SQL as `numeric`), `findGiftCardForViewer`, `listUserGiftCards`,
  `findGiftCardSyncState`, `findGiftCardEmail`, `markExpiredGiftCards(now)`. Integration tests
  with `createTestDatabase()`.
- [ ] **4. Gift card service** — `services/gift-cards.ts`: `generateGiftCardCode(random =
  crypto.randomInt)`, `createGiftCard({ amount, email, userId, locale })` (retries a code clash a
  few times), `checkGiftCard(card, now)` → `ok | unknown | not-active | expired | used-up` (pure),
  `giftCardAmountFor(totalKopiyky, balanceKopiyky)` (pure: `min`), `canViewGiftCard`,
  `getGiftCardView`, `getAccountGiftCards`, `deliverGiftCardEmail(giftCardId)`. Unit tests: the
  code is 16 symbols from the alphabet and round-trips through format/normalize, and the
  check/amount functions are covered for each state.
- [ ] **5. Payments** — In `db/queries/payments.ts`, let `countPayments` / `insertPayment` /
  `findLatestPaymentStatus` take a target (`{ orderId } | { giftCardId }`), and add
  `findPayableGiftCard(tx, id, { lock })`. In `services/payments.ts`, pull the shared attempt logic
  out of `startPayment` and add `startGiftCardPayment({ giftCardId, locale, origin, viewer })`
  (pending cards only; amount = `initial_amount`; reference `G<id>-<n>`; description
  `payments.giftCardDescription`; result URL `giftCardSuccess`). In `handlePaymentCallback`'s
  success branch, a gift card attempt → `activateGiftCard`, then `insertOrderEmail({ giftCardId,
  type: "gift_card", locale: card.locale })`, a `gift_card_recipient` row when
  `recipient_email` is set, and `enqueueCmsSync(tx, "gift_card", [id])`. Return
  `giftCardId` with `paid`. Add `getGiftCardPaymentView`. `routes/payments.callback.ts`: on a paid
  gift card, `void deliverGiftCardEmail(id)` plus `void pushToCms()`. Tests: activation on
  success, a repeated callback is ignored, a failure leaves the card `pending`, an amount mismatch
  is ignored, and order payments behave exactly as before.
- [ ] **6. Code email** — `claimOrderEmails` takes `giftCardId?` and returns `giftCardId`.
  `deliverOrderEmails` / `deliverOne` load the gift card for a `gift_card` / `gift_card_recipient`
  row (new dep `loadGiftCard`). `buildGiftCardEmail(card, translator, env)` goes to
  `buyer_email`: the amount, the formatted code, the expiry date (`formatDate`), how to use it at
  checkout, a line saying the code was also sent to the recipient (when there is one), and contact
  and signature. `buildGiftCardRecipientEmail` goes to `recipient_email`: "you've received a
  Jassmin gift card", the amount, code, expiry and how to use it, with no buyer address or free
  text. Both are plain text with nothing user-supplied in headers (the address goes through
  `stripLineBreaks`). Keys go in `giftCardEmail.*` and `giftCardRecipientEmail.*` (uk + en; the
  recipient gets the purchase locale). Tests: both emails in both languages, the recipient email
  only queued when there's a recipient, retries and the give-up path for the new types, and order
  emails unchanged.
- [ ] **7. Redemption in `createOrder`** — In `db/queries/cart.ts`, add `setCartGiftCard` /
  `findCartGiftCardId` (bump `updated_at`). In `services/cart.ts`, add `applyGiftCard(writer,
  code)` / `removeGiftCard(writer)`: the lookup → `checkGiftCard` → store, and a refused code
  writes nothing. `mergeGuestCart` brings the guest's card along when the user's cart has none.
  In `createOrder`, after `priceAndRedeem`: when the cart has a card, `lockGiftCard`,
  `checkGiftCard(now)`, `amount = giftCardAmountFor(priced.total, balance)` (0 when not ok),
  compare `priced.total − amount` with `expectedTotal`, `insertOrder({ …, giftCardAmount })`
  (`total_amount` subtracts it; at 0 the order is inserted with `payment_method = 'gift_card'`,
  `paid` / `paid` / `paid_at`), and
  `redeemGiftCard` after the order exists. Enqueue the card for Strapi. Add `giftCardAmount` to
  `PlacedOrderTotals`, `findOrderConfirmation`, the account order queries and
  `findOrderSyncState`. Integration tests: partial redemption (rest stays), full redemption (order
  `paid`, no payment needed), a discount + free-delivery threshold + gift card total, an expired or
  used-up card at order time (`total-changed`), and two concurrent `createOrder`s on one card
  (`Promise.all`: one gets the balance, the other `total-changed`, and the balance never goes
  below 0).
- [ ] **8. Checkout route and UI** — `routes/checkout.tsx` loader: add `giftCard`
  (`CheckoutGiftCard`: masked code, amount, balance after) and `amountDue`. Free delivery still
  uses `cart.total`. Action: dispatch on `intent` (`apply-gift-card` → rate limit
  `giftCardCodeLimiter`, zod `giftCardCodeSchema`, `applyGiftCard`, return `{ giftCardError }` or
  redirect back to checkout; `remove-gift-card`; anything else → place the order as now).
  `expectedTotal` is the amount due. When the amount due is `0`, the order is placed as
  `gift_card` whatever was posted, and the card-availability check is skipped (Q1). The zod enum
  uses `SELECTABLE_PAYMENT_METHODS`, so a posted `gift_card` is a validation error. Add `giftCardAmount` to the `purchase` event properties. Create `GiftCardField.tsx`
  (`Form` with code input, apply/remove buttons, `role="alert"` error). `OrderSummary` gets
  `giftCardAmount?` and the "To pay" label. `CheckoutForm` hides the payment fieldset when nothing is due
  and shows "Paid with a gift card" instead (Q1). `PaymentMethodField` iterates
  `SELECTABLE_PAYMENT_METHODS`. The success page, account order page and email show the
  `gift_card` label through `PAYMENT_KEYS`. Route and UI tests in uk and en.
- [ ] **9. Gift card pages** — `routes/gift-cards.tsx`: `meta` (title and description,
  indexable, `hreflang` through the existing helpers), a loader (`cardPaymentAvailable`, the
  amounts, the prefill email from `getUser`), and an action (zod `giftCardPurchaseSchema`:
  `amount` coerced and limited to `GIFT_CARD_AMOUNTS`, `email` via `emailSchema`, optional
  `recipientEmail` (blank → `undefined`, otherwise `emailSchema`; the same as `email` → dropped); refuse without a
  provider; `createGiftCard`; `rememberGiftCard`; `startGiftCardPayment`; redirect to the provider,
  or to the success page if the start failed). `routes/gift-card-success.tsx`: `noindexMeta`; a
  loader with the viewer check (404 otherwise) returning `GiftCardView` + payment view; the action
  (POST "Pay" / "Try again") → `startGiftCardPayment`. Components in `app/features/gift-cards/`:
  three amount tiles as radio cards, the email field, the optional "Recipient's email" field
  with a hint ("we'll send the code there too"), the primary button, the availability notice,
  and the status panel reusing `PaymentStatus` patterns. Register both in `app/routes.ts`. Route
  tests: validation errors, no provider, the redirect to the provider, the 404 for a stranger, and
  pending/failed/active views.
- [ ] **10. Account** — `routes/account._index.tsx` loader also returns `getAccountGiftCards`
  (parallel with orders). `AccountGiftCards` lists amount, balance (`formatPrice`), a status pill,
  `expires_at` (`formatDate`), the recipient's email when set, the code for non-pending cards,
  and a "Pay" link for pending ones.
  It's shown even when there are no orders, and the empty state stays as it is when there are no
  cards. `account.orders.$id.tsx` and `checkout-success.tsx` pass `giftCardAmount` to
  `OrderSummary`. Tests.
- [ ] **11. Strapi** — Create the `gift-card` collection type (`draftAndPublish: false`):
  `giftCardId` (integer, unique), `code`, `initialAmount`, `balance` (decimal), `currency`,
  `giftCardStatus` (enum; Strapi reserves `status`), `buyerEmail`, `recipientEmail`, `userId`,
  `placedAt`,
  `activatedAt`, `expiresAt`, and `redemptions` (repeatable `gift-cards.redemption`: `orderId`,
  `amount`, `redeemedAt`). Add `giftCardAmount` (decimal) to `order` and `gift_card` to its `paymentMethod` enum. Middleware: for
  `api::gift-card.gift-card`, refuse every staff write with a Ukrainian message ("Подарункові
  картки змінюються лише в магазині."). In `index.ts`, mark every gift card field read-only, as for
  orders. `seed.ts`: add the four `api::gift-card.gift-card.*` sync-token permissions (nothing
  else in the seed changes). App side: `CmsGiftCardState` in `~/lib/cms-sync`, `toCmsGiftCardState`
  / `toStrapiGiftCardData`, a `gift-cards` collection in `upsertDocument`, `loadGiftCard` dep, and
  `db:sync-cms --all` also queues gift cards. `CmsOrderState` + `toStrapiOrderData` carry
  `giftCardAmount`. (Q2) In `applyCmsOrderChange`, when `next.restock`, restore each
  unreversed redemption (`restoreGiftCardRedemptions(tx, orderId)`: balance back, `used_up` →
  `active` unless expired, `reversed_at`) and queue the cards. Regenerate the Strapi types. Tests: push mapping,
  middleware refusal, and the restore.
- [ ] **12. Expiry job** — `db/expire-gift-cards.ts` + `db/scripts/expire-gift-cards.ts` +
  `pnpm db:expire-gift-cards`: `active` cards with `expires_at <= now()` → `expired` (raw SQL sets
  `updated_at`), queued for Strapi in the same transaction. Integration test. Document a daily
  cron next to the other jobs in the README.
- [ ] **13. Translations** — `giftCards.*` (page title/intro/amount labels/email/buy/unavailable/
  validity note/success states/code/expiry/pay/try again), `giftCardEmail.*`,
  `checkout.giftCard.*` (label, apply, remove, applied line, "To pay", errors `unknown`,
  `notActive`, `expired`, `usedUp`, `tooManyAttempts`), `account.giftCards.*`,
  `payments.giftCardDescription`. Ukrainian first, then English; plurals not needed. Prices via
  `formatPrice`, dates via `formatDate`. Check: `pnpm typecheck` (dictionary parity) and
  `dictionaries.test.ts`.
- [ ] **14. Docs** — `app/.server/AGENTS.md`: a "Gift cards" section (tables, code rules,
  `total_amount` meaning, lock order, the payment target, the email type, Strapi read-only,
  the expiry job). Update the Orders/Payments/Order email bullets that say an attempt or email
  always has an order. `README.md`: the new script, the Strapi type and the sync-token permissions
  (an existing token needs the gift card permissions added by hand or by re-running
  `pnpm cms:seed`).
- [ ] **15. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, then the manual
  run below.

## Testing & verification

- **Unit:** code generation and formatting (`gift-cards.test.ts`), `checkGiftCard` /
  `giftCardAmountFor`, zod schemas, the email builder (uk/en), the Strapi mappings, the middleware
  refusal, and the UI tests (`gift-cards-ui.test.ts`, `checkout-ui.test.ts`, `account-ui.test.ts`)
  in uk and, with `<I18nProvider locale="en">`, en.
- **Integration (DB, `createTestDatabase()`):** migration + rollback; activation on a successful
  callback and nothing on a failed one; partial and full redemption; an expired, used-up and
  pending card refused with nothing written; **two orders racing for one card's balance**; the
  checkout total with a discount, the free-delivery threshold and a gift card; the expiry job;
  the balance restored on cancel/unclaimed and not on returned; a fully covered order stored as
  `gift_card`; the recipient email queued only with a recipient.
- **Route tests:** `gift-cards`, `gift-card-success`, `checkout` intents, `payments.callback`,
  `account._index`.
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **Manual (`pnpm aspire run`, `PAYMENT_PROVIDER=simulator`, smtp4dev):** buy a 1000 ₴ card →
  simulator "success" → the code email in smtp4dev (and a second one to the recipient when
  that field was filled) (uk, then en from `/en/gift-cards`) → the card
  on `/account` and in Strapi. Fail a payment → the card stays pending → "Try again" works. At
  checkout, apply the code to a 600 ₴ cart → pay 0, the order is paid with method "gift card" and the
  balance is 400 ₴; cancel it in Strapi → the balance is back to 1000 ₴;
  apply it to a 2000 ₴ cart → 400 ₴ off, the card is used up. Bad, expired (set `expires_at` by
  hand) and pending codes show translated errors. In Strapi, editing or deleting a gift card is
  refused.

## Acceptance criteria

- [ ] A customer can buy a 500, 1000 or 2000 ₴ gift card with a card payment, and receives a
  unique code by email after the payment succeeds — steps 3, 4, 5, 6, 9
- [ ] A gift card can't be put in the same cart as perfumes, and isn't sold for cash on delivery
  — decisions (no cart path at all); step 9 (card-only action, refused without a provider)
- [ ] At checkout, a valid code lowers the amount to pay by up to its balance. Any rest stays on
  the card for a later order — steps 7, 8
- [ ] An unknown, expired, used-up or unpaid code shows a translated error and changes nothing —
  steps 4, 7, 8, 13
- [ ] Two orders can't spend more than the card's balance — step 7 (`FOR UPDATE`,
  `expectedTotal`, CHECK; race test)
- [ ] The order summary, order page and email show the gift card amount, in Ukrainian and English
  — steps 6, 7, 8, 10, 13
- [ ] Staff can see gift cards and their balances in Strapi — step 11
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 15

## Out of scope

- The offers page copy, the Strapi offers seed and the offers fixtures (#126).
- Physical cards, custom amounts, refunds to a bank card, and buying a gift card together with
  perfumes (#125).
- A recipient name or personal message, and scheduled delivery to the recipient (only the
  optional recipient email is in scope).
- A header/menu link to the gift card page, and a new analytics event type for gift card
  purchases.
- Real payment providers (still `simulator` only, #44).
