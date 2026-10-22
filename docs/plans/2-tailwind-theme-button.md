# Plan: Configure Tailwind theme with brand color and primary Button component (#2)

Issue: https://github.com/savchukolgaa/jassmin/issues/2
Branch: `issue/2`
Worktree: `../jassmin-worktrees/issue-2`
Status: Planned

## Goal
As a developer, I want Tailwind configured with Jassmin's brand color and button shadow styles so every
page uses the same design system without repeating values. Concretely: register `#FF5C77` as the
`primary` theme color (plus light/dark shades and a brand-tinted button shadow) in `app/app.css`, and
build a reusable, fully typed `Button` (and `ButtonLink`) in `app/components/ui/` that the hero CTA (#7)
and all forms will use.

## Dependencies & prerequisites
- **#1 (scaffold)** — closed and merged (`8db031c`). Provides Tailwind v4 via `@tailwindcss/vite`
  (`vite.config.ts`), `app/app.css` with an existing `@theme` block, `app/components/` (empty, `.gitkeep`)
  and Vitest.
- No new packages, env vars or migrations. `react-dom/server` (already a dependency via `react-dom`) is
  used in tests for `renderToStaticMarkup`.

## Decisions & assumptions
- **Tailwind v4 CSS-first config.** Tokens go into the existing `@theme` block in `app/app.css`; no
  `tailwind.config.ts`. Defining `--color-primary` automatically generates `bg-primary`, `text-primary`,
  `border-primary`, `outline-primary`, `ring-primary`, etc.
- **Shades:** `--color-primary-light: #FF8FA1` (hover/tint backgrounds), `--color-primary-dark: #E0405C`
  (hover/pressed state for the primary variant). Hand-picked tints of `#FF5C77`, confirmed by the user.
- **Contrast:** white text on `#FF5C77` is ~3.0:1 (below WCAG AA 4.5:1 for normal text). Confirmed with
  the user: keep the brand colour as the primary background as the issue specifies, and improve legibility
  with `font-semibold` and `text-base` on `md`/`lg`. Reaching AA is a possible follow-up.
- **Brand-tinted shadows:** `--shadow-button` and `--shadow-button-hover` (pink-tinted `rgb(255 92 119 / …)`)
  are added as optional tokens, but the primary variant uses the stock `shadow-md` / `hover:shadow-lg`
  utilities literally, because the acceptance criteria name them. A tinted colour is applied with
  `shadow-primary/25` (Tailwind v4 shadow-color utility) so shadows stay "elegant" and on-brand while the
  size utilities remain `shadow-md`/`shadow-lg`.
- **No class-merging dependency** (no `clsx` / `tailwind-merge`). A tiny `cn(...classes)` helper that
  joins truthy strings lives in `app/lib/cn.ts` (isomorphic). Consumer `className` is appended last.
- **Shared style function.** `buttonClasses({ variant, size, className })` lives in
  `app/components/ui/button-styles.ts` and is used by both `Button` and `ButtonLink`, so the two never
  drift. It is a pure function, which makes it trivial to unit-test.
- **Props / typing:**
  ```ts
  type ButtonVariant = "primary" | "secondary" | "ghost";
  type ButtonSize = "sm" | "md" | "lg";
  type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean };
  type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };
  ```
  Defaults: `variant="primary"`, `size="md"`. React 19 passes `ref` as a normal prop, so no `forwardRef`.
- **Variants:**
  - primary: `bg-primary text-white shadow-md shadow-primary/25 hover:bg-primary-dark hover:shadow-lg`
  - secondary: `border border-primary bg-white text-primary hover:bg-primary-light/15`, dark-mode
    `dark:bg-gray-950`
  - ghost: `text-primary hover:bg-primary-light/15`
  - shared base: `inline-flex items-center justify-center gap-2 rounded-lg font-semibold
    transition-[box-shadow,background-color,color] duration-200`
- **Focus styles:** `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`
  on every variant (keyboard-only ring, no ring on mouse click).
- **Disabled / loading:** `disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none`
  (and no hover shadow while disabled). `loading` renders an inline SVG spinner (`animate-spin`,
  `aria-hidden`), sets `disabled`, and `aria-busy="true"`; the label stays visible so the button width
  doesn't jump. The component does **not** read `useNavigation()` itself — callers pass
  `loading={navigation.state === "submitting"}` or `fetcher.state !== "idle"`, which keeps `Button`
  usable outside a router.
- **Forms:** `type` is passed through untouched, so the native default (`submit`) applies and the button
  works inside `<Form>` / `fetcher.Form`, including `name`/`value` for intent buttons.
- **ButtonLink** wraps React Router `<Link>` (no `disabled`/`loading`; links can't be disabled
  semantically).
- **File naming:** the issue asks for `app/components/ui/Button.tsx`; PascalCase is kept for component
  files, kebab/lowercase for non-component modules, matching the issue and React convention.

## Resolved questions
- **Exact hex values for `primary-light` / `primary-dark`?** — `#FF8FA1` / `#E0405C` (source: user,
  2026-10-22).
- **White text on `#FF5C77` is ~3.0:1, below WCAG AA — change it?** — No: keep the brand background,
  use `font-semibold` and `text-base` on `md`/`lg`; AA can be a follow-up (source: user, 2026-10-22).
- **Pill or soft-rounded buttons?** — Soft-rounded, `rounded-lg` (source: user, 2026-10-22).
- **Tailwind v3 or v4?** — v4 with `@tailwindcss/vite`; theme lives in `app/app.css` `@theme`
  (source: `package.json`, `vite.config.ts`, `app/app.css`).
- **Where do shared UI components go?** — `app/components/` (source: `AGENTS.md` → Architecture rules).
- **Where do isomorphic helpers go?** — `app/lib/` (source: `AGENTS.md`), hence `app/lib/cn.ts`.
- **Can tests render React?** — Vitest runs in the `node` environment and only includes
  `app/**/*.test.ts` (source: `vitest.config.ts`). So tests are `.ts` files using `createElement` +
  `renderToStaticMarkup` from `react-dom/server`; no jsdom or Testing Library is needed.
- **Dark mode?** — The app already styles `dark:` via `prefers-color-scheme` (source: `app/app.css`),
  so secondary/ghost variants get `dark:` counterparts.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/app.css` | Add `--color-primary`, `-light`, `-dark`, `--shadow-button`, `--shadow-button-hover` to `@theme` |
| create | `app/lib/cn.ts` | `cn(...classes)` — join truthy class strings |
| create | `app/lib/cn.test.ts` | Unit tests for `cn` |
| create | `app/components/ui/button-styles.ts` | `ButtonVariant`, `ButtonSize` types and `buttonClasses()` |
| create | `app/components/ui/button-styles.test.ts` | Variant/size/className class assertions |
| create | `app/components/ui/Button.tsx` | `Button` component (variants, sizes, loading, disabled) |
| create | `app/components/ui/ButtonLink.tsx` | `ButtonLink` wrapping `<Link>` |
| create | `app/components/ui/Button.test.ts` | SSR render tests for `Button` and `ButtonLink` |
| delete | `app/components/.gitkeep` | Folder now has real files |

## Steps
- [x] **1. Theme tokens** — In `app/app.css`, extend the existing `@theme` block:
  ```css
  --color-primary: #ff5c77;
  --color-primary-light: #ff8fa1;
  --color-primary-dark: #e0405c;
  --shadow-button: 0 4px 6px -1px rgb(255 92 119 / 0.25), 0 2px 4px -2px rgb(255 92 119 / 0.25);
  --shadow-button-hover: 0 10px 15px -3px rgb(255 92 119 / 0.3), 0 4px 6px -4px rgb(255 92 119 / 0.3);
  ```
  Check: `pnpm build`, then grep `build/client/assets/*.css` for `--color-primary:#ff5c77` and confirm
  `bg-primary` / `text-primary` / `border-primary` are emitted once used (step 5 uses them).
- [ ] **2. `cn` helper** — `app/lib/cn.ts`:
  `export function cn(...classes: Array<string | false | null | undefined>): string` returning
  `classes.filter(Boolean).join(" ")`. Add `cn.test.ts` (joins, skips falsy values, empty → `""`).
- [ ] **3. `buttonClasses`** — `app/components/ui/button-styles.ts` exports `ButtonVariant`,
  `ButtonSize`, `ButtonStyleOptions` and `buttonClasses({ variant = "primary", size = "md", className })`
  built from `base`, `variants: Record<ButtonVariant, string>` and `sizes: Record<ButtonSize, string>`
  (`sm: "h-9 px-4 text-sm"`, `md: "h-11 px-6 text-base"`, `lg: "h-13 px-8 text-lg"`), using the classes
  listed in *Decisions*. Add `button-styles.test.ts`: primary contains `bg-primary`, `text-white`,
  `shadow-md`, `hover:shadow-lg`, a `transition` class; every variant contains the `focus-visible:outline`
  classes and `disabled:` classes; sizes map correctly; custom `className` is appended last.
- [ ] **4. `Button`** — `app/components/ui/Button.tsx`:
  ```tsx
  export type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean };
  export function Button({ variant, size, loading = false, disabled, className, children, ...props }: ButtonProps)
  ```
  Renders `<button {...props} disabled={disabled || loading} aria-busy={loading || undefined}
  className={buttonClasses(...)}>` with a `Spinner` (local inline SVG, `aria-hidden="true"`,
  `size-4 animate-spin`) before `children` when loading. Export types with `export type`.
- [ ] **5. `ButtonLink`** — `app/components/ui/ButtonLink.tsx`:
  `export type ButtonLinkProps = ComponentProps<typeof Link> & { variant?; size? }`, rendering
  `<Link {...props} className={buttonClasses(...)} />`. Restrict `className` to `string` (Link also accepts
  a function form): `Omit<ComponentProps<typeof Link>, "className"> & { className?: string }`.
- [ ] **6. Render tests** — `app/components/ui/Button.test.ts` using `createElement` +
  `renderToStaticMarkup`:
  - default renders `<button` with `bg-primary`, `shadow-md`, `hover:shadow-lg`, no `type` attribute
    (native submit inside forms); `type="button"`, `name`/`value` pass through;
  - `disabled` → `disabled=""`; `loading` → `disabled=""`, `aria-busy="true"`, spinner `<svg` with
    `aria-hidden="true"`, label still rendered;
  - `variant="secondary"` / `"ghost"` produce their classes;
  - `ButtonLink` inside `createElement(MemoryRouter, …)` renders `<a href="/catalog"` with button classes.
- [ ] **7. Clean up & verify** — delete `app/components/.gitkeep`; run `pnpm format`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, `pnpm build`. Commit only the listed paths.

## Testing & verification
- Unit: `app/lib/cn.test.ts`, `app/components/ui/button-styles.test.ts`, `app/components/ui/Button.test.ts`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (local only, not committed): temporarily render the three variants, a `loading` and a
  `disabled` button and a `ButtonLink` on `app/routes/home.tsx` under `pnpm aspire run` / `pnpm dev`.
  Check in DevTools that `bg-primary` computes to `rgb(255, 92, 119)`, shadow grows on hover, Tab shows
  a pink focus outline (but a mouse click doesn't), a disabled/loading button doesn't respond, a
  submit `Button` inside a `<Form>` submits, and dark mode looks right. Revert the home page afterwards.

## Acceptance criteria
- [ ] `bg-primary`, `text-primary`, `border-primary` resolve to `#FF5C77` — step 1 (verified in steps 1, 7)
- [ ] Primary `Button` shows `shadow-md` by default and `shadow-lg` on hover — steps 3, 4 (tests 3, 6)
- [ ] Button is fully typed (no `any`) and supports disabled/loading states — steps 3, 4, 5 (tests 6)
- [ ] Button has visible focus styles for keyboard users — step 3 (`focus-visible:outline-*`), tests 3

## Out of scope
- The hero "Order Now" CTA and any page using the button (#7) and form pages.
- Other UI primitives (inputs, cards), typography/font changes, a full dark-mode palette.
- An icon library; the spinner is a single inline SVG.
- Visual regression / browser-based tests (no jsdom or Playwright in the project yet).
