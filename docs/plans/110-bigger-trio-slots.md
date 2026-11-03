# Plan: Make the trio slots and the Show my trio button bigger (#110)

Issue: https://github.com/savchukolgaa/jassmin/issues/110
Branch: `issue/110`
Worktree: `.claude/worktrees/issue-110`
Status: Implemented

## Goal
In the home page's "Build your trio" block, a customer should clearly see the three scents they
picked and the next step. The three bottle-shaped slots on the right get noticeably bigger, with
larger family names and numbers, and the "Show my trio" button gets bigger than today's `lg` so it
stands out. Behaviour, the Women / Men switch (#102) and the no-JS form don't change.

## Dependencies & prerequisites
- Trio builder (#64, #67) and the gender switch (#102) are on `origin/main`
  (`app/features/home/TrioBuilder.tsx`).
- No new packages, env vars or migrations. Pure Tailwind/markup change plus one new button size.

## Decisions & assumptions

### Space budget (why these sizes)
- **360 px:** `container px-4` leaves 328 px; the dark card's `p-6` leaves **280 px**. Today three
  `w-22` (88 px) slots + two `gap-2` (8 px) = 280 px, so the slots are already as wide as they can
  be on a 360 px phone. On mobile they grow **in height** (`h-28` → `h-32`, 112 → 128 px) and in
  text size; the width becomes fluid (three equal columns filling the row) instead of fixed, so
  they also widen on bigger phones (≈ 100 px at 390 px).
- **`sm` (640 px+):** fixed `sm:w-28 sm:h-38` (112 × 152 px; was 104 × 132).
- **`md` (768 px+):** `md:w-36 md:h-48` (144 × 192 px, ≈ 1.4× in each direction vs. today's
  104 × 132), `md:gap-4`. The slot row is 3 × 144 + 2 × 16 = **464 px = 29 rem**.
- **Side by side at `lg`:** the card's inner width at `lg` is 1024 − 32 − 96 = 896 px. The form is
  `flex-[1_1_26rem]` (416 px) + `gap-10` (40 px) + a 464 px slot column = 920 px, which would wrap.
  So the form's basis becomes `flex-[1_1_24rem]` (384 + 40 + 464 = 888 ≤ 896) and the right column
  `flex-[1_1_29rem]`. At `md` (inner 640 px) the columns already stack today, and they still do.
  At `xl`+ there's plenty of room.

### Slots
- `<ol>` becomes `grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:gap-3 md:gap-4`; each `<li>`
  is `h-32 sm:h-38 sm:w-28 md:h-48 md:w-36` (full column width on mobile via the grid).
- **Arch shape:** the top radius stays about half the width, set per breakpoint
  (`rounded-[3.25rem_3.25rem_1rem_1rem]`, `sm:rounded-[3.5rem_3.5rem_1rem_1rem]`,
  `md:rounded-[4.5rem_4.5rem_1.25rem_1.25rem]`). Don't use `rounded-t-full`/`999px` here: CSS
  scales *all* radii down when the top pair overflows the width, which would flatten the bottom
  corners. Dashed `border-muted` empty state stays.
- **Filled bottle** keeps its proportions by sizing relative to the slot:
  `h-[calc(100%-0.75rem)] w-[calc(100%-0.75rem)]` (today it is exactly 12 px smaller in both
  directions), with matching inner radii (`2.875rem` / `3.125rem` / `4.125rem` tops).
- **Family name:** `text-sm sm:text-[0.9375rem] md:text-base leading-tight`, `px-1.5 pb-4
  md:pb-6`, `text-balance`, `hyphens-auto` and `[overflow-wrap:anywhere]` as a last resort.
  `<html lang>` is set from the locale (`app/root.tsx:82`), so `hyphens-auto` can use Ukrainian
  rules where the browser has them. Longest labels to check: "Ароматичні", "Альдегідні",
  "Гурманські", "Цитрусові" (uk) and "Aldehydic", "Aromatic", "Gourmand" (en). At 360 px the inner
  bottle is ≈ 76 px wide, so mobile stays at 14 px (`text-sm`, up from 13 px) (Q1).
- **Empty-slot number:** `text-3xl` → `text-4xl md:text-5xl`.
- `animate-slot-pop` and its `key={family}` replay stay. `prefers-reduced-motion: reduce` is
  handled globally in `app/app.css` (turns off all animations), so nothing to add.

### Button
- Add a new size **`xl`** to `app/components/ui/button-styles.ts`:
  `xl: "min-h-16 px-10 text-xl"` (64 px tall, 20 px text; `lg` is 58 px / 18 px). The issue prefers
  an existing size, but `lg` is what it is today and the ask is "larger than `lg`", so a new size is
  needed; it's documented in `docs/design.md` as the issue asks.
- The slots and the CTA sit in one wrapper, `flex w-full flex-col gap-5 sm:w-fit`, and the CTA gets
  `w-full`: full width of the slot row on mobile, exactly as wide as the slots on `sm`+. The longest
  copy ("Показати моє тріо · 499,00 грн →" at 20 px, ≈ 430 px with padding) fits in the 464 px row
  at `md`; at `sm` (row 360 px) it may wrap to two lines inside the pill, which is fine because
  `min-h` is a minimum **(check in step 5)**.
- **"N left to pick" status:** `font-bold text-on-dark-muted` → add `text-lg`.
- **No layout shift:** the status/CTA swap goes in a slot with a reserved height,
  `<div className="flex min-h-16 items-center">`, so the 28 px status line and the 64 px button
  take the same space. `animate-pop` is a transform, so it doesn't shift layout either.
- **Right column centring:** the column changes `items-start` → `items-center`, so the slot row and
  button are centred in the right half on desktop and under the form when stacked. (On mobile the
  row is full width, so this changes nothing there.)

### Deviations found in step 5 (layout check)
Rendering the block at a true 360 px viewport (headless Edge, 360 px iframe) showed two problems
with the planned classes:
- **Names broke mid-word** ("Аромати/чні", "Aldehydi/c"): the browser didn't hyphenate, so
  `overflow-wrap: anywhere` split the word. With the 2 px border, the 12 px inset and `px-1.5`, the
  bottle had only ≈ 60 px for text, and a 10-letter bold label at 14 px needs ≈ 85 px.
  Fix: on mobile the card is `px-4 py-6` (was `p-6`; `sm:p-12` unchanged), the bottle inset is
  0.5 rem below `md` (0.75 rem from `md`), the label padding is `px-0.5` (`md:px-2`), and the slot is
  a size container (`@container`) whose label is `clamp(0.75rem, 14.5cqi, 0.875rem)`. That's
  ≈ 13 px at 360 px, 14 px from ≈ 390 px, 15 px at `sm` and 16 px at `md`+, and every label stays
  on one line. 14 px on the smallest phones (Q1) can't fit a 10-letter word without hyphenation,
  which browsers don't reliably do for Ukrainian.
- **The CTA wrapped onto two left-aligned lines** at 20 px in a 280 px-wide pill. Fix: the `xl` size
  is responsive, `min-h-16 px-6 text-center text-lg leading-tight sm:px-10 sm:text-xl`. On phones
  that's 64 px tall with 18 px text: still bigger than `lg` (58 px) and full width.

## Resolved questions
- **Q1: Mobile family-name size** — 14 px below `sm`, 15 px at `sm`, 16 px at `md`+, with
  `hyphens-auto` and `overflow-wrap: anywhere` as a fallback; the card's mobile padding stays `p-6`
  (source: owner, answering this plan).
- **Q2: Centre the right column or keep it left-aligned** — Centre (`items-center`) (source: owner,
  answering this plan).
- **Where does reduced motion come from?** — A global `@media (prefers-reduced-motion: reduce)` rule
  turns off every animation, so `animate-slot-pop`/`animate-pop` are covered with no extra classes
  (source: `app/app.css` ~line 295).
- **Is there already a size bigger than `lg`?** — No: `sm` / `md` / `lg` only (source:
  `app/components/ui/button-styles.ts`, `docs/design.md` → Buttons).
- **Why can't the slots be wider on 360 px?** — 280 px content width = 3 × 88 + 2 × 8 already
  (source: `TrioBuilder.tsx` card `p-6`, `container px-4`).
- **Which tests assert classes?** — `TrioBuilder.test.ts` matches the status line's exact `class`
  (`font-bold text-on-dark-muted`); `button-styles.test.ts` has a size → height table (source: both
  test files on `origin/main`).
- **Does the page set `lang` for hyphenation?** — Yes, `<html lang={locale}>` (source:
  `app/root.tsx:82`).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/components/ui/button-styles.ts` | Add `xl` to `ButtonSize` and `sizes` |
| modify | `app/components/ui/button-styles.test.ts` | Add `["xl", "min-h-16"]` to the size table |
| modify | `app/features/home/TrioBuilder.tsx` | Bigger slots, text, number; CTA wrapper, `xl` button, reserved height, column flex bases |
| modify | `app/features/home/TrioBuilder.test.ts` | Update the status-line class assertion; add a check that the CTA uses `min-h-16`/`w-full` |
| modify | `docs/design.md` | Add `xl` (64px) to the Buttons size table and mention the trio CTA |

## Steps

- [x] **1. Worktree setup** — In `.claude/worktrees/issue-110` run `pnpm install` (env files are
  already linked). Confirm `git branch --show-current` is `issue/110`.

- [x] **2. Add the `xl` button size** — In `button-styles.ts`: `ButtonSize = "sm" | "md" | "lg" |
  "xl"`, `xl: "min-h-16 px-10 text-xl"`. Add `["xl", "min-h-16"]` to the `it.each` table in
  `button-styles.test.ts`. In `docs/design.md` → Buttons add the row `| `xl` | 64px |` and a line
  that it's for the single standout CTA of a block (the trio builder's "Show my trio"). Run
  `pnpm test app/components/ui`.

- [x] **3. Enlarge the slots** — In `TrioBuilder.tsx`:
  - `<ol>`: `grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:gap-3 md:gap-4`.
  - `<li>`: `flex h-32 items-center justify-center rounded-[3.25rem_3.25rem_1rem_1rem] border-2
    border-dashed border-muted sm:h-38 sm:w-28 sm:rounded-[3.5rem_3.5rem_1rem_1rem] md:h-48
    md:w-36 md:rounded-[4.5rem_4.5rem_1.25rem_1.25rem]`.
  - Filled `<span>`: `animate-slot-pop flex h-[calc(100%-0.75rem)] w-[calc(100%-0.75rem)] items-end
    justify-center rounded-[2.875rem_2.875rem_0.75rem_0.75rem] bg-primary-light px-1.5 pb-4
    text-center text-sm leading-tight font-extrabold text-balance hyphens-auto text-ink
    [overflow-wrap:anywhere] sm:rounded-[3.125rem_3.125rem_0.75rem_0.75rem] sm:text-[0.9375rem]
    md:rounded-[4.125rem_4.125rem_1rem_1rem] md:pb-6 md:text-base` (keep `key={family}` and the
    sr-only "Slot n:" prefix first, so the existing test regex still matches).
  - Empty number: `text-4xl font-extrabold text-on-dark-muted md:text-5xl`.
  - Let `pnpm format` sort the classes (Biome `useSortedClasses` if enabled).

- [x] **4. Bigger CTA without layout shift** — Still in `TrioBuilder.tsx`:
  - Form: `flex-[1_1_26rem]` → `flex-[1_1_24rem]`. Right column: `flex-[1_1_22rem]` →
    `flex-[1_1_29rem]`, `items-start` → `items-center`.
  - Wrap the `<ol>` and the status/CTA in `<div className="flex w-full flex-col gap-5 sm:w-fit">`.
  - Put the `full ? … : …` switch inside `<div className="flex min-h-16 items-center">`.
  - `ButtonLink`: `size="xl"`, `className="animate-pop w-full"` (keep `to` and the copy).
  - Status `<p>`: add `text-lg` (`font-bold text-lg text-on-dark-muted`).
  - Update `TrioBuilder.test.ts`: the "starts empty" assertion's class string (copy Biome's sorted
    order), and in "leads to the popular perfumes…" assert the link's class contains `min-h-16`
    and `w-full`. Behaviour tests stay unchanged.

- [x] **5. Check the layout in the running app** — `pnpm aspire run`, open `/` and `/en/`, scroll to
  `#trio`. Use DevTools device widths 360, 390, 640, 768, 1024, 1280:
  - no horizontal scroll at 360 (`document.documentElement.scrollWidth === 360`);
  - pick the longest families ("Ароматичні", "Альдегідні", "Гурманські" in uk; "Aldehydic",
    "Aromatic" in en): names stay inside the bottle and readable;
  - at `lg` (1024) the form and slots sit side by side; at `md` they stack and the slots are centred;
  - picking the third family swaps the status for the button with no jump in the block's height
    (compare the section's `getBoundingClientRect().height` before/after);
  - the button is full row width on mobile and as wide as the slot row on desktop;
  - Women / Men switch still updates the link; with JS disabled, "Show my picks" submits and the
    slots + button render from the URL;
  - with "Emulate prefers-reduced-motion: reduce", the pop animations don't play.
  Adjust sizes here if something is off (e.g. Q1's padding fallback).

- [x] **6. Verify and commit** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Commit
  with explicit paths (`git add app/components/ui/button-styles.ts …`).

## Testing & verification
- **Unit:** `button-styles.test.ts` gets the `xl` → `min-h-16` case. `TrioBuilder.test.ts`: updated
  status-line class, new assertion that the CTA has `min-h-16` and `w-full`; all behaviour tests
  (GET form, checkboxes, gender radios, href, price, uk copy, empty render) unchanged and passing.
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **Manual:** the checklist in step 5 (widths, both languages, layout shift, no-JS, reduced motion).

## Acceptance criteria
- [x] The three trio slots are clearly bigger on desktop and mobile, and the chosen family names are
  easy to read in Ukrainian and English — steps 3, 5
- [x] The "Show my trio" button is bigger and stands out, at every screen width — steps 2, 4, 5
- [x] Three slots still fit on a 360 px screen with no horizontal scroll, and nothing jumps when the
  button appears — steps 3, 4, 5
- [ ] Picking, the gender switch and the no-JS form work as before — steps 4 (tests unchanged), 5
  — *Not ticked:* the picking and gender logic is unchanged, and the server-render tests for the
  form, picks, gender switch and no-JS button pass unchanged, but clicking through the hydrated
  page in a live browser wasn't done (the home page needs Strapi, which wasn't running).
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 6

## Out of scope
- The family chips and gender switch on the left (only the form's flex basis changes, for room).
- Copy (`home.trio.*` keys) and the trio price.
- The `/popular` page the button links to.
- Any other use of `Button`/`ButtonLink` sizes.
