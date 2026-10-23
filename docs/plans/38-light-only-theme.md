# Plan: Fix dark text on dark background when the OS uses dark mode (#38)

Issue: https://github.com/savchukolgaa/jassmin/issues/38
Branch: `issue/38`
Worktree: `.claude/worktrees/issue-38`
Status: Planned

## Goal

As a customer whose device uses dark mode, I want readable text so that I can browse and buy
perfumes without straining. Today `prefers-color-scheme: dark` turns the page background
`gray-950` while all C+ text tokens stay dark, and `color-scheme: dark` makes native controls dark.
Lock the storefront (and the admin area, which shares `app/app.css`) to the light C+ theme until a
dark theme is designed.

## Dependencies & prerequisites

- None. #27 (C+ design, `docs/design.md`, `app/theme.test.ts`) is already on `origin/main`.
- No new packages, env vars or migrations. The worktree has `.env`; run `pnpm --dir "$WT" install`
  first because `node_modules` is not installed yet.
- **Parallel work / merge order:** #38 merges first, then #28 (i18n), then #10 and #16.
  - #28 will also touch `app/root.tsx` (`<html lang={locale}>`, root loader) and move the
    "Coming soon." / "Your orders will appear here soon." copy in `PagePlaceholder.tsx` and
    `account.tsx` into dictionaries. To keep #28's rebase trivial, this issue changes **only the
    `className`** on those lines and adds the meta tag as a single new line in `<head>`, without
    reshaping `Layout`.
  - #10 replaces the `/cart` placeholder; #16 adds admin product pages. Neither touches the files
    below except possibly using `PagePlaceholder`; the guard test in step 5 will flag any `dark:`
    utility they add after rebasing on main.

## Decisions & assumptions

- **Light-only, not a dark theme.** Per the issue and `docs/design.md` ("Dark mode isn't part of
  C+").
- **`color-scheme: light` goes on the existing `html { … }` block** in `app/app.css` (as its first
  declaration, before the nested reduced-motion `@media`), instead of a new rule. `html, body` keeps
  `@apply bg-white text-ink;` without `dark:bg-gray-950` and without any `prefers-color-scheme`
  block.
- **Leftover `text-gray-600 dark:text-gray-400` becomes `text-muted`** in `PagePlaceholder.tsx` and
  `account.tsx`. `muted` is the C+ secondary-text token (on white ≥ 4.5:1, already asserted in
  `app/theme.test.ts`); just deleting `dark:text-gray-400` would leave a non-token grey.
- **The meta tag** `<meta name="color-scheme" content="light" />` sits in `Layout`'s `<head>` right
  after the viewport meta, so it applies before the stylesheet loads and also covers the root
  `ErrorBoundary` (it renders inside `Layout`).
- **Regression guard covers both CSS and components.** The issue asks for an `app/app.css` check;
  the plan also adds a scan of `app/**/*.{ts,tsx}` for `dark:` Tailwind variants so the "no `dark:`
  utilities in `app/`" criterion stays enforced as #10/#16/#28 land.
- **The `dark:` matcher must not hit false positives.** A plain `"dark:"` substring matches
  `--color-primary-dark: #a8233d;` in `app.css` and the `dark: "bg-ink …"` key in
  `app/components/ui/button-styles.ts`. Use a variant pattern: `dark:` not preceded by a word char
  or `-`, and immediately followed by a class character, e.g.
  `/(?<![\w-])dark:(?=[\w[!-])/`. That ignores `primary-dark:` (preceded by `-`) and `dark: "`
  (followed by a space).

- **Tailwind scans every non-ignored file for class names** (v4 automatic source detection), so
  `dark:` class names written as plain strings, even in a test or a markdown file, still emit dead
  `@media (prefers-color-scheme: dark)` rules into the build. They match no element, so they're
  harmless, but the test builds its sample variant strings at runtime (`${dark}:bg-gray-950`) to
  keep them out of the CSS. While this plan file exists it causes the same dead rules; they disappear
  once the plan is removed before merge (checked: no other tracked file mentions them).
- **The `html` block check uses `/^html \{\s*color-scheme: light;/m`**, since a comment line now
  precedes the block.

## Resolved questions

- **Is there already a theme test file to extend?** Yes: `app/theme.test.ts` reads `app/app.css`
  with `readFileSync(new URL("./app.css", import.meta.url))`; add the new `describe` there (source:
  `app/theme.test.ts`).
- **Which `dark:` utilities exist in `app/`?** Only `app/app.css:46` (`dark:bg-gray-950`),
  `app/components/layout/PagePlaceholder.tsx:6` and `app/routes/account.tsx:21`
  (`dark:text-gray-400`). `button-styles.ts:27` is the unrelated `dark` button variant and
  `--color-primary-dark` is a token (source: `grep -rn "dark:" app/`).
- **Any other `color-scheme` / `prefers-color-scheme` usage?** Only `app/app.css:48-49` (source:
  grep of `app/`).
- **Does the admin area need separate handling?** No: `/admin` routes render inside the same root
  `Layout` and `app/app.css`, so the fix covers them (source: `app/root.tsx`, #36).
- **Are other grey utilities (`AuthLayout.tsx`, `TextField.tsx` `text-gray-*`/`bg-gray-*`) part of
  this bug?** No: they have no dark variant and sit on light surfaces, so they're readable once the
  page is light. Converting them to C+ tokens is a separate cleanup (see Out of scope).
- **Can Biome check `docs/design.md`?** No, `**/*.md` is excluded in `biome.json`; just keep the
  existing ~100-column wrapping.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/app.css` | Drop `dark:bg-gray-950` and the `prefers-color-scheme: dark` block; add `color-scheme: light` to `html` |
| modify | `app/root.tsx` | Add `<meta name="color-scheme" content="light" />` in `Layout`'s `<head>` |
| modify | `app/components/layout/PagePlaceholder.tsx` | `text-gray-600 dark:text-gray-400` → `text-muted` |
| modify | `app/routes/account.tsx` | `text-gray-600 dark:text-gray-400` → `text-muted` |
| modify | `app/theme.test.ts` | Light-only regression tests (CSS, meta tag, no `dark:` variants in `app/`) |
| modify | `docs/design.md` | Document the storefront as light-only with forced `color-scheme: light` |

## Steps

- [x] **1. Install and baseline** — In the worktree run `pnpm install`, then `pnpm typecheck`,
  `pnpm lint`, `pnpm test` to confirm a green baseline.
- [x] **2. Force light in `app/app.css`** — In the `html { … }` block add `color-scheme: light;`
  above the nested `@media (prefers-reduced-motion: no-preference)`. Change `html, body` to just
  `@apply bg-white text-ink;` and delete the `@media (prefers-color-scheme: dark)` block. Optionally
  add a one-line comment: `/* Light-only: C+ has no dark theme (docs/design.md). */`.
- [x] **3. Add the meta tag in `app/root.tsx`** — After
  `<meta name="viewport" … />` add `<meta name="color-scheme" content="light" />`. Touch nothing
  else in `Layout` (keeps #28's `lang` change conflict-free).
- [x] **4. Remove leftover `dark:` variants** — In `PagePlaceholder.tsx` and `account.tsx`, replace
  `text-gray-600 dark:text-gray-400` with `text-muted`. Re-run
  `grep -rnE "(^|[^-[:alnum:]_])dark:[[:alnum:]_[!-]" app/` — expect no matches.
- [x] **5. Regression tests in `app/theme.test.ts`** — Add `describe("light-only theme", …)`:
  - `app.css` has no `prefers-color-scheme: dark` and no `color-scheme: dark`;
  - `app.css` contains `color-scheme: light;` inside the `html {` block (e.g. match
    `/\nhtml \{\s*color-scheme: light;/`);
  - `app.css` has no `dark:` variant (pattern from Decisions) — and a sanity assertion that the
    pattern does **not** match `--color-primary-dark: #a8233d;` or `dark: "bg-ink"`, and **does**
    match `dark:bg-gray-950` and `md:dark:text-white`, so the guard can't silently rot;
  - `root.tsx` source (read via `readFileSync(new URL("./root.tsx", import.meta.url))`) contains
    `<meta name="color-scheme" content="light" />`;
  - no `.ts`/`.tsx`/`.css` file under `app/` (walk with
    `readdirSync(new URL(".", import.meta.url), { recursive: true })`, skipping `*.test.ts` and
    `.react-router`-generated paths if present) contains a `dark:` variant; report offending file
    names in the assertion (`expect(offenders).toEqual([])`).
  Verify the tests fail against the pre-change files (e.g. temporarily revert step 2) and pass
  after.
- [x] **6. Update `docs/design.md`** — Replace the colour-rules bullet "Dark mode isn't part of C+.
  Existing `dark:` variants may stay but aren't designed; …" with: the storefront is light-only; it
  forces `color-scheme: light` on `html` and via `<meta name="color-scheme" content="light">` in
  `app/root.tsx` so pages and native controls stay light under OS dark mode; don't add `dark:`
  variants (guarded by `app/theme.test.ts`); a dark theme would be a separate design issue; the
  header and footer are always deep pink.
- [ ] **7. Verify and commit** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; manual
  check (below); commit with explicit paths on `issue/38`.

## Testing & verification

- Automated: the new `light-only theme` tests in `app/theme.test.ts` (step 5); existing contrast
  tests already cover `muted` on white.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`, Chrome DevTools → Rendering → Emulate CSS media feature
  `prefers-color-scheme: dark`, and once with the OS in dark mode): home, catalog (men/women),
  product page incl. the volume `<select>` (#37), blog list and article, login/register, account,
  cart, checkout placeholder, a 404 page and `/admin` as an admin. Check backgrounds are white/blush,
  text is `ink`/`body`, inputs/selects/checkboxes and scrollbars are light, and DevTools shows
  computed `color-scheme: light` on `<html>`. Also hard-reload with CSS throttled to confirm no dark
  flash before the stylesheet loads.

## Acceptance criteria

- [ ] With `prefers-color-scheme: dark`, every storefront page renders the light C+ theme:
  white/blush backgrounds with `ink`/`body` text — steps 2, 4, 7
- [ ] Native form controls (inputs, selects, checkboxes) and scrollbars stay light in dark mode —
  steps 2, 3, 7
- [ ] `<html>` has `color-scheme: light` and the document has a `color-scheme` meta tag set to
  `light` — steps 2, 3, 5
- [ ] No `dark:` utilities remain in `app/` (apart from the unrelated `dark` button variant and
  `primary-dark` token) — steps 4, 5
- [ ] `docs/design.md` documents the storefront as light-only — step 6
- [ ] A test fails if a dark-mode rule is reintroduced in `app/app.css` — step 5
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 7

## Out of scope

- Designing or implementing a real dark theme (follow-up issue if wanted).
- Converting other non-token greys (`AuthLayout.tsx`, `TextField.tsx`) to C+ tokens.
- A `theme-color` meta tag for mobile browser chrome.
- The Strapi admin (`cms/`), which has its own UI.
- Translating the placeholder/account copy (#28).
