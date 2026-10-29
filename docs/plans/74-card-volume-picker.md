# Plan: Choose the perfume volume directly on product cards (#74)

Issue: https://github.com/savchukolgaa/jassmin/issues/74
Branch: `issue/74`
Worktree: `.claude/worktrees/issue-74`
Status: Planned

## Goal
Shoppers want to pick a perfume's size (e.g. 10 ml instead of the default) right on a product card
and add that size to the cart, without opening the product page. Every catalog and compact card
gets a row of pill-shaped size radios inside its add-to-cart form; the price and the add button
follow the chosen size, and the form still posts the chosen size without JavaScript.

## Dependencies & prerequisites
- #26 (variants with their own price and stock), #10 (cart action and "Added to cart" status),
  #64 (compact card), #67 (popular page), #55 (offer cards), #65 (family on cards): all merged
  on `origin/main` (`9952d5e`).
- #72 / #73 (header and palette): the picker only uses existing tokens (`primary`, `line`, `ink`,
  `muted`), so it follows those changes without depending on them.
- No migration, env var or package. The cart action already validates `variantId` against the
  product (`checkVariantForCart` in `app/.server/services/products.ts`).

## Decisions & assumptions
- **Variants in one query.** `variantStats()` in `app/.server/db/queries/products.ts` gains a
  `variants` column:
  `json_agg(json_build_object('id', public_id, 'volumeMl', volume_ml, 'price', price::text,
  'inStock', stock_quantity > 0) order by volume_ml)`. `price::text` keeps the exact decimal
  string (`"990.00"`); a bare `numeric` would become a JSON number. Every summary query
  (`listProducts`, `listProductSummariesByPublicIds`, `listBestsellers`, `listPopularProducts`)
  already selects `summaryColumns(stats)`, so all four get it with no N+1.
- **Derive the rest from `variants`.** `toSummary` builds `volumes`, `inStock`, `hasPriceRange`
  and `defaultVariant` from `row.variants` (using `defaultVariant()` from `~/lib/products`), so
  the SQL `volumes`, `in_stock`, `default_variant_id` and `default_volume_ml` aggregates and
  `DEFAULT_VARIANT_ORDER` go away, along with their "keep in sync" comment. `min_price` and
  `max_price` stay in SQL because the `price_asc` / `price_desc` sort uses `min_price`.
  The `ProductSummary` fields keep their shapes, so existing callers don't change.
- **Type:** `ProductSummary.variants: CardVariant[]`, where
  `type CardVariant = Pick<ProductVariant, "id" | "volumeMl" | "price" | "inStock">`. Card
  variants carry no `stockQuantity`, so the exact stock doesn't reach the client.
- **`CardVolumePicker`** (`app/features/catalog/CardVolumePicker.tsx`): a `<fieldset>` with an
  `sr-only` legend (`product.volumeLegend`) and one
  `<label><input type="radio" name="variantId" class="peer sr-only"><span>pill</span></label>`
  per size, following the `TrioBuilder` chip markup. Radios are **uncontrolled**
  (`defaultChecked` on the default variant) with an `onChange` that reports the id to the card, so
  a click before hydration isn't undone. Ids come from `useId()`. Out-of-stock sizes are
  `disabled`, struck through (`peer-disabled:line-through peer-disabled:opacity-50`), and get an
  `sr-only` ", out of stock" (`product.outOfStockSize`).
- **Radio name.** The field must be named `variantId` for the cart action. Radio groups are
  scoped to their form owner, so each card's form is its own group; only the `id`s need to be
  unique per card (`useId`).
- **Pill style:** `rounded-pill border-2 border-line px-3.5 min-h-11 text-sm font-extrabold
  text-ink`, checked `peer-checked:border-primary peer-checked:bg-primary peer-checked:text-white`,
  and a focus ring through `peer-focus-visible:` matching `focusRing("onLight")` (`outline-3
  outline-offset-2 outline-primary`), because the ring goes on the pill, not on the hidden input.
  The row is `flex flex-wrap gap-2`, so it wraps at 375px. The pill text is
  `formatVolume({ volumeMl, packSize })`, e.g. `30 мл` or `3 × 7 мл`.
- **Single size:** with only one variant there's no picker; the card shows the size as plain text
  (`formatVolume`) and posts it through `AddToCartForm`'s hidden `variantId`, as today.
- **Price:** the card keeps `selectedId` in state (initially `defaultVariant.id`) and a
  `hydrated` flag (the `useState` + `useEffect` pattern from `TrioBuilder`). Before hydration (and
  so without JS) it shows `from {min}` when the sizes have different prices, as now. Once
  hydrated it shows the selected size's price. A pure helper `cardPrice(product, selectedId,
  hydrated)` in `app/lib/products.ts` makes this testable without a DOM.
- **Add button:** the catalog card's button becomes the default `cart.add` ("Додати в кошик" /
  "Add to cart"), and the "Choose volume" `ButtonLink` is removed. `inStock` stays
  `product.inStock`: the default variant is in stock whenever any size is, and sold-out sizes
  can't be selected.
- **Compact card:** keeps the round "+" (`appearance="icon"`) with the pill row above the
  price/button row. The brand line drops `· {defaultSize}`. Its accessible name becomes
  "Add {title} to cart" (`product.quickAdd` without `{size}`), because without JS a fixed size
  in the label could be wrong after the shopper picks another pill **(unconfirmed, Q1)**.
- **The volumes line** (`formatVolumes`, "7 · 30 · 50 мл") on the catalog card is replaced by the
  picker (or by the single size as plain text). `formatVolumes` then has no users and is deleted
  along with its tests in `app/lib/products.test.ts`.
- **i18n:** add `product.volumeLegend` ("Об’єм" / "Volume") and `product.outOfStockSize`
  ("немає в наявності" / "out of stock"); remove `product.addSize` and `product.chooseVolume`;
  change `product.quickAdd`. The Ukrainian apostrophe follows the existing `’` in `uk.ts`.
- **Tests without a DOM.** Vitest runs in `node` with `renderToStaticMarkup` and no
  jsdom/testing-library (`vitest.config.ts`). Interaction is covered by the pure `cardPrice`
  helper and by asserting the server markup: radios named `variantId` inside the form, the default
  `checked`, sold-out ones `disabled`, and no hidden `variantId` when the picker is shown
  **(unconfirmed, Q2)**.

## Open questions
- [ ] **Q1: Should the compact card's "+" keep naming the size in its accessible name?** — Why it
  matters: today it says "Add {title}, 7 ml, to cart". With a picker, a size baked into the label
  is wrong without JS once another pill is picked; with JS it could follow the state. Recommended
  default: drop the size ("Add {title} to cart"); the checked radio already tells screen-reader
  users which size it is. Affects steps: 5, 6.
- [ ] **Q2: Add jsdom and Testing Library so the tests can click a pill?** — Why it matters: "the
  price follows the selection" and "submitting posts the chosen `variantId`" can then be tested
  end to end in the browser DOM rather than through a pure helper plus static markup. Recommended
  default: no new dev dependencies; test `cardPrice` and the rendered markup, and check the
  interaction by hand. Affects step: 7.
- [ ] **Q3: Should the card's price be visible as "from {min}" or the default size's price before
  hydration?** — Why it matters: the issue keeps "from {min}" without JS. With JS, the server
  HTML shows "from" for a moment and then switches to the default size's price on hydration, a
  small visible jump. Recommended default: follow the issue (keep "from" until hydrated). Affects
  step: 5.

## Resolved questions
- **Does the cart action accept any variant posted from a card?** — Yes: `variantId` is validated
  with zod and checked against the product and its stock by `checkVariantForCart`
  (source: `app/.server/services/products.ts`, `app/features/cart/AddToCartForm.tsx`).
- **Can `AddToCartForm` take the size from a child field?** — Yes: omit `variantId` and render a
  field named `variantId` as `children`, as the product page's `VolumeSelect` does
  (source: `app/features/cart/AddToCartForm.tsx`, `app/features/product/ProductPurchase.tsx`).
- **Which queries build summaries?** — All four use `summaryColumns(variantStats(db))`, mapped by
  `toSummary` (source: `app/.server/db/queries/products.ts`, `app/.server/services/products.ts`).
  Offers use `getProductSummaries` (source: `app/.server/services/offers.ts`).
- **Is there an existing pill-radio pattern?** — Yes: the trio builder's `peer sr-only` checkbox
  chips with `peer-focus-visible` rings and `min-h-11.5` (source:
  `app/features/home/TrioBuilder.tsx`); pills use `rounded-pill`, touch targets are at least
  44px and focus rings 3px with a 2px offset (source: `docs/design.md`).
- **How do components detect hydration?** — `useState(false)` plus `useEffect(() =>
  setHydrated(true), [])` (source: `app/features/home/TrioBuilder.tsx`).
- **Which grids hold cards at 375px?** — All are one column below `sm` (catalog, Bestsellers,
  popular, offer products), so a card is about 343px wide and the pills wrap within it
  (source: `app/routes/catalog.tsx`, `app/features/home/Bestsellers.tsx`,
  `app/features/popular/PopularPage.tsx`, `app/features/offers/OfferCard.tsx`).
- **How are numeric prices returned?** — As exact decimal strings via `node-postgres`, so the JSON
  aggregate must cast `price::text` (source: `app/.server/db/client.ts`, `app/lib/products.ts`).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/products.ts` | `CardVariant`, `ProductSummary.variants`, `cardPrice()`; delete `formatVolumes` |
| modify | `app/lib/products.test.ts` | `cardPrice` tests; drop `formatVolumes` tests |
| modify | `app/.server/db/queries/products.ts` | `variants` JSON aggregate in `variantStats`; drop derived aggregates |
| modify | `app/.server/services/products.ts` | `toSummary` maps `variants` and derives the other fields |
| modify | `app/.server/services/products.test.ts` | summaries carry ordered variants (catalog, bestsellers, popular, by ids) |
| create | `app/features/catalog/CardVolumePicker.tsx` | the pill radio group |
| modify | `app/features/catalog/ProductCard.tsx` | both cards render the picker and the selected price |
| modify | `app/features/catalog/catalog-ui.test.ts` | picker, price, single size, uk/en copy |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | new keys, removed keys, `quickAdd` |
| modify | `app/.server/services/offers.test.ts`, `app/routes/offers.test.ts`, `app/features/home/HomePage.test.ts`, `app/features/offers/offers-ui.test.ts`, `app/features/popular/popular-ui.test.ts` | add `variants` to `ProductSummary` fixtures |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [ ] **1. Add variants to the summary type** — In `app/lib/products.ts` add
  `export type CardVariant = Pick<ProductVariant, "id" | "volumeMl" | "price" | "inStock">` and
  `variants: CardVariant[]` (ascending by volume) on `ProductSummary`, documenting that the other
  stats are derived from it. Add `variants` to every `ProductSummary` fixture listed in Files so
  `pnpm typecheck` passes (`satisfies`-compatible literals; ids reuse each fixture's
  `defaultVariant.id` for the default size).
- [ ] **2. Aggregate variants in SQL** — In `variantStats()` add
  `variants: sql<CardVariant[]>`json_agg(json_build_object('id', ${productVariants.publicId},
  'volumeMl', ${productVariants.volumeMl}, 'price', ${productVariants.price}::text, 'inStock',
  ${productVariants.stockQuantity} > 0) order by ${productVariants.volumeMl})`.as("variants")`,
  and add it to `summaryColumns`. Remove `inStock`, `volumes`, `defaultVariantId`,
  `defaultVolumeMl` and `DEFAULT_VARIANT_ORDER` (check `countPopularProducts` / `countProducts`
  only use the join). Import `CardVariant` as a type from `~/lib/products`.
- [ ] **3. Map variants in `toSummary`** — In `app/.server/services/products.ts`, set
  `variants: row.variants`, `volumes: variants.map((v) => v.volumeMl)`,
  `inStock: variants.some((v) => v.inStock)`, `hasPriceRange: row.minPrice !== row.maxPrice`, and
  `defaultVariant` from `defaultVariant(variants)` (non-empty thanks to the inner join; narrow
  the `undefined` with an explicit error for `noUncheckedIndexedAccess`). Extend
  `products.test.ts`: Coco's `variants` are `[7, 10, 30, 50, 100]` with exact price strings and
  10 ml `inStock: false`; Acqua's are all out of stock; and the bestseller, popular and
  by-id summaries include `variants` (extend `bestsellers.test.ts` / `popular.test.ts` /
  `offers.test.ts` where they hit the DB). Run `pnpm test`.
- [ ] **4. i18n keys** — In `uk.ts` and `en.ts` under `product`: add
  `volumeLegend: "Об’єм"` / `"Volume"` and `outOfStockSize: "немає в наявності"` /
  `"out of stock"`; change `quickAdd` to `"Додати {title} у кошик"` / `"Add {title} to cart"`
  **(Q1)**; remove `addSize` and `chooseVolume` once step 5 no longer uses them.
- [ ] **5. `CardVolumePicker` and `cardPrice`** — Create
  `app/features/catalog/CardVolumePicker.tsx` with props `{ variants: CardVariant[]; packSize:
  number; defaultId: string; onChange: (id: string) => void; className?: string }`, markup and
  classes as in Decisions (`useId()` prefix for each input's `id` and the label's `htmlFor`, or
  wrapping labels). Add `cardPrice(product, selectedId, hydrated)` to `app/lib/products.ts`:
  before hydration `{ price: minPrice, from: hasPriceRange }`, after it the selected variant's
  price with `from: false`, falling back to the default variant.
- [ ] **6. Use the picker on both cards** — In `ProductCard.tsx`, add a small `useCardSize(product)`
  hook (selected id state plus hydrated flag) shared by both cards. `CatalogProductCard`:
  replace the `formatVolumes` line with the picker as `children` of `AddToCartForm` (no
  `variantId` prop) when `variants.length > 1`, else the size as plain `text-sm text-muted`
  text and the hidden `variantId`; the price uses `cardPrice`; the button uses the default
  label; remove the `ButtonLink` and its import. `CompactProductCard`: brand line without the
  size; the picker above a row with the price and the "+" (the form wraps both, e.g. the form
  becomes the bottom block with `className="flex flex-col gap-3"` and a `flex justify-between`
  row inside, keeping the icon status's `relative` positioning on the button's wrapper so "Added
  to cart" still floats below the "+"). Check in the browser at 375px: catalog, home
  Bestsellers, `/popular` and `/offers`.
- [ ] **7. UI tests** — Update `catalog-ui.test.ts` (English unless stated): a multi-size card
  renders a `fieldset` with a legend "Volume" and one `type="radio" name="variantId"` per size
  inside the form, the default one `checked`, a sold-out one `disabled` with "out of stock", no
  hidden `variantId` input, unique input ids across two cards on one page, and the button
  "Add to cart"; a single-size card has no radios, shows "50 ml" and posts the hidden
  `variantId`; packs show "3 × 7 ml"; the server HTML price is "from ₴990"; no "Choose volume";
  Ukrainian legend "Об’єм" and "немає в наявності"; the compact card gets the same picker and
  keeps the "+". Add `cardPrice` cases to `products.test.ts` (before/after hydration, selected
  size, unknown id falls back to the default). Update the home, popular and offers UI tests that
  asserted "Add 7 ml" or "Chanel · 7 ml".
- [ ] **8. Verify and clean up** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
  Grep for leftover `addSize`, `chooseVolume`, `formatVolumes`, `defaultVolumeMl`.

## Testing & verification
- Automated: `products.test.ts` (service, DB integration) for `variants` on all summary queries;
  `app/lib/products.test.ts` for `cardPrice`; `catalog-ui.test.ts` for the picker markup, the
  form fields, single-size and pack cards, and uk/en copy; the fixtures of the other suites.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`): on the catalog, home Bestsellers, `/popular` and `/offers`, pick
  10 ml, see the price change, add to cart and see 10 ml in `/cart`; sold-out pills can't be
  picked; Tab into the group, arrow keys move between enabled sizes with a visible ring; a screen
  reader reads "Volume", each size and "out of stock"; with JS disabled, pick a size and add, and
  the cart gets that size; no horizontal scroll at 375px.

## Acceptance criteria
- [ ] Every product card with several sizes lets the shopper pick a size before adding to cart — steps 5, 6
- [ ] The card's price changes to the selected size's price — steps 5, 6, 7
- [ ] Add to cart adds the selected size, and the cart shows that size — steps 5, 6, 7 (manual check in 8)
- [ ] Out-of-stock sizes are visible but can't be selected — steps 2, 3, 5, 7
- [ ] The picker works without JavaScript and by keyboard, with visible focus and screen-reader labels — steps 4, 5, 7
- [ ] It works in the catalog, home Bestsellers, the popular page and offer cards, with no horizontal scroll at 375px — step 6
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 8

## Out of scope
- Quantity selection on the card, the product page's `VolumeSelect`, and the cart page.
- Live-announcing the card price (`aria-live`) when the size changes: on a grid of cards that
  would be noisy, and the checked radio already names the size.
- The shared `add-to-cart-${productId}` fetcher key, so the same product shown twice on a page
  (e.g. in two offers) shares its "Added to cart" status, as today.
- Refactoring `TrioBuilder` onto a shared hydration hook.
