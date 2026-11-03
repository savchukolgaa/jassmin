# Plan: Show a bigger Instagram icon with its name in the contacts section (#111)

Issue: https://github.com/savchukolgaa/jassmin/issues/111
Branch: `issue/111`
Worktree: `.claude/worktrees/issue-111`
Status: Planned

## Goal
As a customer looking at the contacts, I want the Instagram link to be a bigger icon with the word
"Instagram" next to it, so I recognise it straight away and know where it leads. In the home page's
contacts section, `SocialLinks` gets a labelled variant: a 32 px icon followed by the platform name
in bold, inside a pill link. The footer and mobile menu keep the compact icon-only style.

## Dependencies & prerequisites
- #101 (merged, `f853219`): `SocialLinks` (`app/components/layout/SocialLinks.tsx`), `SOCIAL_ICONS`
  (`app/components/layout/icons.tsx`), `SOCIAL_LABELS` (`app/lib/cms.ts`) and the `social.*` i18n
  keys all exist on `origin/main`.
- No new packages, env vars, migrations or i18n keys.

## Decisions & assumptions
- **Prop API:** `variant?: "icon" | "labelled"` on `SocialLinks`, default `"icon"`, as the issue
  suggests. Footer (`Footer.tsx`) and mobile menu (`MobileMenu.tsx`) pass nothing, so they are
  unchanged.
- **`labelled` only supports `tone="onInk"` in practice.** It's the only caller. Rather than invent
  pill styles for `onPrimary`/`onLight` that nobody uses, type the props as a discriminated union:
  `{ variant?: "icon"; tone: SocialTone } | { variant: "labelled"; tone: "onInk" }`. That keeps the
  `onInk` focus ring (`outline-primary-light`, 7.93:1 on `ink`, `docs/design.md`) the only ring the
  labelled pill can have, and `app/theme.test.ts`'s `onInk` allow-list stays valid without changes.
- **Labelled link classes** (new `labelledOnInkClasses` constant in `SocialLinks.tsx`):
  `inline-flex min-h-11 items-center gap-3 rounded-pill px-3 py-1.5 text-lg font-bold text-white
  transition-colors hover:bg-white/10 hover:text-primary-light` + the same `focus-visible:outline-3
  outline-offset-2 outline-primary-light` ring as `onInkClasses`. The icon is `size-8 shrink-0
  text-primary-light` (decorative, `aria-hidden` already set by `SOCIAL_ICONS`). `text-lg font-bold`
  matches the phone/email rows (`contactLink` in `ContactsSection.tsx`), so the block reads as one
  list.
- **Alignment with the contact rows:** the contact rows have no horizontal padding, so their icons
  sit on the content edge. The labelled list gets `-mx-3` (cancelling the pill's `px-3`) so the
  social icon's left edge lines up with the phone/mail icons, and `flex flex-wrap gap-x-2 gap-y-1`
  so several platforms wrap on narrow screens. The icon variant keeps its current `-mx-1 flex
  flex-wrap gap-1`.
- **Accessible name:** keep `aria-label={t("social.linkLabel", { platform })}` on both variants.
  "Jassmin on Instagram" / "Jassmin у Instagram" contains the visible text "Instagram", which
  satisfies WCAG 2.5.3 Label in Name as the issue requires, and keeps the name identical across
  footer, menu and contacts (existing tests and screen-reader users rely on it). The visible label
  is `SOCIAL_LABELS[platform]` (brand names, not translated), wrapped in a `<span>`.
- `target="_blank"` and `rel="noopener noreferrer"` stay on every link; the `<ul aria-label>`
  ("Social media") stays.

## Resolved questions
- **Which platforms are labelled?** Every link in the list, not only Instagram — the label comes
  from `SOCIAL_LABELS`, so Telegram etc. render the same once set in Strapi (source: #111 Context).
- **Where is the contacts social row rendered?** Only `app/features/home/ContactsSection.tsx`,
  inside `HomePage`; footer and mobile menu use `SocialLinks` with `onPrimary`/`onLight` (source:
  `grep SocialLinks app`).
- **Does the `onInk` ring trip the theme guard?** No — `SocialLinks.tsx` and
  `ContactsSection.tsx` are already in the `onInk` allow-list (source: `app/theme.test.ts:160`).
- **Will existing HomePage tests break?** `HomePage.test.ts:347` expects `aria-label="Jassmin on
  Instagram"` followed directly by `><svg`; the labelled markup keeps the icon as the anchor's first
  child, so it still passes. The test title at `:352` ("same icons as the footer") becomes wrong and
  is updated in step 3.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/components/layout/SocialLinks.tsx` | Add `variant` prop and the labelled pill rendering |
| modify | `app/components/layout/SocialLinks.test.ts` | Cover the labelled variant and the unchanged default |
| modify | `app/features/home/ContactsSection.tsx` | Use `variant="labelled"`, update the comment |
| modify | `app/features/home/HomePage.test.ts` | Assert the contacts section renders the labelled links |

## Steps
- [ ] **1. Add the `labelled` variant to `SocialLinks`** — In `SocialLinks.tsx`, type the props as
  the union described above, add `labelledOnInkClasses`, and in the map render
  `<Icon className="size-8 shrink-0 text-primary-light" /><span>{SOCIAL_LABELS[platform]}</span>`
  for `labelled`, and the existing `<Icon className="size-6" />` otherwise. Switch the `<ul>`
  spacing by variant (`-mx-3 flex flex-wrap gap-x-2 gap-y-1` vs `-mx-1 flex flex-wrap gap-1`).
  Compute the label once (`const label = SOCIAL_LABELS[platform]`) and reuse it for `aria-label`.
  Update the JSDoc to mention the variant and #111. Check: `pnpm typecheck`.
- [ ] **2. Use it in the contacts section** — In `ContactsSection.tsx`, pass `variant="labelled"`
  and update the comment (labelled pills, #111; footer/menu stay icon-only). Check visually in
  `pnpm aspire run` (or `pnpm dev`): icon lines up with the phone/mail icons, two links wrap at
  320 px, focus ring visible on Tab, hover tint.
- [ ] **3. Tests** —
  - `SocialLinks.test.ts`: extend `render()` to accept a `variant`; add
    - "labelled variant shows each platform name after a bigger icon": `html` contains
      `>Instagram</span>` and `>Telegram</span>`, each anchor contains `<svg` with `size-8`, and
      the anchor matches `min-h-11` + `rounded-pill`;
    - "labelled accessible name contains the visible label" (WCAG 2.5.3), in `en` and `uk`: for
      each platform, the anchor's `aria-label` includes `SOCIAL_LABELS[platform]`;
    - "labelled links open in a new tab with the onInk focus ring": `target="_blank"`,
      `rel="noopener noreferrer"`, `focus-visible:outline-primary-light`;
    - "the default variant is unchanged": no `<span>` label text, icons `size-6`, anchors `size-11`
      (the existing 44 px test already covers this — add the "no visible label" assertion there).
  - `HomePage.test.ts`: rename the #101 test to "shows the social links as labelled pills, ringed
    for the dark section (#101, #111)" and assert the contacts slice contains `>Instagram</span>`
    and `size-8`.
  - Footer/Header tests already pin the icon-only rows; confirm they pass unchanged.
- [ ] **4. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Testing & verification
- Unit: `SocialLinks.test.ts`, `HomePage.test.ts` (step 3); existing `Footer.test.ts`,
  `Header.test.ts` and `app/theme.test.ts` must stay green untouched.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: home page `#contacts` at 320 px, 768 px and desktop, in `uk` and `en`; Tab to the links
  (ring visible on `ink`), check the link opens Instagram in a new tab; footer and mobile menu still
  show round icons only.

## Acceptance criteria
- [ ] In the home contacts section, Instagram shows as a bigger icon with "Instagram" written next to
  it, and Telegram the same way once it's set in Strapi — steps 1, 2, 3
- [ ] The links open in a new tab, have a visible focus ring and a 44 px touch target, and their
  accessible name contains the platform name — steps 1, 3
- [ ] The footer and mobile menu still show compact icons — steps 1 (default `"icon"`), 3
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 4

## Out of scope
- Footer and mobile menu styling (stay icon-only).
- Link URLs, order and Strapi configuration (`normalizeSocialLinks`, `SOCIAL_ORDER`).
- Labelled styles for the `onPrimary`/`onLight` tones.
- New i18n keys or translating brand names.
