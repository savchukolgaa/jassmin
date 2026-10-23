# Plan: Implement database-backed shopping cart for guests and users (#10)

Issue: https://github.com/savchukolgaa/jassmin/issues/10
Branch: `issue/10`
Worktree: `.claude/worktrees/issue-10`
Status: Planned

## Goal
Shoppers, guests or logged in, can add perfumes (a chosen volume variant) to a cart, change
quantities and remove lines without leaving the page. The cart is stored in `carts` /
`cart_items` so abandoned carts can be analysed later (#19). Guest carts hang off the visitor's
analytics `session_id`, user carts off `user_id`, and a guest cart is merged into the user's cart
on login or registration.

## Dependencies & prerequisites
- **#4 / #5 commerce and analytics schema**: done. `carts`, `cart_items`, `sessions` exist
  (`app/.server/db/schema.ts`); `carts.session_id → sessions` is `on delete set null`.
- **#26 volume variants**: done (merged as #37). Cart lines are per variant
  (`cart_items.variant_id`, unique `(cart_id, variant_id)`); `checkVariantForCart()` in
  `app/.server/services/products.ts` validates submissions; the `/cart` action stub marks where
  to insert (`// #10`).
- **#8 catalog / product page**: done. `AddToCartForm` (`app/features/cart/AddToCartForm.tsx`)
  already posts `intent=add`, `productId`, `variantId` to `/cart` with a keyed `useFetcher`.
- **#6 header badge**: done. `_shop` layout loader → `getHeaderState()` returns
  `cartCount`, currently stubbed to `0` (`app/.server/services/header.ts`).
- **#9 auth**: done. `onUserAuthenticated(request, userId, kind)` in `services/auth.ts` is the
  hook for "merge the guest cart (#10)"; login and register actions already call it.
- **#18 session tracking: NOT done.** Guest carts need an analytics `session_id`, so this issue
  adds a minimal `getVisitor(request)` in `app/.server/analytics.ts` that #18 extends later
  (30-minute session windows, UTM/referrer/device capture, `trackEvent`, `linkVisitorToUser`).
  The `add_to_cart` / `remove_from_cart` events are left to #18.
- **#28 i18n: in progress, planned to merge before this issue** (order: #38 → #28 → #10 / #16).
  If `app/lib/i18n/` exists on `origin/main` when implementation starts, all new UI strings go into
  the `uk` / `en` dictionaries and are read with `useT()` / `t()` (step 0).
- **#38 dark-mode fix**: merges first; just don't add `dark:` utilities (its test forbids them).
- **Migration**: one new migration (`0005_cart_active_unique`) plus its rollback. #16 runs in
  parallel; if it also adds a migration and merges first, regenerate ours on top (step 0 / step 2).
- No new env vars or packages. Cookies are signed with the existing `SESSION_SECRET`.

## Decisions & assumptions
- **Visitor identity (minimal `getVisitor`)** in `app/.server/analytics.ts`:
  - Two signed cookies built with React Router's `createCookie` and `SESSION_SECRET`:
    `anonymous_id` (UUID, `maxAge` 1 year) and `analytics_session` (the current `sessions.session_id`,
    browser-session lifetime). Both `httpOnly`, `sameSite: "lax"`, `path: "/"`, `secure` in
    production. Signing stops a visitor from forging another visitor's id to read their cart.
  - `getVisitor(request, db = defaultDb)` → `{ anonymousId, sessionId, headers }`: reuses valid
    cookies; creates a new `anonymousId` (`crypto.randomUUID()`) when missing/invalid; inserts a
    `sessions` row (`anonymous_id`, `landing_page` = request path) when there's no session cookie
    or its row no longer exists. `headers` holds the `Set-Cookie` values to send (empty when
    nothing changed).
  - `readVisitor(request)` → `{ anonymousId?, sessionId? }` parses the cookies **without writing**.
    Loaders (header badge, `/cart`) only read, so browsing never creates sessions rows; that's
    #18's job. Only the cart `action` calls `getVisitor`.
  - The 30-minute inactivity window, `traffic_source`, `device_type` and event tracking are #18.
    Keep the function signature and cookie names stable so #18 extends rather than replaces it,
    and leave a comment saying so.
- **Finding the active cart**:
  - Logged in: the `active` cart with `carts.user_id = userId`.
  - Guest: the `active` cart with `user_id is null` whose `session_id` belongs to a `sessions` row
    with this `anonymous_id` (join on `sessions`), newest `updated_at` first. Looking up by
    `anonymous_id` rather than the current `session_id` keeps the cart once #18 starts rolling new
    sessions every 30 minutes.
  - Created lazily on the first `add` (`getOrCreateActiveCart`), never by a loader. A user's cart
    also stores the current `session_id` for analytics.
- **One active cart per owner, enforced by the DB**: new migration with partial unique indexes
  `carts_active_user_id_unique (user_id) where status = 'active' and user_id is not null` and
  `carts_active_guest_session_id_unique (session_id) where status = 'active' and user_id is null`.
  `getOrCreateActiveCart` inserts with `onConflictDoNothing` and re-selects, so a double click on
  "Add to cart" can't create two carts.
- **Line identity**: forms identify a line by its variant's `public_id` (`variantId`), looked up
  only inside the visitor's own active cart, so no serial ids are exposed and nobody can edit
  someone else's line.
- **Stock rules** (variant `stock_quantity`, not the deprecated `products.stock_quantity`):
  - `add`: new quantity = existing + `quantity` (default 1). Over stock → typed error
    `exceeds-stock` with `available`; sold out → `out-of-stock` (from `checkVariantForCart`).
  - `update`: quantity must be `1..stock`; above stock → `exceeds-stock`. Quantity `0` isn't
    allowed (use `remove`). Upper bound in zod: 99 per line.
  - Stock isn't reserved; checkout (#11) rechecks and decrements in its transaction. The cart page
    flags lines whose quantity now exceeds stock ("Only N left") instead of silently changing them.
- **`carts.updated_at` is bumped on every change** (`tx.update(carts).set({ updatedAt: new Date() })`)
  in the same transaction as the `cart_items` write; the abandoned-cart job (#19) relies on it
  (`app/.server/AGENTS.md`).
- **Merge on login/register** (`mergeGuestCart(userId, anonymousId)`, one transaction):
  - No guest cart → nothing. User has no active cart → adopt the guest cart (`set user_id`).
  - Both exist → move each guest line into the user cart; same variant → quantities add up,
    capped at the variant's stock; then delete the emptied guest cart. Bump
    the user cart's `updated_at`.
  - Called from `onUserAuthenticated` with `readVisitor(request).anonymousId`, wrapped in
    `try/catch` + `console.error` so a merge failure never blocks logging in.
- **Header count** = sum of line quantities in the active cart (`HeaderState.cartCount` is
  documented as "Number of items").
- **Money**: line totals and the subtotal are computed in SQL as `numeric`
  (`sum(price * quantity)::numeric(10,2)`) and returned as strings; the client only formats them
  with `formatPrice`. No float arithmetic, so no optimistic subtotal: while a quantity change is in
  flight the subtotal is dimmed (`aria-busy`) until revalidation.
- **Form contract** in `~/lib/cart`: a zod `discriminatedUnion("intent", …)`:
  `add { productId, variantId, quantity? }`, `update { variantId, quantity }`,
  `remove { variantId }`, with `z.coerce.number().int()` for quantities. `parseAddToCart` becomes
  `parseCartAction`. `CartActionResult` = `{ ok: true; intent } | { ok: false; error; available? }`,
  errors `invalid | invalid-variant | out-of-stock | exceeds-stock | not-in-cart`; drop
  `cart-unavailable`.
- **Optimistic UI**: each line uses `useFetcher({ key: "cart-line-<variantId>" })`. The shown
  quantity is `fetcher.formData?.get("quantity")` while submitting, else the loader value; a line
  whose pending intent is `remove` is hidden. The stepper buttons are submit buttons
  (`name="quantity" value={q ± 1}`), so it also works without JS (plain form POST to `/cart`).
- **"Added to cart" feedback** in `AddToCartForm`: a `role="status"` toast (`animate-toast`,
  `success` / `success-bg` tokens, per `docs/design.md`) when `fetcher.data?.ok`.
- **Blog cache safety**: blog HTML contains the header's cart count, and today only
  `__jassmin_session` makes it `private`. `hasSessionCookie` (`app/.server/session-cookie.ts`)
  will also treat the `anonymous_id` cookie as a session cookie, so a guest's cart count is never
  cached publicly. The cookie names live in an env-free module (`app/.server/visitor-cookie.ts`)
  so `session-cookie.ts` stays env-free. (#18 will set `anonymous_id` for every visitor, which
  makes all blog responses private; flag it in #18 then.)
- **UI** follows `docs/design.md` (cart isn't designed yet: build from tokens): page heading
  `text-4xl md:text-5xl font-extrabold`, line cards `rounded-card bg-card`, `ProductImage` arch
  thumbnail, pill stepper with `size-11` buttons and `focusRing("onLight")`, `ButtonLink` primary
  "Proceed to checkout" to `/checkout`, empty state linking to `/catalog/women` and `/catalog/men`
  only (no Unisex). Volume label via `formatVolume({ volumeMl, packSize })`, price via
  `formatPrice` of the **variant** price.

## Resolved questions
- **What happens to the guest cart after merging into an existing user cart?** — Delete the
  emptied guest cart; its lines now live in the user cart, and marking it `abandoned` would
  skew #19 (source: user decision, 2026-10-23).
- **Should guests with a cart get uncached blog pages?** — Yes: treat `anonymous_id` as a session
  cookie, so a guest's cart count is never cached publicly; #18 revisits caching once every
  visitor gets the cookie (source: user decision, 2026-10-23).
- **Cart lines per size?** — Yes: `cart_items.variant_id` is required, unique
  `(cart_id, variant_id)`, keep `product_id` equal to the variant's product; validate with
  `checkVariantForCart` (source: #10 comment, `app/.server/AGENTS.md`).
- **Which price/volume/stock to read?** — The variant's; `products.price/volume_ml/stock_quantity`
  are deprecated (source: `app/.server/AGENTS.md`, #26).
- **Where does the merge hook go?** — `onUserAuthenticated` in `services/auth.ts`, which must never
  make login fail; login and register already call it (source: `services/auth.ts`,
  `routes/login.tsx`, `routes/register.tsx`).
- **How does the header refresh?** — The `_shop` loader revalidates after every fetcher action
  (source: `app/routes/_shop.tsx`), so filling in `getHeaderState().cartCount` is enough.
- **Session tracking available?** — No, #18 is open; add a minimal `getVisitor` here and skip the
  cart events (source: user instructions, #18).
- **Unisex catalog link in the empty state?** — No, only women's and men's catalogs (source:
  `docs/design.md`).
- **Where do the new strings go?** — Into the #28 dictionaries if it has merged by then; otherwise
  plain English like the rest of the app (source: user instructions, #28).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `app/.server/visitor-cookie.ts` | Env-free cookie names (`anonymous_id`, `analytics_session`) |
| create | `app/.server/analytics.ts` | `getVisitor`, `readVisitor` (minimal, extended by #18) |
| create | `app/.server/analytics.test.ts` | Cookie creation/reuse, forged cookie, missing session row |
| modify | `app/.server/session-cookie.ts` | `hasSessionCookie` also checks `anonymous_id` |
| modify | `app/.server/db/schema.ts` | Partial unique indexes on active carts |
| create | `app/.server/db/migrations/0005_cart_active_unique.sql` (+ `meta/`) | Generated migration |
| create | `app/.server/db/rollbacks/0005_cart_active_unique.sql` | Hand-written reverse |
| modify | `app/.server/db/schema.test.ts`, `migrator.test.ts` | New indexes |
| create | `app/.server/db/queries/cart.ts` | Small typed cart queries |
| create | `app/.server/services/cart.ts` | `getOrCreateActiveCart`, `getActiveCart`, `getCartView`, `getCartCount`, `addItem`, `updateQuantity`, `removeItem`, `mergeGuestCart` |
| create | `app/.server/services/cart.test.ts` | DB integration tests |
| modify | `app/.server/services/header.ts` (+ test) | Real `cartCount` |
| modify | `app/.server/services/auth.ts` (+ test) | Merge guest cart in `onUserAuthenticated` |
| modify | `app/.server/AGENTS.md` | Document visitor cookies and cart rules |
| modify | `app/lib/cart.ts` (+ test) | Action schema, result/error types, `CartLine` / `CartView` DTOs, messages |
| modify | `app/routes/cart.tsx` (+ test) | Loader and full action |
| create | `app/features/cart/CartLine.tsx` | Line with optimistic stepper and remove |
| create | `app/features/cart/QuantityStepper.tsx` | Pill −/qty/+ control |
| create | `app/features/cart/CartSummary.tsx` | Subtotal + checkout CTA |
| create | `app/features/cart/EmptyCart.tsx` | Empty state |
| create | `app/features/cart/cart-ui.test.ts` | Pure helpers (optimistic quantity, stock notice) |
| modify | `app/features/cart/AddToCartForm.tsx` | "Added to cart" toast, new error messages |
| modify | `app/lib/i18n/{uk,en}.ts` (if #28 merged) | New strings |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [x] **0. Sync with main** — `git -C "$WT" fetch origin && git -C "$WT" rebase origin/main`.
  Check whether #38, #28 and #16 have merged: if `app/lib/i18n/` exists, use `useT()` / `t()`
  for every string in steps 6–8 and add keys to both dictionaries (with Ukrainian plurals for
  "N items"); if `app/.server/db/migrations/0005_*` exists, our migration becomes `0006`.
- [x] **1. Visitor cookies and `getVisitor`** — Create `app/.server/visitor-cookie.ts`
  (`ANONYMOUS_ID_COOKIE = "anonymous_id"`, `ANALYTICS_SESSION_COOKIE = "analytics_session"`).
  Create `app/.server/analytics.ts` with the two signed `createCookie`s, `readVisitor(request)` and
  `getVisitor(request, db = defaultDb)` as in Decisions; validate cookie values with
  `z.uuid().safeParse` (invalid → treat as missing). Session row insert:
  `db.insert(sessions).values({ anonymousId, landingPage: new URL(request.url).pathname })`.
  Add `analytics.test.ts`: unit tests for `readVisitor` (none / valid / tampered signature) and a
  `describe.skipIf(!hasDatabase)` block on `createTestDatabase("jassmin_analytics_test")` for:
  first visit sets both cookies and inserts one session; repeat visit reuses both and returns no
  headers; a session cookie whose row was deleted gets a fresh session with the same anonymous id.
- [x] **2. One active cart per owner** — Add the two partial `uniqueIndex(...).on(...).where(sql…)`
  entries to `carts` in `schema.ts`; `pnpm db:generate --name cart_active_unique`; write
  `db/rollbacks/0005_cart_active_unique.sql` (`drop index if exists …` ×2). Update the carts index
  list in `schema.test.ts` and the index expectations in `migrator.test.ts`; add a migrator test
  that a second active cart for the same user (and for the same guest session) fails with
  `23505`, while a `converted` one doesn't. Run `pnpm test`.
- [x] **3. Blog cache stays private for guests with a cart** — `hasSessionCookie` also matches
  `ANONYMOUS_ID_COOKIE`; update its doc comment and add a case to the blog cache-header tests
  (`services/blog.test.ts`).
- [ ] **4. Cart queries and service** — `db/queries/cart.ts`: `findActiveUserCart(db, userId)`,
  `findActiveGuestCart(db, anonymousId)` (join `sessions`), `insertActiveCart(db, …)` with
  `onConflictDoNothing`, `listCartLines(db, cartId)` (join `cart_items` → `product_variants` →
  `products`, ordered by `added_at`, selecting public ids, title, brand, image, pack size,
  volume, price, stock, quantity and `(price * quantity)::numeric(10,2)` as `lineTotal`),
  `sumCartQuantity(db, cartId)`, `findCartLineByVariant(db, cartId, variantPublicId)`,
  `touchCart(db, cartId)`.
  `services/cart.ts` (all writes in `db.transaction`, `tx` passed down, every change ends with
  `touchCart`):
  - `type CartOwner = { userId: number | null; anonymousId?: string; sessionId?: string }`
    and `getCartOwner(request)` (combines `getUserId` with `readVisitor`).
  - `getActiveCart(owner, db)` (read-only, `null` when none), `getOrCreateActiveCart(owner, db)`.
  - `getCartView(owner, db)` → `CartView` (`lines`, `subtotal` string, `itemCount`); empty view
    when there's no cart. `getCartCount(owner, db)` → number.
  - `addItem(owner, variant, quantity, db)` (variant from `checkVariantForCart`): upsert on
    `(cart_id, variant_id)`; reject with `exceeds-stock` if total > stock.
  - `updateQuantity(owner, variantPublicId, quantity, db)`: `not-in-cart` / `exceeds-stock`.
  - `removeItem(owner, variantPublicId, db)`: `not-in-cart` when absent.
  - `mergeGuestCart(userId, anonymousId, db)` as in Decisions.
  Results are typed unions (`{ ok: true } | { ok: false; error; available? }`), never throws for
  user mistakes. Write `services/cart.test.ts` (integration, own test DB, seeded products):
  guest add creates one cart tied to the session; a second add of the same variant increments;
  add over stock is rejected and nothing changes; update within/above stock; remove;
  `updated_at` moves forward after each change; a guest from a new session with the same
  anonymous id sees the same cart; two concurrent `getOrCreateActiveCart` calls return one cart;
  merge — no user cart (adopted), both carts (quantities summed and capped, guest cart gone),
  no guest cart (no-op); lines and subtotal use the variant price, not `products.price`.
- [ ] **5. Header badge and merge on login** — `getHeaderState` reads the owner and calls
  `getCartCount` (logged-in user → by user id; guest → by anonymous id; neither → 0 without a DB
  hit). `onUserAuthenticated` calls `mergeGuestCart(userId, readVisitor(request).anonymousId)`
  when there's an anonymous id, inside `try/catch` that logs and swallows. Update
  `header.test.ts` (mock the cart service) and add `auth.test.ts` cases: merge called with the
  cookie's anonymous id; a rejecting merge doesn't throw; no cookie → no merge.
- [ ] **6. Form contract** — In `app/lib/cart.ts`: `cartActionSchema` (discriminated union),
  `parseCartAction(formData)`, `CartActionError`, `CartActionResult`, `CartLine`, `CartView`,
  `MAX_LINE_QUANTITY = 99`, updated `CART_ERROR_MESSAGES` (`exceeds-stock` takes `available`, e.g.
  "Only 3 left in this volume."), and a `cartErrorMessage(result)` helper. Rewrite
  `app/lib/cart.test.ts` for all three intents, coercion, bounds and unknown intents.
- [ ] **7. Cart route** — `routes/cart.tsx`:
  - `loader`: `getCartView(await getCartOwner(request))`.
  - `action`: `parseCartAction` → 400 `invalid`. Then `const visitor = await getVisitor(request)`,
    owner = `{ userId: await getUserId(request) ?? null, ...visitor }`. `add`:
    `checkVariantForCart` (400/409 as today) → `getOrCreateActiveCart` → `addItem`. `update` /
    `remove`: on the active cart (none → `not-in-cart` 404). Status codes: `exceeds-stock` 409,
    `not-in-cart` 404. Every response, success or error, is `data(result, { headers: visitor.headers })`
    so the cookies are set on the first add.
  - Update `meta` and replace the placeholder with the page (step 8).
  - Rewrite `routes/cart.test.ts` mocking `services/cart`, `services/products`, `analytics` and
    `session`: each intent's success and error paths, status codes, `Set-Cookie` passed through,
    nothing written on invalid input.
- [ ] **8. Cart UI** — `QuantityStepper` (pill, `−` / value / `+`, `size-11` buttons,
  `aria-label`s, `−` disabled at 1, `+` disabled at stock or 99); `CartLine` (image, title + brand,
  `formatVolume`, unit price, stepper, line total, remove link-style button, "Only N left" notice
  when `quantity > stockQuantity`, inline error from its fetcher with `aria-live`); `CartSummary`
  (item count, subtotal dimmed with `aria-busy` while any line fetcher is busy —
  `useFetchers()` filtered by the `cart-line-` key prefix — and primary `ButtonLink` "Proceed to
  checkout" to `/checkout`); `EmptyCart` (heading, short copy, links to both catalogs). Put the
  optimistic logic in pure helpers (`optimisticQuantity(formData, fallback)`,
  `isPendingRemove(formData)`) tested in `cart-ui.test.ts`. Responsive: lines stack on mobile,
  summary sits beside the list from `lg:`; no horizontal scroll at 375px.
- [ ] **9. Add-to-cart feedback** — `AddToCartForm`: on `fetcher.data?.ok` show an "Added to
  cart" toast (`role="status"`, `animate-toast`, `bg-success-bg text-success`, link "View cart"
  to `/cart`); errors use `cartErrorMessage`. Check catalog cards and the product page still
  submit `variantId` correctly.
- [ ] **10. Docs** — `app/.server/AGENTS.md`: a "Visitor" section (`getVisitor` / `readVisitor`,
  signed cookies, only actions create sessions rows, #18 extends it) and cart rules (one active
  cart per owner via partial unique indexes, guest lookup by `anonymous_id`, merge in
  `onUserAuthenticated`, stock checks). Mention the cart's `Set-Cookie` in the README only if it
  lists cookies.
- [ ] **11. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, then the manual
  checks below.

## Testing & verification
- Automated: `app/lib/cart.test.ts`, `app/.server/analytics.test.ts`,
  `app/.server/services/cart.test.ts` (DB), `header.test.ts`, `auth.test.ts`, `blog.test.ts`,
  `schema.test.ts`, `migrator.test.ts`, `app/routes/cart.test.ts`, `app/features/cart/cart-ui.test.ts`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` (run with the dev DB up under
  `pnpm aspire run` so integration tests aren't skipped).
- Manual (`pnpm aspire run`):
  - As a guest, add two sizes of one perfume from the product page and one from a catalog card:
    header badge updates without a reload, toast appears; `/cart` shows volume and variant prices.
  - Reload: cart persists; `select * from carts` / `cart_items` / `sessions` show one guest cart
    tied to a session with the cookie's `anonymous_id`.
  - Stepper: `+` up to stock then disabled; forcing a higher quantity (devtools) returns the
    "Only N left" error; quantity changes feel instant; remove hides the line immediately.
  - With JS disabled: add, update and remove still work via full form posts.
  - Log in with a guest cart and an existing user cart: lines merged, quantities capped at stock,
    badge correct; log out → guest sees an empty cart.
  - Blog page as a guest with a cart returns `Cache-Control: private, no-cache`.
  - 375px width: no horizontal scroll; keyboard focus rings visible on stepper and remove.

## Acceptance criteria
- [ ] Guests and logged-in users can add, update and remove items — steps 1, 4, 6, 7, 8
- [ ] Cart persists across reloads and is stored in `carts` / `cart_items` — steps 1, 2, 4, 7
- [ ] Header cart count updates after adding items without a full reload — steps 5, 9
- [ ] Quantity cannot exceed available stock — steps 4, 6, 7, 8
- [ ] Guest cart merges into the user cart on login — steps 4, 5

## Out of scope
- `add_to_cart` / `remove_from_cart` events, 30-minute session windows, UTM/device capture and
  linking sessions to users on login (#18).
- Checkout, stock decrement and marking the cart `converted` (#11).
- Abandoned-cart detection and emails (#19).
- Stock reservation while items sit in a cart.
- Translating product data; adding new locales beyond what #28 provides.
