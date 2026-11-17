# Plan: Add to cart from the AI perfumer's product cards in the chat (#169)

Issue: https://github.com/savchukolgaa/jassmin/issues/169
Branch: `issue/169`
Worktree: `.claude/worktrees/issue-169`
Status: Implemented

## Goal
A customer chatting with the AI perfumer can pick a size and add a recommended perfume to the cart
right from its card in the chat, without leaving the conversation. The pick cards get back the
catalog card's size picker and "Додати в кошик" button (the existing `AddToCartForm` and cart
action), and cart adds from the chat are recorded with `list_id: "perfumer"` and the card's position.

## Dependencies & prerequisites
- **#163** (chat page, `ProductCard purchase` prop): merged (`1de78cd`).
- **#166** (`"perfumer"` in `LIST_IDS`, `ProductListProvider listId="perfumer"` per finished
  answer): merged (`a00ed3e`). The cart action already accepts and records `listId` /
  `listPosition` (`app/routes/cart.tsx` → `listOf`, `app/lib/cart.schema.ts`).
- The issue suggests starting "once #166 has some data": a product call, not a code dependency.
- **Design:** the updated C+ canvas `C+ AI perfumer` artboards with the card's cart controls are
  approved by the owner (confirmed 2026-11-17). Implementation follows them; where they're silent,
  it follows the catalog card.
- No new packages, env vars or migrations.

## Decisions & assumptions
- **Same controls as the catalog card.** `MessageThread`'s `PickList` drops `purchase={false}`, so
  `CatalogProductCard` renders `CardPrice` (the picked size's price instead of "from …"), the
  `CardVolumePicker` for several sizes, and `AddToCartForm` (`size="sm"`). The "Чому вам пасує" box
  stays `children`, so it renders after the form: price → picker → button → reason, as the issue
  asks. No quantity stepper. The `purchase` prop stays on `ProductCard` (no other caller hides the
  controls today, but the issue asks to keep it); its doc comment is updated.
- **List context comes for free** on finished answers: their cards already get `listIndex` inside
  `ProductListProvider listId="perfumer"`, and `CatalogProductCard` passes `listed.list` to
  `AddToCartForm`, which posts `listId=perfumer` and the 1-based `listPosition`.
- **The streaming turn's cards** (shown for the split second between the `picks` event and `done`)
  also get the controls, so the card doesn't change height when the finished turn replaces it.
  They stay outside a product list (#166 keeps them untracked so impressions don't count twice), so
  an add in that moment posts without a list. Accepted: the window is a few hundred ms.
- **One fetcher per card per answer.** `AddToCartForm` keys its fetcher `add-to-cart-<productId>`,
  so the same perfume recommended in two answers would share its "Added to cart" state (and a
  later answer would open already "added"). Add an optional `fetcherKey` prop to `AddToCartForm`
  (default unchanged) and have `PickList` pass `perfumer-<turn item id>-<productId>`. To keep the
  state when the streaming turn becomes the finished one, the finished item reuses the pending
  turn's id (`finish` in `usePerfumerThread` uses `pending.id` / `id` instead of `newId()` for the
  perfumer item). Stored threads keep their ids, so a reload keeps distinct keys too.
- **The thread survives the add.** The thread lives in `usePerfumerThread`'s state and its own
  (unkeyed) fetcher, neither touched by the cart fetcher; `PerfumerPage` doesn't remount on
  revalidation. To make it explicit and skip a pointless loader run, `app/routes/perfumer.tsx`
  exports `shouldRevalidate = shouldRevalidateView` (as `catalog.tsx` does): no revalidation after a
  non-GET form (the cart add, the perfumer's own action, ratings), yes on locale changes. The
  `_shop` loader still revalidates, so the header badge updates. Scroll isn't touched by a fetcher.
- **Focus stays on the add button.** `Button` sets `disabled` while `loading`, which drops focus to
  `<body>` in browsers. Fix it in `AddToCartForm` (scoped, also fixes the catalog): when the submit
  button had focus at submit, focus it again once the fetcher is idle. Changing `Button` globally is
  out of scope.
- **Confirmation and errors reuse the cart's UI and copy**: `cart.added` + `cart.view` ("Переглянути
  кошик" link) with `role="status"`, and `cartErrorMessage` for `out-of-stock` / `not-found` /
  `exceeds-stock`. No new i18n keys are expected; if the approved artboard adds one, it goes into
  `uk.ts` and `en.ts` under `perfumer`.
- **Stale picks** restored from `sessionStorage` (price or stock changed) need no special handling:
  the cart action re-checks via `checkVariantForCart` and the card shows the normal error. A pick
  whose stored `inStock` is `false` shows the disabled "Немає в наявності" button.

- **The confirmation is scrolled into view (Q2).** In the chat, once "Додано в кошик" (or the
  cart's error) appears under the button, the page scrolls just enough to show it above the sticky
  message bar: `AddToCartForm` gets an optional `revealResult` prop; when a new result shows, it
  calls `scrollIntoView({ block: "nearest" })` on the status line (`behavior: "smooth"` unless
  `prefers-reduced-motion`), and the perfumer passes a `scroll-mb-*` class sized to the bar
  (measured at 375px; the bar is taller there with the disclaimer) so `nearest` clears it. It
  never moves focus and does nothing when the line is already visible. Off by default, so the
  catalog doesn't change.
- **Deviations found while implementing.**
  - `ProductCard` takes one `cartForm` prop (`fetcherKey`, `revealResult`, `statusClassName`,
    the `CartFormOptions` type) instead of separate `cartKey`/reveal props: one pass-through.
  - The approved C+ canvas's `PerfumerPlus` / `PerfumerPlusPhone` artboards (as published on
    2026-11-17) still draw the card without cart controls ("від [PRICE] ₴"), so the layout follows
    the catalog card: `CardPrice` `font-extrabold`, the picker, the `sm` button, the status line,
    then the reason box (its top margin trimmed from `mt-3.5` to `mt-1.5`, as the form already
    ends with the `min-h-5` status line).
  - The status line's clearance above the message bar is `scroll-mb-48 sm:scroll-mb-40` (the bar
    is ~170px on phones with the disclaimer wrapped, ~130px from `sm`).

## Resolved questions
- **Q2: Should the chat scroll so the "Added to cart" confirmation isn't hidden under the sticky
  message bar on phones?** — Yes (source: the user, 2026-11-17). See "The confirmation is scrolled
  into view" above; steps 1, 3, 6, 8.
- **Q1: Has the owner approved an updated `C+ AI perfumer` artboard with the cart controls?** —
  Yes, already approved (source: the user, 2026-11-17). Steps 3 and 7 take the price style, button
  size and spacing from the approved artboard rather than assuming the catalog card's.
- **Does the cart action already take the list context?** — Yes: `listId` (enum incl.
  `"perfumer"`), `listPosition` and `searchId` are parsed and added to `add_to_cart`
  (source: `app/lib/cart.schema.ts`, `app/routes/cart.tsx` → `listOf`, `app/lib/analytics.ts`
  `LIST_IDS`).
- **Is `list_position` 0- or 1-based?** — 1-based; `useListedProduct` converts the 0-based
  `listIndex` (source: `app/features/analytics/ProductList.tsx`, `docs/analytics-events.md`).
- **Does the corner button react to the chat's cart adds?** — No: it's hidden on `perfumer`
  (source: `PERFUMER_CORNER_HIDDEN_PAGES` in `app/lib/perfumer.ts`).
- **Is new copy needed for the link to the cart?** — No: `AddToCartForm`'s confirmation already
  has the `cart.view` link (source: `app/features/cart/AddToCartForm.tsx`).
- **Does a stale card need its own error?** — No: the cart action re-checks stock and price and
  returns `out-of-stock` / `not-found` (source: `app/routes/cart.tsx`, issue assumptions).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/features/cart/AddToCartForm.tsx` | optional `fetcherKey` prop; refocus the button after a submit that had focus |
| modify | `app/features/catalog/ProductCard.tsx` | pass `fetcherKey` through to `AddToCartForm`; update the `purchase` doc comment |
| modify | `app/features/perfumer/MessageThread.tsx` | cards with `purchase` on and a per-answer `fetcherKey`; update the header comment |
| modify | `app/features/perfumer/usePerfumerThread.ts` | finished perfumer item reuses the pending turn's id |
| modify | `app/routes/perfumer.tsx` | `export const shouldRevalidate = shouldRevalidateView` |
| modify | `app/features/perfumer/MessageThread.dom.test.ts` | picker/button (uk/en), posted fields, errors, axe |
| modify | `app/features/perfumer/PerfumerPage.dom.test.ts` | thread, input and focus survive an add and revalidation |
| modify | `app/features/cart/` tests or `app/features/catalog/ProductCard.dom.test.ts` | `fetcherKey` and refocus |
| modify | `app/routes/perfumer.test.ts` | `shouldRevalidate` cases |
| modify | `docs/design.md` | perfumer section: cards with cart controls |
| modify | `docs/analytics-events.md` | `perfumer` list: cards now post `add_to_cart` with the list |
| modify | `docs/ai-perfumer.md` | chat section: adding to the cart from a card |

## Steps
- [x] **1. `AddToCartForm`: `fetcherKey` and focus** — Add `fetcherKey?: string` (default
  `add-to-cart-${productId}`). Keep a ref to the submit button (`Button` forwards `ref`? check; else
  wrap via `form.querySelector('button[type=submit]')`), note in `onSubmit` whether
  `document.activeElement` is it, and in an effect on `fetcher.state === "idle"` focus it again.
  Same for the icon variant. Add `revealResult?: boolean` and `statusClassName?: string`: when a
  new result shows and `revealResult` is set, scroll the status line into view (`block: "nearest"`,
  smooth unless reduced motion). Test: the key separates two forms for one product; focus returns;
  `scrollIntoView` is called only with `revealResult`.
- [x] **2. `ProductCard`: pass the key** — `CatalogProductCard` takes an optional `cartKey` prop
  (through `ProductCardProps`, default card only) and passes it as `fetcherKey`. Update the
  `purchase` comment (no longer "the AI perfumer's cards link to the product instead").
- [x] **3. `MessageThread`: turn the controls on** — In `PickList`, drop `purchase={false}`, take a
  `turnId` and pass `cartKey={`perfumer-${turnId}-${pick.product.id}`}`; `StreamingTurn` passes
  `pending.id`, `PerfumerTurn` passes `item.id`. Match the approved `C+ AI perfumer` artboards (price
  style, button size, spacing). Check at 375px and desktop that the reason box sits
  under the button with the card's spacing (`mt-3.5` may need trimming since the form has `pt-3`
  and a `min-h-5` status line). Turn on `revealResult` with a `scroll-mb-*` that clears the
  sticky message bar (via a new optional `ProductCard` prop passed through to the form). Update
  the file's header comment.
- [x] **4. `usePerfumerThread`: stable turn id** — In both finish paths (fetcher result and stream
  `done`), give the `perfumer` item the pending turn's `id` (errors keep `newId()`). Check the
  `key` on `StreamingTurn` (`${pending.id}-reply`) vs `PerfumerTurn` (`item.id`) don't collide.
- [x] **5. `perfumer.tsx`: `shouldRevalidate`** — Export `shouldRevalidateView` from
  `~/lib/analytics`. Test: POST to the cart → `false`; locale switch → `true`.
- [x] **6. Tests** — `MessageThread.dom.test.ts` (with a router and a `/koshyk` action stub):
  a several-size pick renders the size picker and "Додати в кошик" / "Add to cart" in `en`;
  submitting posts `intent=add`, the chosen `variantId`, `listId=perfumer`, `listPosition=2` for the
  second card; an `out-of-stock` result shows the cart's message and no "Додано в кошик"; a pick
  with `inStock: false` shows the disabled out-of-stock button; the same product in two answers
  keeps separate states; axe has no violations on an answer with cards. `PerfumerPage.dom.test.ts`:
  after an add (action + `_shop` loader revalidation) the thread items, the draft in the input and
  focus on the add button are unchanged, and `sessionStorage` still holds the thread.
- [x] **7. Docs** — `docs/design.md`: replace "default product cards without cart controls
  (`purchase={false}`, "from …" price)" with the cart controls (price of the picked size, picker,
  `sm` add button, "Додано в кошик · Переглянути кошик" status, then the reason box). Update the
  approved artboards in the design table if their names changed. `docs/analytics-events.md`: the `perfumer` list paragraph now
  says the cards post `add_to_cart` with `list_id: "perfumer"` and `list_position`.
  `docs/ai-perfumer.md`: a bullet on adding to the cart from a card (stale picks re-checked).
- [ ] **8. Manual check** — `pnpm aspire run` with `AI_BASE_URL` set: ask the perfumer, change a
  **Not done yet:** Docker (and so Postgres) wasn't running and no AI engine was available while
  implementing; to do before merging.
  size, add; the header badge updates, the conversation, scroll and draft stay, focus stays on the
  button; keyboard-only and a screen reader announce "Додано в кошик"; 375px layout with the sticky
  bar: adding from a card low on the screen scrolls "Додано в кошик" just above the bar; reload and add a stale/out-of-stock pick.

## Testing & verification
- Vitest DOM tests in step 6, plus the `AddToCartForm`/`ProductCard` and `perfumer.test.ts` cases.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual checks in step 8; check `user_events` for an `add_to_cart` row with
  `list_id: "perfumer"` and `list_position`.

## Acceptance criteria
- [x] Each recommended card in the chat has a size picker (several sizes) and an add-to-cart button, matching the catalog card — steps 2, 3, 6
- [x] Adding to the cart keeps the customer on the chat with the conversation, scroll position and input intact, and updates the header's cart count — steps 1, 4, 5, 6, 8 (tests; real scrolling to be seen in step 8)
- [x] Cart adds from the chat are recorded with `list: "perfumer"` and the card's position — steps 3, 6, 7
- [x] Out-of-stock and stale picks show the cart's normal error instead of adding — steps 3, 6, 8
- [ ] The controls follow the approved C+ chat design on mobile and desktop, and are keyboard and screen-reader friendly — steps 1, 3, 6, 7, 8 — **unverified:** keyboard and screen-reader use, labels and axe are covered by tests, but the layout at phone and desktop width needs step 8, and the canvas artboards show no cart controls (see Decisions)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — all steps — typecheck, lint and build pass; `pnpm test`: all 2207 tests that need no database pass, the 46 PostgreSQL test files fail with `ECONNREFUSED :5432` (Docker not running), so CI or a local run with the database must confirm them

## Out of scope
Adding several picks at once, a cart summary inside the chat, the perfumer reasoning about the
cart's contents, the floating chat button (#165), a quantity stepper, a new toast, and changing
`Button`'s `loading` behaviour globally.
