# Plan: Build checkout with guest support and transactional order creation (#11)

Issue: https://github.com/savchukolgaa/jassmin/issues/11
Branch: `issue/11`
Worktree: `.claude/worktrees/issue-11`
Status: Planned

## Goal
Guests and registered shoppers can check out from `/checkout` with their contact details, a Nova
Poshta city and branch/address, and a payment method (card or cash on delivery), without having
to create an account. The route's `action` validates the form with zod and calls `createOrder`.
In one transaction, `createOrder` locks stock, computes the totals on the server, writes `orders`
and `order_items`, decrements variant stock and marks the cart `converted`. Then the shopper lands
on a success page that only they can open.

## Dependencies & prerequisites
- **#4 (commerce schema)**: merged. `orders`, `order_items`, `carts` and `cart_items` exist
  (`app/.server/db/schema.ts`), and so do `PAYMENT_METHODS` and `CART_STATUSES` (`app/lib/enums.ts`).
- **#10 (cart)**: merged. `getCartOwner`, `getActiveCartId`, `getCartView` and `lockCart`
  (`app/.server/services/cart.ts`, `app/.server/db/queries/cart.ts`).
- **#26 (volume variants)**: merged. Stock and price come from `product_variants`, and
  `order_items.variant_id` / `volume_ml` exist.
- **#42 (i18n)**: merged. All copy goes into `app/lib/i18n/uk.ts` and `en.ts`.
- **#18 (event tracking)**: **in progress in parallel, not on `origin/main`**. `trackEvent`
  doesn't exist yet, so this issue **does not** record `checkout_start` / `purchase` events. It
  leaves `// #18:` TODO comments in the same style as `routes/catalog.tsx:35` and
  `routes/product.tsx:41`.
- **Migration**: one new migration, `0006_order_checkout_fields`, plus its rollback (step 1). It
  adds `orders.cart_id` (unique, confirmed by the user) and `orders.free_shipping`.
- No new env vars or packages.
- Follow-ups filed during planning: #44 (online card payment provider) and #45 (order-confirmation
  email).

## Decisions & assumptions
- **Stock is per variant.** Lock, check and decrement `product_variants.stock_quantity`, never the
  deprecated `products.stock_quantity`. Copy `product_variants.price` into
  `order_items.price_at_purchase`, and set `order_items.variant_id` and the `volume_ml` snapshot.
  This follows the issue comment and `app/.server/AGENTS.md`, and it overrides the issue body's
  "decrement `products.stock_quantity`".
- **Lock order.** `createOrder` locks the cart row first (`lockCart`, the same order the cart
  service uses). Then it locks the cart's variant rows with
  `SELECT … FROM product_variants WHERE id IN (…) ORDER BY id FOR UPDATE`. A fixed id order means
  two checkouts that share variants can't deadlock. Under READ COMMITTED, `FOR UPDATE` returns the
  latest committed stock, so a concurrent checkout can't oversell. `product_variants_stock_quantity_check`
  (`>= 0`) is the last line of defence.
- **Stock is checked before any write.** If a line's quantity is greater than its locked stock,
  the transaction callback returns `{ ok: false, error: "insufficient-stock", lines }` before
  anything is written, so nothing changes. Any thrown error rolls back the whole transaction.
- **Idempotency / double submit**:
  1. The client disables the submit button while `navigation.state === "submitting"`
     (`Button loading`, as in `register.tsx`).
  2. On the server, the cart row lock serialises two submits of the same cart. After the lock,
     `createOrder` re-reads `carts.status`. If it's already `converted`, it returns the order
     already created from that cart (`orders.cart_id`), and the second request redirects to the
     same success page. A **unique** index on `orders.cart_id` guarantees one order per cart at
     the database level.
- **Totals in SQL, as exact decimals.** The subtotal is `sum(variant.price * quantity)::numeric(10, 2)`
  over the locked rows, as `cartTotals` already does. `discount_amount = 0`.
  `total_amount = subtotal - discount + shipping` is computed in the `INSERT … SELECT` / SQL, never
  with JS floats. `currency = 'UAH'` (the column default). `DISCOUNT_AMOUNT = "0.00"` is a constant
  in `app/lib/checkout.ts`.
- **Shipping (user decision).** When the subtotal (after discount) is **at least 1000 ₴**,
  delivery is free: the store pays Nova Poshta. Below that, the recipient pays Nova Poshta's own
  rate when collecting the parcel. In both cases the store charges nothing for delivery, so
  `shipping_amount = 0.00` and the total doesn't include delivery.
  - Who pays is stored in a new column, `orders.free_shipping boolean not null default false`.
    The store (and #17 / #40 order management) needs to know whether to send the parcel prepaid,
    and it's an analytics feature (does free delivery lift conversion and order value?). Deriving
    it later from the threshold would break if the threshold changes.
  - The column is computed in SQL in the insert, `subtotal >= FREE_SHIPPING_THRESHOLD`.
  - Constants in `app/lib/checkout.ts`: `FREE_SHIPPING_THRESHOLD = "1000.00"` and
    `SHIPPING_AMOUNT = "0.00"`.
  - For the UI, `freeShippingInfo(subtotal)` works on exact integer kopiyky (it parses the decimal
    string, never `Number()` arithmetic). It returns `{ free: true }` or
    `{ free: false, remaining: "<decimal string>" }`, so the summary can say "Free delivery" or
    "Delivery at Nova Poshta rates; add 250 ₴ more for free delivery".
- **Payment (user decision).** Store `payment_method` (`card` | `cod`) as submitted.
  `payment_status` stays `unpaid` (the default) and `status` stays `pending`. For `card`, the
  success page says the store will contact the shopper with payment details. Online payment is #44.
- **Ukrainian phone format.** Strip spaces, `-`, `(` and `)`, then accept `^(\+?38)?0\d{9}$`
  (`+380 67 123 45 67`, `380671234567`, `067 123 4567`). Normalise to `+380XXXXXXXXX` before
  storing it in `orders.guest_phone`, so phone-based identity resolution in LTV models matches the
  same number however it was typed. This is stricter than the loose `PHONE` regex in `lib/auth.ts`,
  which stays as it is.
- **Shipping address.** Two free-text fields, `city` (max 100) and `branch` (branch number,
  parcel locker or street address; max 255). They're stored as one string in
  `orders.shipping_address` in a fixed, locale-independent format: `"<city>, <branch>"`.
  Nova Poshta API autocomplete is out of scope.
- **Customer fields.** `guest_full_name`, `guest_email` (trimmed and lowercased with
  `emailSchema` from `lib/auth.ts`) and `guest_phone` are always stored, for registered users too
  (`schema.ts` comment). `orders.user_id` is the logged-in user's id, or `null` for guests. A guest
  who types the email of an existing account still gets a guest order (`user_id` null). Identity
  resolution happens later, in analytics.
- **Prefill.** For a logged-in user, the loader prefills `fullName`, `email` and `phone` from
  `users`. `PublicUser` has no phone, so add a small `findUserContact` query. The fields stay
  editable.
- **Loader redirects to `/cart`** when the cart is empty, or when any line asks for more than its
  current stock (the cart page already explains this with `cart.stockOut` / `cart.stockLow`).
- **Who can see an order.** The success URL is `/checkout/success/:orderId`, using the serial
  `orders.id` as the order number. The loader shows the order only when `order.user_id` is the
  current user, or when the id is in the cookie session's new `orderIds` (the last 10 orders placed
  in this browser). Everyone else gets **404**, not 403, so order ids can't be probed.
- **Error results.** Validation failures return `data({ fieldErrors, values }, { status: 400 })`
  with message keys, as `register.tsx` does. Insufficient stock returns
  `{ formError: "checkout.errors.stockChanged" }` with status 409 and a link back to `/cart`.
  An empty or already converted cart with no order to show redirects to `/cart`.
- **`TextField` moves** from `app/features/auth/TextField.tsx` to `app/components/ui/TextField.tsx`,
  because two features now use it (AGENTS.md: shared UI goes in `app/components/`). Update the
  imports in `login.tsx` and `register.tsx`.
- **Design.** Checkout isn't on the C+ canvas (`docs/design.md:24`), so build it from the C+
  tokens and components: `blush` summary card like `CartSummary`, Manrope 800 headings, pill
  `Button`, `TextField`, and focus rings as in `docs/design.md`.

## Resolved questions
- **Add `orders.cart_id` (unique) for double-submit idempotency?** — Yes (source: user,
  2026-10-24).
- **Shipping cost?** — Free from 1000 ₴. Below that, the recipient pays Nova Poshta's rate on
  delivery, so the store never charges shipping (source: user, 2026-10-24).
- **Card orders without a payment provider?** — Created `unpaid`. The provider is #44 (source:
  user, 2026-10-24).
- **Order-confirmation email?** — Follow-up #45 (source: user, 2026-10-24).
- **Which stock to decrement?** `product_variants.stock_quantity`. Copy the variant price, and set
  `variant_id` / `volume_ml` (source: #11 comment; `app/.server/AGENTS.md` "At checkout (#11) …").
- **Record `checkout_start` / `purchase`?** Not in this issue. Leave `// #18:` TODOs, because #18
  is built in parallel (source: user instruction; pattern from `app/routes/catalog.tsx:35`).
- **How is a guest's cart found?** `getCartOwner(request)` → `getActiveCartId(owner)`, by
  `user_id` or by `anonymous_id` through `sessions` (source: `app/.server/services/cart.ts`).
- **Where are amounts computed?** In SQL as `numeric`, never as JS floats (source:
  `app/.server/AGENTS.md` "Line totals and the subtotal are computed in SQL"; `app/lib/money.ts`).
- **How are form errors shaped and translated?** As message keys via `msg(...)` and
  `toFieldErrors`, translated when rendered (source: `app/lib/auth.ts`, `app/routes/register.tsx`,
  AGENTS.md i18n section).
- **Is the `/checkout` route registered already?** Yes, as a placeholder (`app/routes.ts`,
  `app/routes/checkout.tsx`). Only the success route is new.
- **Does converting the cart free up the "one active cart" slot?** Yes. The partial unique
  indexes only cover `status = 'active'` (source: `schema.ts`, `carts_active_*_unique`).
- **Payment methods and status?** `card` | `cod` with a CHECK constraint; `payment_status`
  defaults to `unpaid` (source: `app/lib/enums.ts`, `schema.ts`, #11 Context).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/db/schema.ts` | `orders.cartId` + unique index, `orders.freeShipping` |
| create | `app/.server/db/migrations/0006_order_checkout_fields.sql` (+ `meta/` snapshot, journal) | Generated by `pnpm db:generate --name order_checkout_fields` |
| create | `app/.server/db/rollbacks/0006_order_checkout_fields.sql` | Drop the index and both columns |
| modify | `app/lib/commerce.ts` | `Order.cartId: number \| null`, `Order.freeShipping: boolean` (kept in sync by `schema.test.ts`) |
| create | `app/lib/checkout.ts` | zod `checkoutSchema`, `normalizeUkrainianPhone`, `formatShippingAddress`, `freeShippingInfo`, field/error types, DTOs, amount constants |
| create | `app/lib/checkout.test.ts` | Schema and phone tests |
| create | `app/.server/db/queries/orders.ts` | `lockVariantsForCart`, `insertOrder`, `insertOrderItems`, `decrementVariantStock`, `markCartConverted`, `findOrderIdByCartId`, `findOrderConfirmation` |
| modify | `app/.server/db/queries/users.ts` | `findUserContact` (name, email, phone) |
| create | `app/.server/services/orders.ts` | `createOrder`, `getOrderConfirmation`, `canViewOrder` |
| create | `app/.server/services/orders.test.ts` | DB integration tests (transaction, concurrency, idempotency) |
| modify | `app/.server/session.ts` | `SessionData.orderIds?: number[]`, `rememberOrder(session, id)` |
| modify | `app/routes/checkout.tsx` | Real loader, action and page |
| create | `app/routes/checkout-success.tsx` | Success page with access check |
| modify | `app/routes.ts`, `app/routes.test.ts` | Register `checkout/success/:orderId` under `_shop` |
| create | `app/routes/checkout.test.ts` | Loader/action tests with mocked services |
| create | `app/features/checkout/CheckoutForm.tsx` | Contact, delivery and payment sections |
| create | `app/features/checkout/PaymentMethodField.tsx` | Radio group for `card` / `cod` |
| create | `app/features/checkout/OrderSummary.tsx` | Lines + subtotal/shipping/total (checkout and success) |
| create | `app/features/checkout/checkout-ui.test.ts` | Render tests (uk default, en via `I18nProvider`) |
| move | `app/features/auth/TextField.tsx` → `app/components/ui/TextField.tsx` | Shared by auth and checkout; update the imports |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `checkout.*` keys |
| modify | `app/.server/AGENTS.md` | Short "Orders: `services/orders.ts`" section |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [ ] **1. Order checkout fields migration.** In `schema.ts`, add to `orders`:
  - `cartId: integer().references(() => carts.id, { onDelete: "set null" })`, plus
    `uniqueIndex("orders_cart_id_unique").on(t.cartId)` (NULLs don't collide)
  - `freeShipping: boolean().notNull().default(false)`, with a comment saying the store paid Nova
    Poshta

  Run `pnpm db:generate --name order_checkout_fields`, then write
  `rollbacks/0006_order_checkout_fields.sql` (`drop index …; alter table orders drop column
  cart_id, drop column free_shipping;`). Add `cartId: number | null` and `freeShipping: boolean`
  to `Order` in `lib/commerce.ts`. Check: `pnpm test` (`schema.test.ts`, `migrator.test.ts`), and
  `pnpm db:migrate` then `pnpm db:rollback` locally.
- [ ] **2. Shared checkout contract (`app/lib/checkout.ts`).**
  - `normalizeUkrainianPhone(raw): string | undefined` → `+380XXXXXXXXX`.
  - `checkoutSchema` (z.object): `fullName` (trim, 1–255), `email` (`emailSchema`), `phone`
    (trim → normalise → refine, `msg("checkout.errors.phoneInvalid")`), `city` (trim, 1–100),
    `branch` (trim, 1–255), `paymentMethod` (`z.enum(PAYMENT_METHODS)`,
    `msg("checkout.errors.paymentRequired")`).
  - `CHECKOUT_FIELDS`, `type CheckoutField`, and
    `CheckoutFormErrors = AuthFormErrors<CheckoutField>`-style `{ fieldErrors?, formError?, values? }`.
    Reuse `toFieldErrors` from `lib/auth.ts`.
  - `formatShippingAddress({ city, branch })`, `SHIPPING_AMOUNT` / `DISCOUNT_AMOUNT = "0.00"` and
    `FREE_SHIPPING_THRESHOLD = "1000.00"`.
  - `freeShippingInfo(subtotal)`, using exact integer kopiyky (see Decisions).
  - DTOs `CheckoutPrefill`, `OrderConfirmation` (`id`, `createdAt`, contact, `shippingAddress`,
    `paymentMethod`, `freeShipping`, amounts,
    `lines: { title, brand, volumeMl, packSize, quantity, priceAtPurchase, lineTotal }[]`).
  - Tests in `checkout.test.ts`: valid input; each phone variant normalises; invalid phones
    (`+7…`, too short, letters) fail with the key; blank required fields give their keys;
    unknown `paymentMethod` fails. For `freeShippingInfo`: `"999.99"` → 0.01 remaining,
    `"1000.00"` → free, `"1500.50"` → free.
- [ ] **3. i18n keys.** Add the `checkout` namespace to `uk.ts` (source of truth) and `en.ts`:
  `heading`, `form` (aria label), `sections.{contact,delivery,payment}`,
  `fields.{fullName,email,phone,phoneHint,city,branch,branchHint}`, `payment.{card,cod,cardNote,codNote}`,
  `summary`, `subtotal`, `shipping`, `shippingFree` ("Безкоштовно" / "Free"), `shippingCarrierRate`
  ("За тарифами Нової Пошти при отриманні" / "Nova Poshta rates, paid on delivery"),
  `freeShippingHint` ("Додайте ще {amount}, щоб доставка була безкоштовною" / "Add {amount} more for
  free delivery"), `total`, `submit`, `backToCart`,
  `errors.{fullNameRequired,phoneInvalid,cityRequired,branchRequired,paymentRequired,stockChanged}`,
  `success.{title,heading,orderNumber,emailNote,cardNote,codNote,continue}`. Check: `pnpm typecheck`.
- [ ] **4. Order queries (`app/.server/db/queries/orders.ts`).** Use the same
  `Executor = Pick<Db, …>` pattern as `queries/cart.ts`.
  - `lockVariantsForCart(tx, cartId)`: join `cart_items` → `product_variants`, return `variantId`,
    `productId`, `volumeMl`, `price`, `stockQuantity` and `quantity`, ordered by
    `product_variants.id`, with `.for("update", { of: productVariants })`.
  - `cartStatus(tx, cartId)`.
  - `insertOrder(tx, values)`: `.returning({ id })`. `subtotal`, `totalAmount` and
    `freeShipping` come from SQL: sum the cart lines as `numeric(10, 2)` in a `select` first, then
    compute `total = subtotal - discount + shipping` and
    `free_shipping = (subtotal - discount) >= FREE_SHIPPING_THRESHOLD` in SQL
    (e.g. `sql\`${subtotal}::numeric - … \``).
  - `insertOrderItems(tx, orderId, lines)`: one multi-row insert with `priceAtPurchase = price`.
  - `decrementVariantStock(tx, variantId, qty)`: `stock_quantity = stock_quantity - qty`.
  - `markCartConverted(tx, cartId)`: query-builder update, so `$onUpdate` bumps `updated_at`.
  - `findOrderIdByCartId`, `findOrderConfirmation(db, orderId)` (order + lines joined to
    `products` for title, brand and pack size; line total `(price_at_purchase * quantity)::numeric(10, 2)`).
  - Add `findUserContact(db, userId)` to `queries/users.ts`.
- [ ] **5. `createOrder` service (`app/.server/services/orders.ts`).**
  ```ts
  createOrder({ cartId, userId, customer }: CreateOrderInput, db = defaultDb):
    Promise<{ ok: true; orderId: number }
          | { ok: false; error: "cart-empty" }
          | { ok: false; error: "insufficient-stock"; lines: { variantId: string; available: number }[] }>
  ```
  Inside `db.transaction`:
  1. `lockCart`, then `cartStatus`. If `converted`, return `{ ok: true, orderId: findOrderIdByCartId }`
     (the double-submit case). If it's not `active` / no order exists, return `cart-empty`.
  2. `lockVariantsForCart`. Return `cart-empty` when there are no lines. If any
     `quantity > stockQuantity`, return `insufficient-stock` (nothing written yet).
  3. `insertOrder` (with `cartId`, `userId`, the customer fields, `formatShippingAddress`,
     `paymentMethod`, and amounts from SQL), then `insertOrderItems`.
  4. `decrementVariantStock` for each line, then `markCartConverted`.

  A thrown error anywhere rolls everything back. Also add `getOrderConfirmation(orderId)` and
  `canViewOrder(order, { userId, sessionOrderIds })`. Write a top-of-file comment explaining the
  lock order, and a `// #18: trackEvent(request, "purchase", …)` note for the caller.
- [ ] **6. Session: remember a guest's orders.** Add `orderIds?: number[]` to `SessionData` and a
  `rememberOrder(session, orderId)` helper (prepend, dedupe, keep the last 10) in `session.ts`.
  Check: a unit test in `session.test.ts`.
- [ ] **7. Checkout UI components (`app/features/checkout/`).** First move `TextField` to
  `app/components/ui/` and update `login.tsx` and `register.tsx`.
  - `CheckoutForm`: `<Form method="post" noValidate>` with three `<fieldset>`s (contact, delivery,
    payment). The fields use `TextField` with `autoComplete` (`name`, `email`, `tel`,
    `address-level2`). The submit `Button` has `loading={submitting}` and `disabled` while
    submitting.
  - `PaymentMethodField`: accessible radio group (`card`, `cod`) with a short note per option.
  - `OrderSummary`: lines, subtotal, a shipping row, and the total (`formatPrice`). The shipping
    row says "Free" at or above 1000 ₴. Below that, it says "Nova Poshta rates, paid on delivery"
    plus the `freeShippingHint` with the remaining amount. It's used by both pages: on the
    success page from the stored `freeShipping`, at checkout from `freeShippingInfo`.
  - Tests in `checkout-ui.test.ts`: renders the sections and fields; shows field errors with
    `aria-invalid`; the submit button is disabled while submitting; English copy under
    `<I18nProvider locale="en">`.
- [ ] **8. `/checkout` route (`app/routes/checkout.tsx`).**
  - `loader`: `getCartOwner` → `getCartView`. If there are no lines, or any
    `line.quantity > line.stockQuantity`, `throw redirect("/cart")`. Return `{ cart, prefill }`,
    where `prefill` comes from `findUserContact` when logged in. Leave
    `// #18: trackEvent(request, "checkout_start", …)`.
  - `action`: parse `checkoutSchema`. On failure, `data({ fieldErrors, values }, 400)`. Get the
    owner and `getActiveCartId`. If there's no active cart, redirect to `/cart`. Call
    `createOrder({ cartId, userId: owner.userId, customer })`:
    - `insufficient-stock` → `data({ formError: "checkout.errors.stockChanged", values }, 409)`.
    - `cart-empty` → `redirect("/cart")`.
    - ok → `rememberOrder` → `redirect(\`/checkout/success/${orderId}\`, { headers: Set-Cookie })`.

    Leave `// #18: trackEvent(request, "purchase", { properties: { orderId, total } })`.
  - Page: heading, a form error alert with a link to `/cart`, a two-column layout
    (`CheckoutForm` + `OrderSummary` in the `blush` aside), and `meta` via `metaTranslator`.
  - `checkout.test.ts` (mock the services, as the existing route tests do): empty cart redirects;
    an invalid phone returns 400 with the key; ok redirects with `Set-Cookie`; insufficient stock
    returns 409.
- [ ] **9. Success route.** Add `route("checkout/success/:orderId", "routes/checkout-success.tsx")`
  under `_shop` in `routes.ts`, and update `routes.test.ts`. In the `loader`, parse `orderId` as a
  positive int (otherwise 404), then `getOrderConfirmation`. If the order doesn't exist or
  `!canViewOrder`, `throw data(null, { status: 404 })`. The page shows the order number, email
  note, payment note (card/cod), address and `OrderSummary`, plus a "continue shopping" link.
  `meta` has `noindex`. Tests: the owner (user) sees it; a guest whose session has the id sees it;
  another visitor gets 404.
- [ ] **10. Integration tests (`app/.server/services/orders.test.ts`).** Use the
  `describe.skipIf(!hasDatabase)` + `createTestDatabase("jassmin_orders_test")` + seeded products
  pattern from `services/cart.test.ts`:
  - A guest order: `user_id` null, guest fields stored, normalised phone.
  - A user order: `user_id` set.
  - Totals equal the SQL sum of `variant.price * qty`, with `shipping`/`discount` `0.00`;
    `price_at_purchase`, `variant_id` and `volume_ml` are copied.
  - `free_shipping` is `true` for a subtotal of at least 1000 ₴ and `false` below it (seed sizes
    on both sides of the threshold).
  - Stock is decremented, and the cart is `converted` with `updated_at` bumped.
  - Insufficient stock: the result is an error, and stock, cart status and order count are
    unchanged.
  - Forced failure (e.g. a stubbed insert that throws): everything is rolled back.
  - Concurrency: two carts hold the last unit of a variant, and `Promise.all` runs both
    `createOrder` calls. Exactly one succeeds and stock ends at 0.
  - Double submit: `Promise.all` runs two `createOrder` calls on the same cart. Both return the
    **same** `orderId`, and there's exactly one order.
- [ ] **11. Docs.** Add an "Orders: `services/orders.ts`" section to `app/.server/AGENTS.md`
  (lock order, idempotency through `orders.cart_id`, amounts in SQL, session `orderIds` for guest
  access, #18 TODOs). Then run `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and
  `pnpm build`.

## Testing & verification
- Unit: `app/lib/checkout.test.ts`, `app/.server/session.test.ts`,
  `app/features/checkout/checkout-ui.test.ts`, `app/routes/checkout.test.ts`, the success route's
  access tests, `app/routes.test.ts`.
- Integration (needs a DB): `app/.server/services/orders.test.ts`, plus the existing
  `schema.test.ts` / `migrator.test.ts` for the migration.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`):
  1. As a guest, add two sizes and check out with `cod`. You land on `/checkout/success/<id>`,
     the header badge shows 0, and stock in the DB dropped.
  2. Check out a cart under 1000 ₴ (it shows Nova Poshta rates and the "add X more" hint;
     `free_shipping = false`) and one at or above 1000 ₴ (it shows "Free"; `free_shipping = true`).
  3. Open the success URL in a private window: 404.
  4. Log in. The form is prefilled. Check out with `card`, and the order has `user_id` set and
     `payment_status = 'unpaid'`.
  5. Submit invalid fields: inline errors, values kept, uk and en copy.
  6. Lower a variant's stock in the DB below the cart quantity, then submit: a "stock changed"
     error with a link to the cart, and no order.
  7. Without JS, double-click submit: one order.

## Acceptance criteria
- [ ] Guests and registered users can place an order — steps 2, 5, 7, 8, 9, 10
- [ ] Order totals are calculated on the server — steps 4, 5, 10
- [ ] Stock decreases and the cart becomes `converted` only if the order is created — steps 5, 10
- [ ] Concurrent checkouts cannot oversell stock — steps 4 (`FOR UPDATE` in id order), 5, 10
- [ ] Double-submitting the form does not create duplicate orders — steps 1, 5, 7, 8, 10

## Out of scope
- Recording `checkout_start` / `purchase` events (#18 adds them where the TODOs are).
- Online card payment through a payment provider: #44. Until then `payment_status` stays `unpaid`.
- Order-confirmation emails: #45.
- Nova Poshta API (city/branch autocomplete, delivery cost calculation).
- The order history on `/account` (#12) and admin order management (#17 / #40).
- Discounts or promo codes (`discount_amount` stays `0`).
