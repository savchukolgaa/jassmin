# Plan: Add a couple offer: 15% off the second full bottle (#124)

Issue: https://github.com/savchukolgaa/jassmin/issues/124
Branch: `issue/124`
Worktree: `.claude/worktrees/issue-124`
Status: Planned

## Goal
A shopper buying perfume for two gets 15% off every second full bottle (30, 50 or 100 ml). The
offer applies automatically: full bottles are paired from the dearest to the cheapest, and the
cheaper unit of each pair is discounted. It competes with the tester trio and promo codes under the
existing one-best-discount rule, and the offers page gets a couple-offer card in uk and en.

## Dependencies & prerequisites
- #59 discount rules and `priceCart` (`app/.server/services/pricing.ts`): on `main`.
- #98 automatic rule created by a migration (`0021_tester_trio_rule.sql`) plus a DB test
  (`db/tester-trio.test.ts`): on `main`, and the pattern this plan follows.
- #55 offers page and Strapi `offer` type; kind `bundle` is already in the Strapi enum
  (`cms/src/api/offer/content-types/offer/schema.json`) and in `OFFER_GROUP_ORDER`
  (`app/lib/offers.ts`).
- #71 free delivery on the discounted subtotal: already how `priceCart` works, nothing to change.
- One new migration, `0022_couple_offer` (plus its rollback). No new packages or env vars.

## Decisions & assumptions
- **New kind `percent_every_nth`** in `DISCOUNT_KINDS` (`app/lib/enums.ts`). `value` is the percent,
  `min_quantity` is the group size (2 = pairs). Generic enough for a later "every third" offer.
- **Saving:** qualifying unit prices sorted from highest to lowest (the code already does this);
  discounted units are those at index `n-1, 2n-1, …` (each the cheapest of its group). Their sum is
  taken `value`% off with a single `Math.floor((sum * value) / 10_000)`, the same rounding as
  `percent`, so the store never takes off more than advertised.
- **`max_sets`** is honoured for the new kind as the most groups (discounted units) per order,
  like it caps sets for `fixed_price_set`. The `couple-15` rule leaves it `null` (no cap).
- **Scope of `couple-15`:** `scope_volumes_ml = {30, 50, 100}`, `scope_pack_size = 1`,
  `min_quantity = 2`, `value = 15.00`, no code. `pack_size 1` mirrors the tester trio and keeps any
  future multi-bottle set from counting as two bottles. (The issue doesn't name a pack size; this
  is a safe narrowing, since every sold 30/50/100 ml size is `pack_size 1` today.)
- **Created by a migration, not only the seed**, like the tester trio (#98): the offers page will
  advertise it in every environment, so every database needs the rule. `0022` inserts it with
  `ON CONFLICT ("slug") DO NOTHING`, and `SAMPLE_DISCOUNTS` gets the same row (the seed then skips
  it on migrated databases). Keep the two equal; a DB test checks they are.
- **CHECK constraints** (`app/.server/db/schema.ts`): `discounts_kind_check` comes from
  `DISCOUNT_KINDS` automatically; `discounts_value_check` treats the new kind like `percent`
  (`> 0` and `<= 100`); `discounts_min_quantity_check` requires `>= 2` for it too (a group of 1
  would be a plain percent rule). `pnpm db:generate --name couple_offer` writes the drop/add of the
  three checks; the `INSERT` is appended by hand before it is ever applied.
- **Label:** `discountLabel` returns a new key `checkout.discountCouple` for the new kind:
  uk "Пропозиція для двох: −15% на другий флакон", en "Couple offer: −15% on the second bottle".
  The percent is in the copy, like "3 × 10 мл" in `discountTesterSet`; the DB test pins the rule to
  15%, and `app/.server/AGENTS.md` documents that a value change means editing the copy too.
  A promo code still wins the label (`discountWithCode`) whatever its kind.
- **Strapi offer** `couple-offer`, kind `bundle`, no products, `sortOrder: 15` (after the tester
  trio), CTA to the women's catalog. Its `priceNote` is text and matches the
  rule ("−15% на другий флакон" / "−15% on the second bottle").

## Resolved questions
- **Where does the couple-offer card link?** — `/catalog/women`, like the tester-trio and winter
  offers; the body text says bottles from the men's catalog count too (source: user, on this plan).
- **Should the couple offer have an end date?** — No: no `starts_at`/`ends_at` on the rule or the
  offer; staff can set `active = false` and unpublish the offer later (source: user, on this plan).
- **Is `bundle` a valid offer kind?** — Yes, in the Strapi enum and `OFFER_GROUP_ORDER` (source:
  `cms/src/api/offer/content-types/offer/schema.json`, `app/lib/offers.ts`).
- **Does the order page/email need its own change?** — No: the account order page and checkout
  success use `OrderSummary`, the cart uses `CartSummary`, the email uses `order-email.ts`, and all
  three call `discountLabel`. Orders read the kind from the joined rule (`db/queries/orders.ts`).
- **Are migrations generated or hand-written?** — `pnpm db:generate --name <name>`, each with a
  hand-written rollback in `db/rollbacks/<tag>.sql`; never edit an applied migration (source:
  `app/.server/AGENTS.md` → Migrations).
- **Do 5/10 ml units ever count?** — No: excluded by `scope_volumes_ml` via the existing
  `qualifies` (source: `pricing.ts`).
- **Does free delivery need changes?** — No, `priceCart` already decides it on
  `subtotal - discount` (source: `pricing.ts`, #71).
- **Is the CMS seed idempotent?** — Yes, offers are matched by slug and locale and existing ones
  are skipped (source: `cms/scripts/seed.ts` header), so re-seeding adds just the new offer.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | Add `percent_every_nth` to `DISCOUNT_KINDS` |
| modify | `app/.server/db/schema.ts` | Value and min-quantity checks for the new kind; doc comments |
| create | `app/.server/db/migrations/0022_couple_offer.sql` (+ `meta/`) | Rewrite the checks, insert `couple-15` |
| create | `app/.server/db/rollbacks/0022_couple_offer.sql` | Delete an unused `couple-15`, restore the old checks |
| modify | `app/.server/db/migrator.test.ts` | Expect `0022_couple_offer` first when rolling back; test 0022 |
| modify | `app/.server/db/seed-data.ts` | `couple-15` in `SAMPLE_DISCOUNTS` |
| modify | `app/.server/db/seed.test.ts` | Seeded rules include `couple-15` |
| create | `app/.server/db/couple-offer.test.ts` | Migrated rule equals the seed and is 15% (the label says so) |
| modify | `app/.server/services/pricing.ts` | `discountSaving` case for `percent_every_nth` |
| modify | `app/.server/services/pricing.test.ts` | Couple-offer cases |
| modify | `app/lib/discounts.ts` | `COUPLE_OFFER_DISCOUNT_SLUG`; label for the new kind |
| modify | `app/lib/discounts.test.ts` | `discountLabel` tests (uk/en, code wins) |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `checkout.discountCouple` |
| modify | `app/features/cart/cart-ui.test.ts`, `app/features/checkout/checkout-ui.test.ts`, `app/.server/services/order-email.test.ts` | Couple-offer discount line |
| modify | `cms/scripts/seed.ts` | `couple-offer` offer in uk and en |
| modify | `app/.server/cms/__fixtures__/offers.json`, `offers.en.json` | Same offer in the fixtures |
| modify | `app/.server/cms/content.test.ts` | Expected slugs/counts include `couple-offer` |
| modify | `app/features/offers/offers-ui.test.ts` | A `bundle` group renders the couple card |
| modify | `app/.server/AGENTS.md` | Discounts section: the new kind, the second automatic rule, how to change it |

## Steps

- [ ] **1. Add the kind and its checks** — Add `"percent_every_nth"` to `DISCOUNT_KINDS`. In
  `schema.ts` change `discounts_value_check` to
  `value >= 0 and (kind not in ('percent', 'percent_every_nth') or (value > 0 and value <= 100))`
  and `discounts_min_quantity_check` to
  `min_quantity >= 1 and (kind not in ('fixed_price_set', 'percent_every_nth') or min_quantity >= 2)`;
  update the `value`/`minQuantity`/`maxSets` doc comments. `pnpm typecheck` now flags the
  non-exhaustive `switch` in `discountSaving` (the `saving` variable is unassigned), which step 2
  fixes.
- [ ] **2. Price the new kind** — In `discountSaving`, add:
  ```ts
  case "percent_every_nth": {
    const groups = Math.min(Math.floor(units.length / discount.minQuantity),
                            discount.maxSets ?? Number.POSITIVE_INFINITY);
    let discounted = 0;
    for (let g = 1; g <= groups; g++) discounted += units[g * discount.minQuantity - 1] ?? 0;
    saving = Math.floor((discounted * value) / 10_000);
    break;
  }
  ```
  (`?? 0` satisfies `noUncheckedIndexedAccess`.) Update the header comment. Add tests in
  `pricing.test.ts` with a `COUPLE` rule (`{30,50,100}`, pack 1, min 2, 15%): 1 bottle → 0;
  2 bottles 2000 + 1500 ₴ → 15% of 1500 = 225 ₴; 3 bottles → one discounted (the middle price);
  4 bottles of different prices → the 2nd and 4th dearest; quantity 2 on one line; rounding down
  (e.g. 15% of 999.99 ₴); only 5/10 ml units → 0; a 10 ml unit plus one 50 ml → 0; `maxSets`
  caps groups. In `priceCart`: the couple offer applies by itself; a cart with three 10 ml and two
  full bottles picks the larger of trio and couple; `JASSMIN10` (10% of everything) beats the
  couple offer when it saves more and is reported `not-best` when it doesn't; free delivery is
  decided after the couple discount.
- [ ] **3. Migration and rollback** — `pnpm db:generate --name couple_offer`, then append to
  `0022_couple_offer.sql`:
  `INSERT INTO "discounts" ("slug", "kind", "value", "scope_volumes_ml", "scope_pack_size", "min_quantity") VALUES ('couple-15', 'percent_every_nth', '15.00', '{30,50,100}', 1, 2) ON CONFLICT ("slug") DO NOTHING;`
  with a header comment like 0021's. Write `rollbacks/0022_couple_offer.sql`: delete `couple-15`
  where no order references it, then drop and re-add the three checks as in 0011 (a comment notes
  that the rollback fails on purpose while a used `percent_every_nth` rule exists, instead of
  silently breaking order history). Add the same row to `SAMPLE_DISCOUNTS` with a comment that
  0022 creates it everywhere. In `migrator.test.ts`, put
  `expect(await rollbackLatest(db)).toBe("0022_couple_offer")` before each
  `"0021_tester_trio_rule"` rollback and fix the "0007 to 0021" comments; add a test like the
  #98 one: 0022 creates the rule once, keeps an existing one, rolls it back, and the restored
  checks reject `percent_every_nth`. Update `seed.test.ts` for the extra rule.
- [ ] **4. DB test for the advertised rule** — `app/.server/db/couple-offer.test.ts` (skipped
  without a DB, like `tester-trio.test.ts`): after `migrateLatest`, `findDiscountBySlug(db,
  COUPLE_OFFER_DISCOUNT_SLUG)` matches the `SAMPLE_DISCOUNTS` row, `value` is `"15.00"` (the
  label copy and the Strapi texts say 15%), and `priceCart` on two `CATALOG_PRICES[50]` bottles
  saves 15% of one. Add `COUPLE_OFFER_DISCOUNT_SLUG = "couple-15"` to `app/lib/discounts.ts`.
- [ ] **5. Label and copy** — `discountLabel`: code → `discountWithCode`; `fixed_price_set` →
  `discountTesterSet`; `percent_every_nth` → `discountCouple`; else `discount` (a `Record` or
  `switch` over `DiscountKind` so a future kind is a type error). Add `checkout.discountCouple` to
  `uk.ts` and `en.ts`. Tests: `discounts.test.ts` (uk, en via `createTranslator("en")`, a code of
  the new kind shows the code); a couple-offer line in `cart-ui.test.ts` (en),
  `checkout-ui.test.ts` (uk) and `order-email.test.ts`
  (`"Пропозиція для двох: −15% на другий флакон: −225 ₴"`).
- [ ] **6. Strapi offer** — In `cms/scripts/seed.ts` add to `OFFERS` (and a comment that its
  `priceNote` matches the `couple-15` rule):
  slug `couple-offer`, kind `bundle`, image `cover`, no products, `ctaUrl: "/catalog/women"`,
  `sortOrder: 15`; uk: title "Пропозиція для двох", summary "Купуєте два повні флакони —
  другий на 15% дешевше.", body explaining that any two 30/50/100 ml bottles qualify (from the
  women's and men's catalogs), the cheaper of each pair is discounted, 5 and 10 ml don't count, and
  it doesn't add up with other discounts, priceNote "−15% на другий флакон", ctaLabel "Обрати
  пару"; en: "Couple offer", "Buy two full bottles and the second is 15% off.", matching body,
  "−15% on the second bottle", "Choose a pair". Add the same entry (uk and en) to
  `__fixtures__/offers.json` and `offers.en.json`, then update `content.test.ts` (expected slug
  order and `toHaveLength`) and add an `offers-ui.test.ts` case: a `bundle` group with the couple
  offer renders its title, price note and CTA in uk and, under `<I18nProvider locale="en">`, en.
- [ ] **7. Docs** — `app/.server/AGENTS.md` → Discounts: list the new kind and how it prices,
  say the shop now has two automatic rules (tester trio and `couple-15`, migration 0022), and how
  to change the percent (migration `UPDATE … WHERE slug = 'couple-15'`, `SAMPLE_DISCOUNTS`, the
  `checkout.discountCouple` copy, the Strapi offer's texts).

## Testing & verification
- Unit: `pricing.test.ts`, `discounts.test.ts`, cart/checkout/offers UI tests,
  `order-email.test.ts`, `content.test.ts`.
- Integration (need a DB): `migrator.test.ts`, `seed.test.ts`, `couple-offer.test.ts`,
  `schema.test.ts` (constraint names are unchanged).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`): add two 50 ml bottles → cart shows "Пропозиція для двох…" with 15%
  off the cheaper; add a third → still one discounted; a fourth → two; add three 10 ml → whichever
  saves more is used; enter `JASSMIN10` and check `not-best`/`applied`; place the order and check
  the success page, account order page and email; switch to English; reseed Strapi and see the
  couple-offer card on /offers in both languages.

## Acceptance criteria
- [ ] A cart with two full bottles (30/50/100 ml) gets 15% off the cheaper one, automatically — steps 2, 3
- [ ] With 3 full bottles one unit is discounted, with 4 two are, always the cheaper of each pair — step 2
- [ ] 5 and 10 ml units never count towards the couple offer — steps 2, 3
- [ ] When another rule (tester trio, promo code) saves more, that rule is used instead — step 2
- [ ] The cart, checkout, order page and email show the couple-offer discount line in Ukrainian and English — step 5
- [ ] The offers page shows a couple-offer card in both languages — step 6
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — all steps

## Out of scope
- Stacking discounts, or combining the couple offer with the tester trio or a code.
- Couple offers for specific products only.
- Other offers page changes (their own issues), an admin UI for discount rules.
- Showing the saving on product cards or the product page.
