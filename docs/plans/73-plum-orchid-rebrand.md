# Plan: Rebrand the storefront to the plum and orchid palette with a serif for headings (#73)

Issue: https://github.com/savchukolgaa/jassmin/issues/73
Branch: `issue/73`
Worktree: `.claude/worktrees/issue-73`
Status: Planned (open questions answered 2026-10-29)

## Goal

As the store owner, I want the storefront in the brand's new plum/orchid colours with an elegant
serif for headings. Replace the C+ deep-pink token values in `app/app.css` with the owner's palette
(`#6F1747` plum, `#452A3D` aubergine, `#736171` mauve grey, `#D44594` orchid), add an `accent`
token and a free Cyrillic serif (`--font-serif`) for headings, the wordmark, prices and the big
step numbers. The design is approved on the canvas first; then the tokens change and every page
follows.

## Dependencies & prerequisites

- **#27 / Option C+** (`docs/design.md`, `app/app.css`, `app/theme.test.ts`): merged, this is
  what we change.
- **#72 (white header, slimmer marquee, bigger hero/About photos): open, will be implemented and
  merged *before* #73** (owner's note). This plan is built on top of it: once #72 is on `main`,
  rebase `issue/73` on `origin/main` (step 3) before touching code. After #72 the header is white
  with `ink` text, `primary-dark` active/hover links, a `primary` wordmark dot, a `primary` cart
  pill with white text and `focusRing("onLight")`; the footer and hero bands stay `bg-primary`
  (now plum). #72 also edits `OfferMarquee.tsx`, `HeroSection.tsx`, `AboutSection.tsx`,
  `Header.tsx`, `nav.ts`, `theme.test.ts` and `docs/design.md`, so expect to build on its versions
  of those files.
- **Design canvas** https://claude.ai/artifact/RCvne95y2han2bw8dWm1iW: the owner must approve
  the recoloured artboards before code changes (acceptance criterion 1).
- No new packages, env vars or migrations. Fonts come from Google Fonts like Manrope.

## Decisions & assumptions

- **Token values exactly as in the issue table**; `success`, `success-bg`, `brand-legacy`
  unchanged. Contrast recomputed for this plan with the WCAG 2.x formula (all match the issue):
  white/plum 11.11, white/`primary-dark` 13.70, plum on `blush` 10.13, plum on `card` 9.80,
  `primary-dark` on `blush` 12.49, `primary-light` on ink 6.19 and on plum 5.42, white/ink 12.71,
  `on-dark-muted` on ink 8.86, `muted` on white 5.71 / `blush` 5.21 / `card` 5.04, `body` on white
  9.26, ink on `card` 11.22 / `blush` 11.59, ink on `primary-light` 6.19 (trio chips/slots),
  white/orchid 4.14, orchid on white 4.14 / `blush` 3.77 / ink 3.07 / plum 2.69,
  `primary-light` on white 2.05.
- **Header on white (after #72), recomputed with the new tokens:** `ink` text on white 12.71,
  `primary-dark` active/hover text on white 13.70, the `primary` wordmark dot on white 11.11,
  white on the `primary` cart pill 11.11, the `primary` focus ring on white 11.11, hover
  `bg-blush` behind `ink` 11.59 / `primary-dark` 12.49. All pass, so the header needs no class
  changes beyond the serif wordmark; steps 9–10 recheck the actual classes #72 merged and adds any
  header pair that `theme.test.ts` doesn't already cover.
- **`primary-light` becomes valid on plum** (5.42:1, was 2.55:1). The doc's rule changes to "only on
  plum or aubergine", and the focus-ring table allows white *or* `primary-light` on plum.
  `focusRing("onPrimary")` stays white (no churn).
- **Existing focus-ring bug fixed here:** `TextField.tsx:49` and `PaymentMethodField.tsx:38` use
  `outline-primary-light` on white inputs (2.05:1 with the new value, ~2.3:1 today), which fails
  the "≥3:1 on light surfaces" criterion. Switch both to `outline-primary` (11.11:1).
- **Shadows follow the tokens:** `--shadow-button*` tint `rgb(194 47 75)` → plum `rgb(111 23 71)`;
  the `lift` utility's ink tint `rgb(31 26 28)` → `rgb(69 42 61)`.
- **Serif** (Q2): Playfair Display 600–700, Cyrillic + Latin, from Google Fonts.
  `--font-serif: "Playfair Display", Georgia, serif;` next to `--font-sans`. The css2 API serves
  every subset (Cyrillic, Latin, …) as separate `unicode-range` files automatically, so the URL only
  needs `family=Playfair+Display:wght@600..700&display=swap`; the browser downloads only the
  Cyrillic/Latin files a page needs.
- **Where the serif applies:**
  - A base rule in `app/app.css` (`@layer base { h1, h2, h3 { font-family: var(--font-serif); } }`)
    so every page, section and card heading (≈48 headings in 40 files, plus `RichText` `h2`/`h3`
    from the CMS) gets it without per-file edits. `h4`+ and non-heading UI stay Manrope.
  - Explicit `font-serif` on non-heading elements: the wordmark (`Header.tsx`, `account.tsx:60`,
    the giant `Footer.tsx:40` wordmark), the big step numbers (`HowItWorks.tsx`), and
    **prominent prices**: `ProductCard.tsx` (both cards), `ProductPurchase.tsx`, `CartLineItem.tsx`
    line total, the total rows in `CartSummary.tsx` / `OrderSummary.tsx`, `OrderLineItem.tsx`,
    `PreviousOrdersList.tsx`, `CurrentOrderCard.tsx`, the hero price badge (`HeroSection.tsx`) and
    `payments.simulator.tsx`. Prices inside sentences (CTA labels, marquee, "each …", free-shipping
    hint, subtotal/discount rows) stay Manrope so they read as text.
  - Buttons, nav, forms, labels and body copy stay Manrope (issue).
- **Heading weight/tracking:** headings drop `font-extrabold` + `tracking-[-0.03em…-0.05em]` for
  the serif's `font-bold` (700) / `font-semibold` (600) and `tracking-normal` or
  `tracking-[-0.01em]`, values tuned on the canvas (**unconfirmed** until approval). Applied as a
  mechanical sweep (`rg "<h[1-3][^>]*font-extrabold"` and the wordmark/number classes); body and
  button `font-extrabold` stay.
- **Orchid `accent`** (Q4, to be judged on the canvas) is decorative only: the marquee ✦
  (`OfferMarquee.tsx:42`), the hero price badge background with ink or large white text (≥24px, or
  18.66px bold), and the hero/About image placeholder tints. Never behind normal-size white text,
  never as small text. Everything else that is `primary-light` today keeps that token.
- **Copy:** no i18n changes. Email templates (#45) stay plain text. The Strapi admin's look is out
  of scope.

## Resolved questions

- **Q1: Who adds the canvas artboards, and do we block on approval?** — `/implement 73` adds
  them (step 1) and then stops for the owner's approval (step 2); code steps start only after it.
  (source: owner, 2026-10-29)
- **Q2: Playfair Display or Cormorant Garamond?** — Playfair Display 600–700, the default; the
  canvas still shows Cormorant as a tweak for comparison. (source: owner, 2026-10-29)
- **Q3: Plum and aubergine are nearly the same lightness (1.14:1).** — Keep the issue's roles;
  check the spots on the canvas, and if they blur give the `dark` button `hover:bg-primary-dark`
  and separate adjacent plum/aubergine bands with a white/blush gap. (source: owner, 2026-10-29)
- **Q4: Which elements get orchid?** — Try the default: marquee ✦, hero price badge, image
  placeholder tints, no hover glow; judged on the canvas in step 2. (source: owner, 2026-10-29)

- **Does a token change reach every page?** — Yes: pages use `bg-primary`, `text-ink`, … and the
  only raw hex in `app/` outside `app.css` is the flag icons in `components/layout/icons.tsx`
  (UA/UK flag colours, must stay). No `pink-`/`rose-` classes exist. (source: `rg` over `app/`)
- **Which tests pin colours?** — `app/theme.test.ts` (hex values, contrast pairs);
  `Header.test.ts`, `Footer.test.ts`, `Button.test.ts`, `button-styles.test.ts`,
  `HomePage.test.ts`, `popular-ui.test.ts`, `offers-ui.test.ts`, `account-ui.test.ts` pin token
  *class names* (`bg-primary`, `text-primary-light`), which stay, so they keep passing.
  `consent-ui.test.ts:39` pins the cookie banner `h2` classes (`text-lg font-extrabold`) and must
  be updated if that heading's weight changes. (source: `rg` over `*.test.ts`)
- **Is `primary-light` usable on plum?** — Yes, 5.42:1 (computed); the issue also lists it.
- **Is there a CSS hook for headings today?** — No base heading style; every heading carries
  `font-extrabold tracking-[…]` inline (source: `rg "tracking-\[-0\.0" app`, 42 files). Hence the
  base `h1–h3` rule plus a sweep.
- **How do we treat #72?** — Rebase whichever merges second and recheck header contrast (issue
  text).
- **Do we need `&subset=`?** — No; Google Fonts css2 serves subsets via `unicode-range`
  automatically. Manrope is already loaded that way in `app/root.tsx`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | design canvas artifact | recoloured `HomeBoldPlus` + `ProductPlus` with a serif tweak |
| modify | `app/app.css` | new token values, `--color-accent`, `--font-serif`, shadow/lift tints, base `h1–h3` rule |
| modify | `app/root.tsx` | load the serif from Google Fonts |
| modify | `app/theme.test.ts` | new values, new pairs, accent rules, no old hex, serif stack/link |
| modify | `app/components/ui/TextField.tsx`, `app/features/checkout/PaymentMethodField.tsx` | focus ring `outline-primary` |
| modify | `app/components/layout/Header.tsx`, `Footer.tsx`, `app/routes/account.tsx` | serif wordmark |
| modify | heading files (≈40, `rg "<h[1-3]"`), `app/components/ui/RichText.tsx` | serif weight/tracking |
| modify | price files listed in Decisions | `font-serif` on prominent prices |
| modify | `app/features/home/HowItWorks.tsx`, `OfferMarquee.tsx`, `HeroSection.tsx`, `AboutSection.tsx` | serif numbers, orchid accents |
| modify | `app/components/ui/button-styles.ts` (+ test) | only if Q3 changes the `dark` hover |
| modify | `app/features/consent/consent-ui.test.ts` and other class-pinning tests | follow heading class changes |
| modify | `docs/design.md` | palette, rules, focus rings, typeface; "deep pink" wording → plum |

## Steps

- [ ] **1. Canvas artboards** — Read the canvas artifact; add recoloured copies of `HomeBoldPlus`
  and `ProductPlus` to the "Chosen direction" row, starting from #72's white-header versions of
  them (#72 updates `HomeBoldPlus`), with the new tokens and a tweak switching
  Playfair Display / Cormorant Garamond; show the Q3 spots (cookie banner buttons, contacts →
  footer) and orchid uses (Q4). Republish to the same URL.
- [ ] **2. Owner approval (gate)** — Stop and ask the owner to approve palette, serif, heading
  weight/tracking and orchid uses. Record the decisions in this plan. Don't start step 3 before.
- [ ] **3. Rebase on #72** — After #72 merges:
  `git -C .claude/worktrees/issue-73 fetch origin && git -C .claude/worktrees/issue-73 rebase origin/main`.
  Re-run the `rg` sweeps from this plan (headings, prices, `primary-light`, hex values) against the
  rebased code and adjust the file lists here (#72 changes the header, marquee, hero and About
  section). `pnpm typecheck && pnpm lint && pnpm test` must pass before step 4.
- [ ] **4. Tokens** — In `app/app.css` `@theme`: set the issue's values, add
  `--color-accent: #d44594;`, `--font-serif: "<chosen>", Georgia, serif;`, retint
  `--shadow-button`/`--shadow-button-hover` to `rgb(111 23 71 / …)` and `lift` to
  `rgb(69 42 61 / …)`; update the header comment ("Option C+ design tokens" → mention #73). Update
  `theme.test.ts` in the same step (step 9 list) so `pnpm test` stays green.
- [ ] **5. Load the serif** — `app/root.tsx` `links`: add
  `https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600..700&display=swap` (or the
  approved font/weights), ideally combined into the Manrope URL as a second `family=` to keep one
  stylesheet request.
- [ ] **6. Base heading style** — Add `@layer base { h1, h2, h3 { font-family: var(--font-serif); } }`
  in `app/app.css` beside the `html, body` rule. Check in the browser that headings switch and
  Ukrainian letters (є, ї, і, ґ, Щ) render in the serif, not a fallback.
- [ ] **7. Heading weight/tracking sweep** — For each `h1`–`h3` (and `RichText` `[&_h2]`), replace
  `font-extrabold tracking-[-0.0Xem]` with the approved serif weight/tracking; keep sizes and
  leading. Add `font-serif` + the same weight to the wordmarks, `HowItWorks` step numbers and the
  prominent prices. Update `consent-ui.test.ts:39` and any other test that pins those classes.
- [ ] **8. Accents and fixes** — Orchid on the elements approved in step 2 (default: marquee ✦,
  hero badge, image placeholder tints), checking each against the accent rules. Switch
  `TextField`/`PaymentMethodField` focus rings to `outline-primary`. If plum and aubergine blur on the canvas (Q3), change the
  `dark` button hover to `primary-dark` and update `button-styles.test.ts`. Grep `app/` for the old
  values (`c22f4b|a8233d|ff8fa1|1f1a1c|194 47 75|31 26 28`) and comments that say "deep pink"
  (e.g. `nav.ts`, `button-styles.ts`), and update them.
- [ ] **9. Tests** — `app/theme.test.ts`:
  - rename/replace "uses the C+ deep pink" with the plum values, and assert `accent`, `ink`,
    `muted`, `body`, `on-dark-muted`, `blush`, `card`, `line`.
  - 4.5:1 pairs: add `primary on card`, `muted on card`, `ink on blush`, `ink on primary-light`,
    `primary-light on primary`, `on-dark-muted on ink` (already), keep the rest.
  - 3:1 focus/icon pairs: add `primary-light on primary`, `primary on blush`, `primary on card`.
  - accent: `accent` large text on white and `blush` ≥ 3:1; **white on accent < 4.5** (documents
    the "never white body text on orchid" rule) and a source scan that fails if `text-white`
    appears in a class list together with `bg-accent` without a large size (`text-2xl`+ or
    `text-xl font-bold`), and that `text-accent` only appears with large sizes.
  - no old palette hex/rgb left in `app/` (except `brand-legacy`'s own line).
  - `--font-serif` starts with the chosen serif and ends with `Georgia, serif`; `root.tsx` loads
    it with `display=swap`.
  - a test that `h1`–`h3` get `var(--font-serif)` from the base layer.
  - the white header's pairs as merged by #72 (`ink` on white, `primary-dark` on white and on
    `blush`, white on `primary` for the cart pill, `primary` wordmark dot and focus ring on white)
    still pass with the new values; `Header.test.ts` keeps passing unchanged (class names only).
- [ ] **10. Design doc** — `docs/design.md`: title/intro note (#73 recolour of C+), colour table
  with the new values/ratios and `accent`, colour rules (orchid never behind white normal text;
  orchid text only ≥24px or ≥18.66px bold; `primary-light` only on plum or aubergine), focus-ring
  table (white or `primary-light` on plum, `primary-light` on aubergine, `primary` on light),
  typeface section (serif for headings, wordmark, prices, step numbers; Manrope for the rest;
  weights/tracking), button table (`dark` = aubergine), and replace "deep pink" in the
  offers/popular paragraphs with "plum". Recheck the white-header rows #72 added (colour rules,
  focus-ring table) against the new ratios and keep "footer and hero bands are plum". Link the new
  artboards.
- [ ] **11. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; then the visual
  check below.

## Testing & verification

- Automated: the `theme.test.ts` additions in step 9; existing class-pinning tests updated in
  steps 7–8; `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Manual (`pnpm aspire run`): home, catalog (men/women), product, cart, checkout, account
  (+ profile, order), offers, popular, login/register, blog, privacy and an error page, at 1440px
  and 375px, in uk and en. Check the white header (#72) against the plum hero on the home page and
  its wordmark, cart pill, active link and mobile menu in the new colours. Check: no deep pink anywhere; serif on headings/wordmark/prices with
  correct Cyrillic; Manrope on buttons, nav, forms; Tab through header, footer, hero bands, ink
  sections, inputs and payment options to see every focus ring; no horizontal scroll at 375px
  (serif headings are wider: watch long Ukrainian words in hero/page titles).

## Acceptance criteria

- [ ] The owner approved the recoloured artboards and the serif on the design canvas — steps 1, 2
- [ ] The site uses plum `#6F1747`, aubergine `#452A3D`, mauve grey `#736171` and orchid `#D44594`
  in the roles above on every page; no old deep pink remains — steps 4, 8, 9, 11
- [ ] Every text/background pair passes WCAG AA; orchid never sits behind white normal-size text,
  and `app/theme.test.ts` enforces this — steps 4, 8, 9
- [ ] Headings, the wordmark and prices use the chosen serif with correct Ukrainian letters; body
  text, buttons and forms stay in Manrope — steps 5, 6, 7, 11
- [ ] Focus rings stay visible (at least 3:1) on plum, aubergine and light surfaces — steps 8, 9, 11
- [ ] `docs/design.md` documents the new palette, rules and fonts — step 10
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 11

## Out of scope

- Layout changes, new components, a dark theme (the light-only rules stay), the Strapi admin's look.
- The white header (#72), the email templates (#45), the flag icon colours.
- Replacing Tailwind default greys/reds in form fields (`text-gray-900`, `border-gray-200`,
  `red-700`).
- Self-hosting fonts or licensing "Moonlit Velvet Serif".
