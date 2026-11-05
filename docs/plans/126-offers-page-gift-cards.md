# Plan: Update the offers page: gift cards, free delivery from 1500 ₴ and the couple offer (#126)

Issue: https://github.com/savchukolgaa/jassmin/issues/126
Branch: `issue/126`
Worktree: `.claude/worktrees/issue-126`
Status: Planned

## Goal
Shoppers should see the shop's current offers on `/aktsii` (`/en/offers`), and what they read
there should match what checkout does. The editorial "Gifts by budget" offer is replaced by a
gift card offer (500 / 1000 / 2000 ₴) whose CTA opens the gift card page from #125. Every
free-delivery mention says 1500 ₴, and the couple offer card from #124 shows up.

## Dependencies & prerequisites
- **#124 (couple offer): merged** (`380aca7`). The `couple-offer` entry (kind `bundle`,
  `sortOrder` 15) is already in `cms/scripts/seed.ts`, `offers.json` and `offers.en.json`, and
  `offers-ui.test.ts` already renders it in both languages. Here we only check that it's there.
- **#125 (gift card page): open, planned in parallel. It must merge before #126.** #125 adds
  the page key `giftCards` to `PAGES` in `app/lib/paths.ts`, with paths uk `podarunkovi-kartky`
  and en `gift-cards`. Until that's on `main`, `localizeInternalPath("/podarunkovi-kartky", "en")`
  can't find the page and returns the path unchanged. The English CTA would then point to a
  Ukrainian URL that 404s, and the tests in step 4 would fail.
  - Steps 1 to 3 (seed, fixture and README copy) don't depend on #125 and can be written now.
  - Before step 4 and before opening the PR: `git -C "$WT" fetch origin && git -C "$WT" rebase
    origin/main`, then check `PAGES.giftCards` exists with exactly those two paths. If #125
    named the page or its paths differently, use what's on `main` and update `ctaUrl`.
  - The PR description says "Depends on #125 (merge it first)".
- No migration, no new packages, no env vars, no Strapi schema change. The `gift` offer kind is
  reused (issue assumption).

## Decisions & assumptions
- **New offer `gift-cards`** replaces `gifts-by-budget` everywhere (seed, both fixtures, tests).
  The kind (`gift`) and `sortOrder` (20) stay the same, so the offer stays in the same place on
  the page. `productIds: []`: a gift card isn't a product, so the card shows no product strip.
  It keeps the `cover` image, like the old offer.
- **CTA URL `/podarunkovi-kartky`** (the Ukrainian path). `ctaUrl` isn't localized in Strapi
  (one value for every locale, see `cms/scripts/seed.ts` around line 568).
  `toOfferView` → `toInternalPath` → `localizeInternalPath` (`app/lib/links.ts`,
  `app/lib/paths.ts`) rewrites any page path to the viewer's locale, so English visitors get
  `/en/gift-cards`. The other offers store paths the same way (`/catalog/women`, `/register`).
- **Copy** (both languages, the same text in the seed and the fixtures). It must match #125's
  rules: fixed amounts, paid by card online, code by email, spent at checkout, any rest stays on
  the card, valid 12 months. Put a comment above the seed entry, like the couple offer's:
  `// The gift card page and checkout (#125) set these rules; keep the texts in sync with them.`

  | Field | uk | en |
  |---|---|---|
  | title | Подарункові картки на 500, 1000 і 2000 ₴ | Gift cards of 500, 1000 and 2000 ₴ |
  | summary | Подаруйте аромат, не вгадуючи його: отримувач обере парфуми сам. | Give perfume without guessing the scent: they choose it themselves. |
  | body | Оберіть картку на **500**, **1000** або **2000 ₴** і оплатіть її карткою онлайн. Код прийде вам на пошту одразу після оплати: перешліть його тому, кого вітаєте. Код вводять під час оформлення замовлення, а залишок зберігається на картці для наступних покупок. Картка діє 12 місяців. | Choose a card of **500**, **1000** or **2000 ₴** and pay for it by card online. The code arrives in your inbox as soon as the payment goes through: forward it to the person you're celebrating. They enter it at checkout, and anything left stays on the card for their next order. A card is valid for 12 months. |
  | priceNote | 500 · 1000 · 2000 ₴ | 500 · 1000 · 2000 ₴ |
  | ctaLabel | Обрати картку | Choose a card |

- **Free delivery is already 1500 ₴ in the code.** `FREE_SHIPPING_THRESHOLD = "1500.00"`
  (`app/lib/checkout.ts:14`), and every app string (`cart.deliveryNote`,
  `checkout.freeShippingHint`, `home.marquee.freeDelivery`) uses `{threshold}`. The seed and
  fixture perk say "від 1500 ₴" / "from 1500 ₴". The only "1000 ₴" left is in the
  `gifts-by-budget` body, which this plan removes. Step 5 repeats the search so the PR can say
  so. The live Strapi entries may still be wrong, and that's the PR's staff checklist.
- **Offers group heading and page intro:** see Q1. Until it's answered, the plan follows the
  recommended default.
- **The English-fallback test keeps its coverage.** Today `gifts-by-budget` is the only offer
  missing from `offers.en.json`, and that's what tests "keep Ukrainian where a translation is
  missing" in `content.test.ts`. The gift card offer must exist in English (acceptance
  criterion), so it goes into both fixtures. The fallback test then builds its own English
  response from `offersEn` with one entry filtered out (`welcome-offer`), and a new assertion
  checks that `gift-cards` comes back in English.

## Open questions
- [ ] **Q1: Should the `gift` group heading and the offers intro mention gift cards?** Why it
  matters: the gift card offer would sit under "Ідеї подарунків" / "Gift ideas", and the page
  intro and meta description say "ідеї подарунків" / "gift ideas", which describe the offer this
  issue removes. Recommended default: rename `offers.kinds.gift` to "Подарунки" / "Gifts", and in
  `offers.intro` and `offers.metaDescription` replace "ідеї подарунків" / "gift ideas" with
  "подарункові картки" / "gift cards". Change `uk.ts` and `en.ts` together, and the
  `">Gift ideas<"` marker in `offers-ui.test.ts`. Affects step 3.
- [ ] **Q2: Should re-running the seed remove `gifts-by-budget` from an existing local Strapi?**
  Why it matters: the seed only adds missing entries ("existing localizations … are left
  alone"), so a developer's local Strapi keeps the old offer next to the new one. Recommended
  default: no cleanup code. The PR description says to delete `gifts-by-budget` in the local
  Strapi admin (or reset the CMS database), just like staff do on the live site. Affects step 1.

## Resolved questions
- **Which URL does the CTA use, and does it need one per locale?** One app path (the Ukrainian
  `/podarunkovi-kartky`). The app localizes it per viewer (source: `app/.server/services/offers.ts`
  `toOfferView`, `app/lib/links.ts` `toInternalPath`, `app/lib/paths.ts` `localizeInternalPath`;
  user note on the page key and paths of #125).
- **Is a Strapi schema change needed?** No. The `gift` kind is reused (source: #126
  assumptions; `README.md` offer content type).
- **Does any app code still use 1000 ₴ for free delivery?** No (source: `app/lib/checkout.ts:14`,
  `app/lib/i18n/uk.ts` / `en.ts` `{threshold}` keys, `cms/scripts/seed.ts` `free-delivery`).
- **Is the couple offer already on the page?** Yes, since #124 merged (source: `cms/scripts/seed.ts`
  `couple-offer`, both fixtures, `offers-ui.test.ts` "shows the couple offer in the bundles group").
- **Is #124 merged?** Yes (source: `origin/main` `380aca7`; user note).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `cms/scripts/seed.ts` | Replace the `gifts-by-budget` offer with `gift-cards` (uk + en); update the header comment ("gift ideas" → "gift cards") |
| modify | `app/.server/cms/__fixtures__/offers.json` | Replace the `gifts-by-budget` entry with the Ukrainian `gift-cards` entry |
| modify | `app/.server/cms/__fixtures__/offers.en.json` | Add the English `gift-cards` entry (same `documentId` as the Ukrainian one) |
| modify | `app/.server/cms/content.test.ts` | Expected slugs, the fallback test with its own filtered English response, a check that `gift-cards` comes back in English |
| modify | `app/.server/services/offers.test.ts` | Check that the gift card CTA becomes `/podarunkovi-kartky` (uk) / `/en/gift-cards` (en) |
| modify | `app/features/offers/offers-ui.test.ts` | Render the gift card offer next to the couple offer in both languages; update the group heading marker (Q1) |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | Q1: `offers.kinds.gift`, `offers.intro`, `offers.metaDescription` |
| modify | `README.md` | The seed description (line ~224): "gift ideas" → "gift cards" |

## Steps
- [ ] **1. Seed: replace the offer** — In `cms/scripts/seed.ts`'s `OFFERS`, replace the
  `gifts-by-budget` object with `slug: "gift-cards"`, `kind: "gift"`, `image: "cover"`,
  `productIds: []`, `ctaUrl: "/podarunkovi-kartky"`, `sortOrder: 20`, and the uk/en copy from
  the table in Decisions, with the sync comment above it. In the file's header comment, change
  "gift ideas" to "gift cards". `SAUVAGE`, `LA_VIE_EST_BELLE` and `MISSING_PRODUCT` stay because
  other offers use them. Biome flags them if any becomes unused. Check: `pnpm --dir "$WT" lint`
  and `pnpm --dir "$WT" typecheck`.
- [ ] **2. Fixtures** — In `offers.json`, rewrite the `id: 23` entry: new `documentId` (24
  lowercase characters, e.g. `g1f7c4r2d5s8k0p3m6n9q1wz`), `title`, `slug: "gift-cards"`, `summary`,
  `body`, `priceNote`, `ctaLabel`, `ctaUrl: "/podarunkovi-kartky"`, `products: []`. Keep the
  `image` block, `sortOrder: 20`, the timestamps and `locale: "uk"`. In `offers.en.json`, add the
  English entry at the same position (after `couple-offer`, before `welcome-offer`) with the
  **same `documentId`**, a new `id`, `locale: "en"` and the English copy. Both fixtures are
  checked against the zod schema in `app/.server/cms/schemas.ts` when the tests load them.
- [ ] **3. Offers copy (Q1 default)** — In `uk.ts`/`en.ts`, `offers.kinds.gift`: "Подарунки" /
  "Gifts". In `offers.intro` and `offers.metaDescription`: "ідеї подарунків" → "подарункові
  картки", "gift ideas" → "gift cards". Update the `">Gift ideas<"` marker in the `OffersPage`
  grouping test to `">Gifts<"`. That test's card is also titled "Gifts", so give the card a
  different title (e.g. "Gift cards") so the order check stays meaningful. Update `README.md`
  line ~224 ("gift ideas" → "gift cards"). Check: `pnpm --dir "$WT" typecheck` (the uk/en key
  check).
- [ ] **4. Tests (after rebasing onto #125)** — Rebase onto `origin/main` with #125 merged and
  check `PAGES.giftCards` (see Dependencies). Then:
  - `content.test.ts`, "returns the active offers in editor order": `gifts-by-budget` →
    `gift-cards`.
  - "swaps in English translations and keeps Ukrainian where one is missing": answer `en` with
    `{ ...offersEn, data: offersEn.data.filter((o) => o.slug !== "welcome-offer") }` and expect
    `["gift-cards", "en"]` and `["welcome-offer", "uk"]`. Add a test (or an assertion) that with
    the full `offersEn` every offer, `gift-cards` included, comes back with `locale: "en"`, and
    that its `ctaUrl` is `/podarunkovi-kartky`.
  - `offers.test.ts`: `buildOffersPageView([offer("gift-cards", "gift", { ctaUrl:
    "/podarunkovi-kartky", ctaLabel: "Choose a card" })], PRODUCTS, locale)` gives
    `cta.to === "/podarunkovi-kartky"` for `uk` and `"/en/gift-cards"` for `en`.
  - `offers-ui.test.ts`: a test like the #124 couple-offer one that renders the gift card offer
    (`kind: "gift"`, `priceNote: "500 · 1000 · 2000 ₴"`, CTA to the localized path) and the
    couple offer, in `uk` and `en`. It checks that the title, the price note, the
    `href="/podarunkovi-kartky"` / `href="/en/gift-cards"` link, the couple-offer title, and no
    "Подарунки за бюджетом" / "Gifts by budget".
  - Check: `pnpm --dir "$WT" test`.
- [ ] **5. Free-delivery sweep** — Run `git -C "$WT" grep -nE "1000" -- app cms/scripts cms/src
  README.md docs` and read every match that's about delivery. None is expected after step 1.
  Write the result in the PR description. Don't change any `{threshold}` copy.
- [ ] **6. Manual check** — `pnpm aspire run` from the worktree, re-seed (or add the entry by
  hand, see Q2), and open `/aktsii` and `/en/offers`. Check that the gift card offer shows with
  the amounts and its CTA opens the gift card page in each language, that the couple offer card
  is in the bundles group, that the perks strip says 1500 ₴, and that "Gifts by budget" is gone.
- [ ] **7. PR description: staff checklist for live Strapi** — For `/open-pr 126`, list the
  live entries to edit, with the exact text in both languages:
  1. **Offer "Подарунки за бюджетом" / "Gifts by budget"** (`gifts-by-budget`): delete it or
     unpublish it, in both locales.
  2. **New offer** (uk first, then the en localization): kind `gift`, cover image, no
     products, `ctaUrl` `/podarunkovi-kartky`, `sortOrder` 20, and every field from the copy
     table. Publish both locales.
  3. **Perk "Безкоштовна доставка" / "Free delivery"**: summary "Новою Поштою від 1500 ₴" /
     "With Nova Poshta from 1500 ₴". Also check any other offer, home page or site-setting
     text that mentions a delivery threshold.
  4. **Couple offer** (`couple-offer`): make sure it exists and is published in both locales
     (text from #124's seed).
  Also: "Depends on #125: merge it first."

## Testing & verification
- Unit/integration: the updated `content.test.ts` (fixture order, English translation, fallback),
  `offers.test.ts` (localized gift card CTA) and `offers-ui.test.ts` (gift card and couple offer
  cards in uk and en, no "Gifts by budget").
- Commands: `pnpm --dir "$WT" typecheck`, `pnpm --dir "$WT" lint`, `pnpm --dir "$WT" test`,
  `pnpm --dir "$WT" build`. Run them all after the rebase onto #125.
- Manual: step 6.

## Acceptance criteria
- [ ] The offers page shows a gift card offer with the amounts 500, 1000 and 2000 ₴, linking to
  the gift card page, in Ukrainian and English — steps 1, 2, 4, 6
- [ ] "Gifts by budget" no longer appears — steps 1, 2, 3, 4, 7
- [ ] Every free-delivery mention on the site and in the seed says 1500 ₴ — step 5 (already true
  in code; live entries via step 7)
- [ ] The couple offer card is shown on the offers page — steps 4, 6 (already added in #124)
- [ ] The PR description lists the live Strapi entries staff must edit, with the exact text —
  step 7
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — Testing & verification

## Out of scope
- The gift card page, its purchase action and redemption at checkout (#125).
- Couple-offer pricing (#124).
- A Strapi schema change or a new offer kind.
- Seed code that deletes retired offers from an existing Strapi (Q2).
- Editing the live Strapi entries: staff do that from the PR checklist.
