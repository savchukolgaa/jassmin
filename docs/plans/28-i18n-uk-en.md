# Plan: Add Ukrainian and English multi-language support to the storefront (#28)

Issue: https://github.com/savchukolgaa/jassmin/issues/28
Branch: `issue/28`
Worktree: `.claude/worktrees/issue-28`
Status: Planned

## Goal

A customer in Ukraine can use the storefront in Ukrainian (the default) or English. The plan adds
typed dictionaries with a small `t()` helper (interpolation and Ukrainian plurals), resolves the
locale on the server (cookie, then `Accept-Language`, then `uk`) so the first SSR response and
`<html lang>` are correct, and adds a language switcher that works without JS. All existing
storefront copy moves into the dictionaries. Prices and dates are formatted for the active locale.

## Dependencies & prerequisites

- **#38 (dark-mode fix) merges first.** It edits `app/root.tsx` (adds the `color-scheme` meta tag),
  `app/app.css`, `docs/design.md`, and drops `dark:` classes from `PagePlaceholder.tsx` and
  `account.tsx`. This plan edits the same lines in `root.tsx`, `PagePlaceholder.tsx` and
  `account.tsx`, so rebase `issue/28` onto `origin/main` after #38 merges and before opening the
  PR (step 15). The conflicts are small: keep #38's meta tag and its class changes, and keep this
  plan's copy changes.
- **#10 (cart) and #16 (admin products) are built in parallel and merge after this.** #10 adopts
  the dictionaries when it rebases. #16 doesn't need to, because the admin area stays English
  (decision D1). To keep their rebases small, this plan changes the files #10 will touch
  (`app/routes/cart.tsx`, `app/lib/cart.ts`, `app/features/cart/AddToCartForm.tsx`,
  `app/components/layout/Header.tsx`, `app/lib/header.ts`) only mechanically: strings become `t()`
  calls and nothing else moves. Step 14 writes the adoption rules into `AGENTS.md` so the other
  agents can follow them.
- Already on `main`: auth forms (#9), header/nav (#6/#24), catalog (#8), product page with
  volumes (#26/#37), blog (#13/#34), home page (#7), admin layout (#14/#36).
- No new packages, env vars or migrations.

## Decisions & assumptions

- **D1. The storefront is translated and the admin area (`/admin/*`) stays English.** The only
  users of the admin area are the shop staff. Translating it would double the work for #16/#17
  and give nothing to customers. To keep it consistent, the root layout forces the `en` locale
  for any path under `/admin`, so `<html lang="en">` matches the English admin copy. Shared
  components rendered there (`Button`, `ErrorContent`, `Pagination`, error pages) also come out
  in English. The admin files (`AdminLayout.tsx`, `admin-nav.ts`, `AdminPlaceholder.tsx`, admin
  route `meta`) keep their hard-coded English strings. **(unconfirmed, see Q1)**
- **D2. No i18n library.** There are two locales, a few hundred strings and no async namespace
  loading. A ~100-line typed helper gives compile-time key checking, which i18next/remix-i18next
  only add through extra type plumbing, and it adds no runtime dependency. Both dictionaries ship
  in the client bundle (a few KB), which is acceptable.
- **D3. Ukrainian is the source of truth.** `uk.ts` is a plain object literal. `Dictionary` is its
  shape, with each string widened to `string`. `en.ts` is written `satisfies Dictionary`, so a
  missing key **and** an extra key both fail `pnpm typecheck`.
- **D4. Keys are dotted paths into namespaced objects** (`nav.about`, `auth.errors.emailInvalid`,
  `catalog.count`). `MessageKey` is a template-literal union of all leaf paths, so `t()` only
  accepts real keys. A plural message is an object
  `{ one, few, many, other }` (`few`/`many` optional in the type; `en` uses `one`/`other`) and is
  resolved with `Intl.PluralRules(locale)` from `params.count`.
- **D5. Interpolation uses `{name}` placeholders**, filled from `params: Record<string, string |
  number>`. Numbers are formatted with the locale's `Intl.NumberFormat`. A missing param is left
  as `{name}` so it shows up in review. Unused params are ignored, which lets the contact form pass
  `CONTACT_LIMITS` for every message.
- **D6. Validation messages are message keys, not text.** The zod schemas in `app/lib/auth.ts` and
  `app/features/home/contact-form.ts` use keys as their messages (typed with a
  `msg(key: MessageKey)` identity helper). Actions return keys in
  `fieldErrors`/`formError`, and components translate them when rendering. Action results stay
  locale-independent, so switching language re-renders the errors correctly, and the actions
  don't need the locale. `toFieldErrors` narrows each message with `isMessageKey`, falling back to
  `errors.invalid`, so no casts are needed.
- **D7. The translator is a plain object**: `createTranslator(locale)` returns
  `{ locale, t, formatPrice, formatDate, formatNumber }`. Components get it from `useT()` (React
  context provided in the root `Layout`). `meta` functions use `metaTranslator(matches)`, which
  reads the root match's `loaderData.locale`. Server code (blog dates) calls
  `createTranslator(locale)` directly. Without a provider, the context defaults to the `uk`
  translator, so existing `renderToStaticMarkup` tests keep working and render Ukrainian.
- **D8. Intl locales:** `uk` → `uk-UA` and `en` → `en-GB` (day-month order, which matches the
  current blog dates). Prices use `UAH` with `currencyDisplay: "narrowSymbol"`, so both locales show
  `₴` (`6 850 ₴` / `₴6,850`). Dates use `dateStyle: "long"` in `Europe/Kyiv`.
- **D9. Cookie `locale`**: `createCookie("locale", { path: "/", sameSite: "lax", httpOnly: true,
  maxAge: 1 year, secure: import.meta.env.PROD })`. It's unsigned because it isn't sensitive, and
  `isLocale` validates it on every read. It lives in `app/.server/locale.ts`, which doesn't import
  `env.ts` (like `session-cookie.ts`), so tests need no env.
- **D10. `Accept-Language` matching**: parse the comma-separated tags with their `q` weights, sort
  by weight, and pick the first whose primary subtag (`uk-UA` → `uk`) is in `LOCALES`. Anything
  else (`ru`, `de`, garbage) falls back to `uk`.
- **D11. The switcher is a `<Form method="post" action="/locale">`** with two submit buttons
  (`name="locale" value="uk"|"en"`, labelled `УКР` / `EN` with `lang` attributes,
  `aria-pressed` on the active one) and a hidden `redirectTo` set to the current path and query.
  `routes/locale.ts` is an action-only resource route outside the shop layout, like `logout.ts`.
  It validates `{ locale: z.enum(LOCALES), redirectTo: z.string().optional() }` and sets the
  cookie. It then redirects to `safeRedirect(redirectTo, "/")` (reusing `app/lib/auth.ts`). An
  invalid locale returns `data({ ok: false, error: "invalid-locale" }, { status: 400 })`, which
  only a tampered form can trigger. A GET redirects to `/`. With JS, React Router follows the
  redirect and revalidates every loader, so the root locale updates without a full reload.
- **D12. No locale-prefixed URLs.** The language is a per-visitor preference, and the issue lists
  prefixed URLs as optional. The SEO cost is that search engines index the Ukrainian version
  only, which suits a shop in Ukraine. It can be a follow-up.
- **D13. Caching:** blog pages may be stored by shared caches, and their HTML now depends on the
  locale, so `blogCacheHeaders` sends `Vary: Cookie, Accept-Language`. The `locale` cookie is
  already covered by `Vary: Cookie`.
- **D14. Not translated:** the `jassmin` wordmark, brand names, Strapi content (blog, home hero and
  about, site settings), and product data from PostgreSQL (titles, descriptions,
  `fragrance_family` values in filters and badges). These are out of scope per the issue.
- Ukrainian copy is drafted by the implementer in a natural, shop-like register (`ви`, not
  `Ви`). **(unconfirmed, see Q2)**

## Open questions

- [ ] **Q1: Is the admin area (`/admin`) translated?** Why it matters: it decides whether #16/#17
  must add dictionary keys and whether `/admin` follows the visitor's locale. Recommended default:
  **storefront only; admin stays English, with `<html lang="en">` forced under `/admin`** (D1).
  Affects steps: 4, 14.
- [ ] **Q2: Who reviews the Ukrainian copy?** Why it matters: the implementer drafts every
  Ukrainian string (nav, auth, catalog, errors). Recommended default: the implementer drafts it,
  and the shop owner reviews `app/lib/i18n/uk.ts` in the PR. Wording fixes later are one-file
  edits. Affects steps: 1, 7–13.
- [ ] **Q3: What does the switcher show?** Why it matters: it's a small visual choice in the C+
  header. Recommended default: a compact pill toggle `УКР | EN` in the header bar (white text on
  `primary`, the active option inverted to white with `primary` text) and the same toggle at the
  bottom of the mobile menu. No flags, because flags represent countries, not languages. Affects
  step: 6.

## Resolved questions

- **Default locale and resolution order?** `uk` default; cookie → `Accept-Language` → `uk`
  (source: #28 Context/Technical).
- **Library or hand-rolled?** Hand-rolled unless justified; it's justified above (D2) (source: #28
  Technical).
- **Translate Strapi content, product data, currency or URLs?** No (source: #28 "Out of scope").
- **Is there a Unisex catalog to translate?** No, only men/women catalogs exist (source:
  `app/lib/catalog.ts` `CATALOG_TITLES`, memory note "No Unisex catalog").
- **Where does server-only code go and how is it isolated?** `app/.server/locale.ts`; isomorphic
  dictionaries in `app/lib/i18n/` (source: `AGENTS.md` architecture rules).
- **How are redirects kept safe?** Reuse `safeRedirect` from `app/lib/auth.ts` (source: #28
  Technical, `app/lib/auth.ts`).
- **What renders the auth forms and their errors?** `app/routes/login.tsx`,
  `app/routes/register.tsx`, `app/features/auth/AuthLayout.tsx` and `TextField.tsx`; zod messages
  in `app/lib/auth.ts` (source: #9, code).
- **Where is the stray "Kontakt"?** `CONTACTS_LINK` in `app/components/layout/nav.ts` and the
  eyebrow in `app/features/home/ContactsSection.tsx` (source: code).
- **How are components tested?** `renderToStaticMarkup` + `MemoryRouter` in a Node Vitest
  environment, `*.test.ts` only (source: `app/components/layout/Header.test.ts`,
  `vitest.config.ts`).
- **Do test files go through `tsc`?** Yes. `tsconfig.json` includes `**/*`, so a
  `@ts-expect-error` type test in a `*.test.ts` file runs under `pnpm typecheck` (source:
  `tsconfig.json`).
- **Where are prices and dates formatted today?** `app/lib/money.ts` (`uk-UA`, fixed) and
  `formatPublishedDate` in `app/.server/services/blog.ts` (`en-GB`, fixed) (source: code).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `app/lib/i18n/locales.ts` | `LOCALES`, `Locale`, `DEFAULT_LOCALE`, `isLocale`, `INTL_LOCALES`, `uiLocaleForPath` |
| create | `app/lib/i18n/types.ts` | `Plural`, `Dictionary`, `MessageKey`, `PluralKey`, `MessageParams` types |
| create | `app/lib/i18n/uk.ts` | Ukrainian dictionary (source of truth) |
| create | `app/lib/i18n/en.ts` | English dictionary, `satisfies Dictionary` |
| create | `app/lib/i18n/translator.ts` | `createTranslator`, `t`, plurals, `formatPrice/Date/Number`, `msg`, `isMessageKey` |
| create | `app/lib/i18n/react.tsx` | `I18nProvider`, `useT`, `metaTranslator` |
| create | `app/lib/i18n/index.ts` | Public re-exports |
| create | `app/lib/i18n/dictionaries.test.ts` | Key parity (runtime + `@ts-expect-error`), no empty strings, every `uk` plural has `one/few/many/other` |
| create | `app/lib/i18n/translator.test.ts` | Interpolation, plurals (uk 1/2/5/11/21/22/25, en 1/2), formatting, fallbacks |
| create | `app/lib/i18n/locales.test.ts` | `isLocale`, `uiLocaleForPath` |
| create | `app/.server/locale.ts` | `localeCookie`, `getLocale(request)`, `parseAcceptLanguage` |
| create | `app/.server/locale.test.ts` | Precedence: cookie > Accept-Language > default; q-weights; invalid cookie |
| create | `app/routes/locale.ts` | Action: validate, set cookie, redirect back; loader: redirect `/` |
| create | `app/routes/locale.test.ts` | Valid switch, invalid locale 400, unsafe `redirectTo`, GET |
| create | `app/components/layout/LocaleSwitcher.tsx` | No-JS language toggle |
| modify | `app/root.tsx` | Root `loader` returns `locale`; `<html lang>`; `I18nProvider`; translated root error |
| modify | `app/routes.ts`, `app/routes.test.ts` | Register `locale` route outside the shop layout |
| modify | `app/lib/money.ts`, `money.test.ts` | `formatPrice(price, locale)` |
| modify | `app/components/layout/nav.ts`, `Header.tsx`, `MobileMenu.tsx`, `CatalogMenu.tsx`, `Footer.tsx` (+ tests) | Label keys, fix "Kontakt", switcher, aria labels, cart count plural |
| modify | `app/lib/route-error.ts`, `route-error.test.ts`, `app/components/layout/ErrorContent.tsx`, `PagePlaceholder.tsx` | Error/placeholder copy via keys |
| modify | `app/routes/_shop.tsx`, every route `ErrorBoundary` | Pass translator to `describeRouteError` |
| modify | `app/lib/auth.ts`, `auth.test.ts`, `app/routes/login.tsx`, `register.tsx` (+ tests), `app/features/auth/AuthLayout.tsx`, `TextField.tsx` | Keys for zod/form errors, translated forms |
| modify | `app/lib/catalog.ts`, `catalog.test.ts`, `app/lib/products.ts`, `products.test.ts`, `app/lib/cart.ts`, `cart.test.ts` | Title/sort/error keys; locale-aware volume and option formatting |
| modify | `app/features/catalog/*`, `app/features/product/*`, `app/features/cart/AddToCartForm.tsx`, `app/components/ui/Pagination.tsx` (+ tests) | Translated UI |
| modify | `app/routes/catalog.tsx`, `product.tsx`, `cart.tsx`, `checkout.tsx`, `account.tsx` | `meta` via `metaTranslator`, copy via `useT` |
| modify | `app/features/home/*.tsx`, `contact-form.ts`, `contact-form.test.ts`, `app/lib/home.ts`, `app/routes/home.tsx` | Section labels, contact form, default description |
| modify | `app/routes/blog.tsx`, `blog-post.tsx`, `app/features/blog/*`, `app/lib/blog.ts`, `app/.server/services/blog.ts` (+ tests) | Copy, locale dates, `Vary: Cookie, Accept-Language` |
| modify | `AGENTS.md` | Translation rules for later issues (#10, #11, #12…) |

## Steps

Each step ends with `pnpm typecheck && pnpm lint && pnpm test` green.

- [ ] **1. i18n core in `app/lib/i18n/`.**
  - `locales.ts`: `LOCALES = ["uk", "en"] as const`, `type Locale`, `DEFAULT_LOCALE: Locale =
    "uk"`, `isLocale(value: unknown): value is Locale`,
    `INTL_LOCALES: Record<Locale, string> = { uk: "uk-UA", en: "en-GB" }`,
    `LOCALE_LABELS = { uk: "УКР", en: "EN" }` (the switcher's own labels, the same in both
    languages), and `uiLocaleForPath(pathname, locale)`, which returns `"en"` for `/admin` and
    `/admin/*` and `locale` otherwise (D1).
  - `types.ts`: `type Plural = { one: string; few?: string; many?: string; other: string }`.
    `Widen<T>` maps string leaves to `string`, `Plural`-shaped objects to `Plural`, and recurses
    into other objects. `type Dictionary = Widen<typeof uk>`. `MessageKey` holds the dotted leaf
    paths (a `Plural` counts as a leaf) and `PluralKey` the subset whose value is `Plural`.
    `type MessageParams = Record<string, string | number>`.
  - `uk.ts`: `export const uk = { … }` with the namespaces `common` (brand, `optional`,
    `loading`), `meta` (`title: "{page} — Jassmin"`), `nav`, `locale` (switcher `aria-label`),
    `errors` (route errors + `invalid`), `placeholder`, `auth`, `catalog`, `product`, `cart`,
    `pagination`, `home`, `contact`, `blog`, `account`, `checkout`. Fill only the keys this issue
    needs. Steps 7–13 add keys as they move copy, so `uk.ts`/`en.ts` grow with each step.
  - `en.ts`: `export const en = { … } satisfies Dictionary`, with today's English strings moved
    verbatim, except `nav.contacts: "Contacts"`.
  - `translator.ts`: `createTranslator(locale)` → `{ locale, t, formatPrice, formatDate,
    formatNumber }`. The `t(key, params?)` function looks up the path, picks the plural form with
    a cached `Intl.PluralRules(INTL_LOCALES[locale])` when the value is a `Plural` (`params.count`
    required by overload: `t(key: PluralKey, params: MessageParams & { count: number })`), then
    replaces `{name}` (numbers through `formatNumber`). `formatDate(iso)` uses `dateStyle: "long"`
    and `timeZone: "Europe/Kyiv"`. Cache the `Intl` formatters per locale. Also export
    `msg(key: MessageKey): MessageKey` (an identity function for zod messages) and
    `isMessageKey(value: string): value is MessageKey`, which checks the path in `uk`.
  - `index.ts`: re-export the public API.
  - Tests: `translator.test.ts`, `locales.test.ts` and `dictionaries.test.ts`.
    `dictionaries.test.ts` deep-compares the key sets of `uk`/`en` and contains a
    `// @ts-expect-error` line that assigns an object without one key to `Dictionary`, so the
    compile-time check is itself checked by `pnpm typecheck`.

- [ ] **2. Locale-aware money.** `app/lib/money.ts`: change it to
  `formatPrice(price: string, locale: Locale = DEFAULT_LOCALE)` and delegate to the cached
  formatter used by `createTranslator` (one implementation, D8). The translator's `formatPrice`
  calls it. Update `money.test.ts` for `uk` (`6 850 ₴`, normalising ` `/` `) and `en`
  (`₴6,850`).

- [ ] **3. Server locale resolution.** `app/.server/locale.ts`: `localeCookie` (D9),
  `parseAcceptLanguage(header: string | null): Locale | undefined` (D10) and
  `getLocale(request): Promise<Locale>`. `getLocale` tries the parsed cookie when `isLocale`
  accepts it, then `parseAcceptLanguage`, then `DEFAULT_LOCALE`. Also
  `serializeLocaleCookie(locale)`. Tests in `locale.test.ts`: the cookie wins over the header, an
  invalid cookie falls back, `en-US,en;q=0.9` → `en`, `de, en;q=0.5` → `en`, `ru` → `uk`, an
  empty or missing header → `uk`.

- [ ] **4. Root loader, `<html lang>` and the provider.**
  - `app/root.tsx`: `export async function loader({ request }) { return { locale: await
    getLocale(request) }; }`. In `Layout`, read `useRouteLoaderData<typeof loader>("root")`
    (`undefined` on a root error, so fall back to `DEFAULT_LOCALE`). Then apply
    `uiLocaleForPath(useLocation().pathname, …)`, render `<html lang={locale}>` and wrap
    `children` in `<I18nProvider locale={locale}>`. Keep #38's `color-scheme` meta when rebasing.
  - `app/lib/i18n/react.tsx`: `I18nProvider` (a memoised `createTranslator`), `useT()` and
    `metaTranslator(matches)`, which finds the match with `id === "root"`, reads `loaderData.locale`
    through `isLocale`, and applies `uiLocaleForPath` to the match's pathname.
  - Check manually: `curl -H "Accept-Language: en" localhost:…/` returns `<html lang="en">`,
    `/admin` returns `lang="en"`, and the default is `lang="uk"`.

- [ ] **5. `locale` resource route.** Create `app/routes/locale.ts` as in D11 and register
  `route("locale", "routes/locale.ts")` next to `logout` in `app/routes.ts`, with a comment. Add a
  "keeps the locale route outside the shop layout" case to `routes.test.ts`.
  `locale.test.ts` checks that a valid POST returns a 302 to `redirectTo` with a `locale=` cookie
  (Max-Age, Path=/, SameSite=Lax); that `redirectTo=//evil.com` → `/`; that `locale=de` → 400 with
  no Set-Cookie; and that GET → 302 `/`.

- [ ] **6. Language switcher.** `app/components/layout/LocaleSwitcher.tsx` takes
  `tone: NavTone`. It renders a `<Form method="post" action="/locale">` with a hidden `redirectTo`
  from `useLocation()` (`pathname + search`) and one submit button per locale. Each button has
  `lang={l}`, `aria-pressed={l === locale}` and the C+ pill/focus-ring styles from `nav.ts`
  (`focusRing(tone)`, 44px min target), and the group has `aria-label={t("locale.label")}`. Mount
  it in `Header.tsx` before the profile icon, hidden below `md`, and at the bottom of
  `MobileMenu.tsx` with `tone="onLight"`. Header tests: both buttons are rendered, the active one
  is `aria-pressed="true"`, and `redirectTo` matches the current path.

- [ ] **7. Header, nav and footer copy.** In `nav.ts`, replace `label`/`shortLabel` with
  `labelKey`/`shortLabelKey: MessageKey`, and change `CONTACTS_LINK` to `nav.contacts` (uk
  "Контакти", en "Contacts"), which fixes "Kontakt". Translate every string in `Header.tsx`
  (wordmark `aria-label`, nav `aria-label`, account/login label, cart label as the plural
  `nav.cartLabel` with `{count}`), `CatalogMenu.tsx` ("Catalog"), `MobileMenu.tsx` ("Menu",
  "Catalog") and `Footer.tsx` (link labels, footer nav label). Update `Header.test.ts` and
  `Footer.test.ts` to render inside `I18nProvider` and assert both the `uk` default and `en`.

- [ ] **8. Errors and placeholders.** `describeRouteError(error, t, dev?)` returns translated text
  (`errors.notFound`, `errors.forbidden`, `errors.unavailable`, `errors.unexpected`, `errors.title`
  for "Oops!"). Leave `error.statusText` untranslated, since it comes from code, not users.
  Update every caller: `root.tsx`, `_shop.tsx`, `catalog.tsx`, `product.tsx` (and its "This
  perfume could not be found."), `blog.tsx`, `blog-post.tsx` and `admin.tsx` (English via D1;
  its "Back to shop" link stays hard-coded English like the rest of the admin). Each
  `ErrorBoundary` calls `useT()`. `PagePlaceholder` translates "Coming soon." itself and gets its
  `title` already translated from the caller. Update `route-error.test.ts` to pass
  `createTranslator("en")` and `createTranslator("uk")`.

- [ ] **9. Auth forms and validation messages (#9).** In `app/lib/auth.ts`, every zod message
  becomes `msg("auth.errors.…")`. `AuthFormErrors` changes to `fieldErrors?: Partial<Record<Field,
  MessageKey>>` and `formError?: MessageKey`, and `toFieldErrors` narrows with `isMessageKey`. In
  `login.tsx`/`register.tsx`, action errors ("Too many attempts…", "Email or password is
  incorrect…", "An account with this email already exists.") become keys, the components render
  `t(error)`, and labels, hints, the placeholder `+380`, button texts and form `aria-label`s
  become `t()` calls. `AuthLayout.tsx`: `COPY`/`BENEFITS` become key maps, and the tabs, the
  "Account" nav label and the guest-checkout sentence (one key with a `{link}` split into
  `before`/`link`/`after` keys) are translated. `TextField.tsx`: "(optional)" →
  `t("common.optional")`. Update `auth.test.ts`, `login.test.ts` and `register.test.ts` to expect
  keys.

- [ ] **10. Catalog, product, cart and pagination.**
  - `app/lib/catalog.ts`: replace `CATALOG_TITLES` with `CATALOG_GENDERS = ["men", "women"] as
    const` and `CATALOG_TITLE_KEYS: Record<CatalogGender, MessageKey>`. `isCatalogGender` uses the
    array. `CATALOG_SORT_LABELS` becomes `CATALOG_SORT_LABEL_KEYS`.
  - `app/lib/products.ts`: `formatVolume`, `formatVolumes` and `formatVariantOption` take the
    translator (or `t` + `locale`) for "ml"/"мл", "(out of stock)" and the price.
  - `app/lib/cart.ts`: `CART_ERROR_MESSAGES` becomes `CART_ERROR_KEYS: Record<CartActionError,
    MessageKey>` (`cart.errors.*`). This is the only change in this file, to keep #10's rebase
    simple.
  - Components: `CatalogFilters` (labels, "All families/brands", "Apply", "Reset", form label),
    `ProductCard` ("from {price}", "Add {size}", "Choose volume"), `StockStatus` ("In stock",
    "Out of stock", plural `product.onlyLeft`), `AddToCartForm` ("Add to cart", "Out of stock",
    errors), `ProductPurchase` ("Currently unavailable", price), `VolumeSelect` ("Volume"),
    `Pagination` ("Pagination", "Previous", "Next").
  - Routes: `catalog.tsx` (plural `catalog.count`, empty state, "Show all …", "Perfumes" section
    label, `meta`), `product.tsx` (breadcrumb, "Description", `meta` fallback).
  - Update `catalog.test.ts`, `products.test.ts`, `cart.test.ts`, `catalog-ui.test.ts`,
    `product-ui.test.ts` and `Pagination.test.ts`.

- [ ] **11. Home page.** Translate the eyebrows ("About us", "Location", "Kontakt" → `nav.contacts`,
  "Address", "Opening hours", the "Customer service hours" sr-only text and the "Social media"
  label) in `AboutSection`, `LocationSection` and `ContactsSection`. In `ContactForm`, translate
  the title, labels, honeypot label, "Sending…"/"Send message", and the success,
  rate-limited and delivery-failed messages. In `contact-form.ts`, the zod messages become
  `msg("contact.errors.…")` with `{max}`/`{min}` placeholders, and `ContactFieldErrors` holds
  `MessageKey`s that the form renders as `t(key, { min: CONTACT_LIMITS.messageMin, … })`. For
  the `home.tsx` `meta` fallback, `DEFAULT_HOME_DESCRIPTION` becomes the key `home.defaultDescription`,
  and `buildHomePageView` keeps the CMS text (Strapi content isn't translated). Update
  `contact-form.test.ts` and `HomePage.test.ts`.

- [ ] **12. Blog.** `blog.tsx`: translate the heading, intro, empty state, "Shop women/men",
  "Articles" label, and in `meta` the title (`blog.pageTitle` with `{page}`) and default
  description. `BlogArticle.tsx`: "← Back to the blog". `blog-post.tsx`: the "Article not found"
  `meta`. Server: `formatPublishedDate(iso, locale)` reuses the translator's `formatDate`, and
  the loaders call `getLocale(request)` and pass it to `buildBlogListView`/`buildBlogPostView`
  (also for the `DEFAULT_BLOG_DESCRIPTION` fallback, which becomes a dictionary key).
  `blogCacheHeaders` sends `Vary: Cookie, Accept-Language` (D13). Update `blog.test.ts`,
  `blog-post.test.ts`, `services/blog.test.ts` and `blog-ui.test.ts`.

- [ ] **13. Remaining pages and meta titles.** In `account.tsx`, translate the heading, "Hi,
  {name}!", the orders note and "Log out". In `cart.tsx` and `checkout.tsx`, translate the
  placeholder titles. Every storefront route's `meta` uses `metaTranslator(matches)` and
  `meta.title` (`"{page} — Jassmin"`): login, register, account, cart, checkout, catalog,
  product, blog and blog-post. Admin `meta` stays English (D1). Finally, run a sweep:
  `grep -rnE '>[^<{]*[A-Za-z]{3,}' app/routes app/features app/components --include=*.tsx` and a
  grep for quoted capitalised phrases. Every remaining hit must be an admin file, a brand, a
  class name, or a comment.

- [ ] **14. Docs for later issues.** Add a short "Translations (i18n)" section to `AGENTS.md`
  covering these rules:
  - Storefront copy lives in `app/lib/i18n/uk.ts` + `en.ts` under a namespace per feature. Add
    every key to both files.
  - Components use `useT()`, `meta` uses `metaTranslator(matches)`, and server code uses
    `createTranslator(await getLocale(request))`.
  - zod and action errors return `MessageKey`s.
  - Prices and dates go through the translator's `formatPrice`/`formatDate`.
  - `/admin` stays English and hard-coded.
  - Plural keys need `one/few/many/other` in `uk`.

  Mention in the PR that #10 adds its strings under the `cart` namespace that already exists.

- [ ] **15. Rebase and verify.** After #38 merges: `git fetch origin && git rebase origin/main`,
  resolve `root.tsx`/`PagePlaceholder.tsx`/`account.tsx`, then run `pnpm typecheck`, `pnpm lint`,
  `pnpm test` and `pnpm build`, and do the manual checks below. Remove this plan file before the
  PR is merged.

## Testing & verification

Automated (Vitest, next to the code):

- `app/lib/i18n/dictionaries.test.ts`: identical key sets, no empty strings, `uk` plurals complete,
  and a `@ts-expect-error` for a missing key (enforced by `pnpm typecheck`).
- `app/lib/i18n/translator.test.ts`: interpolation, a missing param left visible, number params
  formatted, uk plurals for 1/2/5/11/21/22/25 and en for 1/2, `formatPrice`/`formatDate` per
  locale, `isMessageKey`.
- `app/lib/i18n/locales.test.ts`: `isLocale`, `uiLocaleForPath` (`/admin`, `/admin/products`,
  `/administrator` → not admin).
- `app/.server/locale.test.ts`: `getLocale` precedence and `Accept-Language` parsing.
- `app/routes/locale.test.ts`: the locale action and loader.
- Updated: `Header.test.ts`, `Footer.test.ts`, `route-error.test.ts`, `money.test.ts`,
  `auth.test.ts`, `login.test.ts`, `register.test.ts`, `catalog.test.ts`, `products.test.ts`,
  `cart.test.ts`, `catalog-ui.test.ts`, `product-ui.test.ts`, `Pagination.test.ts`,
  `contact-form.test.ts`, `HomePage.test.ts`, `blog*.test.ts`, `services/blog.test.ts`,
  `routes.test.ts`.

Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

Manual (`pnpm aspire run`):

1. In a fresh private window with the browser language set to Ukrainian, every page renders in
   Ukrainian and `<html lang="uk">`.
2. With the browser language set to English and no cookie, the first response is already English
   (check with view-source or `curl -H "Accept-Language: en"`).
3. Switch to EN on a catalog page with filters: you land on the same URL, in English, and a
   reload and a new tab stay English.
4. With JS disabled in DevTools, the switcher still works (a full POST and redirect).
5. Prices show `₴` in both locales, and blog dates read `22 жовтня 2026 р.` / `22 October 2026`.
6. Login/register and contact form validation errors appear in the active language, and switching
   language while an error is shown re-renders it translated.
7. `/admin` is English with `<html lang="en">` even when the cookie is `uk`.
8. The 404 page (`/nope`) and a 404 product are translated.
9. The mobile menu shows the switcher, and the focus rings are visible on both surfaces.

## Acceptance criteria

- [ ] Every page renders in Ukrainian by default and in English after switching, including on the
  first SSR response: steps 3, 4, 7–13.
- [ ] `<html lang>` matches the active locale: step 4.
- [ ] The language switcher works without client JS and the choice persists across visits
  (cookie): steps 3, 5, 6.
- [ ] No hard-coded user-facing strings remain in existing components; "Kontakt" is fixed: steps
  7–13 (sweep in 13). The admin area is excluded by D1.
- [ ] Missing translation keys fail `pnpm typecheck`: steps 1 (D3, `@ts-expect-error` test).
- [ ] Prices and dates are formatted for the active locale: steps 2, 10, 12.

## Out of scope

- Translating the admin area (`/admin/*`), unless Q1 is answered otherwise.
- Strapi content (blog articles, home hero/about, site settings) and Strapi's i18n plugin; this
  can be a follow-up issue.
- Product data in PostgreSQL (titles, descriptions, `fragrance_family` values).
- Locale-prefixed URLs, `hreflang` and per-locale sitemaps (D12).
- Multi-currency (prices stay in UAH).
- Storing the locale on the user (`users` table) or sending localized emails.
- New copy for pages that don't exist yet (#10 cart page, #11 checkout, #12 orders). Those issues
  add their own keys.
