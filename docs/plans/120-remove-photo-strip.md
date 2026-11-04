# Plan: Remove the family colour strip from the shop's bottle photo (#120)

Issue: https://github.com/savchukolgaa/jassmin/issues/120
Branch: `issue/120`
Worktree: `.claude/worktrees/issue-120`
Status: Planned

## Goal
Product cards and the product page should show only the shop's bottle photo for products without
their own photo, with no coloured line along the bottom. This removes the `h-2` family-accent
strip that #118 added. Everything else stays as it is.

## Dependencies & prerequisites
- #118 (PR #119): merged on `origin/main`. It added `SHOP_BOTTLE_IMAGE` and the strip in
  `ProductImage`.
- No packages, env vars or migrations.

## Decisions & assumptions
- **The shop photo becomes a plain stand-in image.** Without the strip, the shop-photo branch of
  `ProductImage` is identical to the uploaded-photo branch, so the two merge:
  `const photo = image ?? (layout === "thumb" ? null : SHOP_BOTTLE_IMAGE)`. One frame
  (`bg-blush`, no `relative`) renders whichever photo it is, and the label card stays for
  thumbnails. The inner `Photo` component, which existed only to share the `<img>` between the two
  branches, goes back inline.
- The `labelPalette` import goes; `ProductLabel` stays. The `label` prop is still needed for the
  thumbnail label card, so its JSDoc now only mentions that.
- Unchanged: uploaded photos, cart thumbnails (drawn label card, #99), the share image's own
  `accent` strip (#105, between the photo and the text panel; `docs/design.md` "Share image"),
  loading behaviour (`priority`/lazy, `srcset`/`sizes`, `width`/`height`) and alt text.

## Resolved questions
- **Where is the strip?** Only in `app/features/catalog/ProductImage.tsx` (`data-family-strip`).
  It's asserted in `ProductImage.test.ts` and `ProductCard.dom.test.ts` and described in
  `docs/design.md` → "Label card palette" (source: `grep strip`).
- **Does the share image's strip go too?** No. The issue scopes it out, and it isn't on a product
  picture (source: #120 Context).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/features/catalog/ProductImage.tsx` | drop the strip; one photo frame for uploaded or shop photo |
| modify | `app/features/catalog/ProductImage.test.ts` | drop strip-colour tests; assert no strip |
| modify | `app/features/catalog/ProductCard.dom.test.ts` | shop photo, no strip |
| modify | `docs/design.md` | remove the strip sentence |

## Steps

- [ ] **1. `ProductImage` without the strip.**
  - Compute `photo` as above.
  - If `photo` is set, render `<div className={cn(frame, "bg-blush")}><img … /></div>`, the
    current `<img>` attributes inlined from `Photo`.
  - Otherwise render the label-card branch, unchanged.
  - Remove the `labelPalette` import and the `Photo` component.
  - Update the JSDoc: "Product photo with a fixed 4:5 frame; without one, the shop's bottle photo
    (#118), or the generated label card in thumbnails (#99)." The `label` prop now reads: "What the
    thumbnail label card shows without a photo (#99)."

- [ ] **2. Tests.**
  - In `ProductImage.test.ts`:
    - remove `LABEL_PALETTES` and the test "uses the neutral strip without a family";
    - in "shows the shop's bottle photo without one…", replace the strip regex with
      `expect(html).not.toContain("data-family-strip")` and drop "with a strip in the family
      colour" from its name;
    - keep "shows no family strip over an uploaded photo", renamed to "draws nothing over an
      uploaded photo", or drop it if it's redundant.
  - In `ProductCard.dom.test.ts`, rename the #118 test to "shows the shop's bottle photo without
    its own photo (#118, #120)" and expect `[data-family-strip]` to be `null`.

- [ ] **3. Docs.** In `docs/design.md` → "Label card palette", delete the sentence "A `h-2` strip
  along the bottom of the frame, in the family's `accent` colour, tells perfumes apart at a
  glance." Optionally add: "Perfumes are told apart by the brand, name and family chip under the
  photo (#120)."

- [ ] **4. Verify.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, then
  `grep -rn "family-strip" app` (expect no hits).

## Testing & verification
- Updated `ProductImage.test.ts`: the shop photo has no strip, and the uploaded photo, thumbnail
  label card, priority/lazy and alt tests are unchanged.
- Updated `ProductCard.dom.test.ts`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (with products in the local DB): a catalog card and a product page without a photo show
  the bottle photo only.

## Acceptance criteria
- [ ] Product cards (catalog, home Bestsellers, Popular, offers, similar products) and the product page show the shop's bottle photo with no coloured line at the bottom for products without their own photo — steps 1, 2
- [ ] Products with their own photo and cart thumbnails look as before — steps 1, 2
- [ ] Tests and `docs/design.md` no longer refer to the strip — steps 2, 3
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 4

## Out of scope
- The share image (#105) and its strip.
- Any other card, layout or photo change.
