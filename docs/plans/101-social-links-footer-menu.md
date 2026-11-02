# Plan: Show Instagram and Telegram links in the footer and menu on every page (#101)

Issue: https://github.com/savchukolgaa/jassmin/issues/101
Branch: `issue/101`
Worktree: `.claude/worktrees/issue-101`
Status: Planned

## Goal

Customers should be able to find Jassmin's Instagram and Telegram from any page. The store's social
links from Strapi site settings appear as icon links in the footer of every page and in the mobile
menu, and the home page contacts section uses the same icons in place of its text buttons. Links are
ordered Instagram, Telegram, then the rest. Tracking parameters are stripped from them, and only
`https:` URLs are rendered.

## Dependencies & prerequisites

- Strapi site settings with `shared.social-link` (#20, #43): exist on `origin/main`
  (`cms/`, `app/.server/cms/schemas.ts` → `socialLinkComponent`, `getSiteSettings` in
  `app/.server/cms/content.ts`).
- Structured data `sameAs` (#86): exists (`app/lib/structured-data.ts`, `storeGraphLd`). It must keep
  working.
- **Content task for staff, not code:** add the Telegram URL (`https://t.me/<name>`) in Strapi →
  Site settings → Social links, in both locales. Until then only Instagram shows.
- No new packages, env vars or migrations.

## Decisions & assumptions

- **Clean the links once on the server, in `toSiteSettings`.** A pure isomorphic helper,
  `normalizeSocialLinks(links)` in `app/lib/social.ts`, trims each URL, drops anything that isn't a
  parseable `https:` URL, removes tracking parameters (`xtok`, `igsh`, `igshid`, `si`, `fbclid`,
  `gclid`, any `utm_*`), drops a trailing empty `?`, removes duplicates and sorts by
  `SOCIAL_ORDER = ["instagram", "telegram", "facebook", "tiktok", "viber", "youtube"]`. Because every
  consumer (contacts section, `sameAs`, footer, mobile menu) reads `SiteSettings.socialLinks`, they
  all get the same clean, ordered list. This also improves `sameAs`, which is the canonical profile
  URL. The issue says "when rendering". Doing it in the DTO mapper gives the same rendered result
  in one place.
- **Data for the layout:** a new `getSocialLinks(locale)` in `app/.server/cms/social.ts`, called in
  the `_shop` layout loader. That loader runs on every navigation and after every action, and
  `cmsFetch` has no cache. Calling Strapi each time would add up to 5 s (`CMS_TIMEOUT_MS`) of latency
  per navigation when Strapi is slow. So `getSocialLinks` keeps a small in-process cache per locale:
  - TTL **60 s**, so a link staff add appears within a minute without a deploy.
  - Concurrent misses share one in-flight promise.
  - **Never throws.** On a `CmsError` it logs once (`console.warn`, like other CMS fallbacks) and
    returns the last good value for that locale, or `[]`. So the footer simply omits the links
    when Strapi is down.
  - A failure is cached for a shorter time (10 s), so an outage doesn't hit Strapi on every request.
  - A `resetSocialLinksCache()` export for tests.
  The issue says to "reuse the cached CMS call", but no such cache exists. This is that cache, kept
  local to social links rather than a generic CMS cache.
- The home page keeps loading full site settings with `getSiteSettings` (an outage there is still a
  503). Its contacts section uses `contacts.socialLinks` from its own loader, so it doesn't depend on
  the layout cache.
- **Passing the links down:** `ShopLayout` passes `socialLinks` to `<Footer socialLinks>` and
  `<Header socialLinks>`, and `Header` passes them to `<MobileMenu socialLinks>`. The layout's
  `ErrorBoundary` reads them with `useRouteLoaderData("routes/_shop")?.socialLinks ?? []`. Prop
  passing matches how `header` state already flows, so no context is needed.
- **`SocialLinks` component** (`app/components/layout/SocialLinks.tsx`):
  `SocialLinks({ links, tone, className })`, with `tone: "onPrimary" | "onLight" | "onInk"`.
  - Renders nothing for an empty list. Otherwise it renders `<ul aria-label={t("social.title")}>` with
    one `<li><a>` per link: `href`, `target="_blank"`, `rel="noopener noreferrer"`,
    `aria-label={t("social.linkLabel", { platform: SOCIAL_LABELS[platform] })}` ("Jassmin on
    Instagram"), and the platform icon inside.
  - Styling: round 44×44 icon button. It reuses `iconButtonClasses(false, tone)` for
    `onPrimary` (footer) and `onLight` (mobile menu). `onInk` (contacts) uses the same shape with the
    `primary-light` focus ring and hover from `ContactsSection` (docs/design.md: the focus ring on
    `ink` is `primary-light`).
  - Ordering and filtering are already done by `normalizeSocialLinks`. The component still filters
    out empty URLs defensively. It doesn't sort again.
- **Icons** in `app/components/layout/icons.tsx`: `InstagramIcon`, `TelegramIcon`, `FacebookIcon`,
  `TikTokIcon`, `ViberIcon` and `YouTubeIcon`. These are filled glyphs (`fill="currentColor"`,
  `stroke="none"`, `aria-hidden`) that keep the official shapes. A small `GlyphIcon` wrapper sits
  beside the outline `Icon`. `SOCIAL_ICONS: Record<SocialPlatform, ComponentType<IconProps>>` lives
  next to them, so the type checker catches a missing platform.
- **Icons, as implemented:** the glyphs use the existing outline `Icon` wrapper (24×24 viewBox,
  1.75 px `currentColor` stroke) and not filled shapes. The marks stay recognisable (camera for
  Instagram, paper plane for Telegram, and so on) and match the header's icon set. No separate
  `GlyphIcon` was needed.
- **Ukrainian accessible name, as implemented:** "Jassmin у {platform}" (the euphonic «у» after a
  consonant) instead of «в». The list label reuses the existing wording "Соціальні мережі".
- **Footer placement:** a row above the nav. It has an optional visible "Follow us" label
  (`social.followUs`) and the icons, and is shown only when there are links.
- **Mobile menu placement:** a new `<li>` after the locale switcher, separated by the same
  `border-line border-t` rule, with `tone="onLight"`.
- i18n: a new top-level `social` namespace in both `uk.ts` and `en.ts`:
  - `social.title`: "Соцмережі" / "Social media"
  - `social.followUs`: "Стежте за нами" / "Follow us"
  - `social.linkLabel`: "Jassmin в {platform}" / "Jassmin on {platform}"

  `home.contacts.social` becomes unused and is removed from both files.

## Resolved questions

- **Is the CMS call cached anywhere today?** No. `cmsFetch` calls `fetch` with a timeout each time,
  and `getSiteSettings` is called only by `home` and `privacy` (source:
  `app/.server/cms/client.ts`, `app/routes/home.tsx`, `app/routes/privacy.tsx`). Hence the new
  per-locale TTL cache.
- **Which loader runs on every page?** `routes/_shop` (`app/routes/_shop.tsx`). It already feeds
  `Header` and `Footer`, including in its `ErrorBoundary`.
- **Does the URL schema already validate URLs?** No, `url: z.string()` (source:
  `app/.server/cms/schemas.ts`). The `https:` check goes in `normalizeSocialLinks`, not the zod
  schema, so a single bad link is dropped instead of failing the whole site settings response
  (which would 503 the home page).
- **Focus ring and tone per surface:** `focusRing(tone)` / `iconButtonClasses` in
  `app/components/layout/nav.ts`. On `ink` the ring is `primary-light` (`ContactsSection.tsx`,
  docs/design.md).
- **Where may zod go?** Only `*.schema.ts`, loaders and server code (AGENTS.md, #96).
  `app/lib/social.ts` uses only `URL`, so it stays client-safe.
- **Locale for the layout loader:** `getLocale(request)` from `app/.server/locale.ts`, as the home
  loader does. Strapi falls back to Ukrainian via `getSingleType`.

## Open questions

- [ ] **Q1: The shop's Telegram URL.** Why it matters: the Telegram icon only appears once it's set
  in Strapi. No code depends on it. Recommended default: ship without it and staff add it in
  Strapi. Affects steps: none (verification only).
- [ ] **Q2: Show the visible "Follow us" label in the footer?** Why it matters: it's purely
  visual, and the list has an accessible name either way. Recommended default: show it as small
  white text before the icons. Affects step: 6.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `app/lib/social.ts` | `SOCIAL_ORDER`, `cleanSocialUrl`, `normalizeSocialLinks` (isomorphic, no zod) |
| create | `app/lib/social.test.ts` | URL cleaning, https-only, ordering, de-duplication |
| modify | `app/.server/cms/content.ts` | `toSiteSettings` applies `normalizeSocialLinks` |
| modify | `app/.server/cms/content.test.ts` | `toSiteSettings` cleans and orders links |
| create | `app/.server/cms/social.ts` | `getSocialLinks(locale)`: TTL cache that never throws; `resetSocialLinksCache` |
| create | `app/.server/cms/social.test.ts` | cache hit, TTL expiry, stale-on-error, `[]` when down |
| modify | `app/components/layout/icons.tsx` | brand glyph icons + `SOCIAL_ICONS` map |
| create | `app/components/layout/SocialLinks.tsx` | shared icon-link list |
| create | `app/components/layout/SocialLinks.test.ts` | renders only given links, in order, labels, target/rel, 44 px, tones |
| modify | `app/routes/_shop.tsx` | loader returns `socialLinks`; passes them to Header/Footer (+ ErrorBoundary) |
| modify | `app/components/layout/Footer.tsx` (+ `Footer.test.ts`) | `socialLinks` prop, "Follow us" row |
| modify | `app/components/layout/Header.tsx` (+ `Header.test.ts`) | forwards `socialLinks` to `MobileMenu` |
| modify | `app/components/layout/MobileMenu.tsx` | renders `SocialLinks tone="onLight"` |
| modify | `app/features/home/ContactsSection.tsx` | text buttons → `SocialLinks tone="onInk"` |
| modify | `app/features/home/HomePage.test.ts` | contacts renders icon links with accessible names |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `social.*` keys; drop `home.contacts.social` |
| modify | `app/.server/AGENTS.md` | one line on the `getSocialLinks` cache under the CMS section |
| test   | `app/routes/_shop.test.ts` (create if missing) | loader includes `socialLinks`; Strapi down → `[]` |

## Steps

- [x] **1. URL hygiene helper.** Create `app/lib/social.ts` with:
  - `cleanSocialUrl(raw: string): string | null`, which uses `new URL()` in a try/catch, rejects
    anything that isn't `https:`, deletes the tracking params listed above plus every `utm_*` key,
    and returns `url.toString()` with an empty `?` removed.
  - `normalizeSocialLinks(links: readonly SocialLink[]): SocialLink[]`, which cleans each link,
    drops nulls, de-duplicates by platform and URL, and stable-sorts by `SOCIAL_ORDER`.

  Tests cover these cases:
  - The real Instagram URL with `?xtok=…` comes out as `https://www.instagram.com/jassminperfume`.
  - `http:`, `javascript:`, `t.me/x` (no scheme) and the empty string are rejected.
  - Other query params are kept.
  - A Telegram link given first is ordered after Instagram.
- [x] **2. Apply in the DTO.** `toSiteSettings` returns
  `socialLinks: normalizeSocialLinks(entry.socialLinks ?? [])`. Extend `content.test.ts`. Run the
  `structured-data` tests to confirm `sameAs` still works; it now gets cleaned URLs.
- [x] **3. Cached layout data.** Create `app/.server/cms/social.ts` with
  `getSocialLinks(locale): Promise<SocialLink[]>`. It wraps `getSiteSettings(locale)`, keeps a
  `Map<Locale, { value; expiresAt; pending? }>`, uses a 60 s TTL on success and 10 s after a
  failure, returns the stale value or `[]` on error, and never rejects. Mock
  `~/.server/cms/content` in tests and use `vi.useFakeTimers()` to cover:
  - a second call within the TTL doesn't refetch;
  - after the TTL it refetches, so new links show without a deploy;
  - `CmsError` with no previous value gives `[]`;
  - `CmsError` after a success gives the stale value.
- [x] **4. Icons.** Add `GlyphIcon` and six brand glyphs to `icons.tsx` (24×24 viewBox,
  `fill="currentColor"`, `aria-hidden="true"`), plus `SOCIAL_ICONS`.
- [x] **5. `SocialLinks` component.** Implement as described in Decisions. Use
  `renderToStaticMarkup` tests in the style of `Footer.test.ts`:
  - An empty list renders `""`.
  - Instagram and Telegram render in order with English labels "Jassmin on Instagram" / "Jassmin on
    Telegram" (inside `<I18nProvider locale="en">`) and the Ukrainian label by default.
  - Each link has `target="_blank"`, `rel="noopener noreferrer"` and `size-11`.
  - Tone switches the focus ring class (`outline-white` / `outline-primary` /
    `outline-primary-light`).
- [x] **6. i18n keys.** Add the `social` namespace to `uk.ts` and `en.ts`. `pnpm typecheck` catches
  any mismatch.
- [x] **7. Footer.** `Footer({ socialLinks = [] }: { socialLinks?: readonly SocialLink[] })` renders
  the "Follow us" row with `<SocialLinks tone="onPrimary">` when the list isn't empty. Update
  `Footer.test.ts`: links render when passed, and the row is absent when the list is empty.
- [x] **8. Header and mobile menu.** Add an optional `socialLinks` prop to `Header`, forward it to
  `MobileMenu`, and render a new bordered `<li>` with `<SocialLinks tone="onLight">` after the locale
  switcher, only when there are links. Extend `Header.test.ts` so the mobile menu markup contains
  the labelled Instagram link.
- [x] **9. Layout loader.** In `_shop.tsx`, add `getLocale(request).then(getSocialLinks)` to the
  `Promise.all` and return `socialLinks`. Pass it to `<Header>` and `<Footer>` in both the component
  and `ErrorBoundary` (`?.socialLinks ?? []`). Add a loader test that mocks `getSocialLinks` and
  checks the returned data.
- [ ] **10. Contacts section.** Replace the text-button `<ul>` with
  `<SocialLinks links={contacts.socialLinks} tone="onInk" className="mt-8" />`. Remove the unused
  `buttonClasses`/`SOCIAL_LABELS` imports and the `home.contacts.social` key. Update
  `HomePage.test.ts`.
- [ ] **11. Docs.** Add a line to `app/.server/AGENTS.md` (CMS section) on `getSocialLinks`: its
  60 s cache, that it never throws, and that it's used by the `_shop` layout.
- [ ] **12. Verify.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`. Then
  `pnpm aspire run` and check by hand (see below).

## Testing & verification

- Unit tests: `app/lib/social.test.ts`, `app/.server/cms/social.test.ts`, `SocialLinks.test.ts`,
  plus updates to `content.test.ts`, `Footer.test.ts`, `Header.test.ts`, `HomePage.test.ts` and the
  `_shop` loader test. `structured-data.test.ts` must still pass unchanged.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`):
  - The footer on `/`, a catalog page, a product page, `/en/…` and a 404 page shows the Instagram
    icon. Its `href` has no `xtok` and it opens in a new tab.
  - Tab to each icon: the focus ring is visible on deep pink, white and ink.
  - On a narrow viewport, open the mobile menu and check the icons appear under the language
    switcher.
  - Add a Telegram link in Strapi; it appears within about 60 s, ordered after Instagram.
  - Stop Strapi: the footer renders without icons and other pages don't error. The home page is
    still a 503, as before.
  - Screen reader or devtools accessibility tree: the names read "Jassmin on Instagram" /
    "Jassmin в Instagram".

## Acceptance criteria

- [ ] Every page's footer and the mobile menu show Instagram and Telegram icon links when they're
  set in Strapi — steps 3, 4, 5, 7, 8, 9
- [ ] Links open the profile in a new tab and have translated accessible names, a visible focus ring
  and 44 px touch targets — steps 5, 6
- [ ] Tracking parameters are removed from the rendered URLs — steps 1, 2
- [ ] The home contacts section uses the same icons — step 10
- [ ] After staff add the Telegram link in Strapi, it appears without a deploy — step 3 (60 s TTL)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 12

## Out of scope

- Instagram feed embeds or a Telegram chat widget.
- Entering the Telegram URL in Strapi (a content task for staff).
- Changing the Strapi `social-link` component, such as adding URL validation in the CMS.
- A general cache for other CMS content (home page, blog, offers).
- Social links in the desktop header bar.
