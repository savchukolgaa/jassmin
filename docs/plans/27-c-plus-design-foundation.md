# Plan: Apply chosen C+ design to theme, buttons, header and footer (#27)

Issue: https://github.com/savchukolgaa/jassmin/issues/27
Branch: `issue/27`
Worktree: `../jassmin-worktrees/issue-27`
Status: Planned

## Goal
As a shopper I want a storefront that matches the agreed design and uses readable, accessible
colours, so I can trust the shop and use it comfortably. This issue applies the chosen
**Option C+ (Bold blush, upgraded)** design to the shared UI only: Tailwind theme tokens, the
Manrope typeface, `Button`/`ButtonLink`, the header, a new footer and shared motion utilities. It
also writes `docs/design.md`, which the page issues (#7, #8, #9, #12, #26) follow.

## Dependencies & prerequisites
- #2 (theme and `Button`) and #6 (header, nav, `_shop` layout) are closed and on `main`. This plan
  restyles what they added.
- #8 (catalog) is still open. `/catalog/:gender` only accepts `men` and `women`, and there won't be
  a Unisex catalog, so the footer has no Unisex link.
- No new packages, env vars or migrations. Manrope comes from Google Fonts through a `<link>`.
- Design canvas: https://claude.ai/artifact/RCvne95y2han2bw8dWm1iW ("Chosen direction: Option C+"
  row). Use it as the visual reference, not options A–G.

## Decisions & assumptions
- **Repoint `--color-primary`, don't rename it** (the issue's assumption). Existing
  `bg-primary` / `text-primary` usages get `#C22F4B` automatically.
- **Contrast ratios** (computed with the WCAG relative-luminance formula, so `pnpm test` checks
  them, see step 2):
  | Foreground / background | Ratio | Use |
  |---|---|---|
  | white / `#C22F4B` primary | ≈ 5.5:1 | header, footer, primary button |
  | white / `#A8233D` primary-dark | ≈ 7.1:1 | primary button hover |
  | `#C22F4B` / white | ≈ 5.5:1 | cart-pill count, profile icon, active link in dropdown |
  | `#A8233D` / white | ≈ 7.1:1 | pink text on light |
  | `#FF8FA1` / `#1F1A1C` ink | ≈ 7.9:1 | accent text on dark |
  | white / `#1F1A1C` ink | ≈ 17:1 | `dark` button |
  | `#5F5558` muted / white | ≈ 7.2:1 | secondary text |
  | `#FF8FA1` / `#C22F4B` | ≈ 2.5:1 ✗ | decorative footer wordmark only (`aria-hidden`, exempt) |
- **Nav item "tones".** The top-level header links sit on deep pink, but the catalog dropdown and
  mobile menu panels are white. `navItemClasses` and `iconButtonClasses` in `nav.ts` get a
  `tone: "onPrimary" | "onLight"` option. `onPrimary` uses white text and a white underline or
  `bg-white/15` for the active and hover states. `onLight` uses ink text and `text-primary` when
  active. Pink text can't show the active state on a pink bar.
- **Wordmark** "jassmin." is rendered as `jassmin<span aria-hidden="true">.</span>`, with the dot in
  `text-primary-light`. The link keeps the accessible name "Jassmin" through
  `aria-label="Jassmin, home"`. The brand test is updated to match.
- **Cart pill.** A white pill with the cart icon and the count from `formatCartCount` in pink
  (`text-primary`, 5.5:1). The count is hidden for an empty cart, as it is today. The
  `aria-label` "Cart, N items" stays.
- **Profile link.** Logged in: a white circle with a pink `UserIcon`. Logged out: a white outline
  icon on the pink bar.
- **Variants.** `secondary` is replaced by the four variants in the issue: `primary`, `dark`,
  `outline-light` and `ghost`. A grep shows no route uses `variant="secondary"`, so nothing breaks.
- **Sizes.** `sm`/`md`/`lg` become `min-h-11` (44px), `min-h-13` (52px) and `min-h-14.5` (58px), using
  Tailwind v4 spacing (0.25rem steps). All sizes use `font-extrabold` (800) and `rounded-full`
  (`--radius-pill`).
- **Hover motion on buttons:** `hover:scale-[1.03]` and the new shadow tokens. The base transition
  list adds `transform` (`transition-[box-shadow,background-color,color,transform]`).
- **Motion stays visible without animation.** Keyframes only define a `from` state, and the default
  fill mode is used. When `animation: none` applies under `prefers-reduced-motion: reduce`,
  elements render in their final, visible state. This includes `reveal`, which never starts at
  `opacity: 0` outside its `@supports` block.
- **Fonts** load in `root.tsx` `links`: `preconnect` to `fonts.googleapis.com` and
  `fonts.gstatic.com` (`crossOrigin: "anonymous"`), then
  `https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&display=swap`. Google serves the
  Cyrillic subset through `unicode-range`.
- **Footer** renders in `ShopLayout` and in the `_shop` `ErrorBoundary`, so it appears on every
  public page, including error pages. The root `ErrorBoundary` (unmatched URLs and admin) stays
  without header and footer, as it is today.
- **Dark mode** isn't designed. Existing `dark:` variants on non-header UI may stay. The header and
  footer are always deep pink, and the dropdown panels lose their `dark:` styles so they stay
  readable against the pink bar.

## Resolved questions
- **Focus ring colour on the pink bar?** The issue's `#FF8FA1` is only ≈ 2.5:1 on `#C22F4B`, which fails
  WCAG 1.4.11. Use a 3px **white** ring with a 2px offset on deep-pink surfaces (≈ 5.5:1),
  `#FF8FA1` on ink surfaces (≈ 7.9:1) and `primary` on white (source: owner's answer on the plan,
  2026-10-23).
- **Should the cart pill show "0" for an empty cart?** No. Always show the white pill, and show the
  count only when it's above 0, keeping `formatCartCount` (source: owner, 2026-10-23, "okay for
  now").
- **Unisex footer link?** No. There won't be a Unisex catalog, so the footer links are only Women,
  Men, Blog, About us and Kontakt (source: owner, 2026-10-23).
- **Does anything use the `secondary` button variant?** No. It's only used in `Button.test.ts` and
  `button-styles.test.ts` (source: `grep variant app/routes`).
- **Does `/blog` exist for the footer?** Yes, `route("blog", "routes/blog.tsx")` (source: `app/routes.ts`).
- **Can Biome handle Tailwind `@theme` / `@utility` / `@custom-variant`?** Yes,
  `css.parser.tailwindDirectives: true` (source: `biome.json`).
- **Do tests render components in the DOM?** No. They use `renderToStaticMarkup` in the `node`
  environment, so class names and markup are asserted as strings (source:
  `app/components/layout/Header.test.ts`, `vitest.config.ts`).
- **Was C+ confirmed?** Yes, on 2026-10-23 (source: #27 comment).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/app.css` | C+ colour, radius, shadow and font tokens; motion keyframes and utilities; reduced-motion block; body text colour |
| create | `app/theme.test.ts` | Parses `app.css` tokens: WCAG contrast of the documented pairs, `#ff5c77` only as `--color-brand-legacy`, reduced-motion block present |
| modify | `app/root.tsx` | `links` export for Manrope (preconnect + stylesheet) |
| modify | `app/components/ui/button-styles.ts` | Pill shape; `primary`/`dark`/`outline-light`/`ghost`; 44/52/58px; weight 800 |
| modify | `app/components/ui/button-styles.test.ts`, `Button.test.ts` | New variants, sizes, pill and hover scale |
| modify | `app/components/layout/nav.ts` | `tone` option, C+ focus ring, `FOOTER_LINKS` |
| modify | `app/components/layout/Header.tsx` | Deep-pink sticky bar, wordmark, cart pill, profile circle |
| modify | `app/components/layout/CatalogMenu.tsx`, `MobileMenu.tsx` | Pink-bar triggers, white rounded panels with `onLight` items |
| modify | `app/components/layout/Header.test.ts` | Update brand and active-state assertions, add pill and profile tests |
| create | `app/components/layout/Footer.tsx` | C+ footer |
| create | `app/components/layout/Footer.test.ts` | Links, ©, `aria-hidden` wordmark, `overflow-hidden` |
| modify | `app/routes/_shop.tsx` | Render `<Footer />` in the layout and the error boundary |
| create | `docs/design.md` | Design reference for later UI issues |
| modify | `AGENTS.md` | One line pointing UI work to `docs/design.md` |

## Steps
- [ ] **1. Theme tokens and font.** In `app/app.css` `@theme`, set the colour tokens from the issue
  (`primary`, `primary-dark`, `primary-light`, `brand-legacy`, `ink`, `muted`, `body`, `blush`,
  `card`, `line`, `on-dark-muted`, `success`, `success-bg`). Add `--radius-pill: 999px`,
  `--radius-card: 1.5rem` (24px) and `--radius-card-lg: 2rem` (32px). Change `--shadow-button` and
  `--shadow-button-hover` to `rgb(194 47 75 / …)`. Put `"Manrope"` first in `--font-sans` and keep
  the existing stack after it. Set `html, body` to `text-ink` (keep `bg-white dark:bg-gray-950`).
  Add `links()` to `app/root.tsx` as described in Decisions. Check with `pnpm dev`: DevTools shows
  Manrope as the rendered font, and Cyrillic text also renders in Manrope.
- [ ] **2. Theme test.** Create `app/theme.test.ts`. Read `app/app.css` with `node:fs`, extract
  `--color-*: #hex` with a regex, and implement `relativeLuminance` and `contrastRatio` locally in
  the test. Assert the "Decisions" table pairs (≥ 4.5 for text, ≥ 3 for icons and focus rings),
  that `--color-primary` is `#c22f4b`, and that `#ff5c77` appears only on the
  `--color-brand-legacy` line. Steps 6 and 8 extend this test.
- [ ] **3. Buttons.** Rewrite `button-styles.ts`:
  - base: `rounded-full font-extrabold tracking-tight`, the transition list including `transform`,
    `motion-safe:hover:scale-[1.03]`, and `focus-visible:outline-3 focus-visible:outline-offset-2`
    (the colour is set per variant)
  - `primary`: `bg-primary text-white shadow-button hover:bg-primary-dark hover:shadow-button-hover
    focus-visible:outline-primary`
  - `dark`: `bg-ink text-white hover:bg-black focus-visible:outline-ink`
  - `outline-light`: `border-2 border-white text-white hover:bg-white/15 focus-visible:outline-white`
  - `ghost`: `text-primary-dark hover:bg-primary/10 focus-visible:outline-primary`
  - sizes: `min-h-11 px-5 text-sm`, `min-h-13 px-7 text-base`, `min-h-14.5 px-9 text-lg`
  - Keep `disabled:` styles and the "className last" behaviour.

  Update `ButtonVariant` and both test files: variant list, focus classes, `rounded-full`,
  `font-extrabold`, size→`min-h-*` mapping, and `ButtonLink` asserting `min-h-14.5` instead of `h-13`.
- [ ] **4. Nav helpers.** In `nav.ts`:
  - Replace `focusRing` with `focusRingOnPrimary` (white 3px, see Resolved questions) and `focusRingOnLight`
    (`outline-primary`).
  - Change `navItemClasses(active, tone = "onPrimary")` and `iconButtonClasses(active, tone)` as
    described in Decisions. Active `onPrimary` gets `underline decoration-2 underline-offset-8`, plus
    `aria-current` from `NavLink`. Use `font-bold` in pill shapes.
  - Add `FOOTER_LINKS`: women, then men (short labels "Women" and "Men", same `to` as
    `CATALOG_LINKS`), `/blog` "Blog", `ABOUT_LINK` and `CONTACTS_LINK`. Add a `shortLabel` field
    to `CATALOG_LINKS` so they stay one source of truth.
- [ ] **5. Header.** In `Header.tsx`:
  - The bar is `sticky top-0 z-40 bg-primary text-white` (no blur or border).
  - The wordmark is described in Decisions (`text-2xl font-extrabold tracking-[-0.05em]`).
  - Profile `NavLink`: logged in, `bg-white text-primary` circle; logged out, white outline icon.
  - Cart `NavLink`: `inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-4
    text-primary font-extrabold`, with the count in `<span aria-hidden="true">`, shown only when
    `badge` isn't empty.
  - Keep link order, `aria-label`s and `formatCartCount`. The layout stays within 375px: on mobile,
    the hamburger, profile and cart are each 44px.
- [ ] **6. Dropdowns.** `CatalogMenu`: the trigger uses `navItemClasses(inCatalog, "onPrimary")`.
  The panel is `rounded-3xl bg-white p-2 text-ink shadow-xl`, and its items use
  `navItemClasses(isActive, "onLight")`. `MobileMenu`: the summary uses
  `iconButtonClasses(false, "onPrimary")`, and the panel is white with `onLight` items and a muted
  "Catalog" label (`text-muted`). Keep `useDisclosure`, `<details>`, `aria-expanded` and Escape
  unchanged. Update `Header.test.ts`:
  - the brand test checks `href="/"` plus `aria-label="Jassmin, home"`
  - "highlights the catalog trigger" expects the `onPrimary` active class (`underline`) instead of
    `text-primary`
  - the empty-cart test checks there is no count `<span>`
  - add tests for the white cart pill (`bg-white`) and the logged-in profile circle
  - keep all other tests as they are

  Add the header pairs to `theme.test.ts`.
- [ ] **7. Footer.** Create `app/components/layout/Footer.tsx`:
  - `<footer className="relative overflow-hidden bg-primary text-white">`, with a container holding
    a `<nav aria-label="Footer">` list of `FOOTER_LINKS` (white, `onPrimary` focus ring, `min-h-11`
    tap targets, wrapping with `flex-wrap`) and `<p>© {year} Jassmin</p>`
  - a decorative `<p aria-hidden="true" className="pointer-events-none select-none
    whitespace-nowrap text-primary-light font-extrabold leading-none tracking-[-0.05em]
    text-[clamp(5rem,22vw,18rem)]">jassmin.</p>`, clipped by the footer's `overflow-hidden`
  - The year comes from `new Date().getFullYear()`. This is SSR-safe: hydration only mismatches at
    New Year, and `suppressHydrationWarning` on that span covers it.

  Render `<Footer />` after `<Outlet />` in `ShopLayout` and after `<ErrorContent>` in the `_shop`
  `ErrorBoundary`. Wrap them in `<div className="flex min-h-dvh flex-col">` with `<Outlet />`'s area
  set to `flex-1`, so the footer stays at the bottom on short pages. Add `Footer.test.ts` with
  `renderToStaticMarkup` + `MemoryRouter`: every `FOOTER_LINKS` href, "© … Jassmin", the
  wordmark has `aria-hidden="true"`, and the footer has `overflow-hidden`.
- [ ] **8. Motion utilities.** In `app/app.css`:
  - In `@theme`, add `--animate-fade-up: fade-up 0.6s cubic-bezier(.2,.7,.2,1) both`,
    `--animate-pop`, `--animate-spin-in`, `--animate-marquee: marquee 30s linear infinite` and
    `--animate-toast`, with their `@keyframes` (`fade-up`: from `opacity:0; translateY(16px)`;
    `pop`: scale 0.9→1; `spin-in`: `rotate(-180deg) scale(.6)`→none; `marquee`: `translateX(0)`→
    `translateX(-50%)`; `toast`: slide up and fade in). This gives `animate-fade-up` and the other
    `animate-*` classes.
  - `@utility anim-delay-*` with `animation-delay: calc(--value(integer) * 80ms)` for fade-up steps
    (`anim-delay-1` … `anim-delay-6`).
  - `@utility lift` for cards: `transition: transform .25s, box-shadow .25s`; on `&:hover`,
    `translateY(-4px)` and a shadow.
  - `@supports (animation-timeline: view()) { .reveal { animation: fade-up linear both;
    animation-timeline: view(); animation-range: entry 0% cover 30%; } }`
  - One final block: `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation:
    none !important; transition: none !important; scroll-behavior: auto !important; } }`. The `scale`
    hover in buttons is already `motion-safe:`.

  Extend `theme.test.ts`: assert each keyframe name exists, `.reveal` is inside `@supports
  (animation-timeline: view())`, and there's exactly one `prefers-reduced-motion: reduce` block
  that contains `animation: none`. Check manually with a test element on `/` (remove it afterwards),
  then turn on DevTools → Rendering → "prefers-reduced-motion: reduce" and check that everything
  is static.
- [ ] **9. `docs/design.md`.** Sections:
  1. the canvas link and the "C+ only" note
  2. a token table (name, hex, Tailwind class, intended use, contrast ratio against its pair)
  3. rules ("`#FF8FA1` only on ink or deep pink; pink text on light is `primary-dark`; `#FF5C77` never
     behind text")
  4. typeface and scale (Manrope 400–800; headings 800 with −0.03 to −0.05em tracking; suggested sizes)
  5. radius and spacing (pill 999px, cards 24–32px, arch images `rounded-t-[50%]` / top radius = half
     the width; 16px mobile gutter, `container mx-auto px-4`)
  6. focus rings per surface (white on deep pink, `#FF8FA1` on ink, `primary` on white)
  7. buttons: variants and sizes, with a usage example
  8. motion: the utilities and when to use them, and that everything is off under reduced motion
  9. the issue-to-canvas-page table from #27

  Mention it in `AGENTS.md` under "Architecture rules", in one line: UI work follows `docs/design.md`.
- [ ] **10. Contrast audit and polish.** With `pnpm aspire run`, run axe DevTools (or Lighthouse
  Accessibility) on `/` and `/catalog/women` at desktop width and at 375px, logged out and logged in
  with a non-empty cart, and with the catalog dropdown and mobile menu open. Fix any findings and
  check that there is no horizontal scroll at 375px
  (`document.documentElement.scrollWidth === 375`). Then run `pnpm typecheck`, `pnpm lint`,
  `pnpm test` and `pnpm build`, and commit.

## Testing & verification
- Unit tests: `app/theme.test.ts` (contrast pairs, tokens, legacy pink, motion and reduced-motion
  CSS), `button-styles.test.ts` and `Button.test.ts` (variants, sizes, pill), `Header.test.ts`
  (existing behaviour plus the pill and profile circle), and `Footer.test.ts`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual checks:
  - the Manrope font, including Cyrillic text
  - keyboard tab through the header and footer, with the focus ring visible on pink
  - the dropdown: Escape and an outside click close it, and it works with JS disabled
    (`<details>`)
  - 375px with no horizontal scroll
  - emulated reduced motion
  - an axe / Lighthouse pass on `/` and `/catalog/women`

## Acceptance criteria
- [x] The final design direction is chosen and recorded in this issue: **Option C+**
- [ ] The theme tokens above exist in `app/app.css`; `--color-primary` is `#C22F4B`, and `#FF5C77` is no longer behind any text — steps 1, 2
- [ ] Manrope loads and is the primary sans font, with the system fallback kept — step 1
- [ ] `Button` / `ButtonLink` are pill-shaped with `primary`, `dark`, `outline-light` and `ghost` variants, and their tests are updated — step 3
- [ ] The header matches C+ (sticky deep pink, white cart pill with count, visible focus ring on pink) and still passes its existing behaviour tests and works at 375px — steps 4, 5, 6, 10
- [ ] A C+ footer renders on all public pages and causes no horizontal scroll at 375px — steps 7, 10
- [ ] The motion utilities exist and all animation stops under `prefers-reduced-motion: reduce` — steps 3, 8
- [ ] Every text and background pair in the header, buttons and footer meets WCAG AA: 4.5:1 for normal text, 3:1 for large text and icons — steps 2, 6, 10
- [ ] `docs/design.md` documents the canvas link, the tokens with their contrast ratios, the typeface, the motion rules and the page-to-issue table — step 9
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 10

## Out of scope
- Page layouts: home (#7), catalog and product (#8), auth (#9), account (#12). Also the hero bands,
  arch images, price badge, offer banner and "Added to cart" popup themselves. This issue only adds
  the utilities they use.
- The tester-trio picker logic and the volume dropdown (#26).
- A Unisex catalog. There won't be one, per the owner.
- Designing dark mode. Restyling `ErrorContent` and `PagePlaceholder` beyond the inherited font and
  colours.
