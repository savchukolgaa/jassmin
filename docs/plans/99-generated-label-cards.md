# Plan: Show a generated label card for products without a photo (#99)

Issue: https://github.com/savchukolgaa/jassmin/issues/99
Branch: `issue/99`
Worktree: `.claude/worktrees/issue-99`
Status: Planned (questions answered)

## Goal

Customers should be able to tell perfumes apart even though none of the ~140 products has a photo.
Every product without a photo gets a generated label card instead of the brand initial on blush. The
card is an inline SVG in the Option C+ style: a bottle and cap silhouette, the brand, the perfume
name and the "jassmin." wordmark. Its colours come from the product's main fragrance family, and the
bottle shape varies by product id. An uploaded Strapi photo always replaces the card.

## Dependencies & prerequisites

- #65 fragrance families (`FRAGRANCE_FAMILIES` in `app/lib/enums.ts`, `products.fragrance_family`
  holding the primary family): on `main`.
- #73 Playfair Display: on `main`. `app/root.tsx` preloads the Cyrillic subset, so SVG `<text>` in
  `var(--font-serif)` needs no extra font request.
- #88 / #96 (CWV, `ProductImage` layouts, Lighthouse ≥ 90): on `main`. The card must keep the 4:5
  frame and add no requests or JS.
- #85 share images (`seoMeta` image, `DEFAULT_SHARE_IMAGE`): on `main`.
- No new packages, env vars or migrations for steps 1–8. `fragrance_family` already exists, and the
  queries only need to select it.

## Decisions & assumptions

- **Pure logic in `app/lib/label-art.ts`** (isomorphic, no zod, no React): the family → palette map,
  the deterministic variant from the id, and the text layout (line wrapping and font size). The SVG
  component `app/features/catalog/ProductLabelArt.tsx` only draws. This logic can be unit tested
  without rendering, and a later server-side PNG renderer can reuse it.
- **The palette lives in TypeScript as hex values** (`LABEL_PALETTES`), and the SVG uses those
  values directly as `fill`. These are the design tokens, and `docs/design.md` documents them as a
  "Label card palette" table. They are not added to Tailwind's `@theme`, because v4 drops theme
  variables that no class uses, so `fill="var(--color-…)"` built at runtime would break. Hex values
  also work in a rasterised OG image and in emails. (Q2)
- **Families map to palette groups.** Similar families share a group, so 16 families need only 9
  palettes (`bg` / `accent` / `ink`):
  | Group | Families | Look |
  |---|---|---|
  | `floral` | квіткові, альдегідні | blush pink / C+ primary |
  | `fruity` | фруктові | peach / coral |
  | `oriental` | східні, пряні | deep plum (light text) |
  | `gourmand` | гурманські, ванільні | warm caramel |
  | `woody` | деревні, шипрові | warm brown (light text) |
  | `fresh` | свіжі, водяні | light blue |
  | `green` | зелені, цитрусові | light green |
  | `aromatic` | ароматичні, фужерні | sage / teal |
  | `musky` | мускусні | soft lavender-taupe |
  | `neutral` | no family or an unknown legacy value | `card` grey / `muted` |

  `labelPalette(family: string | null)` returns `neutral` for `null` or anything that fails
  `isFragranceFamily`. A `Record<FragranceFamily, LabelPaletteKey>` makes `pnpm typecheck` fail
  when a family has no group.
- **Variation:** `labelVariant(id)` hashes the product's `public_id` with FNV-1a (32-bit) and
  returns `{ bottle: 0..3, cap: 0..2 }`: four bottle silhouettes (tall rectangle, rounded flask,
  faceted, round) and three caps. This is deterministic, so SSR and hydration always match. With
  12 combinations per palette, two perfumes from the same family usually differ in shape, and they
  always differ in their printed name.
- **Fitting the text without measuring it.** The server can't measure text, so `layoutLabelText`
  works by character count. It wraps the name on spaces into at most 3 lines of ≈14 characters and
  hard-breaks a single word that's longer than that. It picks the font size from the longest line
  (for example 30 → 19 px in viewBox units), and adds an ellipsis after the 3rd line. The
  brand goes on one line in small caps (`letter-spacing`, uppercase) and is truncated the same way.
  - *Deviation (step 2):* the planned `textLength` squeeze was dropped. Because wrapping already
    keeps every estimated line within the width, the flag never fired. `textLength` would also
    *stretch* lines that are narrower than estimated. Instead, the estimate uses a deliberately
    wide average glyph (0.58 × font size), so wide Cyrillic and capital letters still fit.
- **SVG geometry:** `viewBox="0 0 400 500"` (4:5) with `width`/`height` 100% inside the existing
  `aspect-[4/5]` frame, so the layout is the same as before (CLS 0). The background fills the frame
  and the bottle is centred. The text sits on a light label panel on the bottle, or directly on the
  background where that passes contrast. "jassmin." goes at the bottom. Each card should be
  ≲ 1.5 KB of markup, since a catalog page renders up to 24 of them inline.
- **Contrast:** each palette's `ink` (the name and brand) is checked against the surface it sits
  on: the label panel colour, or `bg` when there's no panel. A unit test computes the WCAG relative
  luminance ratio and requires ≥ 4.5:1 for all palettes (normal text, the strictest case).
- **`ProductImage` API:** replace the `brand: string` prop with
  `label: { id: string; brand: string; title: string; family: string | null }`. The frame, `alt`,
  `role="img"` / `aria-hidden` rules and the photo branch stay as they are. Without a photo, the
  frame keeps `rounded-card` but the SVG paints the background instead of `bg-blush`.
- **Thumbnails:** the cart uses `layout="thumb"`, which is 96–112 px wide. There the card is drawn
  with `detail="minimal"` (bottle and colour only, with no text, which would be unreadable at that
  size). The account's `OrderLineThumb` (48–52 px squares) uses the same minimal art, cropped to a
  square with `preserveAspectRatio="xMidYMid slice"`. Lines whose product has been deleted
  (`title === null`) keep the neutral tile.
- **Checkout and emails:** `OrderSummary` shows no images today, and the order emails
  (`app/.server/services/order-email.ts`) contain no `<img>`. Since there's nothing to replace,
  both stay unchanged. (Q3)
- **OG image:** split into a follow-up issue (Q1). A correct PNG needs a
  rasteriser with real fonts: Playfair is loaded from `@fontsource`, and librsvg/`sharp` would fall
  back to system fonts and draw the label differently. `satori` + `@resvg/resvg-js` adds about
  10 MB of native/WASM dependencies and a caching strategy. That is too much for this UI issue. Until
  then, products without a photo keep sharing `/og-default.jpg`, as they do today.

## Resolved questions

Answered by the user on 2026-11-02:

- **Q1: Should the OG PNG route (`/og/products/<slug>.png`) be part of this issue?** No. It
  becomes a follow-up issue, created with `/create-issue` in step 9 and linked from the PR, which
  satisfies the "or a follow-up issue exists" criterion. Until then, products without a photo keep
  sharing `/og-default.jpg`.
- **Q2: Where does the palette live?** As hex constants in `app/lib/label-art.ts`, documented in
  `docs/design.md`. They are not added as CSS `@theme` tokens.
- **Q3: Which other places get the card?** Account order thumbnails get the minimal card (no
  text). The checkout summary stays as it is, with no images.
- **Q4: Is the palette approved?** Build the table above, and put a screenshot of
  `/katalog/zhinochi` in the PR so the store owner can approve it before merging (step 8).

Answered from the codebase:

- **Which family picks the colour?** The primary one: `ProductSummary.fragranceFamily`
  (= `products.fragrance_family`, kept equal to `fragrance_families[1]` by the CHECK
  `products_fragrance_family_primary_check`), and `ProductDetail.fragranceFamilies[0]` on the
  product page (source: `app/.server/db/schema.ts:98-149`, `app/lib/products.ts`).
- **Can stored families hold values outside the enum?** Yes. Rows written before #65 can, so
  reads are `string` and unknown values fall back to `neutral` (source: `app/lib/enums.ts:110`).
- **Which id gives the variation?** The product's `public_id` (a uuid string), exposed as
  `ProductBase.id` and `CartLine.productId`. Serial ids never leave the server (source:
  `app/lib/products.ts:1-3`).
- **Where does `ProductImage` appear?** In `ProductCard.tsx` (catalog and compact cards, which
  also cover home, popular and offers), `routes/product.tsx` and `CartLineItem.tsx`. The account
  uses its own `OrderLineThumb`, and checkout and emails show no images (source: grep of
  `<ProductImage` / `<img`).
- **Does the card need its own font request?** No. `app/root.tsx` preloads Playfair (Cyrillic)
  and Manrope, and `app/app.css` imports both (source: `app/root.tsx:28`).
- **Can components import zod?** No. `label-art.ts` must stay zod-free, and
  `client-bundle.guard.test.ts` enforces that (source: `AGENTS.md`, #96).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `app/lib/label-art.ts` | Palettes, `labelPalette`, `labelVariant` (FNV-1a), `layoutLabelText`, `contrastRatio` |
| create | `app/lib/label-art.test.ts` | Mapping, neutral fallback, determinism, wrapping (Cyrillic and Latin), WCAG AA |
| create | `app/features/catalog/ProductLabelArt.tsx` | Inline SVG card (`detail: "full" \| "minimal"`) |
| create | `app/features/catalog/ProductLabelArt.test.ts` | Static markup: viewBox, colours, text, no `<img>`/URLs |
| modify | `app/features/catalog/ProductImage.tsx` | `label` prop replaces `brand`; render the card without a photo |
| modify | `app/features/catalog/ProductImage.test.ts` | Card vs photo, alt/role rules |
| modify | `app/features/catalog/ProductCard.tsx` | Pass `label` (id, brand, title, `fragranceFamily`) |
| modify | `app/routes/product.tsx` | Pass `label` with `fragranceFamilies[0] ?? null` |
| modify | `app/lib/cart.ts` | `CartLine.fragranceFamily: string \| null` |
| modify | `app/.server/db/queries/cart.ts`, `app/.server/services/cart.ts` | Select `products.fragranceFamily` |
| modify | `app/features/cart/CartLineItem.tsx` | Pass `label`, use the minimal card |
| modify | `app/lib/account.ts` | `AccountOrderLine.productId`, `fragranceFamily` |
| modify | `app/.server/db/queries/orders.ts` | `listOrderLinesByOrderIds` selects `products.publicId`, `fragranceFamily` |
| modify | `app/features/account/OrderLineItem.tsx` | `OrderLineThumb` shows the minimal card without a photo |
| modify | Tests and fixtures that build `CartLine` / `AccountOrderLine` / `ProductImage` props | New fields |
| modify | `docs/design.md` | "Label card palette" section with contrast ratios |

## Steps

- [x] **1. Palette and variation logic.** Create `app/lib/label-art.ts` with
  `LABEL_PALETTES: Record<LabelPaletteKey, { bg; accent; ink; panel }>`,
  `FAMILY_PALETTE: Record<FragranceFamily, LabelPaletteKey>`,
  `labelPalette(family: string | null)`, `labelVariant(id: string)` and `contrastRatio(a, b)`
  (WCAG 2.x relative luminance). Write `label-art.test.ts`: every `FRAGRANCE_FAMILIES` entry maps
  to a palette; `null`/`"unknown"` → `neutral`; the same id → the same variant; a set of ~200
  random uuids hits every bottle shape; each palette's `ink` on its text surface is ≥ 4.5:1.
- [x] **2. Text layout.** Add `layoutLabelText(text, { width, maxLines, sizes })` →
  `{ lines: string[]; fontSize: number }`. Test short Latin ("Coco"), long
  Latin ("Eau de Parfum Intense Pour Homme"), Cyrillic ("Квітковий сад"), a single word longer
  than a line, the ellipsis after `maxLines`, and that the font size gets smaller as the text gets
  longer.
- [x] **3. `ProductLabelArt` component.** Create `app/features/catalog/ProductLabelArt.tsx`:
  `<svg viewBox="0 0 400 500" preserveAspectRatio=… aria-hidden="true" focusable="false">`, the
  background `rect`, one of 4 bottle `path`s and 3 caps chosen by `labelVariant`, a label panel,
  the brand (Manrope, uppercase, `letter-spacing`), the name (`font-family="var(--font-serif)"`,
  `<tspan>` per line, centred with `text-anchor="middle"`) and "jassmin." at the bottom. Props:
  `{ label: { id, brand, title, family }, detail?: "full" | "minimal", className? }`. The SVG always
  uses `preserveAspectRatio="xMidYMid slice"`, so it fills a 4:5 frame exactly and crops evenly in a
  square one; no `crop` prop is needed.
  `minimal` leaves out all text. No `useId` is needed (no gradients/defs), so the markup is
  identical on server and client. Test with `renderToStaticMarkup`: the colours of the family's
  palette appear, the name lines and the brand appear, `minimal` has no `<text>`, and there are no
  `href`/`url(` references (no requests).
- [x] **4. `ProductImage` uses it.** Change the props to `label: ProductLabel` (export the type
  from `ProductLabelArt.tsx`). Without `image`, render the frame (no `bg-blush`) containing
  `ProductLabelArt`. With `alt` set, the wrapper is `role="img" aria-label={alt}`, otherwise it's
  `aria-hidden="true"`, as today. Add a `labelDetail` prop that defaults to `"full"`. Update
  `ProductImage.test.ts`: without a photo it renders `<svg` and the title and has no initial-only
  span; with a photo it renders `<img` and no `<svg`; the alt/role cases still hold.
- [x] **5. Catalog and product page.** `ProductCard.tsx` (both cards): pass
  `label={{ id: product.id, brand: product.brand, title: product.title, family: product.fragranceFamily }}`.
  `routes/product.tsx`: `family: product.fragranceFamilies[0] ?? null`, keeping `priority`.
  Update `ProductCard.dom.test.ts` / `catalog-ui.test.ts` fixtures if they assert the initial.
- [ ] **6. Cart and account.** Add `fragranceFamily` to `CartLine`, select it in
  `queries/cart.ts` (next to the image columns) and pass it through `toCartLine`. In
  `CartLineItem.tsx`, pass `label` and `labelDetail="minimal"`. Add `productId` (from
  `products.publicId`, `null` once deleted) and `fragranceFamily` to `AccountOrderLine`, and
  select both in `listOrderLinesByOrderIds`. `OrderLineThumb`: photo → `<img>` as today; product
  present without a photo → `ProductLabelArt` (`minimal`, sliced to the square) in the same box; deleted
  → neutral tile. Fix the fixtures in `cart`/`account`/`orders` tests that type-check against these
  DTOs.
- [ ] **7. Document the palette.** Add a "Label card palette" section to `docs/design.md` after
  "Colour tokens": the table of groups → families → `bg`/`accent`/`ink`/`panel` hex values with
  their measured contrast ratios, the variation rule (FNV-1a of `public_id`) and the "a photo
  always wins" rule. Mention that new families must be added to `FAMILY_PALETTE`.
- [ ] **8. Verify performance and visuals.** Run `pnpm aspire run`. Check `/katalog/zhinochi`,
  `/en/catalog/men`, a product page, the cart and the account orders at 375 px and
  desktop width: long Cyrillic names wrap without overflowing, and same-family
  neighbours differ. Run Lighthouse (mobile) on the catalog and a product page: Performance ≥
  #96's results, CLS 0, and no new network requests in DevTools. Check the HTML size of the
  catalog page (it should grow by no more than ~30 KB uncompressed for 24 cards). Save a
  screenshot of `/katalog/zhinochi` for the PR so the store owner can approve the palette (Q4).
- [ ] **9. Share image follow-up.** File a follow-up issue with `/create-issue`
  ("Rasterise the label card as the product's og:image"). It covers a resource route
  `/og/products/<slug>.png` at 1200×630, `satori` + `@resvg/resvg-js` with embedded Playfair and
  Manrope, `Cache-Control: public, max-age=86400, immutable`-style caching keyed on `updated_at`,
  and `product.tsx` `meta` falling back to it. Reference it in the PR.
- [ ] **10. Checks.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Testing & verification

- Unit: `app/lib/label-art.test.ts` (palette mapping for all 16 families, neutral fallback,
  deterministic and well-spread variants, text layout, WCAG AA for every palette).
- Component: `ProductLabelArt.test.ts`, `ProductImage.test.ts` (card vs photo, alt/`role="img"` vs
  `aria-hidden`), updated card, cart and account tests.
- Guard: `client-bundle.guard.test.ts` still passes (no zod in `label-art.ts`).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: step 8 (visual check, Lighthouse, Network panel, CLS).

## Acceptance criteria

- [ ] Every product without a photo shows a generated card with its brand and name, coloured by
  its main fragrance family. Products with a photo still show the photo. (Steps 1–6)
- [ ] Two perfumes from different families look clearly different, and two from the same family
  still differ. (Steps 1, 3, 8)
- [ ] No extra network requests for the cards on catalog pages, no layout shift (CLS 0), and
  Lighthouse Performance stays at or above #96's results. (Steps 3, 4, 8)
- [ ] Text on the cards meets WCAG AA contrast, and alt text follows the existing rules.
  (Steps 1, 4)
- [ ] Sharing a product without a photo shows the card as the preview image (or a follow-up issue
  exists). (Step 9)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass. (Step 10)

## Out of scope

- Product photography, descriptions and availability (separate issues).
- The OG PNG route itself (follow-up issue, Q1).
- Images in checkout and order emails, which have none today.
- A Unisex palette or catalog (there is no Unisex catalog).
