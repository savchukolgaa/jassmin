# Plan: Show the shop's real bottle photo on product cards and the product page (#118)

Issue: https://github.com/savchukolgaa/jassmin/issues/118
Branch: `issue/118`
Worktree: `.claude/worktrees/issue-118`
Status: Implemented

## Goal
Customers should see a real photo of the bottle they'll receive, not a drawn picture. Products
without their own uploaded photo show the shop's JASSMIN bottle photo (`IMG_1589`, the same photo
for every perfume) on every product card and on the product page. A strip in the perfume's
fragrance-family colour tells them apart. Cart thumbnails keep the drawn label card (#99), and an
uploaded photo still always wins.

## Dependencies & prerequisites
- #99 (drawn label card, `labelPalette`) and #105 (the same photo for the share image): both
  merged on `origin/main`.
- **Source photo**: `images/IMG_1589.JPG` in the main checkout (untracked, 2988×4032, has EXIF).
  It's read once to produce the web sizes and is never committed.
- No new packages: a one-off Pillow (`python -I`) export run from the scratchpad, as in #105. No
  env vars, no migrations.

## Decisions & assumptions
- **The photo files are hashed Vite assets** in `app/assets/shop-bottle/`, not `public/`, and are
  imported as URLs. Vite fingerprints them into `build/client/assets/`, which
  `react-router-serve` serves with a year-long immutable cache. That's better for repeat visits
  and LCP than `public/`, which gets a short cache.
- **WebP only, 5 widths: 320, 480, 640, 960 and 1280 px**, all 4:5 (heights 400…1600). Every
  supported browser decodes WebP, so `<img srcset>` needs no `<picture>`/JPEG fallback, and
  `ProductImage` keeps its single `<img>`.
  - The widths cover `PRODUCT_IMAGE_SIZES`: a card at ~22–46vw and a page image at up to 720 CSS
    px, at 1×–2× DPR.
  - `src` is the 640 px file.
  - Target ≤ 80 KB for the 1280 px file, at quality ~78 with `method=6`.
  - Cropping: `ImageOps.exif_transpose`, a 4:5 box 1700×2125 at (650, 1150), the same framing as
    #105's `share-bottle.jpg`, Lanczos resize, saved without EXIF.
  - AVIF would be smaller, but WebP is simpler and already small (Q1: confirmed).
- **`SHOP_BOTTLE_IMAGE: ResponsiveImage`** lives in a new isomorphic module
  `app/lib/shop-bottle.ts`, so `images.ts` stays asset-free and its tests don't change. It's built
  with the existing `buildSrcSet`, with width/height 1280×1600 (the largest file; `width` and
  `height` on `<img>` only set the aspect ratio).
- **Fallback by layout, not by a new prop.** `ProductImage` already gets
  `layout: "card" | "compact" | "page" | "thumb"`. Without a photo:
  - `thumb` (cart lines, the only thumbnail; `OrderLineItem` doesn't render an image) keeps the
    drawn label card;
  - every other layout gets the shop photo.

  No caller has to change. The issue suggested a `fallback` prop, but the layout already says
  which it is, and a second prop could disagree with it.
- **Family strip**: in the photo frame (`relative`), an absolutely positioned `<span>` along the
  bottom edge, `h-2`, `inset-x-0 bottom-0`, `aria-hidden="true"`, with
  `style={{ backgroundColor: labelPalette(label.family).accent }}`. That's the same accent the
  share image's strip uses. Without a family it's the neutral accent `#D9CDD1`. The strip sits
  inside the rounded frame, so the frame's `overflow-hidden` clips it to the corners, and the
  product page's `md:rounded-t-full` arch works unchanged.
- **Alt text is unchanged**:
  - cards keep `alt=""` (a hidden duplicate link);
  - the product page keeps `t("product.imageAlt", { brand, title })`. The photo shows the bottle
    that perfume ships in, so "<brand> <name>" stays accurate.

  No new i18n keys.
- **Loading is unchanged**: the photo goes through the existing `<img>` branch, so `priority`
  (`loading="eager"`, `fetchPriority="high"`) on the product page and `loading="lazy"` in grids
  work as for uploaded photos. `width`/`height` reserve the 4:5 space, so there's no layout shift.
- The `bg-blush` behind the photo stays, so the frame isn't empty while the image loads.
- `ProductLabelArt` and the `labelDetail` prop stay, because cart thumbnails still use them.

- **Deviation (step 1): quality 60, not 78; the 1280 px file is 117 KB, not ≤ 80 KB.** The
  textured wall compresses poorly. At q78 the 1280 file was 164 KB, and q50 still gave 102 KB.
  q60 looks sharp at full size. The sizes are 12, 27, 44, 79 and 117 KB, and phones at 2× pick
  mostly the 640/960 files.

## Open questions
- [x] **Q1: WebP only, or AVIF too?** Why it matters: AVIF is ~20–30% smaller but needs a
  `<picture>` element (or AVIF-only, which very old Safari can't decode), which complicates
  `ProductImage`. Recommended default: WebP only. Affects steps: 1, 2. **Answer:** default (WebP only), per the user.

## Resolved questions
- **Which photo, where, and how to tell perfumes apart?** `IMG_1589`, on product cards and the
  product page, with a family-colour strip. Cart/order thumbnails keep the drawn card (source:
  user's answers before #118, #118 Context).
- **Which components show product images?** Only `ProductImage`, used by:
  - `ProductCard`: the catalog, offers and similar products (`card`), and home Bestsellers and
    Popular (`compact`);
  - `routes/product.tsx` (`page`);
  - `CartLineItem` (`thumb`).

  `OrderLineItem` renders no image (source: `grep ProductImage app`).
- **Does an uploaded photo still win?** Yes. The fallback runs only when `image` is `null`
  (source: `app/features/catalog/ProductImage.tsx`, #118).
- **Can `app/lib/` import image assets?** Yes. Asset imports are plain URL strings, and
  `client-bundle.guard.test.ts` only forbids zod and server imports (source: AGENTS.md,
  `app/root.tsx`, which already imports font files with `?url`).
- **Can Pillow write WebP here?** Yes (`PIL.features.check("webp")` is `True`).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `app/assets/shop-bottle/shop-bottle-{320,480,640,960,1280}.webp` | the cropped photo in 5 widths, no metadata |
| create | `app/lib/shop-bottle.ts` (+ `.test.ts`) | `SHOP_BOTTLE_IMAGE` (`ResponsiveImage`) from the imported URLs |
| modify | `app/features/catalog/ProductImage.tsx` | photo + family strip without an uploaded photo, label card only for `thumb` |
| modify | `app/features/catalog/ProductImage.test.ts` | new fallback behaviour |
| modify | `app/features/catalog/ProductCard.dom.test.ts` | a card without a photo shows the shop photo (if it asserts the SVG today) |
| modify | `docs/design.md` | "Label card palette": where the drawn card still appears; the shop photo and strip |

## Steps

- [x] **1. Export the photo.** In the scratchpad, write a Pillow script and run it with
  `python -I`:
  - open `C:/Users/КТС/jassmin/images/IMG_1589.JPG` and apply `exif_transpose`;
  - crop `(650, 1150, 2350, 3275)`;
  - for each width in `[320, 480, 640, 960, 1280]`, resize to `(w, w * 5 // 4)` with Lanczos and
    save `shop-bottle-{w}.webp` (quality 78, `method=6`, no `exif=`).

  Check that every file reopens with an empty `getexif()`, that the 1280 file is ≤ ~80 KB, and that
  the bottle is fully in frame at 320 px (look at it). Copy the files to
  `app/assets/shop-bottle/`. Note the exact command in the PR.

- [x] **2. `app/lib/shop-bottle.ts`.** Import the five files
  (`import w320 from "~/assets/shop-bottle/shop-bottle-320.webp"`, …) and export
  `SHOP_BOTTLE_IMAGE: ResponsiveImage = { url: w640, srcSet: buildSrcSet([...]), width: 1280,
  height: 1600 }`. Add a header comment on why one photo serves every perfume. The test checks
  that `srcSet` lists 5 candidates from 320w to 1280w, smallest first, that `url` is the 640 file,
  and the 4:5 width/height.

- [x] **3. `ProductImage`.** Without `image`:
  - if `layout === "thumb"`, render today's `ProductLabelArt` branch, unchanged;
  - otherwise, render the `<img>` branch with `SHOP_BOTTLE_IMAGE`, keeping `alt`, `priority` and
    `sizes`, plus the family strip
    `<span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2" style={{ backgroundColor: labelPalette(label.family).accent }} />`.
    Give the frame `relative`.

  Factor the `<img>` into a small inner function, so the uploaded and shop photos share it. Update
  the JSDoc: "Product photo, or the shop's bottle photo with a family strip without one (#118); the
  drawn label card in thumbnails (#99)."

- [x] **4. Tests.** In `ProductImage.test.ts`:
  - replace "draws the label card without a photo (#99)" with:
    - without a photo (`card`), the `<img>` has `SHOP_BOTTLE_IMAGE`'s `src`/`srcSet`,
      `sizes=card`, `loading="lazy"` and no `<svg>`;
    - the strip's `background-color` is floral `#E86A82`, and neutral `#D9CDD1` with
      `family: null`;
    - `layout: "page", priority: true` gives `loading="eager"` and `fetchPriority="high"`;
    - `alt` is kept, `alt=""` stays empty;
  - keep the label-card tests, run with `layout: "thumb"`: the SVG, the minimal variant, and
    `role="img"`/`aria-hidden`;
  - an uploaded photo still renders with no strip.

  Check `ProductCard.dom.test.ts` (its fixture has `image: null`) and any page tests that assert
  `<svg>` in a card or the product page, and update them to expect the shop photo.

- [x] **5. Docs.** In `docs/design.md`, "Label card palette": a product without a photo now shows
  the shop's bottle photo (`app/lib/shop-bottle.ts`) with a strip in its family `accent` on cards
  and the product page (#118). The drawn label card remains for cart thumbnails, the palette
  table still applies, and an uploaded photo always wins.

- [ ] **6. Verify in the app.** *(Partly verified. `pnpm build` passes, and the five photos are
  fingerprinted into `build/client/assets/` (`shop-bottle-640-D8dv0Hkg.webp`, …). `pnpm start`
  serves them as `image/webp` with `Cache-Control: public, max-age=31536000, immutable`. The
  catalog pages answer 200, but the local dev DB has **no products** (`total: 0` in both
  catalogs), so there was nothing to see the photo on, and Lighthouse wasn't run. To finish:
  `pnpm db:import-catalog` (or seed) locally, then look at a catalog page, a product page and the
  cart, and run Lighthouse mobile. The rendering is covered by the `ProductImage` and
  `ProductCard` tests.)* Run `pnpm build`. With the dev DB migrated (the local DB was behind
  in #105; run `pnpm db:migrate` first if the catalog 500s), run `pnpm dev` or `pnpm start` and
  check:
  - a catalog page, home Bestsellers and Popular show the photo with family strips, and a product
    page shows it as the main image;
  - the cart still shows drawn thumbnails;
  - DevTools shows a fitting WebP width chosen and long-cache `assets/` URLs;
  - Lighthouse (mobile) on a catalog page and a product page scores Performance ≥ 90, with CLS ≈ 0.

## Testing & verification
- Unit: `shop-bottle.test.ts`, `ProductImage.test.ts` (photo fallback, strip colours, thumb label
  card, priority/lazy, alt), and updated `ProductCard.dom.test.ts`.
- `app/lib/client-bundle.guard.test.ts` still passes: `shop-bottle.ts` imports only assets and
  `images.ts`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: step 6, plus Lighthouse mobile.

## Acceptance criteria
- [x] Every product card (catalog, home Bestsellers, Popular, offers, similar products) for a product without its own photo shows the real bottle photo with a strip in its fragrance-family colour; brand, name and price under the card are unchanged — steps 2, 3, 4, 6
- [x] The product page of a product without its own photo shows the same photo with the family strip, loaded with high priority and correctly sized (`srcset`/`sizes`, `width`/`height`) — steps 3, 4, 6
- [x] Products with their own uploaded photo still show that photo, with no strip — steps 3, 4
- [x] Cart and account order thumbnails still show the drawn label card — steps 3, 4 (orders render no image today)
- [x] The committed images contain no EXIF/GPS metadata, and the original photo isn't committed — step 1
- [ ] Lighthouse Performance on a catalog page and a product page stays at or above 90 (mobile), with no layout shift from the photo — step 6 (**not verified**: the local DB has no products; `width`/`height` reserve the 4:5 space, so CLS should be 0)
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 6

## Out of scope
- The share image (#105) and its `share-bottle.jpg`.
- Uploading the photo through Strapi or per product.
- Changing cart/order thumbnails, card layout, or the text under cards.
- Removing `ProductLabelArt`: thumbnails still use it.
