# Plan: White header, slimmer offers marquee and bigger hero and About photos on the home page (#72)

Issue: https://github.com/savchukolgaa/jassmin/issues/72
Branch: `issue/72`
Worktree: `.claude/worktrees/issue-72`
Status: Planned

## Goal

As a shopper, I want a header that stands apart from the home page's deep-pink hero, a slimmer
offer strip with the real deals, and bigger photos, so the home page is easier to read. The shared
header turns white with `ink` text, the home marquee gets about half as tall and scrolls only offers
(tester trio and free delivery, no fragrance families), and the hero image and About us photo grow.

## Dependencies & prerequisites

- #64 (home page), #67 (Bestsellers/Popular header link), #27 (header/footer), #59 (tester-trio
  rule): all merged on `origin/main`.
- #71 (free delivery from 1500 ₴): **open**. Not a blocker: the marquee reads
  `FREE_SHIPPING_THRESHOLD` from `app/lib/checkout.ts` (currently `"1000.00"`), so it shows 1500 ₴
  once #71 lands, with no change here.
- #73 (plum/orchid rebrand and heading serif): **open, planned in parallel, implemented after this
  issue.** It recolours the site by changing tokens in `app/app.css`, so this issue must not add any
  hex value or arbitrary colour (see Decisions).
- No migrations, env vars or packages. The worktree's `node_modules` is not installed yet: run
  `pnpm install` before `/implement 72`.

## Decisions & assumptions

- **Tokens only (from the owner, for #73).** Every header colour is a token utility
  (`bg-white`, `text-ink`, `text-primary`, `text-primary-dark`, `bg-primary`, `hover:bg-primary-dark`,
  `hover:bg-blush`, `border-line`, `outline-primary`). No `#…`, `rgb(…)`, `[color:…]` or
  `bg-[…]` classes, so #73 recolours the header by editing `app/app.css` alone. The contrast tests
  name tokens, not hex values, so they re-check the header after #73's change.
- **Reuse the existing `"onLight"` tone** in `app/components/layout/nav.ts` for the whole header
  instead of adding a third tone. The footer keeps `"onPrimary"` (it stays deep pink), so
  `navItemClasses()`, `iconButtonClasses()` and `focusRing()` keep `"onPrimary"` as their default.
- **Active link colour:** change the `onLight` active state from `text-primary` to
  `text-primary-dark` (issue: "`primary-dark` for the active link and hover"; 7.06:1 on white,
  6.56:1 on the `blush` hover). This also applies to the catalog dropdown and the mobile menu,
  which already use `onLight`, so all three stay consistent.
- **Active marker in the bar:** the header bar keeps its underline for the current section
  (`underline decoration-2 underline-offset-8`), so the active state isn't shown by colour alone.
  The panels (dropdown, mobile menu) stay without an underline. Implement as an `underline` option
  (e.g. `navItemClasses(active, "onLight", { underline: true })`) or a small
  `headerNavItemClasses(active)` helper in `nav.ts`; pick whichever reads cleaner.
- **Bar underline as a helper (implemented):** `navItemClasses(active, tone, { underline })`
  defaults `underline` to `tone === "onPrimary"`, and `headerNavItemClasses(active)` wraps the
  white-bar case. The `onLight` icon button's active state is `bg-blush text-primary-dark` (was
  `text-primary` only), so the active profile/menu icon isn't marked by colour alone.
- **Header surface:** `bg-white text-ink` with a `border-b border-line` bottom border. The line is
  decorative (1.36:1): on the home page the deep-pink hero gives the real separation, on white pages
  the border is a hint. No shadow by default (see Q2).
- **Header elements:**
  - Wordmark: `text-ink`, dot `text-primary` (`primary-light` is about 2.2:1 on white and only allowed
    on dark/pink surfaces).
  - Logged-out profile and the hamburger `<summary>`: `iconButtonClasses(active, "onLight")`.
  - Logged-in profile: inverted circle `bg-primary text-white hover:bg-primary-dark` (was
    `bg-white text-primary` on pink).
  - Cart pill: `bg-primary text-white hover:bg-primary-dark` (white on `primary` 5.52:1, on
    `primary-dark` 7.06:1).
  - Locale switcher in the bar: `tone="onLight"` (active `bg-blush text-primary-dark`).
  - "Popular" button from the issue = the `BESTSELLERS_LINK` `NavLink` (#67); it follows the nav
    item styles, no separate button.
  - All focus rings: `focusRing("onLight")` (`primary` ring, 5.52:1 on white, 5.13:1 on `blush`).
- **Mobile menu panel / catalog dropdown:** already `bg-white text-ink`. Add `border-t border-line`
  to the mobile panel so it reads as separate from the now-white bar. The dropdown keeps its shadow
  and also gets a `border border-line` (implemented), since it now opens over a white bar and often
  a white page.
- **Marquee:** `py-2` and `text-base md:text-lg font-extrabold` (from `py-4.5`, `text-xl/md:text-2xl`),
  gap reduced to `gap-8 pr-8` to match the smaller type (final size checked with the
  owner on the running page). Items: the trio offer (when `trioOffer` exists) and
  `home.marquee.freeDelivery` with `formatPrice(FREE_SHIPPING_THRESHOLD)`. Since free delivery is
  always present, the "nothing to say → `null`" branch goes away.
- **Marquee fill:** with only two short items, one copy of the track is narrower than a wide
  viewport, which would leave an empty stretch before the loop restarts. Repeat the items inside
  each copy a fixed number of times (`const REPEAT = 4`, Q1) so a copy is wider than ~1600px.
  The 26s duration and the `animate-marquee`/`marquee-pause` utilities are unchanged (speed and
  animation are out of scope). Keys become index-based since items repeat.
- **`labelTrioFamilies` stays** in `app/lib/trio.ts`: `TrioBuilder.tsx` still uses it. Only the
  marquee's import and `families` prop go; `HomePage.tsx` stops passing it.
- **Hero image:** column `max-w-lg` and `flex-[2_1_24rem]` (from `max-w-md`, `20rem`), frame
  `h-112 md:h-152` (28rem / 38rem, Tailwind v4 numeric spacing like the existing `h-130`),
  `sizes="(min-width: 768px) 512px, 100vw"`. Badge and chip stay absolutely positioned inside the
  same relative wrapper, so they keep their place relative to the image.
- **About photo:** frame `h-96 md:h-136` (24rem / 34rem) and `flex-[1_1_28rem]` (from `h-80 md:h-115`,
  `24rem`), `sizes="(min-width: 768px) 640px, 100vw"`.
- **Design canvas (`HomeBoldPlus`)** is updated with the owner, outside the code (Q3).

## Resolved questions

- **Q1: Marquee density and repeat count?** — `py-2`, `text-base`/`md:text-lg`, items repeated 4×
  per copy; fine-tuned on the running page with the owner (source: owner, 2026-10-29).
- **Q2: Bottom border or shadow for the white header?** — `border-b border-line` only; `shadow-sm`
  only if the owner later finds it too flat (source: owner, 2026-10-29).
- **Q3: Who updates the design canvas's `HomeBoldPlus` header?** — The code and `docs/design.md`
  change in this PR; the owner updates the canvas, and the PR description notes it (source: owner,
  2026-10-29).

- **Is the "Popular" button a separate component?** — No, it's the `BESTSELLERS_LINK` NavLink
  labelled "Bestsellers" (source: `app/components/layout/nav.ts`, `Header.tsx`, #67).
- **Can the marquee (client component) import the threshold?** — Yes, `FREE_SHIPPING_THRESHOLD` is
  in the isomorphic `app/lib/checkout.ts` (source: `app/lib/checkout.ts:13`).
- **Can `labelTrioFamilies` be removed?** — No, `TrioBuilder.tsx` uses it (source:
  `app/features/home/TrioBuilder.tsx:41`).
- **Does the footer share the header's nav helpers?** — Yes, `Footer.tsx` calls `navItemClasses()`
  with the default `"onPrimary"` tone, so defaults must stay `"onPrimary"` (source:
  `app/components/layout/Footer.tsx`).
- **Are the header contrast pairs already covered?** — Mostly: `ink`/white, `primary-dark`/white,
  white/`primary`, `primary-dark`/`blush`, white/`primary-dark` (cart hover) and the `primary` ring on white exist in
  `app/theme.test.ts`. Missing: the `primary`
  ring on `blush` (3:1) and a named header group (source: `app/theme.test.ts`).
- **Hex values for the white header?** — None allowed; tokens only, so #73 can recolour through
  `app/app.css` (source: owner's note in this session, #73).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/components/layout/nav.ts` | `onLight` active → `primary-dark`; underline option for the bar; update the tone comments |
| modify | `app/components/layout/Header.tsx` | White bar, `ink` wordmark with `primary` dot, `onLight` items/rings, `primary` cart pill and logged-in circle |
| modify | `app/components/layout/MobileMenu.tsx` | `onLight` hamburger; `border-t border-line` on the panel |
| modify | `app/components/layout/CatalogMenu.tsx` | Trigger uses `onLight` with the bar underline |
| modify | `app/components/layout/LocaleSwitcher.tsx` | Doc comment only if needed (bar now passes `tone="onLight"`) |
| modify | `app/components/layout/Header.test.ts` | White bar, classes and `outline-primary` rings |
| modify | `app/theme.test.ts` | Header contrast group; `primary` ring on `blush` |
| modify | `app/features/home/OfferMarquee.tsx` | Slimmer band; trio + free delivery; no `families` |
| modify | `app/features/home/HomePage.tsx` | Stop passing `families` to the marquee |
| modify | `app/features/home/HeroSection.tsx` | Wider/taller image column; `sizes` |
| modify | `app/features/home/AboutSection.tsx` | Larger photo frame; `sizes` |
| modify | `app/features/home/HomePage.test.ts` | Marquee items, no families, bigger frames |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `home.marquee.freeDelivery` |
| modify | `docs/design.md` | White header in tokens table, colour rules, wordmark, focus-ring table, marquee row |

## Steps

- [x] **1. Nav helpers** — In `nav.ts`, change the `onLight` branch of `navItemClasses` to
  `active ? "text-primary-dark" : "text-ink hover:text-primary-dark"` and add the bar underline
  option. Rewrite the `NavTone` doc: `onPrimary` = the deep-pink footer and hero bands, `onLight` =
  the white header and its panels. Keep `"onPrimary"` defaults for `Footer.tsx`. Check: footer tests
  still pass unchanged.
- [x] **2. White header** — In `Header.tsx`: `<header className="sticky top-0 z-40 border-b
  border-line bg-white text-ink">`; wordmark `text-ink` + `focusRing("onLight")`, dot
  `text-primary`; bar links `navItemClasses(isActive, "onLight", { underline: true })` (About and
  Contacts with `false`); `LocaleSwitcher tone="onLight"`; logged-in profile
  `bg-primary text-white hover:bg-primary-dark`, logged-out `iconButtonClasses(isActive, "onLight")`;
  cart pill `bg-primary text-white hover:bg-primary-dark` with `focusRing("onLight")`. Only token
  classes. Check in the dev server that the header separates from the hero.
- [x] **3. Catalog dropdown and mobile menu** — `CatalogMenu` summary uses the `onLight` bar style
  (underline when `inCatalog`); `MobileMenu` summary `iconButtonClasses(false, "onLight")`, panel
  gets `border-t border-line`. Check the menu at 375px: opens below the bar, no horizontal scroll.
- [x] **4. Marquee** — In `OfferMarquee.tsx`: props `{ trioOffer: TrioOffer | null }`; items =
  trio offer (if any) + `t("home.marquee.freeDelivery", { threshold:
  formatPrice(FREE_SHIPPING_THRESHOLD) })`; repeat items `REPEAT` times per copy (index keys); band
  `py-2`, text `text-base md:text-lg`, `gap-8 pr-8`; drop the `null` return and
  `labelTrioFamilies` import; update the doc comment (both offers also show on the hero badge,
  offers page and cart, so it stays `aria-hidden`). Add `freeDelivery: "Безкоштовна доставка від
  {threshold}"` / `"Free delivery from {threshold}"` under `home.marquee` in `uk.ts` and `en.ts`.
  In `HomePage.tsx` render `<OfferMarquee trioOffer={view.trioOffer} />`.
- [x] **5. Hero image** — In `HeroSection.tsx`: wrapper `max-w-lg … flex-[2_1_24rem]`, `imageFrame`
  `h-112 … md:h-152`, `sizes="(min-width: 768px) 512px, 100vw"`. Check the badge/chip positions and
  375px width.
- [x] **6. About photo** — In `AboutSection.tsx`: `photoFrame` `h-96 … flex-[1_1_28rem] … md:h-136`,
  `sizes="(min-width: 768px) 640px, 100vw"`. Check at 375px and desktop.
- [ ] **7. Design doc** — In `docs/design.md`: `primary` row no longer lists "sticky header";
  replace "The header and footer are always deep pink." with "The header is white (`bg-white`,
  `ink` text, `line` bottom border, `primary-dark` active/hover, `primary` cart pill); the footer is
  deep pink."; wordmark dot is `primary` on white and `primary-light` on dark/pink; focus-ring table:
  deep pink row becomes "footer, hero bands", white row adds "header"; `focusRing` note says the
  header uses `"onLight"`; marquee motion row says "offers banner (trio, free delivery)". Note in
  the PR that the canvas's `HomeBoldPlus` header needs the same change (Q3).
- [ ] **8. Tests** — see below; then run the full check set.

## Testing & verification

- `app/components/layout/Header.test.ts`:
  - "renders a sticky white bar": `^<header class="sticky top-0[^"]*border-line[^"]*bg-white text-ink"`.
  - Wordmark dot `class="text-primary"`.
  - Active Offers/Bestsellers in the bar: `underline decoration-2` and `text-primary-dark`; in the
    mobile menu `text-primary-dark` without underline.
  - Logged-in profile `rounded-full bg-primary text-white`; logged-out `text-ink`, `hover:bg-blush`.
  - Cart pill `rounded-pill … bg-primary … text-white`.
  - Focus rings: cart, wordmark and locale buttons use `focus-visible:outline-primary`; the header
    contains no `focus-visible:outline-white`.
  - No hex/arbitrary colour in the header markup: `not.toMatch(/(bg|text|border|outline)-\[#/)`.
- `app/components/layout/Footer.test.ts`: unchanged, still passes (footer stays pink).
- `app/theme.test.ts`: a `describe("header (white)")` listing the pairs the header relies on —
  `ink`/white, `primary-dark`/white, `primary-dark`/`blush`, white/`primary`, white/`primary-dark`
  (4.5:1) and `primary` ring on white and `blush` (3:1) — so #73's new tokens are checked against
  the header.
- `app/features/home/HomePage.test.ts`: replace the three marquee tests with
  - "scrolls the trio offer and free delivery, hidden from screen readers": both texts present in
    the `aria-hidden` track, `marquee-pause`, `py-2`; free delivery uses
    `formatPrice(FREE_SHIPPING_THRESHOLD, "en")`;
  - "shows no fragrance families in the marquee": slice the marquee's HTML and assert no family label
    (e.g. `Woody`) appears there (TrioBuilder still shows them);
  - "drops the trio item without a live rule but keeps free delivery";
  - Ukrainian copy: `Безкоштовна доставка від` renders with `uk`.
  - Hero/About: frames contain `md:h-152` / `md:h-136` and the new `sizes`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`): home, catalog, cart and product pages at 375px and desktop; header
  clearly separate from the hero; keyboard-tab through every header element (visible ring);
  mobile menu and catalog dropdown; marquee has no empty stretch on a wide window; hero and About
  photos visibly larger; no horizontal scroll. Review the marquee size with the owner (Q1).

## Acceptance criteria

- [ ] The header is white with dark text on every page, and on the home page it's clearly separate
  from the deep-pink hero — steps 2, 3
- [ ] Every header element (links, active link, Popular button, cart, locale switcher, mobile menu)
  passes WCAG AA contrast and has a visible focus ring — steps 1, 2, 3, 8
- [ ] The marquee is noticeably thinner and shows only offers: the tester trio (when the rule
  exists) and free delivery from the current threshold — step 4
- [ ] No fragrance families appear in the marquee — steps 4, 8
- [ ] The hero image and the About us photo are visibly larger on desktop and phone, with no
  horizontal scroll at 375px — steps 5, 6
- [ ] `docs/design.md` describes the white header — step 7
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 8

## Out of scope

- The palette rebrand and heading serif (#73), and any new colour token or hex value.
- The footer, other colours, the marquee's speed and animation, bestseller cards.
- Changing `FREE_SHIPPING_THRESHOLD` (#71).
- Editing the design canvas from code (Q3).
