# Plan: Cut the JavaScript loaded before first paint to reach Lighthouse Performance 90 (#96)

Issue: https://github.com/savchukolgaa/jassmin/issues/96
Branch: `issue/96`
Worktree: `.claude/worktrees/issue-96`
Status: Planned

## Goal

A shopper on a phone with a slow connection should see the shop's pages quickly. Lighthouse
mobile Performance should reach at least 90 on the home, catalog (`/katalog/zhinochi`) and product
pages, and blog list and blog post should be measured too. The main lever is the JavaScript that is
modulepreloaded before first paint, which competes with the HTML and CSS on simulated slow 4G.

## Dependencies & prerequisites

- #88 (PR #95) is merged on `origin/main`: responsive images and self-hosted fonts are done, and CLS is 0.
- To measure, you need a production build (`pnpm build && pnpm start`), a throwaway seeded
  database, and Strapi running (`pnpm cms:dev`, or via `pnpm aspire run`) so home and blog answer
  200 and not 503.
- Lighthouse 12.6.1 is run through `npx lighthouse@12.6.1`, outside the project, so no dependency
  is added. `rollup-plugin-visualizer` is optional: step 1 can do without it (see below).
- No migrations and no new env vars.

## Baseline profile (taken while planning, `origin/main` @ 60e0f0a, `pnpm build`)

The build has 66 client JS chunks. These are the big shared ones (raw / gzip):

| Chunk | Raw | Gzip | What it is |
|-------|-----|------|------------|
| `entry.client-*.js` | 223 KB | 69 KB | react-dom + React Router runtime |
| `jsx-runtime-*.js` | 123 KB | 40 KB | React + router shared code |
| `schemas-*.js` | 87 KB | **24 KB** | **zod v4**: the whole library, on every page |
| `cn-*.js` | 67 KB | **21.5 KB** | **both `uk` and `en` dictionaries** (+ `cn`, the translator) |
| `manifest-*.js` | 31 KB | – | route manifest |
| `home-*.js` | 21 KB | – | home route |

`routes/_shop` alone imports 11 chunks, including `schemas` (zod), and the home route imports about
20 more. The issue says "`consent` ~25 KB". That is the same zod chunk under another name: Rolldown
names a shared chunk after one of its modules.

**Why zod reaches the client:** components import constants and helpers from isomorphic modules
that also declare zod schemas at module level, for example `CATALOG_TITLE_KEYS` /
`fragranceFamilyLabel` from `lib/catalog`, `FREE_SHIPPING_THRESHOLD` from `lib/checkout`,
`cartErrorMessage` from `lib/cart`, `discountLabel` / `MAX_PROMO_CODE_LENGTH` from `lib/discounts`,
`MAX_CLIENT_EVENTS` from `lib/analytics` (used by `useClientPageViews` in `_shop`), and
`blogPostHref` / `popularHref`. `z.object(…)` calls have side effects as far as the bundler can
tell, so it can't tree-shake them, and all of zod comes along. No component validates with zod.
Schemas are only used in loaders and actions, and React Router strips those from the client build.

## Decisions & assumptions

1. **Get zod out of the client bundle first.** It wasn't in the issue's candidate list, but it is
   the largest removable chunk (24 KB gzip) and loads on every page. Move each module-level schema
   (and the `parse…` helpers that use it) out of the shared `app/lib/<m>.ts` into a sibling
   `app/lib/<m>.schema.ts`. Only route `loader`s/`action`s, server code and tests import it. The
   constants, types and label helpers stay in `app/lib/<m>.ts`, so component imports don't change.
   They stay isomorphic and outside `.server/`, because action results and their types are shared.
   Types made with `z.infer` stay importable as `import type` from the schema module.
2. **Ship only the active locale's dictionary.** Recommended mechanism: the **root loader returns
   the active dictionary** (`messages`), and `I18nProvider` builds the translator from it. It is
   inlined in the hydration data (one request less, no waterfall), and with the existing
   `shouldRevalidate` the root loader only re-runs when the language changes, so the dictionary is
   sent once per language. (Confirmed by the user: root loader data, not a dynamic `import()`.)
   **Outcome: implemented, measured, then reverted** (b744b4f, reverted in e3ff947). The
   dictionary left the bundle (the shared chunk went from 21.5 to 6.3 KB gzip), but it added ~10 KB
   (brotli) of hydration data to every HTML response, which is on the render-critical path and
   isn't cached. With the stylesheet and chunk changes in place, an A/B showed both dictionaries in
   the cached `app` chunk scoring **1 point higher on all five pages** (and FCP ~0.15 s earlier on
   catalog and product). The acceptance criterion makes this change conditional on profiling
   showing it helps, so it was dropped. The plan below keeps the original description for the record.
   - `translator.ts` gets a core `createTranslatorFrom(locale, dictionary)` without dictionary
     imports. `createTranslator(locale)`, which imports both dictionaries, moves to a module that
     only server code, tests and the server render use (`app/lib/i18n/dictionaries.ts`).
   - Client paths that call `createTranslator()` today must stop doing so: the `I18nContext`
     default (`react.tsx`), `metaTranslator` (it reads `messages` from the root match's
     `loaderData`, next to `locale`), the default params in `cart.ts`, `discounts.ts`,
     `CartSummary.tsx` and `cart-line-state.ts` (make the translator a required argument, since
     components already have `useT()`), and `isTextKey` in `auth.ts` / `contact-form.ts` (used
     only in actions, so it moves along with the schemas in decision 1).
   - The context default without a provider (component tests) must still render Ukrainian. Make
     it work in tests with a test-only setup, or keep a lazy `uk` fallback that never runs in the
     browser. Pick whichever keeps `uk.ts` out of the client chunk graph, and check that in the
     build.
3. **Measure each change on its own** (issue requirement): after every candidate step, rebuild and
   record the chunk list and the Lighthouse medians in a scratch table, which then goes into the PR.
   Drop a candidate that doesn't help.
4. **Consent split:** the "consent ~25 KB" chunk is zod (see the profile), so this candidate mostly
   goes away with decision 1. After step 3, check what `CookieBanner` + `useClientPageViews` still
   cost. Only lazy-load them (`React.lazy`, rendered only when `consent === null` / `granted`) if
   they are still significant, because the banner must render on the server and post without JS.
   A lazy component that SSRs needs care: keep it a plain import if lazy-loading would leave the
   SSR markup out.
5. **Chunk merging:** Vite 8 bundles with Rolldown, so the Rollup options named in the issue
   (`manualChunks`, `experimentalMinChunkSize`) don't apply as written. Use Rolldown's grouping
   option (`build.rolldownOptions.output.advancedChunks` / its current name in the installed
   Rolldown, with `minSize` / groups) to fold the many 1–5 KB shared chunks into a few. Only keep
   it if the request count before first paint drops and Lighthouse improves. Don't merge route
   chunks into one big bundle.
6. **React Router preloads:** React Router 8 already preloads only the matched routes' modules,
   and route discovery is lazy by default (no `routeDiscovery` override in
   `react-router.config.ts`), so `routes.ts` needs no `lazy` changes. Check the `<Links>` /
   `<Scripts>` output once more after the steps above, and only act if something unexpected is
   preloaded.
7. Fonts, images, metadata, structured data and the sitemap stay untouched (#83–#88).
8. **Deviation: stylesheet before the modulepreloads** (found while measuring step 4). React 19
   hoists `<link rel="modulepreload">` above a plain `<link rel="stylesheet">`, so the page's only
   render-blocking request started after ~24 scripts. `app.css` is now imported with `?url` and
   declared in the root `links` with `precedence: "default"`, which React emits with the other
   stylesheets before the preloads. Dev mode still serves the Tailwind-processed CSS (checked).
9. **Chunk merging, as built:** Rolldown 1.2.15's `output.codeSplitting.groups` with one `app` group
   for `app/(components|features|lib)/`, `minShareCount: 2` (code used by one route only stays in
   that route's chunk), client build only (`isSsrBuild`). The group pulls in React's shared chunk
   (`includeDependenciesRecursively`), so a page now preloads 6 scripts instead of 24.

## Resolved questions

- **Q1: Dictionary delivery: root loader data, or a dynamic `import()` per locale?** Root loader
  data (decided by the user). No per-locale chunk fallback.
- **Q2: What if ≥ 90 isn't reached after steps 2–6?** Record the measured result in the PR and
  open a follow-up issue for deeper changes (e.g. the ~109 KB gzip React + React Router runtime,
  partial hydration). No architecture changes in this issue (decided by the user).

- **Is the "consent ~25 KB" chunk the cookie banner?** No. It is zod, shared by every route that
  imports a schema-bearing `lib` module (source: `build/client/assets/schemas-*.js` contains
  `ZodError`/`$ZodType`; manifest entry for `routes/_shop`).
- **Are both dictionaries really shipped?** Yes, in one chunk that holds both `uk` and `en` strings
  (source: `build/client/assets/cn-*.js`; `app/lib/i18n/translator.ts` statically imports both into
  `DICTIONARIES`).
- **Does any component validate with zod in the browser?** No. Schemas are used in route actions
  and loaders only (`grep` over `app/features`, `app/components`), so moving them doesn't change
  behaviour or the no-JS fallbacks (source: `app/features/home/contact-form.ts` is used only by the
  `home` action).
- **Which bundler options apply?** Vite 8.3.5 (Rolldown) and React Router 8.5.0 (source:
  `node_modules/*/package.json`).
- **Do pages work without JS?** Yes, and that must be kept: forms post to actions, and the cookie
  banner is a plain `<Form>` to `/consent` (source: `app/features/consent/CookieBanner.tsx`,
  `AGENTS.md`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `app/lib/{auth,cart,catalog,checkout,consent,discounts,analytics,blog,popular}.schema.ts` | zod schemas + `parse…` helpers moved out of the shared modules |
| modify | `app/lib/{same}.ts` | keep constants, types, labels; no `zod` import |
| create | `app/features/home/contact-form.schema.ts` (or keep the file, see step 2) | contact schema used only by the `home` action |
| modify | route modules and `app/.server/**` that import schemas | import from `*.schema.ts` |
| modify | `app/lib/*.test.ts` | follow the moved exports |
| create | `app/lib/client-bundle.guard.test.ts` | guard: nothing the UI imports reaches `zod`, a `*.schema.ts` module or server code |
| modify | `app/root.tsx`, `app/root.test.ts` | stylesheet via `app.css?url` in `links` with `precedence` (decision 8) |
| modify | `vite.config.ts` | Rolldown chunk grouping, client build only (decision 9) |
| modify | `AGENTS.md` (code rules) | the schema-module rule |

The i18n files listed in the original plan (`translator.ts`, `dictionaries.ts`, `react.tsx`, the
root loader's `messages`, required translator arguments) were changed in b744b4f and restored by
its revert (decision 2). Step 5 changed nothing.

## Steps

- [x] **1. Baseline.** Seed a throwaway DB, run Strapi, `pnpm build && pnpm start`, then run Lighthouse
  mobile 3× on home, `/katalog/zhinochi`, a product page, `/blog` and one blog post. Record the
  median Performance, FCP, LCP, TBT, CLS, SEO and Accessibility, the list of modulepreloaded
  chunks per page (from the HTML `<link rel="modulepreload">`) and their gzip sizes. A small node
  script in the scratchpad is enough for this, so the visualizer is optional.
- [x] **2. Move zod schemas out of shared `lib` modules.** For each of `auth`, `cart`, `catalog`,
  `checkout`, `consent`, `discounts`, `analytics`, `blog`, `popular` (and `contact-form`), move the
  `z.*` declarations and the parse helpers that use them to `<m>.schema.ts`. Update the imports in
  routes (`loader`/`action` only), `.server/` services and tests. Keep types from `z.infer`
  available via `import type`. Run `pnpm typecheck && pnpm test`.
- [x] **3. Check zod is gone and add a guard.** Rebuild and confirm that no client chunk contains
  `ZodError` and that `_shop`'s manifest imports no longer include the zod chunk. Add
  `client-bundle.guard.test.ts`, which walks the static imports of the modules components use
  (`app/lib/*.ts` minus `*.schema.ts`, `app/features/**`, `app/components/**`) and fails on `zod`.
  Model it on `paths.guard.test.ts`. Measure (Lighthouse, 3 runs).
- [x] **4. Ship only the active dictionary.** (Done, measured, reverted: see decision 2.) Implement decision 2: split `translator.ts`, return
  `messages` from the root loader, give `I18nProvider` / `metaTranslator` the dictionary, and remove
  the client-side `createTranslator()` defaults. Make sure an error page whose root loader failed
  still renders (in `uk`, with server-render fallback). Extend the guard test so `uk.ts`/`en.ts`
  are imported only from `dictionaries.ts`. Rebuild, confirm the client chunks contain only the
  active locale's strings (switch to `/en/…` and check the second language arrives on a language
  switch), then measure.
- [x] **5. Consent / tracker (conditional).** Skipped: `CookieBanner` + `client-events` +
  `useClientPageViews` are ~6 KB of source, ~1.5 KB gzip, under the threshold. Re-check what `CookieBanner` and
  `useClientPageViews`/`client-events` add to `_shop`. If it is significant (> ~5 KB gzip), load
  them only when needed (banner when `consent === null`, tracker when `granted`), keeping SSR markup
  and the no-JS form post. Otherwise skip and note it in the PR.
- [x] **6. Merge tiny chunks (conditional).** Kept (decision 9), together with the stylesheet order (decision 8). Try Rolldown's chunk grouping in `vite.config.ts` to
  fold the 1–5 KB shared chunks. Keep it only if the preload count drops and the Lighthouse median
  doesn't get worse.
- [x] **7. Final measurement and docs.** Run the full measurement matrix again (5 pages × 3 runs)
  and write the before/after table for the PR. Update `AGENTS.md` (i18n: provider gets `messages`,
  server uses `createTranslator`; code rules: zod schemas live in `*.schema.ts` and are imported
  only from loaders/actions/server). If ≥ 90 isn't reached, record the result in the PR and open a
  follow-up issue (`/create-issue`) describing the remaining bottleneck and the measurements.
- [ ] **8. Verify.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and do the
  no-JS manual checks below.

## Testing & verification

- **Unit:** the schema tests moved with their schemas (`*.test.ts` import from `*.schema.ts`).
- **Guard:** `client-bundle.guard.test.ts` (no `zod`, schema or server imports in the client
  graph); checked that it fails when a client module imports a schema module.
- **Root:** `root.test.ts` checks the stylesheet link keeps its `precedence`.
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **Manual, no JS (browser with JS off):** add to cart, update/remove a line, apply a promo code,
  check out, log in, register, edit profile, the contact form on home, the cookie banner
  accept/decline, footer "Cookie settings", and the language switcher. All must still work with
  translated error messages.
- **Manual, with JS:** switch language on several pages, get an action error message in both
  languages, and check that meta titles change correctly on client navigation in both languages.
- **Lighthouse:** same setup as #88 (production build, mobile preset, 3 runs, median). SEO stays
  100, CLS ≤ 0.1, and Accessibility doesn't drop.

## Results

Lighthouse 12.6.1, mobile preset, local production build (`react-router-serve`, HTTP/1.1) with a
throwaway seeded database and Strapi (`cms:dev`) on throwaway databases, median of 3 runs.
Performance (FCP / LCP in seconds; scripts = JS requests on the page):

| Page | Baseline (`main`) | Zod out | + dictionary via root loader | + stylesheet first | + chunks merged | **Final** (dictionary reverted) |
|------|------|------|------|------|------|------|
| home `/` | 80 (3.38 / 3.84) | 80 | 82 | 84 | 87 | **90** (2.46 / 3.02) |
| `/katalog/zhinochi` | 85 (3.07 / 3.53) | 88 | 86 | 88 | 93 | **94** (2.16 / 2.76) |
| product page | 85 (3.22 / 3.38) | 86 | 86 | 86 | 91 | **92** (2.45 / 2.87) |
| `/blog` | 87 (2.79 / 3.24) | 90 | 90 | 90 | 93 | **94** (2.27 / 2.72) |
| blog post | 88 (2.92 / 3.23) | 89 | 88 | 88 | 93 | **94** (2.31 / 2.72) |
| scripts per page | 21–28 | 18–24 | 18–24 | 18–24 | 6 | **6** |

SEO is 100 and CLS 0 on every page in every run. Accessibility is unchanged from the baseline
(home 90, the others 95–96). TBT is 0–6 ms throughout. Home is right at the threshold; what's left
there is fonts (its LCP element is the Playfair "jassmin." logo, which needs the late-discovered
Latin subsets) and the hero image preload from Strapi's origin, both out of scope here.

## Acceptance criteria

- [x] Lighthouse mobile Performance ≥ 90 on home, `/katalog/zhinochi` and a product page (median of
  3 runs, local production build with Strapi running), with SEO still 100 and CLS ≤ 0.1 (steps
  2–7): home 90, catalog 94, product 92
- [x] Blog list and a blog post measured and recorded too (steps 1, 7): 94 and 94
- [x] Only the active locale's messages are sent to the client, if profiling shows it helps
  (step 4): profiling showed it doesn't help, so both stay in the bundle (decision 2)
- [x] No page loses functionality without JavaScript (steps 5, 8): checked with plain form posts
  (cart add/update/remove, promo, checkout, login, contact form, cookie banner accept/reset,
  language switch), each with translated errors
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass (step 8)

## Out of scope

- Images, fonts, metadata, structured data and the sitemap (#83–#88).
- Replacing React/React Router, partial hydration or turning off hydration on static pages (follow-up issue if the target isn't met).
- Server-side performance (TTFB, DB query tuning) beyond what measurement reveals as blocking.
