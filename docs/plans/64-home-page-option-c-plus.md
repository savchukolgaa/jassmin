# Plan: Rebuild home page to match the Option C+ design, sections and animations (#64)

Issue: https://github.com/savchukolgaa/jassmin/issues/64
Branch: `issue/64`
Worktree: `.claude/worktrees/issue-64`
Status: Implemented

## Goal

Shoppers should land on a home page that looks and moves like the chosen `HomeBoldPlus` artboard
(Option C+), and reach the tester trio, the two catalogs and the bestsellers from it. `/` is
rebuilt section by section: a fuller hero with a price badge and floating chip, an offer marquee,
"How it works", "Build your trio", category tiles, bestsellers, and restyled about, location and
contacts, with the artboard's entrance and hover animations. Every price shown comes from the
active tester-trio discount rule, so the page never advertises a price checkout won't charge.

## Dependencies & prerequisites

- **#65 (open, planned in parallel): only for the family labels.** #65 adds
  `products.fragrance_families text[]`, `FRAGRANCE_FAMILIES` in `app/lib/enums.ts` with
  `catalog.families.*` labels, and the primary family on cards. Since the trio CTA goes to
  `/popular` (#67), this issue doesn't touch the catalog filter at all. Until #65 is merged, the
  trio chips, the marquee and the card badge use today's single `products.fragrance_family`
  values (shown as stored); step 9 switches them to #65's array and translated labels once #65 is
  on `main` (rebase `issue/64` on it). If #64 merges first, step 9 moves into #65.
- **#67 (open):** the `/popular` page and header button that "Order Now" links to. Not a blocker:
  the CTA is a Strapi field, so only its seeded value depends on #67.
- Done and on `main`: tester-trio discount rule (#59, `discounts.slug = 'tester-trio'`), offers
  (#55), Strapi product sync (#40), cart and add-to-cart (#10), Strapi home content (#20, #43),
  i18n (#28), C+ header/footer (#27).
- Strapi content-type change (`home.hero`, `home.about` components): restart Strapi so it picks up
  the schema, re-run `pnpm cms:seed`, then re-record `home-page.json` / `home-page.en.json`.
- No new packages, env vars or DB migrations (the bestseller and trio queries read existing
  tables; #65 owns the `fragrance_families` migration).

## Decisions & assumptions

- **Section order** (artboard): Hero → `OfferMarquee` → `HowItWorks` → `TrioBuilder` (`#trio`) →
  `CategoryTiles` → `Bestsellers` → `AboutSection` (`#about`) → `LocationSection` →
  `ContactsSection` (`#contacts`). Header and footer stay as they are (#27); none has a Unisex link
  (checked: no "unisex" string in `app/components` or `app/features`).
- **Trio price source = the DB rule, not Strapi.** A new `getTesterTrioOffer(now)` reads the
  `tester-trio` discount (`TESTER_TRIO_DISCOUNT_SLUG` in `app/lib/discounts.ts`) and returns
  `{ price, setSize, volumeMl }` only when it's `active`, inside its window (start inclusive, end
  exclusive, like `priceCart`) and not used up (`redemption_count < max_redemptions`); otherwise
  `null`. The home page doesn't fetch Strapi offers: the trio section is the "link"; the hero CTA
  (`hero.ctaHref`) goes to `/popular` (#67). This is what checkout charges, which is the
  issue's requirement.
- **Without the trio offer** (`trioOffer === null`): the hero badge, the marquee's offer text,
  the trio CTA price, and the whole "How it works" section (it explains the 499 ₴ offer, step 02
  is "Pay {price}") are hidden. The trio builder stays, as a family finder, with "Show my
  picks →".
- **Hero fields**: new optional, localised Strapi fields on `home.hero`: `eyebrow` (string ≤ 60),
  `subtitle` (text ≤ 300), `secondaryCtaLabel` (string ≤ 60), `secondaryCtaHref` (string ≤ 500).
  Each is `null` when blank and its element isn't rendered; the second CTA needs both label and a
  `resolveCtaHref`-valid href. The floating chip "Women · Men" is fixed copy
  (`home.hero.chip`), not CMS. The headline stays a single Strapi string with `text-balance`.
- **About image**: optional `image` media on `home.about`; without it the asymmetric
  (`rounded-[1.75rem_13.75rem_1.75rem_1.75rem]`-style, i.e. artboard 28/220/28/28 px) frame is a
  decorative `bg-primary-light` block, like the hero image placeholder today.
- **Bestsellers** (`getBestsellers`, home loader): the 4 listed products (`isListed`, with
  variants) with the most units sold in `order_items` of orders whose `status` is `paid`,
  `shipped` or `completed`; ties by newest; topped up with the newest listed
  products not already chosen when fewer than 4 have sales. Returned as `ProductSummary[]` from the
  existing `summaryColumns` / `toSummary`.
- **Bestseller card**: reuse `ProductCard` with a new `variant="compact"` that matches the
  artboard card (family badge on the image, "brand · volume", round quick-add button + → ✓). The
  quick-add button is `AddToCartForm` with a new `appearance="icon"` (48 px circle, `aria-label`
  "Add {title} to cart" / "Added to cart"), keeping its fetcher, `/cart` action and the existing
  inline `animate-toast` "Added to cart · View cart" status. The catalog keeps the current card.
- **Trio builder is a GET form**: `<Form method="get" action="/" preventScrollReset>` with one
  checkbox per family (`name="family"`), styled as pills. Checkboxes already expose their state
  to screen readers, so they get no `aria-pressed` (that's for toggle buttons); the group is a
  `fieldset` with a visually hidden legend. Without JS, "Update" submits to `/?family=…#trio` and
  the loader renders the filled slots and the CTA. With JS, chip changes update local state (the
  slots pop in place) and unchecked chips are `disabled` once 3 are picked; the server caps at 3
  as well (`parseTrioSearch`, first 3 known families, deduped). The builder never adds to the cart.
- **Trio CTA target**: `/popular?family=a&family=b&family=c` (owner, 2026-10-26). The chosen
  families travel in the URL; showing popular products filtered by them is #67's job (comment
  added to #67). With no family picked the CTA isn't shown.
- **Chip families**: the distinct families of listed products of either gender. Today that is
  `products.fragrance_family` (alphabetical, as stored); after #65, `unnest(fragrance_families)`
  in `FRAGRANCE_FAMILIES` order with `catalog.families.*` labels. The marquee uses the same list.
  URL values are the stored Ukrainian values.
- **Motion**: shared utilities used elsewhere (`fade-up`, `pop`, `spin-in`, `lift`) keep their
  look; new home-specific utilities are added for the artboard effects that differ. Only
  `animate-marquee` changes (30s → 26s, plus pause on hover); it isn't used by any page yet.
  Hero text uses `animate-fade-up` with `anim-delay-2/4/6` (160/320/480 ms ≈ artboard 150/300/450).
- **After #65 (merged into `issue/64` before the PR)**: `getTrioFamilies` returns every family of
  listed products (#65's `unnest(fragrance_families)` in `listFilterOptions`) as stored values;
  `labelTrioFamilies` in `app/lib/trio.ts` labels them with `fragranceFamilyLabel` and sorts them
  alphabetically in the UI's language, like the catalog filter. The compact card's badge uses the
  same label. #65 already added `fragranceFamily` to `ProductSummary`, so #64's copy was dropped.
- **Restyle (step 12)**: "Get directions" uses the `outline-light` variant on the pink card
  (the artboard's solid white button isn't a `Button` variant, and no new variants are added).
  Form inputs keep `border-muted` (2px, white background) instead of the artboard's `line`
  border, because `line` on white is below the 3:1 contrast inputs need. `Eyebrow` gains an
  `onPrimary` tone (white).
- **Bestseller cards (step 11)**: the compact card shows the stored (Ukrainian) family with
  `lang="uk"` until #65 adds labels. The round button's accessible name is "Add {title}, {size},
  to cart", then "Added to cart"; the existing status pill floats under it. The home loader skips
  revalidation after a `/cart` POST (the layout still refreshes the header count).
- **Trio builder details (step 8)**: a plain `<form method="get" action="/#trio">` (no router
  `Form`, since with JS it never submits). The chip limit is the pure `toggleTrioFamily` in
  `app/lib/trio.ts`, unit-tested, because component tests render static markup in Node. Unchecked
  chips are only disabled after hydration; without JS the loader caps the picks at 3. Empty slots
  have an `sr-only` "Slot n", filled ones "Slot n: family". The section isn't rendered when no
  listed product has a family.
- **CMS fixtures and generated types (step 1)**: Strapi wasn't running during implementation, so
  `home-page(.en).json` and `cms/types/generated/components.d.ts` were updated by hand in Strapi's
  shape (the about image mirrors the seeded `blog-cover.jpg` upload). Re-record them from a seeded
  Strapi when convenient. The seed skips existing home pages, so a dev Strapi needs the new hero
  fields filled in the admin (or a fresh `pnpm cms:seed`). The seeded hero CTA was already
  `/popular`, so it stays.
- **Tokens**: artboard hex → tokens: `#c22f4b` `primary`, `#a8233d` `primary-dark`, `#ff8fa1`
  `primary-light` (only on `ink`/`primary`), `#1f1a1c` `ink`, `#fff4f5` `blush`, `#f7f3f4` `card`,
  `#5f5558` `muted`, `#d9cfd2` `on-dark-muted`, `#e5dadd` `line`, `#4a4245` `body`. Artboard-only
  colours map to the nearest token: `#f3e7ea` (map bg) → `card`, `#6f6367`/`#8a7d81` (empty slot
  border/number) → `muted` / `on-dark-muted`, product tints → `card`. No new colours.

## Resolved questions

- **Q1b: Where does "Show my trio" go?** — Also to `/popular`, with the chosen families as
  `family` params (owner, 2026-10-26). The catalog filter stays as it is.
  Until #67 ships, that link is a 404; the home page is still built and tested with it.
- **Q1: Where does the hero's "Order Now" go?** — To the new Popular page `/popular`, which also
  gets a header button and its own C+ design; both are #67, not this issue. Here the hero keeps
  its Strapi `ctaHref`; the seed sets it to `/popular`. Until #67 ships, `/popular` is a 404, so
  #64 seeds `/popular` only if #67 is merged first, otherwise `/#trio` and #67 switches it
  (owner, 2026-10-26).
- **Q2: Bestseller card style** — the artboard's compact card on the home page only; the catalog
  keeps its card (owner, 2026-10-26, default).
- **Q3: Several families in one URL** — moot after Q1b: the catalog isn't the trio's target, so
  its filter is unchanged.
- **Q4: Which orders count as sales** — `status in ('paid', 'shipped', 'completed')`. The owner will
  provide the perfume information for the first bestseller list (owner, 2026-10-26); that data is
  seeded by #67 / the product import, not here.
- **Is there a Unisex link to remove?** — No: header, footer and empty cart already link only to
  women/men (source: `app/features/cart/EmptyCart.tsx`, #27, memory "no Unisex catalog"). The hero
  chip reads "Women · Men" and there are two tiles.
- **Where does the trio price come from?** — The `tester-trio` automatic `fixed_price_set` rule in
  `discounts` (499.00, `min_quantity` 3, 10 ml, pack size 1); Strapi's `priceNote` is text only
  and must match it (source: `app/.server/db/seed-data.ts` `SAMPLE_DISCOUNTS`,
  `app/.server/AGENTS.md` → Offers / Discounts, #59).
- **Which toast is "the Added to cart toast"?** — The inline `role="status"` pill with
  `animate-toast` in `AddToCartForm` (source: `app/features/cart/AddToCartForm.tsx`, #10). It's
  reused; the artboard's fixed bottom toast is not built.
- **Can `animate-marquee` change without affecting other pages?** — Yes, no component uses it yet
  (source: `grep animate-marquee app`). `spin-in`, `pop` and `fade-up` are used by the offers hero,
  product page, cookie banner and contact form, so they stay.
- **Do social links support Telegram and Viber?** — Yes, `SOCIAL_PLATFORMS` includes them; the
  pills render whatever `site-setting.socialLinks` holds (source: `app/lib/cms.ts`).
- **Exact artboard values** (sizes, radii, keyframes, copy) — read from
  `project/HomeBoldPlus.dc.html` on the design canvas (https://claude.ai/artifact/RCvne95y2han2bw8dWm1iW).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `cms/src/components/home/hero.json` | optional `eyebrow`, `subtitle`, `secondaryCtaLabel`, `secondaryCtaHref` |
| modify | `cms/src/components/home/about.json` | optional `image` media |
| modify | `cms/scripts/seed.ts` | new hero fields (uk/en), about image, hero `ctaHref: "/#trio"` |
| modify | `cms/types/generated/contentTypes.d.ts` | regenerated types (if Strapi regenerates components) |
| modify | `app/.server/cms/schemas.ts` | `heroComponent` / `aboutComponent` new fields (`nullish`) |
| modify | `app/lib/cms.ts` | `HomePage.hero` / `about` DTO fields |
| modify | `app/.server/cms/content.ts` | populate `about.image`; map new fields (blank → `null`) |
| modify | `app/.server/cms/__fixtures__/home-page.json`, `home-page.en.json` | re-recorded |
| modify | `app/.server/cms/content.test.ts`, `schemas.test.ts` | new fields and fallbacks |
| modify | `app/lib/discounts.ts` | `TESTER_TRIO_DISCOUNT_SLUG` |
| modify | `app/.server/db/queries/discounts.ts` | `findDiscountBySlug` |
| create | `app/.server/services/trio.ts` (+ `.test.ts`) | `getTesterTrioOffer(now)`, `toTrioOffer` (reuses `discountAvailability`) |
| modify | `app/.server/db/queries/products.ts` | `listBestsellers`; `fragranceFamily` in `summaryColumns` |
| modify | `app/.server/services/products.ts` | `getBestsellers`, `getTrioFamilies`, `fragranceFamily` on `ProductSummary` |
| create | `app/.server/services/bestsellers.test.ts` | DB tests for both |
| create | `app/lib/trio.ts` (+ `.test.ts`) | `TRIO_SIZE`, `parseTrioSearch`, `trioHref`, `TrioOffer` type |
| modify | `app/lib/home.ts` | `HomePageView`: hero fields, `about.image`, `trioOffer`, `trio`, `bestsellers` |
| modify | `app/.server/services/home.ts` (+ `home.test.ts`) | `buildHomePageView` takes the new inputs |
| modify | `app/routes/home.tsx` (+ `home.test.ts`) | loader loads trio offer, families, bestsellers, trio search; `shouldRevalidate` |
| modify | `app/features/home/HeroSection.tsx` | eyebrow, subtitle, 2 CTAs, rise image, badge, chip |
| create | `app/features/home/OfferMarquee.tsx` | `ink` marquee, `aria-hidden` |
| create | `app/features/home/HowItWorks.tsx` | three step cards |
| create | `app/features/home/TrioBuilder.tsx` | GET form, chips, slots, CTA |
| create | `app/features/home/CategoryTiles.tsx` | Women / Men tiles |
| create | `app/features/home/Bestsellers.tsx` | heading, "View all →", 4 compact cards |
| modify | `app/features/home/AboutSection.tsx`, `LocationSection.tsx`, `ContactsSection.tsx`, `ContactForm.tsx` | C+ restyle |
| modify | `app/features/home/HomePage.tsx`, `HomePage.test.ts` | new order and sections |
| create | `app/features/home/TrioBuilder.test.ts` | chip limit, slots, CTA href, no-JS state |
| modify | `app/features/catalog/ProductCard.tsx`, `app/features/cart/AddToCartForm.tsx` | `variant="compact"`, `appearance="icon"` |
| modify | `app/features/catalog/catalog-ui.test.ts`, `app/features/cart/cart-ui.test.ts` | compact card / icon button |
| modify | `app/app.css` | new motion utilities; marquee 26s + pause |
| modify | `app/theme.test.ts` | new utilities exist and are covered by reduced motion |
| modify | `docs/design.md` | Motion table: new utilities, marquee timing |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `home.*` keys |

## Steps

- [x] **1. CMS: hero and about fields** — Add the four optional hero attributes to
  `cms/src/components/home/hero.json` and `image` (single, images) to `about.json`. Extend
  `heroComponent` / `aboutComponent` in `app/.server/cms/schemas.ts` (`.nullish()`), the
  `HomePage` DTO in `app/lib/cms.ts` (`eyebrow: string | null`, …, `about.image: CmsImage | null`)
  and the mapper in `content.ts` (trim; blank → `null`; image through the same absolute-URL helper
  as `hero.image`); populate `about: { populate: ["image"] }` in `getHomePage`. Seed both locales
  in `cms/scripts/seed.ts` (uk: eyebrow "Тестерний набір", subtitle, "Усі парфуми" →
  `/catalog/women`; en: "Tester set", "See all perfumes"; `ctaHref`: `/popular` if #67 is merged,
  else `/#trio`; about image = the
  uploaded hero/cover image). Restart Strapi, `pnpm cms:seed`, re-record both home fixtures.
  Update `content.test.ts` / `schemas.test.ts`: fields mapped, missing fields → `null`.
  Check: `pnpm test app/.server/cms`.
- [x] **2. Tester-trio offer** — `TESTER_TRIO_DISCOUNT_SLUG = "tester-trio"` in
  `app/lib/discounts.ts`; `findDiscountBySlug(db, slug)` (pricing columns + `scopeVolumesMl`) in
  `queries/discounts.ts`; `app/.server/services/trio.ts` with
  `getTesterTrioOffer(now = new Date(), db = defaultDb): Promise<TrioOffer | null>`, live only when
  `active`, `kind === "fixed_price_set"`, `startsAt <= now < endsAt` and not used up.
  `TrioOffer = { price: string; setSize: number; volumeMl: number | null }` in `app/lib/trio.ts`.
  (Implemented as the pure `toTrioOffer(rule, now)` on top of `discountAvailability` from
  `services/pricing.ts`, so the window and limit rules are checkout's own.) Unit-test it and a DB integration test (seeded rule → offer;
  `active = false`, expired, used up → `null`).
- [x] **3. Trio search parsing** — In `app/lib/trio.ts`: `TRIO_SIZE = 3`,
  `parseTrioSearch(params, knownFamilies): string[]` (all `family` values, trimmed, known only,
  deduped, first 3). Tests: unknown values dropped, 4 values → 3, duplicates, empty.
- [x] **4. Motion utilities** — In `app/app.css`, add keyframes (start state only, as today) and
  utilities matching the artboard: `animate-rise` (80px, 1s, delay 0.2s), `animate-badge`
  (`spin-in-badge` from `rotate(-200deg) scale(0)` 0.9s `cubic-bezier(.3,1.4,.5,1)` at 0.7s, then
  `wobble` −8°↔6° ×1.04 4s infinite from 1.6s; resting `rotate: -8deg`), `animate-float` (−14px,
  6s infinite from 1s), `animate-slot-pop` (scale .3 rotate −20° → overshoot, 0.5s);
  `@utility card-tilt` (lift 6px + rotate −1deg, and `.card-tilt-img` zoom 1.04 over 0.5s on
  card hover), `tile-arrow` (tile up 6px, `[data-arrow]` slides 10px), `quick-add` (rotate 90deg
  scale 1.08 on hover), `chip-hover` (up 2px), `step-hover` (up 4px); change `--animate-marquee`
  to 26s and add `@utility marquee-pause` (`&:hover { animation-play-state: paused }`). All rely on
  the existing reduced-motion block. Extend `app/theme.test.ts` to assert each utility exists and
  the reduced-motion block is still last. Update the Motion table in `docs/design.md`.
- [x] **5. i18n keys** — Add to `home` in `uk.ts` and `en.ts`: `hero.{chip, badgeOnly, badgeFor,
  badgeLabel}`, `marquee.offer`, `howItWorks.{title, pick/pay/decide Title and Body}` (`payTitle`
  takes `{price}`), `trio.{title, intro, families, update, slots, slot, left, cta,
  ctaNoPrice}`, `tiles.{label, women, men}`, `bestsellers.{title, viewAll}`, plus
  `product.quickAdd` for the round add button. `badgeLabel`, `marquee.offer` and `trio.left` are
  plurals (`{ one, few, many, other }` in uk). The location title follows the artboard ("Come smell
  them in person"). `pnpm typecheck` catches missing keys.
- [x] **6. Hero** — `HeroSection`: eyebrow pill (`bg-white/16`, uppercase, `animate-fade-up`),
  `h1` (`text-5xl md:text-8xl`, `leading-[0.92]`, `anim-delay-2`), subtitle
  (`text-lg md:text-xl`, `anim-delay-4`), `dark` "Order Now" + `outline-light` second CTA
  (`anim-delay-6`), arched image with `animate-rise`. Over the image: the white round badge
  (`size-32 md:size-40`, `animate-badge`, `aria-hidden` plus an `sr-only` sentence "Only {price}
  for {count}") only when `trioOffer`, and the `ink` floating chip (`animate-float`). Section keeps
  `overflow-hidden`; badge/chip offsets are smaller below `md` so nothing overflows at 375px.
  Prices via `formatPrice`.
- [x] **7. Marquee, How it works, Category tiles** — `OfferMarquee`: `ink` band,
  `overflow-hidden`, track `aria-hidden="true"` with `animate-marquee marquee-pause`, content
  rendered twice: optional offer text (`home.marquee.offer`) then family labels separated by
  `primary-light` "✦". Rendered only when it has at least one item. `HowItWorks` (only with
  `trioOffer`): `h2` + 3 `step-hover` cards (01, 02 on `blush` with `primary-dark` numbers, 03 on
  `ink` with `primary-light` / `on-dark-muted`), `rounded-card-lg`. `CategoryTiles`: two
  `Link`s (`/catalog/women` `blush`, `/catalog/men` `ink`), `min-h-50`, big label and
  `aria-hidden` arrow, `tile-arrow`, `focusRing("onLight")`.
- [x] **8. Trio builder (UI)** — `TrioBuilder({ families, selected, trioOffer })`: `ink` panel
  `id="trio"` (`scroll-mt-20`), `h2`, intro; `<Form method="get" action="/#trio"
  preventScrollReset>` with a `fieldset` of checkbox pills (`sr-only` input + styled label,
  `peer-checked:bg-primary-light peer-checked:text-ink`, `peer-focus-visible` ring,
  `min-h-11`, `chip-hover`), unchecked ones `disabled` when 3 are picked (JS only; server caps
  too), and an "Update" submit button (`home.trio.update`) that is rendered on the server and
  removed after hydration (a `useEffect` flag), so no-JS users can submit. Three slots (dashed
  arch; filled slot `animate-slot-pop` with the family label; empty shows its number), then either
  `role="status"` "{count} more to pick" or the CTA `ButtonLink` to `trioHref(selected)`
  (`/popular?family=…`, in `app/lib/trio.ts`). State: `useState(selected)` from the loader,
  re-synced when `selected` changes. Families come in as a `{ value, label }[]` prop.
- [x] **9. Trio families** — `getTrioFamilies(db)` in `services/products.ts` reuses
  `listFilterOptions(db, GENDERS)` (distinct non-null `fragrance_family` of listed products with
  variants, any gender, alphabetical) and returns `{ value, label }[]` (label = value for now).
  `ProductSummary` gains `fragranceFamily` (the stored primary family) for the card badge.
  **After #65 is on `main`:** read `unnest(fragrance_families)`, order by `FRAGRANCE_FAMILIES` and
  label with `t("catalog.families.…")`, and show the translated primary family on the compact
  card. Tests: DB test that inactive products' and products without variants' families are left
  out; `trioHref` encodes each family.
- [x] **10. Bestsellers query** — `listBestsellers(db, limit)` in `queries/products.ts`: one
  query, `products` + `variantStats`, left-joined to a subquery summing `order_items.quantity` per
  `product_id` over orders with `status in ('paid','shipped','completed')`, `isListed`, ordered by
  `coalesce(units, 0) desc`, then newest. Unsold products come after sold ones, newest first, so
  the top-up needs no second query. `getBestsellers(db = defaultDb)` → `BESTSELLER_COUNT` (4)
  `ProductSummary`. DB integration test (`services/bestsellers.test.ts`): ranking, ignored
  statuses, inactive/variant-less skipped, newest top-up, at most 4.
- [x] **11. Bestseller cards** — `AddToCartForm` gets `appearance?: "button" | "icon"`: icon renders
  a 48 px round `primary` button with "+" (`quick-add`), turning `bg-success` "✓" with
  `aria-label` "Added to cart" after an ok result; status text unchanged. `ProductCard` gets
  `variant?: "default" | "compact"`: `bg-card` card with `card-tilt`, image wrapper
  `overflow-hidden` with `card-tilt-img`, white family badge (#65's primary family label; omitted
  when `null`), "brand · {size}", title link, price + icon add. `Bestsellers`: `h2`, "View all →"
  to `/catalog/women`, grid `sm:grid-cols-2 lg:grid-cols-4` of compact cards with
  `headingLevel={3}`; hidden when the list is empty. Tests in `catalog-ui.test.ts` /
  `cart-ui.test.ts`.
- [x] **12. About, location, contacts restyle** — `AboutSection`: `blush`, two columns: photo
  (`about.image`, asymmetric radius, `loading="lazy"`) and eyebrow/`h2` (`text-4xl md:text-5xl`)/
  `RichText`. `LocationSection`: deep-pink card (`bg-primary text-white rounded-card-lg p-10`,
  eyebrow, `h2`, address and hours with white icons, white "Get directions" `ButtonLink`
  variant) beside the map (`flex-[2]`, `min-h-110`, `rounded-[2rem]`). `ContactsSection`: `ink`,
  eyebrow `primary-light`, `h2`, phone/email links and hours with `primary-light` icons, social
  links as `outline-light` pills (`min-h-11`); `ContactForm` inside a white `rounded-[2rem] p-9`
  panel, inputs `rounded-2xl border-2 border-line min-h-13`, `primary` submit. Keep every
  existing id, label, `name`, honeypot, `aria-*`, action result handling and test.
- [x] **13. Loader, view and page** — `HomePageView` gains `hero.{eyebrow,subtitle,secondaryCta}`,
  `about.image`, `trioOffer: TrioOffer | null`, `trio: { families, selected }`,
  `bestsellers: ProductSummary[]`. The home `loader` runs in parallel: CMS calls (as today, with
  `cmsUnavailable`), `getTesterTrioOffer()`, `getTrioFamilies(locale)`, `getBestsellers()`; then
  `parseTrioSearch(url.searchParams, families)`. DB failures throw (500) like other loaders.
  `buildHomePageView` takes an object of these inputs. `shouldRevalidate`: still skip the contact
  POST; GET trio submissions revalidate (cheap enough). `HomePage` renders the sections in the
  artboard order. Update `home.test.ts` (service) and `routes/home.test.ts`.
- [x] **14. Polish and layout checks** — 375 px: no horizontal scroll (hero `overflow-hidden`,
  marquee clipped, grids collapse to one column), touch targets ≥ 44 px, visible `focusRing()` on
  chips, tiles, cards, quick add, social pills and form fields. Search the diff for `#` hex values
  and user-facing literals.

## Testing & verification

- **Unit**: `parseTrioSearch`, `isRuleLive`, `trioHref`, `buildHomePageView` (new fields, `trioOffer: null`), CMS mapping of the
  new fields, `theme.test.ts` utilities.
- **Component** (`renderToStaticMarkup` + `createRoutesStub`, as in `HomePage.test.ts`): sections
  present and in artboard order (by heading ids / `id`s); badge, marquee offer text, "How it works"
  and CTA price absent when `trioOffer` is `null`; marquee track `aria-hidden`; tiles link only
  to `/catalog/women` and `/catalog/men` and no "Unisex"/"Унісекс" text; trio with 3 selected
  renders 3 filled slots, the CTA href with all families and disabled unchecked chips; with 1
  selected "2 more to pick" (uk plural "Ще 2 на вибір"); compact card renders badge and icon
  button; English copy under `<I18nProvider locale="en">`.
- **DB integration** (`describe.skipIf(!hasDatabase)`, `createTestDatabase`): `getTesterTrioOffer`
  states; `getBestsellers` ranking, status filter, inactive skip, newest fallback; multi-family
  catalog filter.
- **Commands**: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **Manual** (`pnpm aspire run`, seeded DB and Strapi): compare `/` with the artboard at 1440 and
  375 px; animations (badge spin then wobble, chip float, image rise, card tilt/zoom, tile arrow,
  quick-add rotate, chip hover, marquee pause on hover); DevTools "prefers-reduced-motion: reduce"
  stops all of them; disable JS and use the trio builder; set the `tester-trio` rule
  `active = false` and see the badge, marquee offer text, "How it works" and CTA price disappear;
  quick add shows ✓ and the toast and bumps the header cart count; `/en` copy.

## Acceptance criteria

- [ ] The home page shows every section of the `HomeBoldPlus` artboard in the same order and
  layout, at desktop and phone widths — steps 6, 7, 8, 11, 12, 13, 14
- [ ] Hero has the eyebrow, headline, subtitle, both CTAs, arched image, price badge and floating
  chip, with the artboard's entrance animations — steps 1, 4, 6
- [x] The badge, marquee offer text and trio price come from the active tester-trio offer and are
  hidden when there is none — steps 2, 6, 7, 8, 13
- [x] The marquee scrolls in a loop, pauses on hover and is hidden from screen readers — steps 4, 7
- [ ] "Build your trio" allows at most 3 families, fills the slots, and leads to products
  filtered by those families, also without JS — steps 3, 8, 9 (the CTA passes the families to
  `/popular`; the filtering there is #67)
- [x] Category tiles link to `/catalog/women` and `/catalog/men`; there is no Unisex tile, chip or
  link — steps 6, 7
- [ ] "Bestsellers" shows 4 real products with working quick add and the "Added to cart" toast —
  steps 10, 11
- [ ] About, location and contacts match the artboard's styling and keep their current CMS data
  and contact form behaviour — steps 1, 12
- [ ] All hover and entrance animations match the artboard, and none run with
  `prefers-reduced-motion: reduce` — step 4 (used in 6–12)
- [x] Only C+ tokens are used; no hard-coded hex colours or user-facing strings; all copy is in
  `uk.ts` and `en.ts` — steps 5, 14
- [ ] No horizontal scroll at 375px; focus rings are visible on every interactive element — step 14
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — all steps

Not yet verified in a browser (Strapi wasn't running, so the page couldn't be loaded): the
artboard comparison at 1440 and 375 px, the animations and reduced motion, focus rings, quick add
end to end, and the no-JS trio flow. The trio's family filtering on `/popular` is #67. Check these
manually before merging.

## Out of scope

- Any change to the catalog's family filter, filtering `/popular` by family (#67), `fragrance_families`, family labels and the product
  page's families/notes (#65).
- The Popular page, its header button and design (#67).
- Header and footer (#27), a dark theme, new tokens or fonts, other pages.
- The artboard's fixed bottom toast and header cart-count animation; the existing inline toast is
  reused.
- Adding a trio to the cart from the home page, a 10 ml-only catalog filter, and Strapi offers on
  the home page.
