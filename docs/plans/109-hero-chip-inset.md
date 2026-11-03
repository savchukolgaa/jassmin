# Plan: Move the hero's Women · Men chip a little to the left (#109)

Issue: https://github.com/savchukolgaa/jassmin/issues/109
Branch: `issue/109`
Worktree: `.claude/worktrees/issue-109`
Status: Implemented

## Goal

Customers landing on the home page should see the dark "Жінкам · Чоловікам" / "Women · Men" chip sit
comfortably inside the hero picture instead of against its right edge. Only the chip's horizontal
position changes. Its text, colours, float animation and the price badge stay as they are.

## Dependencies & prerequisites

- The hero from #64 and #72 is on `origin/main`: `app/features/home/HeroSection.tsx` → `FloatingChip`.
- No packages, env vars or migrations are needed.

## Decisions & assumptions

- **Inset with `right-*`, not `-translate-x-*`.** `animate-float` animates `transform`
  (`translateY(-14px)` in `@keyframes float`, `app/app.css`), and a keyframe `transform` replaces a
  Tailwind `translate` utility while the animation runs. Changing `right-0` keeps the two
  independent.
- **Values: `right-4 md:right-8`** (16 px on phones, 32 px from `md`), as the issue suggests. Here is
  the geometry check against the classes on `main`:
  - The image wrapper is `w-full max-w-lg` (≤ 512 px) inside `container px-4`, and the image is
    `h-112` (448 px), or `md:h-152` (608 px) from `md`.
  - The chip is `text-sm font-extrabold px-4.5 py-3`. The longer Ukrainian label comes to about
    185–195 px wide, and the English one to about 120 px.
  - **360 px:** the wrapper is 328 px. With `right-4` the chip spans about x = 120–312, so it sits
    inside the image with a 16 px margin on the right.
  - **768 px:** the row wraps (512 + 40 + 384 > 736), so the wrapper is 512 px and centred. With
    `md:right-8` the chip spans about x = 285–480.
  - **1024 px:** the image sits beside the text and the wrapper shrinks to about 406 px. The chip
    spans about x = 180–374, which is the narrowest case and still fits.
  - **1280 px+:** the wrapper is about 509–512 px, the same as at 768 px.
  - The price badge is at `top-4/md:top-6`, `left-0/md:-left-6`, `size-32/md:size-39`, and the chip
    is at `bottom-9`. They're more than 250 px apart vertically at every width, so they never
    overlap.
  - The arch (`rounded-t-full`) only rounds the top. The bottom corners where the chip sits are
    square, so the chip stays over the picture.
- **No horizontal scroll or CLS risk.** The chip is `absolute` inside the `relative` wrapper, and
  moving it inward only shrinks its footprint. It's still in its final place on first paint (#88).
- **Reduced motion** is handled already by the global `prefers-reduced-motion: reduce` rule in
  `app/app.css`, so nothing changes there.
- **Test:** add one class assertion to the existing hero test in
  `app/features/home/HomePage.test.ts`, following the existing `h-112 … md:h-152` class check, so a
  later edit doesn't quietly put the chip back on the edge. The issue makes this optional, but
  `AGENTS.md` asks for tests next to changed behaviour, and the check is cheap.

- **Browser check (step 3), done without the full stack.** `pnpm aspire run` needs Postgres and
  Strapi, so the check used a static copy of the hero markup with the built CSS
  (`build/client/assets/app-*.css`) and the real Manrope font, measured in headless Edge.
  360 px was tested in an iframe, because headless Edge won't size a window below about 496 px.
  The results matched the geometry above. At 360 px the Ukrainian chip spans 156–328 inside a
  16–344 wrapper and the English one 202–328, so the right gap is 16 px. At `md`+ the right gap is
  32 px. At the narrowest side-by-side layout (wrapper 406 px) the chip still has 203 px of room
  on the left. The chip's top is always more than 200 px below the badge's bottom, and
  `scrollWidth` equals the viewport width at every width in both locales. The real hero photo
  wasn't in the check, so the owner should glance at it on the deployed page.

## Open questions

- [x] **Q1: Is "a little bit to the left" 16/32 px, or should it move further?** Why it matters:
  it's a visual judgement for the store owner. Recommended default: `right-4 md:right-8`. If it
  still looks too far right in the browser check (step 3), go up to `right-6 md:right-12`, which
  still fits at 1024 px (about 406 − 48 − 195 = 163 px of room on the left). Affects steps 1 and 3.

## Resolved questions

- **Does an existing test assert the chip's classes?** No. The hero test only checks the text
  "Women · Men" and the absence of "unisex" (source: `app/features/home/HomePage.test.ts`, "renders the
  hero eyebrow, subtitle, second CTA and floating chip").
- **Does the float animation move the chip sideways?** No. It is vertical only, `translateY(-14px)`
  (source: `app/app.css` `@keyframes float`).
- **Is reduced motion already respected?** Yes. The global rule sets `animation: none !important`
  (source: `app/app.css`, `@media (prefers-reduced-motion: reduce)`).
- **What are the chip labels?** "Жінкам · Чоловікам" / "Women · Men", and they stay the same
  (source: `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts`, `home.hero.chip`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/features/home/HeroSection.tsx` | Change `right-0` to `right-4 md:right-8` on `FloatingChip` |
| modify | `app/features/home/HomePage.test.ts` | Assert that the chip has the inset and not `right-0` |

## Steps

- [x] **1. Inset the chip.** In `FloatingChip` (`app/features/home/HeroSection.tsx`), change the
  class string from
  `animate-float absolute right-0 bottom-9 …` to `animate-float absolute right-4 bottom-9 md:right-8 …`.
  Let `pnpm format` put the classes in Biome's sorted order. Leave everything else alone (text,
  `bg-ink`, padding, radius, animation).
- [x] **2. Lock it with a test.** In `app/features/home/HomePage.test.ts`, extend
  "renders the hero eyebrow, subtitle, second CTA and floating chip" with a check such as
  `expect(html).toMatch(/<p class="[^"]*\bright-4\b[^"]*md:right-8[^"]*">Women · Men<\/p>/)` and
  `not.toMatch(/\bright-0\b[^>]*>Women · Men/)`.
- [x] **3. Check it in the browser.** Run `pnpm aspire run`, open `/` (uk) and `/en`, and look at
  360, 768, 1024 and 1280 px+ in DevTools. Confirm that the chip sits fully over the image with a
  visible margin on the right, doesn't touch the price badge or the main subject, and causes no
  horizontal scrollbar (`document.documentElement.scrollWidth === innerWidth`). Also check with
  "Emulate prefers-reduced-motion: reduce" (no float). Adjust the values in steps 1 and 2 if Q1's
  answer calls for it.
- [x] **4. Run the gates.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` in the
  worktree.

## Testing & verification

- Unit: the updated hero test in `HomePage.test.ts` (step 2).
- Commands: `pnpm --dir .claude/worktrees/issue-109 typecheck`, then `lint`, `test` and `build`.
- Manual: the browser check in step 3 at four widths, in both locales, with reduced motion on and
  off.

## Acceptance criteria

- [x] On the home page hero, the "Women · Men" chip sits slightly further left, clearly inside the
  image, on mobile, tablet and desktop (steps 1 and 3).
- [x] The chip is never clipped and causes no horizontal scroll, in Ukrainian and English (steps 1
  and 3).
- [x] The chip's text, colours and animation are unchanged (steps 1 and 2).
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass (step 4).

## Out of scope

- The price badge, the hero image size and the arch shape.
- Making the chip a link, or changing its copy, colours or animation.
