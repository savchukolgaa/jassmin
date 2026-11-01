# Plan: Keep the scroll position when switching the language (#82)

Issue: https://github.com/savchukolgaa/jassmin/issues/82
Branch: `issue/82`
Worktree: `.claude/worktrees/issue-82`
Status: Planned

## Goal

When customers switch between Ukrainian and English with the header flags, the page should stay
where it is and only the text should change. Today the `/locale` action's redirect back to the same
page is handled like any other navigation, so `<ScrollRestoration />` scrolls to the top. The
redirect also drops the URL hash. The fix: turn off scroll reset on the switcher's form and keep the
hash in `redirectTo`.

## Dependencies & prerequisites

- #28 (language switcher, `/locale` action) is merged on `origin/main`:
  `app/components/layout/LocaleSwitcher.tsx` and `app/routes/locale.ts`.
- No new packages, env vars or migrations. `jsdom`, `@testing-library/react` and
  `@testing-library/user-event` are already dev dependencies (used by
  `app/features/catalog/ProductCard.dom.test.ts`).

## Decisions & assumptions

- **`preventScrollReset` on the `<Form>`.** React Router keeps the flag from a form submission when
  it follows the action's redirect, so `<ScrollRestoration />` leaves the window where it is. This
  uses the framework's own behaviour, so we don't need custom scroll-saving code in `root.tsx` or a
  `getKey` override.
- **Hash in `redirectTo`.** Use `pathname + search + hash` from `useLocation()`. With JS the redirect
  `Location` keeps the fragment. Without JS, browsers also keep a fragment in a 302 `Location`, so the
  no-JS fallback comes back to the anchor as well.
- **Hash plus `preventScrollReset`.** With JS, when the redirect target has a hash React Router's
  `<ScrollRestoration />` would normally scroll to that element. With `preventScrollReset` it skips
  the scroll entirely, which is what we want: stay where the user is, not jump back to the anchor
  they originally opened. The step 4 manual check covers this.
- **No change to `safeRedirect`.** It already passes same-site paths with a fragment through
  unchanged, and `app/lib/auth.test.ts` already covers `"/products/1?x=1#y"`. The plan adds one
  explicit case for a root path with a hash (`"/#location-title"`), which is the issue's example.
- **One component covers every placement.** `Header.tsx` (desktop, `hidden lg:flex`) and
  `MobileMenu.tsx` both render `LocaleSwitcher`. The footer doesn't render a switcher. Changing the
  component fixes both.
- **Test style.** `preventScrollReset` isn't rendered as an HTML attribute, so static-markup tests
  can't see it. Add a jsdom test (`LocaleSwitcher.dom.test.ts`, with the same setup as
  `ProductCard.dom.test.ts`) that clicks a flag on a memory router and checks the posted
  `redirectTo` and `router.state.preventScrollReset` after the redirect. Tests stay `*.test.ts`
  (`vitest.config.ts` only includes `.ts`) and use `createElement`, not JSX.

## Resolved questions

- **Does `safeRedirect` keep a `#fragment`?** Yes. It only rejects values that don't start with `/`,
  values that start with `//`, and values that contain `\`. Everything else is returned as-is. The
  test `"/products/1?x=1#y"` already passes (source: `app/lib/auth.ts`, `app/lib/auth.test.ts:94`).
- **Where is the switcher rendered?** `Header.tsx:79` and `MobileMenu.tsx:80`, both using
  `LocaleSwitcher` (source: `grep LocaleSwitcher app`).
- **Is there a `/#location` anchor?** No. The home page's location section only has
  `id="location-title"` on its heading (`app/features/home/LocationSection.tsx:23`). The issue uses
  `/#location` only as an example. Use `/#location-title` for manual checks. Adding a `location`
  id is out of scope.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/components/layout/LocaleSwitcher.tsx` | Add `preventScrollReset` and include `hash` in `redirectTo`; update the doc comment |
| create | `app/components/layout/LocaleSwitcher.dom.test.ts` | jsdom test: posted `redirectTo` includes the hash, and the redirect keeps `preventScrollReset` |
| modify | `app/lib/auth.test.ts` | Add `"/#location-title"` to the allowed `safeRedirect` paths |
| modify | `app/routes/locale.ts` | Comment only: mention that the redirect keeps the scroll position (optional) |

## Steps

- [ ] **1. Keep the hash in `redirectTo`.** In `LocaleSwitcher`, destructure `hash` from
  `useLocation()` and set the hidden input to `pathname + search + hash`. Check in the dev app that
  `/?x=1#location-title` posts that value.
- [ ] **2. Turn off scroll reset.** Add `preventScrollReset` to `<Form method="post" action="/locale">`.
  Update the component's doc comment to say that with JS the page keeps its scroll position and
  without JS it's a plain form post that returns to the same URL, hash included.
- [ ] **3. Tests.**
  - `app/lib/auth.test.ts`: add `"/#location-title"` to the `it.each` list of allowed paths.
  - `app/components/layout/LocaleSwitcher.dom.test.ts` (`// @vitest-environment jsdom`): build a
    `createMemoryRouter` with `{ path: "/", element: LocaleSwitcher }` and a `/locale` route whose
    action records the `FormData` and returns `redirect(formData.get("redirectTo"))`. Start at
    `initialEntries: ["/?page=2#location-title"]` and wrap the router in `I18nProvider`. Click the
    "English" button with `userEvent`, then `waitFor`:
    - the posted `redirectTo` is `/?page=2#location-title` and `locale` is `en`;
    - after the redirect, `router.state.location` has pathname `/`, search `?page=2` and hash
      `#location-title`, and `router.state.preventScrollReset` is `true`;
    - control case: `router.navigate("/other")` leaves `preventScrollReset` `false`, so ordinary
      navigation still scrolls to the top.
    - Call `cleanup()` in `afterEach`, as in `ProductCard.dom.test.ts`.
  - `Header.test.ts` keeps passing unchanged, because the rendered markup is the same apart from
    the hidden input's value.
- [ ] **4. Manual check** (`pnpm aspire run`):
  - On the home page, scroll to the location section and switch to EN. The page stays at the same
    spot, now in English. Repeat on a catalog page (e.g. `/women`) and on a blog post, in the
    desktop header and in the mobile menu.
  - Open `/#location-title`, scroll a little, and switch. The URL still ends with `#location-title`.
  - Click a header link. The new page starts at the top.
  - Turn off JS in devtools and switch. The cookie is set, you're back on the same URL with the
    hash, and the page is in the new language.
- [ ] **5. Checks.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Testing & verification

- New: `LocaleSwitcher.dom.test.ts` (hash posted, scroll reset off after the redirect, normal
  navigation unaffected), plus one `safeRedirect` case in `auth.test.ts`.
- Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` in the worktree.
- Do the manual checks from step 4 with and without JS, on desktop and on mobile widths.

## Acceptance criteria

- [ ] Switching the language halfway down a page (e.g. the home page's location section, a catalog
  page, a blog post) keeps the page at the same scroll position and shows it in the new language.
  Steps 2, 3, 4
- [ ] Switching on a URL with a hash (e.g. `/#location`) comes back to the same URL including the
  hash. Steps 1, 3, 4
- [ ] Ordinary link navigation still scrolls to the top as before. Steps 3 (control case), 4
- [ ] The switcher still works without JS (form post, cookie set, back on the same page). Step 4
  (the markup is still a plain `<form method="post">`)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass. Step 5

## Out of scope

- Keeping the scroll position without JS: a full page load starts at the top.
- How the mobile menu behaves after switching (whether it stays open or closes).
- Compensating for layout shifts when the two languages have different text lengths.
- Adding a `location` anchor id to the home page.
