# Plan: Apply promo codes and offer discounts at checkout (#59)

Issue: https://github.com/savchukolgaa/jassmin/issues/59
Branch: `issue/59`
Worktree: `.claude/worktrees/issue-59`
Status: Planned

## Goal

As a shopper, I want the savings shown on special offers and my promo codes to be applied at
checkout so that I actually pay the advertised price. This adds a discount engine to the cart and
checkout: promo codes, bundle prices ("two 30 ml perfumes, −10%") and fixed-price sets (the tester
trio, 3 × 7 ml for 499 ₴). The saving is stored in `orders.discount_amount` (and the rule in a new
`orders.discount_id`) and shown in the cart, at checkout, on the success and account order pages,
and in the confirmation email.

## Dependencies & prerequisites

- Checkout and order creation (#11), volume variants (#26), order email (#45), account orders
  (#12), offers in Strapi (#55) and card payments (#44) are all merged on `origin/main`
  (`a4e98e1`). Nothing open blocks this issue.
- Products moving to Strapi (#40) is still open: rules therefore scope products by **`public_id`**
  (the stable external key), not by the serial `products.id`, so they survive that move.
- One new migration (`0011_discounts`) with a hand-written rollback. No new env vars or packages.

## Decisions & assumptions

**Schema**

- New table `discounts`:
  - `id serial` PK; `slug text not null` unique (`discounts_slug_unique`): a stable internal key
    for the seed's `onConflictDoNothing` and for Strapi to reference a rule later. Automatic rules
    have no code, so the seed can't key on `code`.
  - `code varchar(40)` nullable. Case-insensitive unique via
    `uniqueIndex("discounts_code_unique").on(sql\`lower(${t.code})\`)`. Codes are also normalised
    (`trim().toUpperCase()`) by the zod schema before every lookup, and looked up with
    `lower(code) = lower($1)`. A rule **with** a code applies only when the shopper enters it; a
    rule **without** one applies automatically when the cart qualifies.
  - `kind text` limited by `discounts_kind_check` to `DISCOUNT_KINDS = ["percent", "fixed_amount",
    "fixed_price_set"]` in `~/lib/enums` (text + CHECK, like `payments.provider`, so a new kind is
    a migration rewriting the check).
  - `value numeric(10, 2) not null`: the percent for `percent` (CHECK `> 0 and <= 100`), hryvnias
    off for `fixed_amount`, the set's price for `fixed_price_set` (CHECK `value >= 0` for both).
  - Variant scope, every part optional (`null` = any): `scope_volumes_ml integer[]`,
    `scope_product_public_ids uuid[]`, `scope_pack_size integer`. A cart line qualifies when it
    matches every non-null part.
  - `min_quantity integer not null default 1` (CHECK `>= 1`): qualifying **units** needed. For
    `fixed_price_set` it is the set size (CHECK `kind <> 'fixed_price_set' or min_quantity >= 2`).
  - `starts_at` / `ends_at timestamptz` nullable (start inclusive, end exclusive, like
    `isOfferActive`); CHECK `ends_at > starts_at` when both are set.
  - `max_redemptions integer` nullable (CHECK `> 0`), `redemption_count integer not null default 0`
    with CHECK `redemption_count >= 0 and (max_redemptions is null or redemption_count <=
    max_redemptions)` as the last-line guard against overselling a code.
  - `active boolean not null default true`, `created_at`, `updated_at` (`updatedAt()` helper).
- `orders.discount_id integer` nullable FK → `discounts.id` **on delete restrict** (an order's
  promotion attribution is analytics data; a used rule is deactivated, not deleted), plus index
  `orders_discount_id_idx`.
- `carts.discount_id integer` nullable FK → `discounts.id` **on delete set null**: the promo code
  the shopper applied (automatic rules are never stored on the cart; they are recomputed). Changing
  it goes through `touchCart` like any cart change.
- Mirror the new columns and a `Discount` row type in `~/lib/commerce` and `schema.test.ts`.

**Pricing** — `app/.server/services/pricing.ts`, pure and synchronous:

- `priceCart(lines, discounts, now)` → `{ subtotal, discount, shipping, total, freeShipping,
  applied }`. Inputs and outputs are whole **kopiyky** (`number`); callers convert with
  `toKopiyky` / `fromKopiyky`, which move from `~/lib/checkout` (private) to `~/lib/money`
  (exported, tested) as the issue asks. Integer kopiyky are exact, so this doesn't break the
  "no float money" rule; `AGENTS.md`'s "computed in SQL" note gets a line about it.
- `discounts` are the **candidates** (automatic rules plus the cart's code, already filtered to
  `active`). `priceCart` itself re-checks the window against `now` and `redemption_count <
  max_redemptions`, computes each candidate's saving and applies **the single largest** (one
  discount per order). Ties go to the entered code, then the lower id. `applied` is
  `{ discountId, code, kind, amount } | null`, plus `codeStatus` for the entered code
  (`applied` | `not-best` | `not-applicable` | `expired` | `used-up`).
- Per kind, over the **qualifying units** only (a line of quantity 3 is 3 units):
  - `percent`: if units ≥ `min_quantity`, `floor(sum × value / 100)` kopiyky (rounded down, so
    the store never gives more than advertised).
  - `fixed_amount`: if units ≥ `min_quantity`, `min(value, sum)`.
  - `fixed_price_set`: `sets = floor(units / min_quantity)`; the **most expensive** qualifying
    units go into sets (best for the shopper); saving = `max(0, sum(those units) − sets × value)`.
    Several sets per cart are allowed (6 × 7 ml = two trios).
  - Every saving is clamped to `[0, subtotal]`, so the total never goes below 0.
- Shipping stays `SHIPPING_AMOUNT` (`0`); `freeShipping` is `subtotal − discount ≥
  FREE_SHIPPING_THRESHOLD`. Discounts never reduce shipping (issue assumption).
- `freeShippingInfo` takes the discounted subtotal, so the cart/checkout hint matches.
- The bundle example "two 30 ml perfumes, −10%" is `percent`, `scope_volumes_ml {30}`,
  `min_quantity 2`, `value 10`, and takes 10% off **all** 30 ml units once there are two
  **(unconfirmed, Q2)**.

**Cart**

- `cartActionSchema` gains `{ intent: "apply-promo", code }` (zod: trim, uppercase, 1–40 chars of
  `[A-Z0-9_-]`, error key `cart.errors.promoInvalid`) and `{ intent: "remove-promo" }`.
- `applyPromoCode(owner, code)` / `removePromoCode(owner)` in `services/cart.ts`: transaction,
  `lockCart`, look the code up, run `priceCart` with it, and only store `carts.discount_id` when
  it applies now. Typed results, no throws: `promo-invalid` (unknown, inactive or not started
  yet — not started isn't revealed), `promo-expired`, `promo-used-up`, `promo-not-applicable`
  (cart doesn't meet scope/minimum). A code that applies but loses to an automatic rule is still
  stored and shown with `cart.promo.notBest`.
- Promo attempts are rate-limited with `createRateLimiter` (10 per `clientKey` per 15 minutes →
  `promo-rate-limited`) so codes can't be brute-forced.
- `getCartView` loads the candidates (`listCandidateDiscounts(db, cartDiscountId)`) and adds
  `discount: CartDiscount | null`, `total`, `promo` (the stored code and its status) and the
  discounted free-shipping info to `CartView`. A stored code that stops applying after a line
  change stays on the cart, and the summary says it doesn't apply (with a remove button).
- `mergeGuestCart`: when both carts exist, the guest cart's code moves to the user's cart only if
  the user's cart has none; an adopted guest cart keeps its own.

**Checkout** — `createOrder` in `services/orders.ts`:

- Lock order stays deadlock-free: `lockCart` → variant rows (`lockCartLinesForOrder`) →
  candidate discount rows `FOR UPDATE` in id order (`lockCandidateDiscounts(tx, cartDiscountId,
  now)`). Then `priceCart` on the locked prices and counts.
- If the cart has a code and it is now invalid / expired / used up, return
  `{ ok: false, error: "discount-changed" }` (nothing written) → the action answers 409 with
  `checkout.errors.discountChanged` and the page reloads with the new total, like
  `stockChanged`. The shopper is never charged more than the page showed because of their code.
- With the applied rule: `UPDATE discounts SET redemption_count = redemption_count + 1 WHERE id = $1
  AND (max_redemptions IS NULL OR redemption_count < max_redemptions)`; zero rows updated →
  `discount-changed` (the CHECK is the backstop). Counted for automatic rules too, for analytics.
- `insertOrder` takes `discountAmount` and `discountId`; the SQL for `total_amount` and
  `free_shipping` already uses `subtotal − discount`, so only the bound value changes. The
  `DISCOUNT_AMOUNT` constant is removed.
- `CreateOrderResult` (`placed: true`) also returns `totalAmount`, `discountAmount` and
  `discountCode` for the `purchase` event.

**Display**

- `OrderSummary` gets an optional `discount?: { amount: string; code: string | null }` and renders
  a "Знижка / Discount" row (`−{amount}`, with the code when there is one) between subtotal and
  shipping, only when the amount is > 0. Used by checkout, the success page and the account order
  page. `CartSummary` gets the same row plus the promo form.
- Discount label: a generic translated label (`checkout.discount`, `checkout.discountWithCode`
  "Знижка (промокод {code})"), not a per-rule name stored in the DB **(unconfirmed, Q3)**.
- `findOrder` / `findUserOrder` left-join `discounts` for `discountCode`; `OrderConfirmation` and
  `AccountOrderDetail` gain `discountAmount` / `discountCode`. `buildOrderConfirmationEmail` adds
  the discount line when > 0.

**Analytics** — `checkout_start` properties gain `discountCode` (or `null`) and `discountAmount`;
`purchase` gains `discountId`, `discountCode`, `discountAmount` and `totalAmount`.

**Offers / seed**

- `db/seed-data.ts` gets `SAMPLE_DISCOUNTS`, seeded by `db/seed.ts` with `onConflictDoNothing` on
  `slug`:
  - `tester-trio`: `fixed_price_set`, `scope_volumes_ml {7}`, `min_quantity 3`, `value 499`, no
    code, no window **(unconfirmed, Q1)**.
  - `two-30ml-10`: `percent`, `scope_volumes_ml {30}`, `min_quantity 2`, `value 10`, no code.
  - `JASSMIN10` (`welcome-10`): `percent 10`, code, no window — for manual testing.
  - `EXPIRED5` (window in the past) and `USEDUP` (`max_redemptions 1`, `redemption_count 1`) to
    exercise the error paths in dev.
- `cms/scripts/seed.ts`: the tester-trio `priceNote` becomes "3 × 7 мл — 499 ₴ у кошику" /
  "3 × 7 ml — 499 ₴ in your cart", and a new `bundle` offer ("Два аромати по 30 мл — −10%") is
  added. The seed skips offers that already exist, so existing Strapi databases keep the old text
  until edited in the admin (noted in the PR). No Strapi content-model change **(unconfirmed, Q4)**.

## Open questions

- [ ] **Q1: Is the tester trio really any three 7 ml sizes for 499 ₴?** — Why it matters: seeded
  7 ml prices are 590–990 ₴, so three cost 1 770–2 970 ₴ and the rule takes off 70–83%; the
  current copy says "від 499 ₴" (from 499), which hints at a price range or a limited choice.
  Recommended default: any three 7 ml units, 499 ₴ per set, repeatable, no product scope (as the
  issue says). Affects steps: 2, 3, 11.
- [ ] **Q2: Does "two 30 ml, −10%" discount every 30 ml unit once there are two, or only pairs?**
  — Why it matters: with three 30 ml bottles it's 10% of three vs 10% of two. Recommended
  default: every qualifying unit once `min_quantity` is reached (simpler, more generous). Affects
  steps: 3, 11.
- [ ] **Q3: Should each rule carry its own shopper-facing name (uk/en) for the discount line?** —
  Why it matters: a name like "Тестерне тріо" is clearer than "Знижка", but needs
  `title_uk`/`title_en` columns (copy outside the i18n dictionaries) or a key per rule.
  Recommended default: generic translated labels ("Знижка", "Знижка (промокод JASSMIN10)").
  Affects steps: 1, 6, 9.
- [ ] **Q4: Should a Strapi offer link to a rule now (e.g. a `discountSlug` field) so the page can
  show the live price?** — Why it matters: it keeps page and price in sync automatically but means
  a content-model change, schema/DTO/mapper updates and re-recorded fixtures. Recommended
  default: no link in this issue; only update the seed wording, and leave the link for #40's
  admin work. Affects steps: 11.
- [ ] **Q5: Which wins when the entered code is valid but an automatic rule saves more?** — Why it
  matters: the issue says "the best one for the shopper, or the entered promo code".
  Recommended default: the larger saving wins (ties → the code); the code stays on the cart with a
  "a better offer is already applied" note and isn't redeemed. Affects steps: 3, 5.

## Resolved questions

- **Where do rules live?** — PostgreSQL, not Strapi, so checkout computes them in its transaction
  and a CMS outage can't change prices (source: #59 assumptions; `app/.server/AGENTS.md` "Offers
  … never change prices").
- **Can discounts stack?** — No, one per order (source: #59 assumptions).
- **Do discounts affect shipping?** — No. Shipping stays `0` and free delivery is decided on
  `subtotal − discount` against `FREE_SHIPPING_THRESHOLD` (source: #59; `app/lib/checkout.ts`
  `FREE_SHIPPING_THRESHOLD` doc comment; `insertOrder` in `app/.server/db/queries/orders.ts`
  already computes `free_shipping` from `subtotal − discount`).
- **Is there a kopiyky helper in `app/lib/money.ts`?** — Not yet: `toKopiyky` / `fromKopiyky` are
  private in `app/lib/checkout.ts`; they move to `money.ts` (source: those files).
- **How to scope products given #40?** — By product `public_id` (source: `app/.server/AGENTS.md`
  "public_id … is the stable external key"; offers reference products by `public_id`, #55).
- **Admin UI for rules?** — Out of scope; rules come from the seed or a migration (source: #59).
- **How do stock and the order lock interact?** — Keep #11's lock order (cart → variants) and add
  discounts last, in id order (source: `createOrder` in `app/.server/services/orders.ts`).
- **Enum style for `kind`?** — text + CHECK built from a `~/lib/enums` array, like
  `payments.provider` (source: `app/.server/db/schema.ts`, `0010_payments.sql`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | `DISCOUNT_KINDS`, `DiscountKind` |
| modify | `app/lib/money.ts`, `app/lib/money.test.ts` | export `toKopiyky` / `fromKopiyky` (+ tests) |
| modify | `app/lib/checkout.ts` | use money helpers; drop `DISCOUNT_AMOUNT`; `OrderConfirmation.discountCode`; discounted `freeShippingInfo` callers |
| create | `app/lib/discounts.ts` (+ `.test.ts`) | `promoCodeSchema`, `normalizePromoCode`, `CartDiscount` / `PromoStatus` DTOs, error keys |
| modify | `app/lib/cart.ts` | `apply-promo` / `remove-promo` intents, promo errors, `CartView.discount/total/promo` |
| modify | `app/lib/commerce.ts`, `app/lib/account.ts` | `Discount` row type, `discountId` on `Cart` / `Order`; `AccountOrderDetail.discountAmount/discountCode` |
| modify | `app/.server/db/schema.ts`, `schema.test.ts` | `discounts` table, `orders.discount_id`, `carts.discount_id` |
| create | `app/.server/db/migrations/0011_discounts.sql` (+ snapshot, journal) | generated by `pnpm db:generate --name discounts` |
| create | `app/.server/db/rollbacks/0011_discounts.sql` | drop FKs/columns, then the table |
| create | `app/.server/db/queries/discounts.ts` (+ `.test.ts`) | `findDiscountByCode`, `listCandidateDiscounts`, `lockCandidateDiscounts`, `redeemDiscount`, `setCartDiscount` |
| create | `app/.server/services/pricing.ts`, `pricing.test.ts` | pure `priceCart` |
| modify | `app/.server/services/cart.ts`, `cart.test.ts` | `getCartView` pricing, `applyPromoCode`, `removePromoCode`, merge keeps code |
| modify | `app/.server/db/queries/orders.ts` | `insertOrder` discount params; `findOrder` / `findUserOrder` discount fields |
| modify | `app/.server/services/orders.ts`, `orders.test.ts` | discount in `createOrder`, `discount-changed`, redemption |
| modify | `app/.server/services/order-email.ts`, `order-email.test.ts` | discount line |
| modify | `app/routes/cart.tsx`, `cart.test.ts` | promo intents, rate limit, errors |
| modify | `app/routes/checkout.tsx`, `checkout.test.ts` | discounted totals, `discount-changed`, analytics props |
| modify | `app/routes/checkout-success.tsx`, `app/routes/account.orders.$id.tsx` (+ tests) | pass `discount` to `OrderSummary` |
| modify | `app/features/cart/CartSummary.tsx` | discount row, total, free-shipping hint |
| create | `app/features/cart/PromoCodeForm.tsx` | apply / remove form (`fetcher.Form`, works without JS) |
| modify | `app/features/checkout/OrderSummary.tsx`, `checkout-ui.test.ts`, `cart-ui.test.ts` | discount row |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `cart.promo.*`, `cart.errors.promo*`, `checkout.discount*`, `checkout.errors.discountChanged` |
| modify | `app/.server/db/seed-data.ts`, `seed.ts`, `seed.test.ts` | `SAMPLE_DISCOUNTS` |
| modify | `cms/scripts/seed.ts` | trio wording, new bundle offer |
| modify | `app/.server/AGENTS.md` | discounts section; update "Discounts aren't implemented" and offers notes |

## Steps

- [ ] **1. Schema and migration** — Add `DISCOUNT_KINDS` to `~/lib/enums`; define `discounts`,
  `orders.discountId`, `carts.discountId` in `schema.ts` with the constraints above (explicit
  snake_case names). `pnpm db:generate --name discounts`, check the SQL (functional `lower(code)`
  index, array columns), write `rollbacks/0011_discounts.sql`. Mirror types in `~/lib/commerce`;
  extend `schema.test.ts`. Check: `pnpm typecheck`, `pnpm test` (schema + migrator tests),
  `pnpm db:migrate` then `pnpm db:rollback` then migrate again on the dev DB.
- [ ] **2. Money helpers** — Move `toKopiyky` / `fromKopiyky` to `~/lib/money` (exported, with
  tests for `"0"`, `"999.5"`, `"1000.00"`, invalid input); `~/lib/checkout` imports them.
- [ ] **3. `priceCart`** — `services/pricing.ts` with types `PricingLine { variantPublicId,
  productPublicId, volumeMl, packSize, unitPrice (kop), quantity }` and `PricingDiscount`
  (row subset). Implement qualification, the three kinds, best-of selection, tie-breaks, clamp,
  free shipping and `codeStatus`. `pricing.test.ts` covers: each kind; scope by volume, product
  and pack size; `min_quantity` just below / at; window edges (start inclusive, end exclusive);
  used-up; inactive ignored; repeated sets and most-expensive-first selection; percent rounding
  down; never below 0; best-of and ties; free shipping crossing the threshold only after the
  discount.
- [ ] **4. Discount queries** — `db/queries/discounts.ts`: `findDiscountByCode(db, code)`
  (`lower(code) = lower($1)`), `listCandidateDiscounts(db, cartDiscountId)` (active, no code, or
  `id = cartDiscountId`), `lockCandidateDiscounts(tx, …)` (same, `FOR UPDATE`, order by id),
  `redeemDiscount(tx, id)` (conditional increment, returns boolean), `setCartDiscount(tx, cartId,
  id | null)`. Integration tests with `createTestDatabase()`.
- [ ] **5. Cart service** — `getCartView` builds `PricingLine`s from `listCartLines` (add product
  `public_id` and `pack_size` if missing), loads candidates and returns `discount`, `total`,
  `promo`, `shipping`. `applyPromoCode` / `removePromoCode` (lock, check, store, `touchCart`).
  `mergeGuestCart` carries the code over. Extend `cart.test.ts` (DB): apply valid / each error,
  remove, stored code becoming not-applicable, merge.
- [ ] **6. i18n** — Add every new key to `uk.ts` and `en.ts`: `cart.promo.{label, placeholder,
  apply, remove, applied, notBest, notApplicable}`, `cart.errors.{promoInvalid, promoExpired,
  promoUsedUp, promoNotApplicable, promoRateLimited}`, `cart.total`, `checkout.discount`,
  `checkout.discountWithCode`, `checkout.errors.discountChanged`. `pnpm typecheck` enforces parity.
- [ ] **7. Cart route and UI** — `routes/cart.tsx` handles `apply-promo` (rate limit first, then
  `applyPromoCode`; 400 for invalid input, 409 for expired / used-up / not-applicable, 429 for
  rate-limited) and `remove-promo`. `PromoCodeForm` (Option C+ input and button styles from
  `docs/design.md`, visible label, error in `role="alert"` linked with `aria-describedby`).
  `CartSummary` shows subtotal, discount row, total and the discounted free-shipping note. Extend
  `routes/cart.test.ts` (mocked services) and `cart-ui.test.ts` (uk + en rendering).
- [ ] **8. Checkout service** — `createOrder`: after the stock check, read the cart's
  `discount_id`, `lockCandidateDiscounts`, `priceCart` with `now = new Date()`, handle
  `discount-changed`, `redeemDiscount`, then `insertOrder({ …, discountAmount, discountId })`.
  `insertOrder` binds the discount instead of `DISCOUNT_AMOUNT`. Return the new fields.
  Integration tests in `orders.test.ts`: order with a code writes `discount_amount`,
  `discount_id`, the right total and `redemption_count + 1`; trio and bundle applied automatically;
  1 100 ₴ cart with 10% off → `free_shipping = false`; a code with `max_redemptions 1` and two
  concurrent checkouts → exactly one discounted order, the other `discount-changed`, count = 1;
  expired code at checkout → `discount-changed`, nothing written; rollback still undoes the
  redemption.
- [ ] **9. Checkout route, success and account pages** — `checkout.tsx` loader passes
  `cart.total`, `cart.discount` and the discounted shipping info to `OrderSummary`; the action maps
  `discount-changed` to a 409 `formError`. `OrderSummary` renders the discount row. `findOrder` /
  `findUserOrder` return `discountAmount` / `discountCode`; `checkout-success.tsx` and
  `account.orders.$id.tsx` pass them. Update the route and UI tests (uk + en).
- [ ] **10. Order email and analytics** — `buildOrderConfirmationEmail` adds the discount line
  (`order-email.test.ts`, both locales). Add the discount properties to `checkout_start` and
  `purchase` in `checkout.tsx` (assert in `checkout.test.ts`).
- [ ] **11. Seeds** — `SAMPLE_DISCOUNTS` in `db/seed-data.ts`, inserted by `db/seed.ts`
  (`onConflictDoNothing` on `slug`), `seed.test.ts` updated. `cms/scripts/seed.ts`: trio wording
  and the new `bundle` offer referencing seeded 30 ml products.
- [ ] **12. Docs and final checks** — Update `app/.server/AGENTS.md` (new "Discounts" section;
  orders/offers notes; kopiyky in JS for pricing). Run `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`; manual check under `pnpm aspire run`.

## Testing & verification

- Unit: `pricing.test.ts` (all rules), `money.test.ts`, `discounts.test.ts` (schema/normalising),
  UI tests for `CartSummary`, `PromoCodeForm` and `OrderSummary` in uk and en
  (`<I18nProvider locale="en">`), route tests for `cart.tsx` and `checkout.tsx` with mocked
  services, `order-email.test.ts`.
- Integration (`describe.skipIf(!hasDatabase)`, `createTestDatabase()`): discount queries, cart
  promo flow, `createOrder` with discounts including the concurrent redemption test, migration
  up/down via `migrator.test.ts`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`, `pnpm db:seed`): add three 7 ml sizes → trio price in the cart; two
  30 ml → −10%; `JASSMIN10` reduces the total; `EXPIRED5`, `USEDUP` and `NOPE` show translated
  errors and leave the total; switch to English; place a cash and a card order and check the
  success page, `/account/orders/:id`, the email in smtp4dev and `orders.discount_*` /
  `discounts.redemption_count` in the DB.

## Acceptance criteria

- [ ] A valid promo code entered in the cart reduces the total, and an invalid, expired or used-up
  code shows a translated error without changing the total — steps 3, 5, 6, 7
- [ ] A bundle rule (for example two 30 ml perfumes, −10%) and the tester trio fixed price
  (3 × 7 ml for 499 ₴) are applied automatically when the cart qualifies — steps 3, 5, 11
- [ ] `orders.discount_amount` and `orders.discount_id` are written in the checkout transaction,
  and a code's redemption limit can't be exceeded by concurrent orders — steps 1, 4, 8
- [ ] Cart, checkout, the order-confirmation email and the account order page show the discount
  line in Ukrainian and English — steps 6, 7, 9, 10
- [ ] Free shipping still uses the discounted subtotal against `FREE_SHIPPING_THRESHOLD` — steps
  3, 5, 8
- [ ] Unit tests cover the pricing rules, and integration tests cover checkout with a discount —
  steps 3, 8

## Out of scope

- Stacking several discounts on one order.
- Personalized offers, email campaigns, loyalty points, gift cards.
- Admin UI for rules (seed / migration only; later #40), and showing discounts on `/admin/orders`.
- Linking Strapi offers to rules in the content model (see Q4), and per-rule display names (Q3).
- Discounts on shipping; per-user redemption limits; minimum-subtotal rules.
