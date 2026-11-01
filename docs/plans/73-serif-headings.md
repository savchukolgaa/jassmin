# Plan: Serif for headings, keeping the C+ colours (#73)

Issue: https://github.com/savchukolgaa/jassmin/issues/73
Branch: `issue/73`
Worktree: `.claude/worktrees/issue-73`
Status: Planned (scope reduced by the owner on 2026-11-01)

## Goal

As the store owner, I want headings set in an elegant serif so the storefront looks more refined.
After seeing the plum/orchid artboards, the owner decided to **keep the current C+ colours** and
change only the heading font: Playfair Display for headings, the wordmark, prices and the big
step numbers; Manrope stays for everything else.

## Dependencies & prerequisites

- **#27 / Option C+** (`docs/design.md`, `app/app.css`, `app/theme.test.ts`): merged.
- **#72 (white header, slimmer marquee, bigger hero/About photos): open, merges *before* #73**
  (owner's note). Once #72 is on `main`, rebase `issue/73` on `origin/main` (step 3) before any
  code. #72 edits `Header.tsx`, `nav.ts`, `OfferMarquee.tsx`, `HeroSection.tsx`,
  `AboutSection.tsx`, `theme.test.ts` and `docs/design.md`, so build on its versions.
- **Design canvas** https://claude.ai/artifact/RCvne95y2han2bw8dWm1iW: the owner approves the
  serif artboards before code changes.
- No new packages, env vars or migrations. The font comes from Google Fonts like Manrope.

## Decisions & assumptions

- **Scope change (owner, 2026-11-01): colours stay as they are.** "Leave as it was in previous
  variant and only change a text font." The plum/orchid palette, the `accent` token, the shadow
  retint and all colour rules in the issue are dropped. Confirmed with the owner: keep the
  deep-pink colours, serif for **headings only**, **Playfair Display**. The GitHub issue body
  still describes the palette and should be updated to match (see Open questions).
- **Serif:** Playfair Display 600–700, Cyrillic + Latin, from Google Fonts.
  `--font-serif: "Playfair Display", Georgia, serif;` next to `--font-sans` in `@theme`. The css2
  API serves every subset as separate `unicode-range` files, so the URL only needs
  `family=Playfair+Display:wght@600..700&display=swap`.
- **Where the serif applies** (issue, unchanged):
  - A base rule in `app/app.css` (`@layer base { h1, h2, h3 { font-family: var(--font-serif); } }`)
    so every page, section and card heading (≈48 headings in 40 files, plus `RichText` `h2`/`h3`
    from the CMS) gets it without per-file edits. `h4`+ and non-heading UI stay Manrope.
  - Explicit `font-serif` on non-heading elements: the wordmark (`Header.tsx`, `account.tsx:60`,
    the giant `Footer.tsx:40` wordmark), the big step numbers (`HowItWorks.tsx`), and **prominent
    prices**: `ProductCard.tsx` (both cards), `ProductPurchase.tsx`, `CartLineItem.tsx` line total,
    the total rows in `CartSummary.tsx` / `OrderSummary.tsx`, `OrderLineItem.tsx`,
    `PreviousOrdersList.tsx`, `CurrentOrderCard.tsx`, the hero price badge (`HeroSection.tsx`) and
    `payments.simulator.tsx`. Prices inside sentences (CTA labels, marquee, "each …", free-shipping
    hint, subtotal/discount rows) stay Manrope.
  - Buttons, nav, forms, labels and body copy stay Manrope.
- **Heading weight/tracking:** serif elements drop `font-extrabold` + `tracking-[-0.03em…-0.05em]`
  for `font-bold` (700) and `tracking-[-0.01em]`, as drawn on the canvas (approved in step 2). Sizes and leading stay. Body and button `font-extrabold` stay.
- **Existing focus-ring bug fixed here:** `TextField.tsx:49` and `PaymentMethodField.tsx:38` use
  `outline-primary-light` (`#FF8FA1`) on white inputs, about 2.3:1, below the 3:1 rule in
  `docs/design.md`. Switch both to `outline-primary` (5.52:1). The canvas pages show this too.
  Small, already against the design rules, and in files the sweep doesn't otherwise touch; drop it
  if the owner wants a strictly font-only PR.
- **Canvas artboards (step 1):** first drawn in the plum palette (canvas version 33); after the
  owner's decision redrawn as `HomeRebrand.dc.html` / `ProductRebrand.dc.html`, titled
  "Serif headings (#73) — home/product, for approval" (canvas version 36): exact C+ colours,
  Playfair Display 700 / `-0.01em` on headings, wordmarks, step numbers, card titles and prices,
  #72's white header (#72 merges first and hasn't updated `HomeBoldPlus` yet), no Unisex tile or
  link (no Unisex catalog), and a `lang` tweak (uk / en, real `uk.ts` headings) to check Cyrillic.
- **Copy:** no i18n changes. The Strapi admin's look is out of scope.

## Open questions

- [ ] **Q1: Update the GitHub issue #73 to the reduced scope?** — Why it matters: the issue's
  title, palette table and acceptance criteria still describe plum/orchid, so the PR would look
  like it misses most criteria. Recommended default: retitle to "Set headings in a serif (Playfair
  Display), keeping the C+ colours" and replace the colour sections with a note pointing to this
  decision; done only with the owner's OK. Affects: PR description, acceptance criteria below.

## Resolved questions

- **Colours?** — Keep the current C+ deep-pink palette; only the heading font changes. (source:
  owner, 2026-11-01)
- **Which text gets the serif?** — Headings, wordmark, prices, big step numbers; everything else
  Manrope. (source: owner, 2026-11-01; issue #73)
- **Which serif?** — Playfair Display. (source: owner, 2026-10-29 and 2026-11-01)
- **Canvas first, with approval?** — Yes: `/implement 73` adds the artboards, then stops for
  approval. (source: owner, 2026-10-29)
- **#72 order?** — #72 merges first; #73 rebases on it. (source: owner, 2026-10-29)
- **Which tests pin heading classes?** — `consent-ui.test.ts:39` pins the cookie banner `h2`
  (`text-lg font-extrabold`); `Header.test.ts:21` pins the wordmark markup. Colour class tests are
  untouched. (source: `rg` over `*.test.ts`)
- **Is there a CSS hook for headings today?** — No; every heading carries
  `font-extrabold tracking-[…]` inline (42 files). Hence the base rule plus a sweep. (source:
  `rg "tracking-\[-0\.0" app`)
- **Do we need `&subset=`?** — No; Google Fonts css2 serves subsets via `unicode-range`
  automatically, as for Manrope in `app/root.tsx`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | design canvas artifact | serif artboards for approval |
| modify | `app/app.css` | `--font-serif`, base `h1–h3` rule |
| modify | `app/root.tsx` | load Playfair Display |
| modify | `app/theme.test.ts` | serif stack, font link, base rule |
| modify | heading files (≈40, `rg "<h[1-3]"`), `app/components/ui/RichText.tsx` | serif weight/tracking |
| modify | `Header.tsx`, `Footer.tsx`, `app/routes/account.tsx` | serif wordmark |
| modify | price files listed in Decisions, `HowItWorks.tsx` | `font-serif` on prices and step numbers |
| modify | `app/components/ui/TextField.tsx`, `app/features/checkout/PaymentMethodField.tsx` | focus ring `outline-primary` |
| modify | `consent-ui.test.ts`, `Header.test.ts` and other class-pinning tests | follow class changes |
| modify | `docs/design.md` | typeface section |

## Steps

- [x] **1. Canvas artboards** — Serif-only `HomeRebrand.dc.html` and `ProductRebrand.dc.html` at
  the end of the "Chosen direction" row (canvas version 36), as described in Decisions.
- [x] **2. Owner approval (gate)** — The owner approves the serif, its weight (700) and tracking
  (`-0.01em`) on the canvas. Record the outcome here. Don't start step 3 before. **Approved
  2026-11-01:** after the serif-only artboards, the owner ran `/implement 73` again (no canvas
  comments); taken as approval of Playfair Display 700 / `-0.01em`.
- [x] **3. Rebase on #72** — After #72 merges: `git fetch origin && git rebase origin/main` in the
  worktree. Re-run the `rg` sweeps (headings, prices, wordmark) against the rebased code and adjust
  the file lists. `pnpm typecheck && pnpm lint && pnpm test` must pass. **Done:** rebased on
  `c78ebec` (#72); all checks pass (121 test files, with the local `jassmin-pg` PostgreSQL
  started for the DB tests). Sweep results match the lists above; #72's header wordmark dot is now
  `text-primary` on white.
- [x] **4. Font token and loading** — `app/app.css` `@theme`: add
  `--font-serif: "Playfair Display", Georgia, serif;` after `--font-sans`. `app/root.tsx`
  `links`: add `family=Playfair+Display:wght@600..700` to the existing Google Fonts URL (one
  stylesheet request). Add tests in `theme.test.ts` for the stack and the link.
- [x] **5. Base heading style** — `@layer base { h1, h2, h3 { font-family: var(--font-serif); } }`
  beside the `html, body` rule; test it in `theme.test.ts`. Check in the browser that Ukrainian
  letters (є, ї, і, ґ, Щ) render in Playfair, not a fallback.
- [x] **6. Weight/tracking sweep** — For each `h1`–`h3` (and `RichText` `[&_h2]`), replace
  `font-extrabold tracking-[-0.0Xem]` with `font-bold tracking-[-0.01em]`; keep sizes and leading.
  Add `font-serif font-bold tracking-[-0.01em]` to the wordmarks, `HowItWorks` step numbers and
  the prominent prices. Update `consent-ui.test.ts:39`, `Header.test.ts` and any other test that
  pins those classes.
  **Done:** 40 files swept (all `h1`–`h3`, the dynamic `<Heading>` in `ProductCard`, the account
  `sectionHeading` constant, `RichText` `h2`). `font-serif font-bold tracking-[-0.01em]` on the
  header and footer wordmarks, the `HowItWorks` numbers, the hero badge price, both product card
  prices, the product page price, the cart line total, the cart/checkout total `<dd>`, account
  order prices and the payment simulator amount. `CurrentOrderCard`'s price sits inside a
  "date · items · price" sentence, so it stays Manrope. The `/offers` small uppercase `h1` eyebrow
  gets `font-sans` so it stays a Manrope label. Tests: `Header.test.ts` pins the serif wordmark;
  `cart-ui.test.ts` and `consent-ui.test.ts` follow the new classes.
- [ ] **7. Focus-ring fix** — `TextField`/`PaymentMethodField`: `outline-primary-light` →
  `outline-primary`.
- [ ] **8. Design doc** — `docs/design.md` "Typeface and scale": Playfair Display for headings,
  wordmark, prices and step numbers (700, `-0.01em`), loaded with Manrope in `app/root.tsx`;
  Manrope for body, buttons, nav, forms and labels; update the headings and wordmark bullets; link
  the new artboards.
- [ ] **9. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; then the visual
  check below.

## Testing & verification

- Automated: `theme.test.ts` additions (steps 4–5); class-pinning tests updated (step 6);
  `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Manual (`pnpm aspire run`): home, catalog (men/women), product, cart, checkout, account
  (+ profile, order), offers, popular, login/register, blog, privacy and an error page, at 1440px
  and 375px, in uk and en. Check: serif on headings, wordmark, prices and step numbers with correct
  Cyrillic; Manrope on buttons, nav, forms and body; colours unchanged; no horizontal scroll at
  375px (Playfair runs wider: watch long Ukrainian words in hero/page titles).

## Acceptance criteria

The issue's colour criteria no longer apply (owner's decision, 2026-11-01). Remaining:

- [ ] The owner approved the serif on the design canvas — steps 1, 2
- [ ] Headings, the wordmark and prices use the chosen serif with correct Ukrainian letters; body
  text, buttons and forms stay in Manrope — steps 4, 5, 6, 9
- [ ] Colours are unchanged from C+ — steps 6, 9
- [ ] Focus rings stay visible (at least 3:1) on light surfaces — steps 7, 9
- [ ] `docs/design.md` documents the fonts — step 8
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 9

## Out of scope

- Any colour change (the plum/orchid palette, an `accent` token, shadow tints).
- Layout changes, new components, a dark theme, the Strapi admin's look.
- The white header (#72), the email templates (#45).
- Self-hosting fonts or licensing "Moonlit Velvet Serif".
