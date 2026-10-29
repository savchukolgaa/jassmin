# Plan: Raise the free-delivery threshold to 1500 ₴ (#71)

Issue: https://github.com/savchukolgaa/jassmin/issues/71
Branch: `issue/71`
Worktree: `.claude/worktrees/issue-71`
Status: Planned

## Goal
As a store owner, I want free Nova Poshta delivery to start at 1500 ₴ instead of 1000 ₴, so that
delivery costs are covered on smaller orders. We raise `FREE_SHIPPING_THRESHOLD` to `"1500.00"`
for the checkout transaction. The cart and checkout get copy that states the threshold through a
`{threshold}` placeholder filled from the constant. The Strapi seed and the recorded fixtures for
the offers perks strip change from "1000 ₴" to "1500 ₴" in both locales.

## Dependencies & prerequisites
- #11 (checkout), #59 (pricing / discounts) and #55 (offers perks strip) are merged on `origin/main`:
  `app/lib/checkout.ts`, `app/.server/services/pricing.ts`, `app/.server/db/queries/orders.ts`,
  `app/features/offers/PerksStrip.tsx` and `cms/scripts/seed.ts` all exist.
- #72 (home page marquee, open) will advertise the threshold. It must import
  `FREE_SHIPPING_THRESHOLD` from `~/lib/checkout`. This plan only keeps the constant the single
  source; it doesn't build the marquee.
- No migration, env var or package is needed. `orders.free_shipping` is computed when the order is
  created, so existing orders keep their stored value.

## Decisions & assumptions
- **The constant stays the single source.** `FREE_SHIPPING_THRESHOLD = "1500.00"` in
  `app/lib/checkout.ts`. `priceCart` (`pricing.ts:172`), the SQL in `orders.ts:106` and
  `freeShippingInfo` already read it, so the logic itself doesn't change. Only the value and the
  tests change.
- **Today no app copy states the threshold.** The cart says "Delivery is calculated at checkout"
  (`cart.deliveryNote`), and checkout only says "Add {amount} more for free delivery"
  (`checkout.freeShippingHint`). To meet "the cart, checkout and offers page show 1500 ₴", we add
  `{threshold}` to both messages:
  - `cart.deliveryNote`: uk «Безкоштовна доставка Новою Поштою від {threshold}. Решту вартості
    розрахуємо під час оформлення.» / en "Free Nova Poshta delivery from {threshold}. Any delivery
    cost is worked out at checkout." **(unconfirmed wording, Q2)**
  - `checkout.freeShippingHint`: uk «Додайте ще {amount}, щоб доставка була безкоштовною (від
    {threshold}).» / en "Add {amount} more for free delivery (from {threshold})."
    **(unconfirmed wording, Q2)**
  - Both are filled with `formatPrice(FREE_SHIPPING_THRESHOLD)` from the translator, so the result
    is "1 500 ₴" in uk and "₴1,500" in en.
- **The offers perk stays editorial Strapi text**, as the issue's Technical section says. In
  `cms/scripts/seed.ts` and `offers*.json`, "від 1000 ₴" / "from 1000 ₴" becomes 1500 ₴. The app
  doesn't rewrite CMS text. **(unconfirmed, Q1)**
- **The seed skips entries that already exist** (`seed.ts:507`), so live Strapi entries aren't
  touched. The PR description must tell staff to edit the `free-delivery` offer (uk and en
  summaries) in the Strapi admin by hand.
- The gift-guide text "До 1000 ₴" / "Up to 1000 ₴" (`seed.ts:422-429`, `offers.json:234-235`) is a
  gift price band, not the delivery threshold, so it stays as it is.
- `cart.test.ts`, listed in the issue, doesn't pin the threshold (its only "1000" is
  `60 * 60 * 1000`). The cart copy is tested in `app/features/cart/cart-ui.test.ts`.

## Open questions
- [ ] **Q1: Should the offers perk get its number from the constant instead of Strapi text?** — Why
  it matters: the issue wants every message to read the constant, but the perk summary is CMS
  copy, so a later threshold change would again mean a seed, fixture and manual Strapi edit. One
  option is to replace a `{threshold}` token in perk summaries in `app/.server/cms/` before
  rendering. Recommended default: follow the issue and keep literal "1500 ₴" in Strapi. Affects
  steps: 4.
- [ ] **Q2: Wording of the new cart and checkout copy.** — Why it matters: this is shopper-facing
  copy in two languages. Recommended default: the texts in Decisions above. Affects steps: 2, 3.
- [ ] **Q3: Should checkout also state the threshold when delivery is already free?** — Why it
  matters: the hint only shows below the threshold, so a shopper at 1500 ₴ or more sees only
  "Free". Recommended default: no. "Free" is enough once it applies. Affects steps: 3.

## Resolved questions
- **Where is the threshold enforced?** — In `priceCart` (`app/.server/services/pricing.ts:172`) and
  in the `createOrder` SQL (`app/.server/db/queries/orders.ts:106`). Both read
  `FREE_SHIPPING_THRESHOLD`, and the checkout loader uses `freeShippingInfo` from
  `app/lib/checkout.ts:109` (source: `app/.server/AGENTS.md` → Orders).
- **Do existing orders change?** — No. `orders.free_shipping` is written when the order is created
  (source: `app/.server/db/schema.ts:319`, issue assumptions).
- **Does re-running the seed update live Strapi?** — No. Existing offers are skipped (source:
  `cms/scripts/seed.ts:507`).
- **How are prices formatted?** — With the translator's `formatPrice`: `"1 500 ₴"` in uk (narrow
  no-break space) and `"₴1,500"` in en (source: `app/lib/i18n/translator.test.ts:55-56`).
- **Do the uk and en dictionaries need matching keys?** — Yes. `pnpm typecheck` fails when they
  differ (source: `AGENTS.md` → Translations).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/checkout.ts` | `FREE_SHIPPING_THRESHOLD = "1500.00"` |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `{threshold}` in `cart.deliveryNote` and `checkout.freeShippingHint` |
| modify | `app/features/cart/CartSummary.tsx` | Pass `threshold: formatPrice(FREE_SHIPPING_THRESHOLD)` |
| modify | `app/features/checkout/OrderSummary.tsx` | Pass `threshold` to the hint |
| modify | `cms/scripts/seed.ts` | `free-delivery` perk summary: 1500 ₴ (uk, en) |
| modify | `app/.server/cms/__fixtures__/offers.json`, `offers.en.json` | Same change in the recorded fixtures |
| modify | `app/lib/checkout.test.ts` | `freeShippingInfo` at 1499.99 / 1500 / 0 |
| modify | `app/.server/services/pricing.test.ts` | Threshold and discount cases for 1500 ₴ |
| modify | `app/.server/services/orders.test.ts` | 1499.99 (paid) and 1500.00 (free) orders; comments |
| modify | `app/routes/checkout.test.ts` | `remaining` values and the "free" prefill case |
| modify | `app/features/checkout/checkout-ui.test.ts` | Titles, and the hint now shows the threshold |
| modify | `app/features/cart/cart-ui.test.ts` | Cart note shows 1500 ₴ in uk and en |
| modify | `app/features/offers/offers-ui.test.ts` | Perk fixture text: 1500 ₴ |
| modify | `app/.server/AGENTS.md` | Orders section: "1000 UAH" → "1500 UAH" |

## Steps
- [ ] **1. Raise the constant.** — In `app/lib/checkout.ts`, set `FREE_SHIPPING_THRESHOLD =
  "1500.00"`. In `app/lib/checkout.test.ts`, update `freeShippingInfo`: `"1500.00"` → free,
  `"1499.99"` → `{ free: false, remaining: "0.01" }`, `"0.00"` → `remaining: "1500.00"`. Run
  `pnpm test app/lib/checkout.test.ts`.
- [ ] **2. Show the threshold in the cart.** — Add `{threshold}` to `cart.deliveryNote` in `uk.ts`
  and `en.ts`. In `CartSummary.tsx`, call `t("cart.deliveryNote", { threshold:
  formatPrice(FREE_SHIPPING_THRESHOLD) })`, importing the constant from `~/lib/checkout`
  (isomorphic, so the client can import it). In `cart-ui.test.ts`, assert "1 500 ₴" (uk, matching
  whitespace with a regex or `normalize` as in `translator.test.ts`) and "₴1,500" (en inside
  `<I18nProvider locale="en">`).
- [ ] **3. Show the threshold at checkout.** — Add `{threshold}` to `checkout.freeShippingHint`
  (uk, en). In `OrderSummary.tsx`, pass `threshold: formatPrice(FREE_SHIPPING_THRESHOLD)` with
  `amount`. In `checkout-ui.test.ts`, rename the "1000 UAH" tests to 1500 and use realistic
  amounts (e.g. subtotal `"1499.99"`, remaining `"0.01"`). Assert the English hint contains
  `₴1,500`, and add a Ukrainian assertion.
- [ ] **4. Update Strapi seed and fixtures.** — `cms/scripts/seed.ts:440-441`: «Новою Поштою від
  1500 ₴» / "With Nova Poshta from 1500 ₴". Make the same change at line 9 of
  `app/.server/cms/__fixtures__/offers.json` and `offers.en.json`. Leave the gift-guide "1000 ₴"
  alone. In `offers-ui.test.ts`, update the perk summary and the assertion to 1500 ₴. Run
  `pnpm test app/.server/cms app/features/offers`.
- [ ] **5. Server pricing tests.** — In `pricing.test.ts` → "decides free delivery on the
  discounted subtotal", the undiscounted 1100 ₴ line is no longer free, so rebuild the case around
  1500 ₴. Example: a 1600 ₴ line is free without a code, and minus 10% (1440 ₴) it isn't. Add
  undiscounted `149_999` (paid) and `150_000` (free) cases, and an exact-1500-after-discount case
  with a price whose 10% discount gives exactly 150 000 kopiyky (e.g. `166_667` if rounding lands
  there, otherwise use a fixed-amount rule).
- [ ] **6. Order creation tests.** — In `orders.test.ts` → "links a registered user's order…",
  change the title to 1500 UAH. Keep the 990 ₴ order (paid). Set the variant price to `"1499.99"`
  and expect `freeShipping: false`, then to `"1500.00"` and expect `freeShipping: true`, each on a
  fresh cart. Restore the price in the `finally` block as now. The "discounted subtotal" test
  (1980 ₴ free, 980 ₴ paid) still holds: update only the comment to say the 1500 ₴ threshold.
  These are DB integration tests, so they need the test database.
- [ ] **7. Checkout route tests.** — In `app/routes/checkout.test.ts`, change the `remaining`
  values: 900 → `"600.00"` and 945 → `"555.00"`. Change the prefill case's subtotal from
  `"1000.00"` to `"1500.00"` so it stays `{ free: true }`.
- [ ] **8. Docs and sweep.** — Change the threshold in `app/.server/AGENTS.md` (Orders) to 1500
  UAH. Grep for leftovers: `rg -n "1000 ?(₴|UAH)|1 000|from 1000|від 1000" app cms/scripts
  README.md docs`. Only the gift-guide band and unrelated numbers (image widths, ms) should remain.
- [ ] **9. Verify.** — `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`.

## Testing & verification
- Unit: `freeShippingInfo` at 1499.99 / 1500.00 (step 1). `priceCart` at 1499.99 / 1500 and with
  discounts (step 5).
- Integration (test DB): `createOrder` stores `free_shipping = false` at 1499.99 ₴ and `true` at
  1500 ₴ (step 6).
- UI: cart note and checkout hint show "1 500 ₴" / "₴1,500" (steps 2–3). The offers perk shows
  1500 ₴ (step 4).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`): cart with a 990 ₴ item → the note says 1 500 ₴. Checkout → "Add 510 ₴
  more… (from 1 500 ₴)". Raise the quantity past 1500 ₴ → "Free". Switch to English and check
  "₴1,500". `/offers` shows 1500 ₴ only after re-seeding a fresh Strapi or editing the entry by
  hand.

## Acceptance criteria
- [ ] An order whose subtotal minus discount is below 1500 ₴ pays delivery; at 1500 ₴ or more delivery is free — steps 1, 5, 6, 7
- [ ] The cart, checkout and offers page show 1500 ₴, in Ukrainian and English — steps 2, 3, 4
- [ ] No user-facing text or seed content still says 1000 ₴ for free delivery — steps 4, 8
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 9

## Out of scope
- Delivery prices themselves and other perks.
- The home page marquee (#72). It reads `FREE_SHIPPING_THRESHOLD` when it's built.
- Editing live Strapi entries. Staff do this by hand, as listed in the PR description (offer
  `free-delivery`, uk and en summaries).
- Recomputing `free_shipping` on existing orders.
