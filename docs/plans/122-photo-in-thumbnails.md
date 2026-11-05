# Plan: Show the shop's bottle photo in order and cart thumbnails (#122)

Issue: https://github.com/savchukolgaa/jassmin/issues/122
Branch: `issue/122`
Worktree: `.claude/worktrees/issue-122`
Status: Planned

## Goal
Customers should see the same real bottle photo everywhere. Account order thumbnails ("Current
orders" cards, "Previous orders" lines) and cart line thumbnails still draw the old label card
(#99). For products without their own photo they switch to the shop's bottle photo
(`SHOP_BOTTLE_IMAGE`, #118), with nothing drawn over it (#120). After this the drawn label card
isn't rendered anywhere, so its component is removed.

## Dependencies & prerequisites
- #118 (`SHOP_BOTTLE_IMAGE`, `app/lib/shop-bottle.ts`) and #120 (no strip): merged on `origin/main`.
- No packages, env vars or migrations.

## Decisions & assumptions
- **`ProductImage` always shows a photo.** `const photo = image ?? SHOP_BOTTLE_IMAGE`, with the
  `layout === "thumb"` exception removed, so the cart thumbnail (`layout="thumb"`,
  `PRODUCT_IMAGE_SIZES.thumb`) gets the shop photo through the same `<img>`.
  - The label-card branch goes, and so do the `label` and `labelDetail` props, which only fed it.
  - Callers stop passing them: `ProductCard` (twice, plus its now-unused `summaryLabel` helper and
    `ProductLabel` import), `routes/product.tsx` and `CartLineItem`.
- **`OrderLineThumb`** (`app/features/account/OrderLineItem.tsx`):
  - a line with `imageUrl` keeps its plain `<img>`, as today (no `srcset` data for order lines);
  - a line without a photo but with a product renders the same `<img>` element with
    `SHOP_BOTTLE_IMAGE`: `src`, `srcSet`, `sizes="52px"`, `alt=""`, `loading="lazy"`,
    `decoding="async"`, the existing `box` + `border-2 border-white bg-white object-cover`
    classes;
  - `sizes` gets a new `PRODUCT_IMAGE_SIZES.orderThumb: "52px"` entry. The tiles are `size-12`
    (48px) and `size-13` (52px), so the browser picks the 320w file;
  - a deleted product (`productId`/`title`/`brand` null) keeps the neutral `bg-card` tile.
    Assumption from #122: a removed product shows no bottle.
- **Delete `app/features/catalog/ProductLabelArt.tsx` and `ProductLabelArt.test.ts`.** After
  this, nothing imports it (`grep ProductLabelArt app`: `ProductImage.tsx` and
  `OrderLineItem.tsx` only).
- **Keep `app/lib/label-art.ts` unchanged except its header comment.** The share image (#105)
  uses `labelPalette`, `layoutLabelText` and `ProductLabel`. `labelVariant`/`BOTTLE_SHAPES`
  become unused by the UI but stay, because they're tested and harmless; removing them is out of
  scope. The header comment changes to: "Label card palette and text fitting (#99): the colours
  and layout helpers the share image (#105) uses."
- **Keep `fragranceFamily` on the cart and order line DTOs** (`app/lib/cart.ts`,
  `app/lib/account.ts`). No longer drawn, but changing the loaders and DTOs is out of scope.

## Resolved questions
- **Which thumbnails draw the label card today?** `OrderLineThumb`, used by
  `CurrentOrderCard.tsx` (up to 3 per current order) and `OrderLineItem` (`PreviousOrdersList`),
  and `ProductImage` with `layout="thumb"` in `CartLineItem` (source: `grep ProductLabelArt app`).
- **Should the cart change too?** Yes, the user chose "Orders and cart" (source: #122 Context).
- **What happens to a deleted product?** It keeps the empty tile (source: #122 Context, today's
  `OrderLineThumb`).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/features/catalog/ProductImage.tsx` (+ test) | always a photo; drop `label`/`labelDetail` and the label-card branch |
| modify | `app/features/catalog/ProductCard.tsx` | stop passing `label`; drop `summaryLabel` |
| modify | `app/routes/product.tsx` | stop passing `label` |
| modify | `app/features/cart/CartLineItem.tsx` | stop passing `label`/`labelDetail` |
| modify | `app/lib/images.ts` | `PRODUCT_IMAGE_SIZES.orderThumb` |
| modify | `app/features/account/OrderLineItem.tsx` (+ `account-ui.test.ts`) | shop photo in `OrderLineThumb` |
| delete | `app/features/catalog/ProductLabelArt.tsx`, `ProductLabelArt.test.ts` | unused |
| modify | `app/lib/label-art.ts` | header comment only |
| modify | `docs/design.md` | "Label card palette": the card is gone; the photo is used everywhere |

## Steps

- [x] **1. `ProductImage` always shows a photo.**
  - Set `photo = image ?? SHOP_BOTTLE_IMAGE`, and render only the `bg-blush` frame with the
    `<img>`.
  - Remove the `label`/`labelDetail` props, the `ProductLabelArt` and `ProductLabel` imports and
    the `role="img"`/`aria-hidden` label-card branch.
  - Update the JSDoc: "Product photo with a fixed 4:5 frame, or the shop's bottle photo without
    one (#118, #122)."
  - Update the callers: `ProductCard` (drop `summaryLabel`, the `ProductLabel` import and both
    `label=` props), `routes/product.tsx` and `CartLineItem`. `pnpm typecheck` will catch any
    leftover.
  - `ProductImage.test.ts`:
    - drop the `label` fixture field;
    - replace the three thumbnail label-card tests with one: `layout: "thumb"` without a photo
      renders the shop photo with `sizes=PRODUCT_IMAGE_SIZES.thumb` and no `<svg>`;
    - keep the uploaded-photo, shop-photo, priority and alt tests.

- [ ] **2. `OrderLineThumb` shows the shop photo.**
  - Add `orderThumb: "52px"` to `PRODUCT_IMAGE_SIZES` (with a comment: "Account order line
    tiles").
  - In `OrderLineThumb`, replace the `ProductLabelArt` branch with an `<img>` of
    `SHOP_BOTTLE_IMAGE` as described in "Decisions", and update the component's JSDoc. The
    deleted-product tile is unchanged.
  - `account-ui.test.ts` → `describe("OrderLineThumb (#99, #122)")`:
    - "shows the shop's bottle photo when the product has no photo": `src`/`srcSet` contain
      `shop-bottle-`, `sizes="52px"`, `alt=""`, and no `<svg>`;
    - the photo and deleted tests stay;
    - check the `CurrentOrderCard`/`PreviousOrdersList` tests in that file still pass.

- [ ] **3. Remove the label card.**
  - Delete `ProductLabelArt.tsx` and `ProductLabelArt.test.ts`.
  - Update the `label-art.ts` header comment.
  - `grep -rn "ProductLabelArt\|labelDetail" app` → no hits.

- [ ] **4. Docs.** In `docs/design.md` → "Label card palette", replace the "Cart thumbnails
  (`layout="thumb"`) keep the generated label card…" paragraph. The shop photo is now the
  picture of every product without its own photo, everywhere: cards, the product page, cart and
  order thumbnails (#122). The generated label card was removed. An uploaded photo always wins.
  Keep the palette table; reword the sentence after it to: "the hex values live in
  `LABEL_PALETTES` … because the share image (#105) uses them".

- [ ] **5. Verify.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`. Manual,
  with products and an order in the local DB: the account page's current order thumbnails,
  previous order lines and the cart show the bottle photo.

## Testing & verification
- `ProductImage.test.ts` (thumb now a photo), `account-ui.test.ts` (`OrderLineThumb` photo,
  photo-less, deleted), `cart-ui.test.ts` and `ProductCard.dom.test.ts` still green.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: the account page and the cart, if the local DB has products and an order.

## Acceptance criteria
- [ ] "Current orders" cards and "Previous orders" lines show the shop's bottle photo for products without their own photo, with no drawn label card — step 2
- [ ] Cart line thumbnails show the shop's bottle photo for products without their own photo — step 1
- [ ] Lines and cart items with their own photo still show it; a deleted product still shows the empty tile — steps 1, 2
- [ ] The drawn label card isn't rendered anywhere on the site; `ProductLabelArt` is removed, and `label-art.ts` stays for the share image — step 3
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 5

## Out of scope
- Removing `labelVariant`/`BOTTLE_SHAPES` or other now-UI-unused exports from `label-art.ts`.
- Dropping `fragranceFamily` from cart/order DTOs or loaders.
- The share image (#105).
- Giving order lines a `srcset` for products' own photos.
