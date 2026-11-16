# Plan: Add "Ask the perfumer" entry points on catalog and product pages (#165)

Issue: https://github.com/savchukolgaa/jassmin/issues/165
Branch: `issue/165`
Worktree: `.claude/worktrees/issue-165`
Status: In progress

## Goal

A customer browsing the shop should reach the AI perfumer (#163) without looking for it in the
menu. Add three entry points: a floating "Запитати AI парфумера" corner button on the shop's pages,
a banner and an empty-results button on the catalog pages that open the chat with the active filters
as a message, and a "Знайти схожі з AI парфумером" link on product pages that asks for similar
perfumes. The prefilled message (`?q=`) is sent once, then removed from the URL. None of them show
when the engine is off.

## Dependencies & prerequisites

- #163 (chat page) and #162 (engine, `similar_to` tool) are merged on `main` (`1de78cd`,
  `29dc62f`). The `_shop` loader already returns `perfumerEnabled` (`isPerfumerEnabled()`), and
  `PerfumerPage` / `usePerfumerThread` already have `send(text)`.
- The corner button's design (C+ canvas, artboards `PerfumerCornerPlus.dc.html` and
  `PerfumerCornerPlusPhone.dc.html`) was **approved by the owner** on 2026-11-16 (Q1).
- No new packages, env vars or migrations. `axe-core`, jsdom and Testing Library are already dev
  dependencies (used by `app/features/perfumer/PerfumerPage.dom.test.ts`).

## Decisions & assumptions

- **The corner button is a `<Link>`, not a widget** (issue). It works without JS and keeps one chat
  UI.
- **Look, from the canvas** (`PerfumerCornerPlus*.dc.html`), translated to tokens:
  - `sm` and up: `fixed right-6 bottom-6`, `min-h-14` pill, `bg-primary` → hover `bg-primary-dark`
    and `scale-1.03` (as `buttonClasses`), padding `pr-5.5 pl-2`, gap 10px, 16px weight-800 white
    label, brand shadow; a 40px white circle with the `primary` `BottleIcon` (with `sparkle`, already
    in `app/features/perfumer/icons.tsx`) on the left.
  - below `sm`: a 60px circle (`size-15`), `right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))]`,
    the icon white on pink with no circle, the label `sr-only` (so the link's name stays the label;
    no `aria-label` needed at all, since the text is always in the DOM).
  - `z-30`: above page content, below the sticky header (`z-40`, so the open mobile menu covers it)
    and the cookie banner (`z-50`).
  - Pop-in: `animate-pop` with a 0.6s delay (a new `anim-delay` value or an arbitrary
    `[animation-delay:600ms]`); the global reduced-motion block in `app/app.css` already turns it
    off. `focusRing("onLight")`.
  - The `bottom` change is a `transition-[bottom]` (also off under reduced motion).
- **Bottom UI offsets via CSS variables on `<html>`**, set by the components that own the bottom UI,
  so the corner button needs no shared React state:
  - `CookieBanner` measures its own `<section>` with a `ResizeObserver` and sets
    `--bottom-ui-banner: <height>px` on `document.documentElement`, removing it on unmount (which
    also covers the "answer in flight" early return, since the section unmounts).
  - The corner button's `bottom` is
    `calc(<base> + max(var(--bottom-ui-banner, 0px), var(--bottom-ui-toast, 0px)))`, written as a
    small CSS rule in `app/app.css` (`.perfumer-corner`) rather than an unreadable arbitrary class.
  - **Without JS** the variable is never set. The layout knows `consent === null` on the server, so
    it passes `cookieBanner` to the button, which then gets a static fallback class
    (`bottom-[15rem] sm:bottom-[8.5rem]`, the canvas's 244px / 132px rounded to the real banner)
    until the measured variable takes over.
- **The "Added to cart" toast** (Q2, confirmed): the app has no fixed toast; `AddToCartForm` shows an
  inline `role="status"` pill below its button (floating `absolute top-full right-0` for the
  compact cards' round "+"), which can sit right under the phone's corner button. On
  phones the button rises by 80px (`--bottom-ui-toast: 5rem`, the canvas's 96px − 16px) for 2.6s
  after any add-to-cart fetcher (`useFetchers()`, key prefix `add-to-cart-`) turns idle with
  `data.ok === true`. The corner button owns that state, so it sets a `data-raised` attribute on
  itself rather than a variable on `<html>` (deviation: nothing else needs it); the pill itself is
  unchanged. `ADD_TO_CART_FETCHER_PREFIX` is exported from `AddToCartForm.tsx` so the key has one
  source.
- **Hidden pages:** `perfumer`, `cart`, `checkout`, `checkoutSuccess`, `checkoutPay`,
  `giftCardSuccess`, matched with `pageOf(useLocation().pathname)` against a
  `PERFUMER_CORNER_HIDDEN_PAGES` set in `app/lib/perfumer.ts` (isomorphic, unit-testable). Also
  hidden by the `_shop` `ErrorBoundary` (it doesn't render the button at all).
- **Open mobile menu:** pure CSS, works without JS: the `<details>` in `MobileMenu.tsx` gets
  `data-mobile-menu`, and the button `[body:has(details[data-mobile-menu][open])_&]:hidden`.
- **Tab order:** rendered in `_shop.tsx` after `<Footer>` and before `<CookieBanner>`, so it's the
  last link of the page (the banner, when open, stays after it as before).
- **Prefill contract** (`?q=`):
  - `app/lib/perfumer.ts`: `PERFUMER_PREFILL_PARAM = "q"` and `perfumerPrefillSearch(message)`
    (search params), passed as `path("perfumer", {}, { search })`. (Deviation from
    `perfumerHref(path, message)`: plain search params need no path-builder type in `app/lib`.)
  - `app/lib/perfumer.schema.ts`: `parsePerfumerPrefill(searchParams)` with zod:
    `z.string().trim().min(1).max(PERFUMER_MAX_INPUT_LENGTH)`, `.catch(null)`. A too long or empty
    `q` is dropped silently (a hand-edited URL), never an error page.
  - `routes/perfumer.tsx` `loader` returns `{ prefill }`. Its `shouldRevalidate` doesn't need to
    change: removing `q` re-runs the loader, which then returns `null`.
  - `PerfumerPage` takes `prefill: string | null`. Once the thread is restored from
    `sessionStorage` (a new `restored` flag from `usePerfumerThread`), an effect guarded by a ref
    calls `thread.send(prefill)` and then `navigate({ pathname, search: "" }, { replace: true,
    preventScrollReset: true })`. Replacing the history entry means reload and Back never resend
    it. If the thread already has messages, the prefill joins it as the next message (same as
    typing it). If a reply is pending (it can't be after a full navigation) it's dropped.
  - SEO: `seoMeta` already drops every query param not in `keepParams`, so the canonical stays
    `/parfumer` (add a test). Crawlers that run JS must not send messages: entry links get
    `rel="nofollow"`, and `robotsDisallowPaths()` gains `/parfumer?q=` and `/en/perfumer?q=` (from
    `PAGES.perfumer`, via `pathFor`, so they follow the path table).
- **Catalog message from the filters** (`catalogPerfumerMessage(gender, search, translator)` in
  `app/lib/catalog.ts`, pure and unit-tested): the gender's noun plus the active family label
  (`fragranceFamilyLabel`) and brand, joined by the translator, e.g.
  uk "Допоможіть обрати жіночий аромат: цитрусові, бренд Lancôme",
  en "Help me choose a women's perfume: citrus, by Lancôme". Without filters it's just the first
  part. Sort and page are ignored. The catalog has **no price filter** (`CatalogSearch` has only
  `fragranceFamily`, `brand`, `sort`, `page`), so the issue's "до 500 ₴" example doesn't apply.
- **Catalog banner** (not drawn, by decision Q3; follows the chat page's C+ look; on every catalog page, Q4): between the filters and the
  results, a `rounded-card-lg bg-blush` row with the white-circle bottle icon, the bold line
  "Не знаєте, що обрати? Запитайте AI парфумера" and a `ButtonLink size="sm"`
  "Запитати AI парфумера". In the empty state (`products.length === 0`), the existing blush box gets
  a `ButtonLink` "Запитати AI парфумера" next to "Show all", and the banner is not shown (one entry
  point per state). Both carry the filters message. New component
  `app/features/perfumer/PerfumerCatalogBanner.tsx` (+ `PerfumerEntryLink` for the shared
  link-with-prefill).
- **Product link:** in `routes/product.tsx`, after `ProductPurchase` / `ProductUnavailable` (so it
  helps on archived products too), a ghost-style link with the bottle icon
  "Знайти схожі з AI парфумером" → `q = t("perfumer.entry.similarMessage", { title, brand })`
  (uk "Схоже на {title} від {brand}", en "Something like {title} by {brand}"). `similar_to` (#162)
  resolves the name.
- **Enabled flag:** every entry point reads `perfumerEnabled` from
  `useRouteLoaderData<typeof shopLoader>("routes/_shop")` (as `PerfumerPage` already does for
  `consent`), so the catalog and product loaders don't change.
- **Analytics:** none in this issue; measuring entry-point use is #166.

## Resolved questions

- **Q1: Is the corner button design approved?** — Yes, as drawn: the owner approved the
  `PerfumerCornerPlus.dc.html` and `PerfumerCornerPlusPhone.dc.html` artboards on the C+ canvas
  (2026-11-16, canvas version `1794858052-f4a7`, artboards unchanged since planning).
- **Q2: How should the button avoid the "Added to cart" status?** — Keep the app's inline pill; on
  phones the button rises by 80px for 2.6s after a successful add (option (a)) (owner,
  2026-11-16).
- **Q3: Draw the catalog banner and product link on the canvas first?** — No: build them from the
  existing C+ tokens and show screenshots in the PR (owner, 2026-11-16).
- **Q4: Catalog banner on every page or only page 1?** — Every catalog page (owner, 2026-11-16).
- **Where does `perfumerEnabled` come from?** — The `_shop` loader already returns it
  (`app/routes/_shop.tsx`, #163); entry points read it with `useRouteLoaderData("routes/_shop")`,
  like `PerfumerPage` reads `consent`.
- **How are hidden pages matched?** — `pageOf(path)` in `app/lib/paths.ts` returns the `Page` name
  for both languages; the hidden list uses the `PAGES` keys named in the issue.
- **Is the canonical URL already free of `q`?** — Yes: `canonicalUrl` keeps only `keepParams`
  (`app/lib/seo.ts`), and `perfumer.tsx` passes none. Only a test is needed.
- **Which catalog filters exist?** — Gender (the path), `fragrance_family`, `brand`, `sort`, `page`
  (`app/lib/catalog.ts`, `app/lib/catalog.schema.ts`). No price filter.
- **Max prefill length?** — `PERFUMER_MAX_INPUT_LENGTH` = 500, the same as typed messages
  (`app/lib/perfumer.ts`); the action validates it again anyway (`perfumerRequestSchema`).
- **Can zod parse `q` in the route?** — Yes, schemas live in `*.schema.ts` and are imported only
  by loaders/actions (AGENTS.md, `app/lib/client-bundle.guard.test.ts`).
- **Does the thread survive the prefill send?** — The thread is in `sessionStorage`
  (`thread-storage.ts`) and restored in an effect, so the prefill must wait for `restored`, else
  `saveThread` would overwrite the stored thread with just the prefill.
- **Z-order** — header `z-40` (`Header.tsx`), cookie banner `z-50` (`CookieBanner.tsx`), so the
  button at `z-30` sits under both.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/perfumer.ts` | `PERFUMER_PREFILL_PARAM`, `PERFUMER_CORNER_HIDDEN_PAGES`, `showPerfumerCorner(page)`, `perfumerHref` |
| modify | `app/lib/perfumer.schema.ts` | `parsePerfumerPrefill` |
| modify | `app/lib/catalog.ts` | `catalogPerfumerMessage` |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `perfumer.entry.*` copy |
| create | `app/features/perfumer/PerfumerCornerButton.tsx` | the floating corner link |
| create | `app/features/perfumer/PerfumerEntryLink.tsx` | link to the chat with a prefilled message (`rel="nofollow"`) |
| create | `app/features/perfumer/PerfumerCatalogBanner.tsx` | the catalog banner |
| modify | `app/features/perfumer/usePerfumerThread.ts` | expose `restored` |
| modify | `app/features/perfumer/PerfumerPage.tsx` | send the prefill once, then drop `q` |
| modify | `app/routes/perfumer.tsx` | loader returns `{ prefill }` |
| modify | `app/routes/_shop.tsx` | render the corner button |
| modify | `app/features/consent/CookieBanner.tsx` | set `--bottom-ui-banner` |
| modify | `app/components/layout/MobileMenu.tsx` | `data-mobile-menu` on the `<details>` |
| modify | `app/app.css` | `.perfumer-corner` bottom rule |
| modify | `app/routes/catalog.tsx` | banner + empty-state button |
| modify | `app/routes/product.tsx` | "find similar" link |
| modify | `app/.server/seo/robots.ts` | disallow `?q=` chat URLs |
| modify | `docs/design.md` | corner button rules; motion table row |
| create | `app/features/perfumer/PerfumerCornerButton.dom.test.ts` | visibility, offsets, axe |
| create | `app/features/perfumer/PerfumerEntryPoints.dom.test.ts` | catalog banner, empty state, product link, disabled |
| modify | `app/features/perfumer/PerfumerPage.dom.test.ts` | prefill sent once, URL cleaned |
| modify | `app/lib/perfumer-*.test.ts` / new `app/lib/perfumer.test.ts` | hidden pages, `perfumerHref` |
| modify | `app/lib/catalog.test.ts` (or create) | filters-to-message |
| modify | `app/routes/perfumer.test.ts` | loader `prefill` parsing, canonical without `q` |
| modify | `app/routes/robots.txt.test.ts` | new disallow lines |

## Steps

- [x] **1. Shared helpers and copy** — In `app/lib/perfumer.ts` add `PERFUMER_PREFILL_PARAM`,
  `PERFUMER_CORNER_HIDDEN_PAGES` (`perfumer`, `cart`, `checkout`, `checkoutSuccess`, `checkoutPay`,
  `giftCardSuccess`) and `showPerfumerCorner(page: Page | null)`. Add `catalogPerfumerMessage` to
  `app/lib/catalog.ts`. Add `perfumer.entry.{corner, bannerTitle, bannerAction, emptyAction,
  similar, catalogMessage, catalogMessageFilters, brandFilter, similarMessage}` to `uk.ts` and
  `en.ts`. Unit tests for the hidden pages (both locales' paths via `pageOf`) and the message
  (no filters, family, brand, both, unknown family value, English). `pnpm typecheck && pnpm test`.
- [x] **2. Prefill in the chat route** — `parsePerfumerPrefill` in `perfumer.schema.ts`; the
  `perfumer.tsx` loader returns `{ prefill }` and passes it to `PerfumerPage`. `usePerfumerThread`
  returns `restored`. In `PerfumerPage`, a ref-guarded effect sends the prefill once `restored`, then
  `navigate` with `replace` and no search. Tests: loader (`q` trimmed, empty → `null`, 501 chars →
  `null`, disabled → 404); DOM (the message is posted exactly once, joins an existing stored thread,
  the URL loses `q`, a re-render or remount after replace doesn't resend); `meta` canonical has no
  `q`.
- [x] **3. `PerfumerEntryLink`** — a `Link` to `perfumerHref(path, message)` with `rel="nofollow"`,
  rendering nothing when `perfumerEnabled` is false; accepts `ButtonLink`-style variants or a
  `className`. Test: href encodes Cyrillic and `&`, hidden when disabled.
- [x] **4. Corner button** — `PerfumerCornerButton.tsx` per the decisions above (link to
  `path("perfumer")`, no `q`); `.perfumer-corner` rule in `app/app.css`; `cookieBanner` fallback
  class; the 2.6s toast raise on phones via `useFetchers()` (Q2 confirmed). In `_shop.tsx`
  render `{perfumerEnabled && <PerfumerCornerButton cookieBanner={consent === null} />}` after
  `<Footer>`. `MobileMenu`'s `<details>` gets `data-mobile-menu`. Check in the running app at 390px
  and 1440px against the artboards.
- [x] **5. Cookie banner offset** — `CookieBanner` sets/removes `--bottom-ui-banner` with a
  `ResizeObserver` (guard for jsdom without it). Test: the variable is set while the banner shows and
  removed after it unmounts.
- [ ] **6. Catalog entry points** — `PerfumerCatalogBanner` above the results when there are
  products; a `PerfumerEntryLink` button in the empty-results box; both with
  `catalogPerfumerMessage(gender, search, translator)`.
- [ ] **7. Product link** — the "find similar" link in `product.tsx` below the purchase/unavailable
  block, with `similarMessage`.
- [ ] **8. robots.txt** — add the two `?q=` chat paths to `robotsDisallowPaths()`; update
  `robots.txt.test.ts`.
- [ ] **9. DOM tests for entry points** — corner button: hidden for each hidden page (uk and en
  paths), shown on home/catalog/product, hidden when disabled, fallback class with `cookieBanner`,
  bottom variable raised after a successful add-to-cart fetcher and back after 2.6s (fake timers),
  `sr-only` label is the accessible name, axe has no violations with it shown. Catalog banner,
  empty-state button and product link: correct `q`, absent when disabled.
- [ ] **10. Docs** — `docs/design.md`: a "AI perfumer corner button" section (look per breakpoint,
  offsets and the CSS variables, z-order, hidden pages, mobile menu, motion) and the `animate-pop`
  use in the motion table; mention the catalog banner and product link.
- [ ] **11. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; manual check with
  `pnpm aspire run` and `AI_BASE_URL` set and unset.

## Testing & verification

- Unit: `app/lib` helpers (hidden pages, `perfumerHref`, `catalogPerfumerMessage`,
  `parsePerfumerPrefill`), `perfumer.tsx` loader and `meta`, robots.
- DOM (jsdom + Testing Library + axe-core): corner button, catalog banner/empty state, product link,
  prefill send-once in `PerfumerPage.dom.test.ts`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (Aspire): at 390px and 1440px the button matches the artboards; it rises above the cookie
  banner and drops after answering; it rises after "+" on a catalog card on a phone; it's gone on
  `/parfumer`, `/koshyk`, checkout, success pages and in the open mobile menu; works with JS off;
  a catalog filter → banner → chat sends "Допоможіть обрати жіночий аромат: …" once, reload doesn't
  resend; product "find similar" asks about that perfume; with `AI_BASE_URL` unset, nothing shows.

## Acceptance criteria

- [ ] A corner "AI парфумер" button on the shop's pages opens the chat, matches the approved C+
  design on mobile and desktop, and never covers the cookie banner or the cart toast — steps 4, 5,
  9
- [ ] The corner button is hidden on the chat, cart, checkout and payment pages — steps 1, 4, 9
- [ ] Catalog pages and the empty-results state have an entry point that opens the chat with the
  current filters as a message — steps 1, 3, 6, 9
- [ ] Product pages have a "find similar" link that opens the chat asking for similar perfumes —
  steps 3, 7, 9
- [ ] The prefilled message is sent once and isn't repeated on reload — step 2
- [ ] No entry points appear when the engine is disabled — steps 3, 4, 9
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 11

## Out of scope

- An in-page chat widget (a later issue if #166's data shows use).
- Adding to the cart from the chat (#169).
- Analytics events for the entry points (#166).
- A fixed "Added to cart" toast (Q2 chose to keep the inline pill).
- A price filter in the catalog.
