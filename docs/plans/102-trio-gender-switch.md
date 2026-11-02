# Plan: Add a Women / Men switch to the Build your trio builder (#102)

Issue: https://github.com/savchukolgaa/jassmin/issues/102
Branch: `issue/102`
Worktree: `.claude/worktrees/issue-102`
Status: Implemented

## Goal

A shopper building a tester trio on the home page chooses whether the trio is for women or for
men (Women by default), so the families they pick suggest perfumes they would actually wear.
The choice goes into the "Show my trio" link (`/populiarni?gender=women&family=…`,
`/en/popular?gender=men&family=…`). The popular page filters by it, shows the active gender and
lets the shopper switch or clear it. This works with and without JavaScript.

## Dependencies & prerequisites

- Trio builder #64 and the popular page #67 are on `main` (`app/features/home/TrioBuilder.tsx`,
  `app/lib/trio.ts`, `app/routes/popular.tsx`, `getPopularPage` in
  `app/.server/services/products.ts`).
- Localized paths #84 (`pathFor` in `app/lib/paths.ts`) and the canonical/noindex rules #85
  (`seoMeta` `keepParams` in `app/lib/seo.ts`) are on `main`.
- `CATALOG_GENDERS`, `CatalogGender` and `isCatalogGender` (`app/lib/catalog.ts`) and
  `GENDER_SCOPE` (`app/.server/services/products.ts`) already exist.
- No migrations, env vars or packages are needed.

## Decisions & assumptions

- **Gender scope includes unisex.** `gender=women` filters by `GENDER_SCOPE.women`
  (`women` + `unisex`), and `men` by `men` + `unisex`, the same as the women's and men's
  catalogs. Unisex perfumes have no catalog of their own, but they are listed in both. Without
  this scope, a "for women" trio would hide perfumes the women's catalog shows.
- **No `gender` param means no gender filter** on `/popular`, so the header/nav links and the old
  family-only links behave as before. The builder always sends a gender, since Women is the
  default.
- **One filter object for popular URLs.** `popularHref(locale, families, page)` becomes
  `popularHref(locale, filter: PopularFilter, page = 1)` with
  `PopularFilter = { families: readonly string[]; gender: CatalogGender | null }`. That way
  pagination, the "remove family" chips, "Show all" and the gender links all carry both params,
  and no positional argument gets lost. Param order is `gender`, then `family…`, then `page`,
  matching the issue's example URLs.
- **Parsing.** `parseTrioGender(params): CatalogGender | null` sits next to `parseTrioSearch`
  in `app/lib/trio.ts`. It reads `params.get("gender")?.trim()` and keeps it only if
  `isCatalogGender`, so anything else (`unisex`, `""`, `toString`, `WOMEN`) becomes `null`
  without an error. This is a loader read, like `parseTrioSearch`, so no zod schema is needed:
  AGENTS.md only requires zod for `action` input.
- **Home default.** The home loader passes `selectedGender = parseTrioGender(...) ?? "women"`
  to the builder. `TrioBuilder` holds `gender` in state, seeded from the prop and re-synced
  when the prop changes (the same pattern as `selectedKey`).
- **Switch markup.** A `<fieldset>` with a visible-to-screen-readers `<legend>`
  (`home.trio.gender.legend`) holds two native `<input type="radio" name="gender">` (values
  `women` / `men`), styled as a pill segmented control. They use `peer sr-only` with a styled
  `<span>`, like the family chips. Native radios with one `name` already give arrow-key
  movement, one tab stop and the right screen-reader role, so no custom key handler is needed.
  Focus uses `peer-focus-visible:outline-3 outline-offset-2 outline-primary-light`, like the
  chips on the dark `bg-ink` band (`docs/design.md` → Focus rings). The background slide/colour
  change uses only `transition-colors`, which is turned off by the global
  `prefers-reduced-motion: reduce` block (`docs/design.md` → motion).
- **Popular page UI.** `PopularHero` shows the filter row when there are families **or** a gender:
  - a gender chip "Women ×" that clears the gender, keeping the families (`aria-label`
    "Remove filter: Women"),
  - a plain "Men" switch link next to it (to the other gender, keeping the families). The labels
    are simply "Women" / "Men", with no "Show …"/"For …" wording (user decision),
  - the family chips as today (removing one keeps the gender),
  - "Show all popular" clears both.

  `PopularEmpty`'s "filtered" state is true when families or gender are set.
- **SEO.** `meta` keeps `keepParams: ["page"]`, so gender/family-filtered URLs stay canonical to
  the unfiltered list, as #85 decided for `family` (comment in `app/routes/popular.tsx`).
- **Analytics.** No trio event exists (`CLIENT_EVENT_TYPES` is only `page_view` in
  `app/lib/analytics.ts`; the builder records nothing), so nothing is added. The `page_view` of
  `/popular?gender=…` already records the URL.

- **Implementation deviations.**
  - The popular page groups the gender chip and the switch link in a `<ul>` labelled
    `popular.gender.label` ("Для кого" / "Who it's for") instead of `role="group"`. Biome's
    `useSemanticElements` rejects the role, and this matches the families `<ul>`. As a result,
    `popular.chosenFilters` wasn't needed.
  - The label maps `TRIO_GENDERS` / `TRIO_GENDER_KEYS` (`app/lib/trio.ts`) and
    `POPULAR_GENDER_KEYS` (`app/lib/popular.ts`) follow the `CATALOG_TITLE_KEYS` pattern.
  - The home view is built in `app/.server/services/home.ts` (plus `home.test.ts`), so it carries
    `selectedGender` too. `app/routes/popular.test.ts` and `HomePage.test.ts` fixtures were
    updated for the new argument and field.
  - The steps were committed as one change, because the `popularHref` signature change touches
    every step's files.

## Resolved questions

- **Does the builder already record an analytics event?** No. The only client event is
  `page_view` (source: `app/lib/analytics.ts`; `TrioBuilder.tsx` has no tracking call).
- **How should an unknown gender be validated?** With `isCatalogGender`, which already rejects
  `unisex` and prototype keys (source: `app/lib/catalog.ts`, `app/lib/catalog.test.ts`).
- **Do unisex perfumes count for a gender?** Yes. They are in both catalogs through
  `GENDER_SCOPE` (source: `app/.server/services/products.ts`). Only the *catalogs/links* are
  women/men-only (memory: no Unisex catalog; issue Context).
- **Should the family chips depend on the gender?** No. Families stay selectable, and an empty
  result uses `PopularEmpty` (source: #102 Context).
- **Should "Women" include unisex perfumes?** Yes. Keep the current `GENDER_SCOPE` behaviour
  (source: user, 2026-11-02).
- **Popular-page switch wording?** Simply "Women" / "Men" (source: user, 2026-11-02).
- **Canonical/noindex of filtered URLs?** The filtered URLs are canonical to the unfiltered
  page, the same as for `family` (source: `app/routes/popular.tsx` `meta`, #85).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/popular.ts` | `PopularFilter` type; `popularHref(locale, filter, page)` writes `gender` first; `PopularPageView.gender` |
| modify | `app/lib/popular.test.ts` | `popularHref` with/without gender, param order |
| modify | `app/lib/trio.ts` | `parseTrioGender`; `trioHref(locale, families, gender)` |
| modify | `app/lib/trio.test.ts` | `parseTrioGender` valid/invalid/missing; `trioHref` with gender |
| modify | `app/lib/home.ts` | `selectedGender` option → `view.trio.gender` |
| modify | `app/routes/home.tsx` | parse gender, default `"women"` |
| modify | `app/routes/home.test.ts` | no-JS reload keeps `?gender=men`; invalid → women |
| modify | `app/features/home/TrioBuilder.tsx` | segmented radio switch; gender in state and in the link |
| modify | `app/features/home/TrioBuilder.test.ts` | switch renders, default women, prop `men` checked, link carries gender |
| modify | `app/features/home/HomePage.tsx` | pass `gender` to `TrioBuilder` |
| modify | `app/.server/db/queries/products.ts` | `PopularFilters.genders`; `genderFilter` in list + count |
| modify | `app/.server/services/products.ts` | `getPopularPage(filter, page, db)` maps gender via `GENDER_SCOPE` |
| modify | `app/.server/services/popular.test.ts` | gender filtering (incl. unisex, combined with families) |
| modify | `app/routes/popular.tsx` | parse gender, pass to service and view; update comments |
| modify | `app/features/popular/PopularHero.tsx` | gender chip (clear) + switch link; keep gender on family chips |
| modify | `app/features/popular/PopularPage.tsx` | pagination keeps the filter |
| modify | `app/features/popular/PopularEmpty.tsx` | `filtered` includes gender; "Show all" uses new signature |
| modify | `app/features/popular/popular-ui.test.ts` | hero shows gender chip/switch; links keep params |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | new keys (see step 2) |
| modify | `app/.server/AGENTS.md` | popular-perfumes note: gender filter via `GENDER_SCOPE` |

## Steps

- [x] **1. Popular URL filter (lib).** In `app/lib/popular.ts`, add
  `export interface PopularFilter { families: readonly string[]; gender: CatalogGender | null }`
  and change `popularHref(locale, filter, page = 1)` to set `gender` (if any), then each
  `family`, then `page > 1`. Add `gender: CatalogGender | null` to `PopularPageView`. Update the
  callers (`PopularHero`, `PopularPage`, `PopularEmpty`, `trio.ts`) to pass a filter, without
  behaviour changes yet (`gender: null`). Update `popular.test.ts`. Run `pnpm typecheck` and
  `pnpm test app/lib`.
- [x] **2. Translations.** Add to both `uk.ts` (source of truth) and `en.ts`:
  - `home.trio.gender.legend` ("Для кого тріо" / "Who's it for"), `.women` ("Жінки" /
    "Women"), `.men` ("Чоловіки" / "Men").
  - `popular.gender.women` ("Жінки" / "Women"), `popular.gender.men` ("Чоловіки" / "Men"),
    used for both the active chip and the switch link, plus `popular.gender.remove`
    ("Прибрати фільтр: {gender}" / "Remove filter: {gender}") for the chip's `aria-label`, and
    `popular.chosenFilters` for the list's `aria-label` if the row now mixes gender and families.
    There is no separate "switch to" key: the link is just the other gender's label.

  Check that the `uk`/`en` shapes match with `pnpm typecheck`.
- [x] **3. Trio lib.** In `app/lib/trio.ts`, add `parseTrioGender(params)` (see Decisions). Change
  `trioHref(locale, families, gender: CatalogGender)` to call
  `popularHref(locale, { families, gender })`. In `trio.test.ts`, test `women`/`men`, `" men "`
  trimmed, `unisex`/`WOMEN`/`toString`/empty/missing → `null`, and `trioHref` in `uk` and `en`
  (`/populiarni?gender=women&family=…`, `/en/popular?gender=men&family=…`).
- [x] **4. Query + service gender filter.** In `app/.server/db/queries/products.ts`, add
  `genders?: readonly Gender[]` to `PopularFilters` and a
  `genderFilter(genders)` (`inArray(products.gender, [...genders])` when non-empty) to the `where`
  of both `listPopularProducts` and `countPopularProducts`. In `services/products.ts`,
  change `getPopularPage(filter: PopularFilter, page, db)` to build
  `{ fragranceFamilies: filter.families, genders: filter.gender ? GENDER_SCOPE[filter.gender] : undefined }`.
  Update the `popular.test.ts` helper. Add these tests: `women` lists women + unisex and excludes
  men; `men` the reverse; gender combined with families narrows to both; the top-up from
  unranked bestsellers respects the gender; `null` keeps every gender.
- [x] **5. Popular route.** In `app/routes/popular.tsx` `loader`, call
  `parseTrioGender(url.searchParams)`, pass `{ families, gender }` to `getPopularPage`, and
  return `gender` in the view. Update the loader/meta comments to mention `gender`. Keep
  `keepParams: ["page"]`.
- [x] **6. Popular UI.** In `PopularHero` (props `families`, `gender`), render the filter row
  when either is set: the gender chip (clears the gender, keeps the families) and the switch link
  to the other gender (keeps the families), styled like the family chips with
  `focusRing("onPrimary")`. Family chips keep `gender`, and "Show all popular" clears both. In
  `PopularPage`, the pagination uses `popularHref(locale, { families, gender }, page)`. In
  `PopularEmpty`, use `filtered = families.length > 0 || gender !== null`. Extend
  `popular-ui.test.ts`.
- [x] **7. Home loader + view.** In `app/lib/home.ts`, add the `selectedGender: CatalogGender`
  option and `trio.gender`. In `app/routes/home.tsx`, use
  `selectedGender: parseTrioGender(searchParams) ?? "women"` and update the loader comment
  (`?family=` / `?gender=`). Pass `gender={view.trio.gender}` in `HomePage.tsx`. Extend
  `home.test.ts`: `?gender=men&family=…` gives `trio.gender === "men"`, and a missing or invalid
  gender gives `"women"`.
- [x] **8. TrioBuilder switch.** Add the `gender: CatalogGender` prop, a `useState` seeded from it,
  and a `useEffect` re-sync on prop change. Above the family fieldset, add the gender
  `<fieldset>`/`<legend className="sr-only">` with two `CATALOG_GENDERS` radios (`name="gender"`,
  `checked={gender === value}`, `onChange` sets state). The labels are a two-segment pill: the
  container has `inline-flex rounded-pill border-2 border-primary-light p-1`, and the selected
  segment has `peer-checked:bg-primary-light peer-checked:text-ink`, `min-h-11`, focus ring as in
  Decisions, and `transition-colors`. The CTA link becomes
  `trioHref(translator.locale, picked, gender)`. Update the component doc comment. In
  `TrioBuilder.test.ts`, test that two radios named `gender` exist in the form inside a fieldset
  with the translated legend, `women` is checked by default, `gender="men"` checks men, the full
  trio's link contains `gender=men` (en: `/en/popular?gender=men&family=…`), and the radios sit
  inside the GET form so the no-JS submit sends them.
- [x] **9. Docs.** Update the popular-perfumes bullet in `app/.server/AGENTS.md`:
  `listPopularProducts`/`countPopularProducts` take `genders`, and `getPopularPage` maps
  `gender` through `GENDER_SCOPE`.
- [x] **10. Verify.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, then do the
  manual checks below.

## Testing & verification

- Unit: `app/lib/trio.test.ts`, `app/lib/popular.test.ts`.
- Component: `TrioBuilder.test.ts`, `popular-ui.test.ts`, both in `uk` (default) and `en`.
- Route: `app/routes/home.test.ts` (no-JS reload keeps the gender).
- Integration (DB): `app/.server/services/popular.test.ts`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`):
  - On the home page, Women is preselected. Switch to Men, pick three families, and click
    "Show my trio": `/populiarni?gender=men&family=…` lists only men + unisex perfumes. Repeat
    under `/en`.
  - With JS disabled, choose Men plus families and submit "Show my picks". After the reload, Men
    is still checked and the CTA link carries `gender=men`.
  - Keyboard: Tab reaches the switch once, ←/→ moves between Women/Men, and the focus ring is
    visible. A screen reader announces the radio group with its legend.
  - On `/populiarni?gender=xyz`, there is no error and the page is unfiltered by gender.
  - On the popular page, the gender chip clears the gender and the switch link toggles it.
    Pagination and family chips keep the gender, and "Show all" clears everything.
  - With reduced motion on, nothing animates when the switch changes.

## Acceptance criteria

- [x] The trio builder has a Women / Men switch, with Women selected by default — steps 2, 7, 8
- [x] "Show my trio" opens results with only perfumes of the chosen gender in the picked families, in both languages — steps 1, 3, 4, 5, 8
- [x] The choice survives the no-JavaScript reload, and the switch is keyboard and screen-reader accessible — steps 7, 8
- [x] The popular page shows the active gender and lets the visitor change it — steps 2, 6
- [x] An invalid `gender` value is ignored without an error — steps 3, 5, 7
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 10

## Out of scope

- The trio discount (#59) and the families list/marquee (`getTrioFamilies` stays gender-agnostic).
- A unisex option or unisex catalog/links.
- A new analytics event for the trio builder.
- Gender filtering on the catalog pages, which already have their own gender routes.
