# Plan: Build root layout with persistent header, navigation, catalog dropdown, profile and cart (#6)

Issue: https://github.com/savchukolgaa/jassmin/issues/6
Branch: `issue/6`
Worktree: `../jassmin-worktrees/issue-6`
Status: Planned

## Goal
Shoppers get the same header on every public page: the "Jassmin" brand on the left, and About us · Catalog ▾ · Kontakt · Profile · Cart on the right. The header is rendered by a `_shop` layout route whose `loader` provides `{ user, cartCount }`, so auth state and the cart badge are correct on the first server render. The issue also registers the app's full route skeleton in `app/routes.ts`, with placeholder pages where needed.

## Dependencies & prerequisites
- **#1 (scaffold)** and **#2 (theme, `Button`/`ButtonLink`)**: done and on `main`. The plan uses `bg-primary`/`text-primary` tokens from `app/app.css` and `cn` from `app/lib/cn.ts`.
- **#9 (auth)**: open. `app/.server/session.ts` already stores an optional `userId`, but there is no `users` table yet (#3 is open, and `app/.server/db/schema.ts` is empty). The header's `user` is **stubbed** from the session `userId` only, with no DB lookup.
- **#10 (cart)**: open. `cartCount` is **stubbed** as `0`. #10 replaces the stub with a real count, and the default loader revalidation then updates the badge after `fetcher` actions.
- **#14 (admin)**: open. `/admin/*` is registered **outside** the `_shop` layout, so #14 can give it its own layout.
- **#7 (home sections)**: open. #7 adds the anchors `id="about"` and `id="contacts"` on `/`. Until then, `/#about` and `/#contacts` just load `/`.
- No new packages, env vars or migrations. Icons are inline SVGs, so no icon library is needed.

## Decisions & assumptions
- **Layout route:** `layout("routes/_shop.tsx", [...])` in `app/routes.ts` wraps every public route. Its component renders `<Header />` and then `<Outlet />`. Pages keep rendering their own `<main>`, as `routes/home.tsx` already does.
- **Header data contract:** a new isomorphic DTO in `app/lib/header.ts`:
  ```ts
  export interface HeaderUser { id: number }
  export interface HeaderState { user: HeaderUser | null; cartCount: number }
  ```
  The server function `getHeaderState(request)` lives in `app/.server/services/header.ts`. #9 widens `HeaderUser` (for example with `fullName`) and swaps in `getUser(request)`. #10 swaps in the real cart count. The layout loader does not change.
- **Stubbed auth (unconfirmed until #9):** `user = session.get("userId") ? { id } : null`, read with `getSession(request.headers.get("Cookie"))`. The function does not query the DB, because no `users` table exists yet.
- **No flash on load:** auth and count come only from `loaderData`. There is no client-side state or `useEffect` for them.
- **Catalog dropdown uses `<details>`/`<summary>`.** It opens and closes with Enter and Space and is announced as expanded or collapsed natively, even without JS. JS adds the rest of the issue's behaviour: Escape closes it and returns focus to the `<summary>`, a `pointerdown` outside closes it, and it closes on navigation (`useLocation().key` effect). `aria-expanded` mirrors the open state on the `<summary>`, which a controlled `open` + `onToggle` drives. This meets "button with `aria-expanded`" and "usable without JS" with one implementation.
- **Links:** "About us" and "Kontakt" are hash links, so they use plain `<Link to="/#about">`, because `NavLink` active state doesn't apply to hashes. The catalog items, profile and cart use `<NavLink>` with a `text-primary` active style. The Catalog trigger also looks active when `useMatch("/catalog/*")` matches.
- **Profile:** the link goes to `/account` with `aria-label="My account"` when `user` is set, otherwise to `/login` with `aria-label="Log in"`.
- **Cart:** the link goes to `/cart` and shows a `bg-primary` badge with the count when `cartCount > 0` (`99+` when the count is over 99). Its `aria-label` is "Cart, N items".
- **Responsive design (breakpoint `md`):** below `md`, the brand sits on the left, and the profile, cart and a hamburger sit on the right. The hamburger is a second `<details>` that opens a stacked panel with About us, a "Catalog" group showing Men/Women inline, and Kontakt. It closes on navigation and on Escape. From `md` up, the full inline nav shows and the hamburger is hidden.
- **Labels:** the text follows the issue exactly ("About us", "Catalog", "Men Perfumes", "Women Perfumes", "Kontakt"), even though `<html lang="uk">`. Translation is out of scope.
- **Placeholders:** each route that has no page yet renders a shared `PagePlaceholder` with a title and "Coming soon". `catalog/:gender` throws a 404 for anything other than `men`/`women`, which keeps junk URLs out. #8 refines this.
- **Errors keep the header:** `_shop.tsx` exports an `ErrorBoundary`. It renders `<Header />` from `useRouteLoaderData("routes/_shop")`, falling back to the logged-out state with 0 items, plus the shared error content. Child errors such as the home page's CMS 503 or the catalog 404 then still show the header. The message logic moves out of `root.tsx` into `app/lib/route-error.ts`, and both boundaries reuse it. The root boundary still handles unmatched URLs and errors in the layout loader itself.

## Open questions
- [ ] **Q1: Should the header link to the Blog (`/blog`)?** Why it matters: the issue registers `/blog` but doesn't list it in the header order. Recommended default: no Blog link in this issue. #13 can add it after "Kontakt". Affects steps: 4.
- [ ] **Q2: On mobile, should profile and cart stay visible next to the hamburger?** Why it matters: it changes the mobile layout and tests. Recommended default: yes, keep both icons visible and put only About us, Catalog and Kontakt in the hamburger panel. Affects steps: 5.
- [ ] **Q3: Should the logged-out profile icon offer "Sign up" too (for example as a small menu)?** Why it matters: the issue's context says "User Profile (Login/Sign Up)". Recommended default: one icon that links to `/login`. The login page (#9) links to `/register`. Affects steps: 4.

## Resolved questions
- **Where do admin pages go?** Outside the shop layout, so #14 can use a different layout (source: #6 Technical, #14).
- **Which catalog genders are valid?** `men` and `women` for the catalog pages. `gender_type` also has `unisex` (#3), but the issue only defines men's and women's catalogs (source: #6, #3).
- **Where do the hash links point?** #7 places `id="about"` and `id="contacts"` sections on `/` (source: #7 Technical).
- **How does the cart badge update?** #10 uses `fetcher.Form` posting to `/cart`, and React Router revalidates the layout loader, so the `_shop` loader must not opt out of revalidation (source: #10 Technical).
- **How are tests written for components?** As `*.test.ts` using `createElement` and `renderToStaticMarkup` inside `MemoryRouter`. Vitest only includes `app/**/*.test.ts` (source: `app/components/ui/Button.test.ts`, `vitest.config.ts`).
- **How do tests import `.server` modules that read env?** Dynamically, inside the test, after setting the env (source: `app/.server/AGENTS.md` → Tests). `session.ts` calls `getEnv()` at import, so set the env with `vi.stubEnv` first.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/routes.ts` | Register `_shop` layout + all public routes; `admin/*` outside it |
| create | `app/routes/_shop.tsx` | Layout route: `loader` → `HeaderState`, `<Header/>` + `<Outlet/>`, `ErrorBoundary` with header |
| create | `app/lib/header.ts` | `HeaderUser`, `HeaderState` DTOs, `formatCartCount` helper |
| create | `app/lib/header.test.ts` | Tests for `formatCartCount` |
| create | `app/.server/services/header.ts` | `getHeaderState(request)` (stubbed user/cart) |
| create | `app/.server/services/header.test.ts` | Logged-out / logged-in session cases |
| delete | `app/.server/services/.gitkeep` | Folder now has real files |
| create | `app/components/layout/Header.tsx` | Header: brand, desktop nav, profile, cart, mobile menu |
| create | `app/components/layout/CatalogMenu.tsx` | `<details>` dropdown with Escape / outside-click / navigation close |
| create | `app/components/layout/MobileMenu.tsx` | Hamburger `<details>` panel |
| create | `app/components/layout/useDisclosure.ts` | Shared hook: controlled `open`, Escape, outside click, close on navigation |
| create | `app/components/layout/icons.tsx` | Inline SVG `UserIcon`, `CartIcon`, `MenuIcon`, `ChevronDownIcon` (`aria-hidden`) |
| create | `app/components/layout/Header.test.ts` | SSR markup tests (order, links, auth state, badge, details) |
| create | `app/components/layout/PagePlaceholder.tsx` | Shared "Coming soon" page body |
| create | `app/components/layout/ErrorContent.tsx` | Error message/stack markup shared by both boundaries |
| create | `app/lib/route-error.ts` | `describeRouteError(error)` → `{ message, details, stack? }` (moved from `root.tsx`) |
| create | `app/lib/route-error.test.ts` | 404 / 503 / generic cases |
| modify | `app/root.tsx` | Use `describeRouteError` + `ErrorContent` |
| create | `app/routes/catalog.tsx` | Placeholder `/catalog/:gender` (404 unless men/women) |
| create | `app/routes/product.tsx` | Placeholder `/products/:id` |
| create | `app/routes/blog.tsx` | Placeholder `/blog` |
| create | `app/routes/blog-post.tsx` | Placeholder `/blog/:slug` |
| create | `app/routes/login.tsx` | Placeholder `/login` |
| create | `app/routes/register.tsx` | Placeholder `/register` |
| create | `app/routes/cart.tsx` | Placeholder `/cart` |
| create | `app/routes/checkout.tsx` | Placeholder `/checkout` |
| create | `app/routes/account.tsx` | Placeholder `/account` |
| create | `app/routes/admin.tsx` | Placeholder `/admin/*` (no shop header; #14 adds auth + layout) |
| create | `app/routes.test.ts` | Asserts every required path is registered and admin is outside `_shop` |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [ ] **1. Set up the worktree.** In `../jassmin-worktrees/issue-6`, run `pnpm install` and copy `.env` from the main checkout. Check that `pnpm typecheck` passes on the untouched tree.
- [ ] **2. Add the route skeleton.** Create `PagePlaceholder({ title })`, which renders `<main className="container mx-auto p-4 pt-16">` with an `h1` and "Coming soon", and the placeholder route modules (each with `meta` and a default component typed via `./+types/<route>`). `catalog.tsx` gets a `loader` that returns `{ gender }` and throws `data(null, { status: 404 })` when `params.gender` is not `"men"`/`"women"`. Create a minimal `_shop.tsx` that renders only `<Outlet />`. Rewrite `app/routes.ts`:
  ```ts
  export default [
    layout("routes/_shop.tsx", [
      index("routes/home.tsx"),
      route("catalog/:gender", "routes/catalog.tsx"),
      route("products/:id", "routes/product.tsx"),
      route("blog", "routes/blog.tsx"),
      route("blog/:slug", "routes/blog-post.tsx"),
      route("login", "routes/login.tsx"),
      route("register", "routes/register.tsx"),
      route("cart", "routes/cart.tsx"),
      route("checkout", "routes/checkout.tsx"),
      route("account", "routes/account.tsx"),
    ]),
    route("admin/*", "routes/admin.tsx"),
  ] satisfies RouteConfig;
  ```
  Add `app/routes.test.ts`, which walks the config and asserts the paths, `admin/*` at the top level and the rest under the `_shop` layout. Run `pnpm typecheck` and open each URL in `pnpm dev`.
- [ ] **3. Add header data.** Create `app/lib/header.ts` with the DTOs and `formatCartCount(n)` (`""` for 0, `"99+"` for >99), plus its test. Create `app/.server/services/header.ts` with `getHeaderState(request: Request): Promise<HeaderState>`, which reads `userId` from `getSession(request.headers.get("Cookie"))` and returns `cartCount: 0`. Comment the stub with `// Stub until #9` / `#10`. Add `header.test.ts`, which uses `vi.stubEnv` for `DATABASE_URL`/`SESSION_SECRET`, dynamically imports `session.ts` and `header.ts`, and checks that no cookie gives `{ user: null, cartCount: 0 }` and a cookie from `commitSession` with `userId: 7` gives `user: { id: 7 }`. Delete `services/.gitkeep`. Wire the `_shop` `loader`: `return getHeaderState(request)`.
- [ ] **4. Add the desktop header.** Build `icons.tsx`, then `useDisclosure()`, which returns `{ open, setOpen, detailsRef, summaryRef, onToggle }` and handles the Escape keydown (close and focus the summary), document `pointerdown` outside `detailsRef` (close) and `useLocation().key` changes (close). Build `CatalogMenu`, a `<details>` with a `<summary aria-expanded={open}>` "Catalog" + chevron, a positioned `<ul>` of two `NavLink`s and a hidden native marker (`list-none [&::-webkit-details-marker]:hidden`). Build `Header({ user, cartCount })` as a `<header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur dark:bg-gray-950/90">` with brand `<Link to="/">Jassmin</Link>` on the left and `<nav aria-label="Main">` on the right, in the DOM order About us → Catalog → Kontakt → Profile → Cart. Give every interactive element visible `focus-visible:outline-primary` styles that match `button-styles.ts`. Render `<Header {...loaderData} />` in `_shop.tsx`.
- [ ] **5. Add the mobile menu.** Build `MobileMenu`, which reuses `useDisclosure`. Its `<summary aria-label="Menu">` shows a hamburger icon, and the panel is full-width below the header bar with About us, a Catalog group (Men Perfumes, Women Perfumes) and Kontakt. In `Header`, show the inline links with `hidden md:flex` and the `MobileMenu` with `md:hidden`, and keep profile and cart visible at all sizes (Q2 default). Check at 375px in browser devtools that nothing overflows horizontally and that tap targets are at least 44px.
- [ ] **6. Keep the header on errors.** Move the message logic from `root.tsx` to `describeRouteError(error)` in `app/lib/route-error.ts`, with tests for 404, 503 and generic errors. Move the markup to `ErrorContent`. `root.tsx` uses both, with no behaviour change. In `_shop.tsx`, add an `ErrorBoundary` that renders `<Header {...(useRouteLoaderData<typeof loader>("routes/_shop") ?? { user: null, cartCount: 0 })} />` and `<ErrorContent />`. Check `/catalog/foo` (404) and `/` with Strapi stopped (503): both show the header.
- [ ] **7. Add Header tests.** Write `Header.test.ts`, which renders `Header` in `MemoryRouter` with `renderToStaticMarkup`. The tests check that:
  - the brand links to `/`;
  - the `indexOf` order of "About us", "Catalog", "Kontakt", the profile link and the cart link is ascending;
  - the hrefs are `/#about`, `/catalog/men`, `/catalog/women`, `/#contacts` and `/cart`;
  - logged out gives `href="/login"` and `aria-label="Log in"`, and logged in gives `href="/account"`;
  - the badge is absent at 0, shows `3` and shows `99+`;
  - the catalog uses `<details>`/`<summary` with `aria-expanded="false"`.
- [ ] **8. Verify and commit.** Run `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`. Do the manual checks below. Commit in logical chunks (routes, header data, header UI, error boundary), staging paths explicitly.

## Testing & verification
- **Unit:** `app/routes.test.ts`, `app/lib/header.test.ts`, `app/lib/route-error.test.ts`, `app/.server/services/header.test.ts` and `app/components/layout/Header.test.ts`.
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **Manual checks (`pnpm aspire run` or `pnpm dev`):**
  - View the source of `/`, `/catalog/men` and `/cart`: the header markup is in the HTML.
  - Disable JS: the catalog dropdown and hamburger still open, and the links work.
  - Keyboard: Tab to Catalog, Enter opens it, Tab reaches Men/Women, and Escape closes it and returns focus. Clicking outside closes it, and so does navigating.
  - Set `userId` in the session temporarily, or with a dev-only cookie from a test: the profile link goes to `/account` on first paint, with no flicker.
  - At 375px (devtools): the brand, profile, cart and hamburger fit, and the panel opens and closes.
  - `/admin`: there is no shop header.

## Acceptance criteria
- [ ] Header renders server-side on all public pages with items in the specified order — steps 2, 3, 4, 6, 7
- [ ] Catalog dropdown links to men's and women's catalogs and works with the keyboard — steps 4, 7
- [ ] Profile icon routes to login or account depending on auth state, without a flash on load — steps 3, 4, 7
- [ ] Mobile layout works at 375px width — step 5

## Out of scope
- Real authentication and user lookup (#9) and a real cart count (#10). Both are stubbed behind `getHeaderState`.
- Page content for the placeholder routes (#7, #8, #11, #12, #13) and admin auth and layout (#14).
- The `id="about"`/`id="contacts"` sections on the home page (#7).
- A Blog link in the header (Q1), translations, search and a footer.
