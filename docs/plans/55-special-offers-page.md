# Plan: Add special offers page with Strapi-managed offers (#55)

Issue: https://github.com/savchukolgaa/jassmin/issues/55
Branch: `issue/55`
Worktree: `.claude/worktrees/issue-55`
Status: Planned

## Goal
As a shopper, I want one page with the store's current special offers (discovery sets, seasonal
campaigns, gift ideas, last units and always-on perks) so I can find deals and gift ideas easily.
We add a localized `offer` collection type in Strapi and a `/offers` storefront page that shows
the offers active today, grouped by type, each linking to its products or a catalog. Offers are
editorial only: they never change prices at checkout.

## Dependencies & prerequisites
- **Strapi integration (#20, #43)**: done. `cmsFetch`, `CmsError`/`cmsUnavailable`, locale
  fallback (`withLocaleFallback`) and the `blog-post` collection pattern exist in
  `app/.server/cms/` and `cms/src/api/blog-post/`.
- **Volume variants (#26)**: done. `product_variants` has per-size price and stock, and
  `listProducts()` in `app/.server/db/queries/products.ts` builds `ProductSummary` rows.
- **Account dashboard (#12)**: done. Its empty "No orders yet" state (`account.orders.empty` in
  i18n) can now link to `/offers`.
- **Products in Strapi (#40)**: open, not required. Until it lands, offers reference products by
  `products.public_id` and the app resolves them from PostgreSQL.
- **Discounts at checkout**: no issue exists yet (searched `discount OR promo`). The acceptance
  criteria require one to track price-changing promotions (step 13).
- No new env vars, packages or DB migrations. The Strapi API token needs `api::offer.offer.find`
  (step 3).

## Decisions & assumptions
- **Strapi model** (`cms/src/api/offer/content-types/offer/schema.json`), `draftAndPublish: true`,
  localized like `blog-post`:
  - localized: `title` (string, required, ≤ 120), `summary` (text, ≤ 300), `body` (richtext /
    Markdown), `priceNote` (string, ≤ 80), `ctaLabel` (string, ≤ 40);
  - not localized: `slug` (uid from `title`), `image` (media, images), `kind` (enumeration of
    `discovery-set`, `seasonal`, `gift`, `bundle`, `featured`, `last-units`, `perk`, required),
    `startsAt` / `endsAt` (optional), `products` (see next point), `ctaUrl` (string),
    `sortOrder` (integer, default 0).
- **`productIds` as a repeatable component** `offers.product-ref` with one non-localized
  `publicId` string (`regex` for a UUID), exposed to the app as `productIds: string[]`. Strapi has
  no string-list field; a component gives editors one input per product with validation, where a
  `json` field would mean hand-typed JSON. The schema key is `products`; the DTO field is
  `productIds`.
- **Offer kinds are a shared constant** `OFFER_KINDS` in `~/lib/cms` (like `SOCIAL_PLATFORMS`),
  used by the zod schema, the DTO type and the grouping order. Card groups render in this order:
  `discovery-set`, `seasonal`, `gift`, `bundle`, `featured`, `last-units`. `perk` offers aren't
  cards: they fill the perks strip.
- **Active window** (**unconfirmed**, Q1): `startsAt` / `endsAt` are Strapi `date` fields (no
  time), inclusive, compared with today's date in `Europe/Kyiv` (the translator's time zone).
  Missing `startsAt` means "already started", missing `endsAt` means "no end". Strapi filters the
  window (`$or` of `$null` / `$lte` / `$gte`), and a pure `isOfferActive(offer, today)` applies
  the same rule in the app so it's unit-testable and safe against clock skew.
- **Locale fallback** like `listBlogPosts`: read the active `uk` offers (dates and kind aren't
  localized, so `uk` decides what's active), then fetch the `en` translations by `documentId` and
  swap each one in when present. One page of up to `MAX_PAGE_SIZE` (50) offers, sorted
  `sortOrder:asc`, then `startsAt:desc` as a tie-breaker.
- **Hero** (**unconfirmed**, Q2): the "main campaign" is the first active `seasonal` offer by
  `sortOrder`, else the first active non-perk offer. It isn't repeated as a card.
- **Empty state**: shown when no non-perk offer is active. The perks strip still renders when perk
  offers exist; the empty state offers both catalogs and the blog.
- **CTA links** are internal paths only. A new `toInternalPath(href)` in `app/lib/links.ts` reuses
  `resolveCtaHref`'s internal-path rule and returns `null` for anything else (external URLs,
  `javascript:`, `//host`); the CTA is then hidden, and the card still links its products.
- **Products** are resolved in one query: a new `listProductSummariesByPublicIds(db, ids)` in
  `app/.server/db/queries/products.ts` reuses `variantStats()` with the same inner join as the
  catalog, so products without variants ("inactive") drop out, like unknown ids. Ids that aren't
  UUIDs are dropped before querying (PostgreSQL would reject the `uuid` cast). Out-of-stock
  products stay, with `ProductCard`'s disabled add-to-cart, which suits "last units". Products keep
  the order the editor gave them.
- **`ProductCard` heading level**: it renders an `h2`; on `/offers` products sit under an offer
  `h3`, so add an optional `headingLevel` prop (default `2`, unchanged for the catalog).
- **Rendering**: a new `app/.server/services/offers.ts` builds an `OffersPageView` (hero, perks,
  groups, `bodyHtml` via `renderMarkdown()`, `validUntilLabel` via `formatDate`), like
  `buildHomePageView` / `buildBlogListView`. Price text is the editor's `priceNote`, shown as-is.
- **Caching**: like `/blog`, `blogCacheHeaders(request)` (public 60 s for visitors without a
  session, `Vary: Cookie, Accept-Language`) plus a `headers` export that doesn't cache errors.
  Product stock on the page may be up to a minute stale; the cart re-checks stock anyway. Generalise
  the helper's name only if it reads oddly (e.g. `cmsPageCacheHeaders`); keep the blog working.
- **Navigation**: `OFFERS_LINK = { to: "/offers", labelKey: "nav.offers" }` in `nav.ts`; the
  header (desktop list after the catalog menu, and `MobileMenu`) and `FOOTER_LINKS` (after the
  catalogs, before Blog) render it.
- **Account empty state** (#12): add an "Offers" `ButtonLink` next to the catalog links in the
  "No orders yet" state, as the issue's context asks.
- **Design canvas** (**unconfirmed**, Q3): add a `C+ Offers` artboard (desktop and phone width,
  hero, perks strip, grouped cards, empty state) to the C+ canvas artifact
  (https://claude.ai/artifact/RCvne95y2han2bw8dWm1iW) with the Artifact tool, using only existing
  tokens and components, and list it in `docs/design.md`.

## Open questions
- [ ] **Q1: Should `startsAt` / `endsAt` be dates or date-times?** — Why it matters: holiday
  campaigns are naturally whole days ("valid until 14 February"), but a date-time allows e.g. a
  Black Friday sale that ends at 23:59 or starts at noon. It changes the Strapi field type, the
  filter and the "valid until" label. Recommended default: `date` fields, inclusive, in
  `Europe/Kyiv`. Affects steps: 1, 4, 5, 7.
- [ ] **Q2: Which offer is the hero's "main campaign"?** — Why it matters: the content type has no
  "featured" flag. Recommended default: the first active `seasonal` offer by `sortOrder`, else the
  first non-perk offer; no extra field. Alternative: a boolean `isHero` field. Affects steps: 1, 6.
- [ ] **Q3: May `/implement` update the shared C+ design canvas artifact directly?** — Why it
  matters: the canvas is the owner's private artifact, and the acceptance criteria need the
  mockup on it. Recommended default: yes, add the `C+ Offers` artboard by republishing the canvas
  (after reading its current version), and report the link. Affects step: 12.
- [ ] **Q4: Should `/implement` create the follow-up "discounts at checkout" issue?** — Why it
  matters: acceptance criteria say price-changing promotions are tracked in a separate issue, and
  none exists. Creating a GitHub issue is outward-facing. Recommended default: yes, with
  `/create-issue` (promo codes, bundle and trio prices, `orders.discount_amount`), and link it in
  this issue's PR. Affects step: 13.

## Resolved questions
- **How are CMS reads, errors and locales done?** — Through `cmsFetch` with a zod schema,
  `CmsError` → `cmsUnavailable` (503), and `uk` fallback per entry by `documentId` for
  collections (source: `app/.server/cms/content.ts` `listBlogPosts`, `app/.server/AGENTS.md`).
- **What is an "inactive" product?** — There's no active flag on `products`; the catalog lists
  only products with at least one variant (inner join on `variantStats`). Offers use the same rule
  (source: `app/.server/db/queries/products.ts`).
- **Is there a product card DTO to reuse?** — Yes, `ProductSummary` (title, brand, image, sizes,
  min price, default variant) and `ProductCard` (source: `app/lib/products.ts`,
  `app/features/catalog/ProductCard.tsx`).
- **Which time zone do dates use?** — `Europe/Kyiv` in the translator's `formatDate` (source:
  `app/lib/i18n/translator.ts`).
- **How are editor links made safe?** — `resolveCtaHref` accepts `/path` but not `//host` or
  `/\` (source: `app/lib/links.ts`).
- **Does the token get new permissions automatically?** — No: `seedApiToken` skips an existing
  token, and `TOKEN_PERMISSIONS` lists the allowed actions (source: `cms/scripts/seed.ts`), so
  step 3 handles existing tokens.
- **Free delivery threshold** — `FREE_SHIPPING_THRESHOLD = "1000.00"` (source:
  `app/lib/checkout.ts`); the perk's text is editorial and seeded to match.
- **Unisex** — there is no Unisex catalog; offer CTAs and the empty state link only
  `/catalog/women` and `/catalog/men` (source: `docs/design.md`).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `cms/src/api/offer/content-types/offer/schema.json` | `offer` collection type |
| create | `cms/src/api/offer/{controllers,routes,services}/offer.ts` | Core factories, like `blog-post` |
| create | `cms/src/components/offers/product-ref.json` | Repeatable `{ publicId }` product reference |
| modify | `cms/src/index.ts` | Add `api::offer.offer` to `PROTECTED_UIDS` |
| modify | `cms/scripts/seed.ts` | Seed offers (uk/en), seed image, token permission sync |
| create | `cms/scripts/seed-data/offer-trio.jpg` (and/or reuse `hero.jpg`) | Seed image |
| modify | `cms/types/generated/*.d.ts` | Regenerated by Strapi |
| modify | `README.md` | Content model table, token permissions, seed description |
| modify | `app/.server/AGENTS.md` | List `listActiveOffers` among the content queries |
| modify | `app/lib/cms.ts` | `OFFER_KINDS`, `OfferKind`, `Offer` DTO |
| modify | `app/.server/cms/schemas.ts` | `offerEntry` zod schema |
| modify | `app/.server/cms/content.ts` | `toOffer`, `isOfferActive`, `kyivToday`, `listActiveOffers` |
| create | `app/.server/cms/__fixtures__/offers.json`, `offers.en.json`, `offers-empty.json` | Recorded responses |
| modify | `app/.server/cms/schemas.test.ts`, `content.test.ts` | Schema, mapper, window, fallback tests |
| modify | `app/.server/db/queries/products.ts` | `listProductSummariesByPublicIds` |
| modify | `app/.server/services/products.ts` | `getProductSummaries(ids, db)` |
| create | `app/lib/offers.ts` | `OffersPageView` types, group order |
| create | `app/.server/services/offers.ts` (+ `.test.ts`) | `buildOffersPageView` |
| modify | `app/lib/links.ts` (+ test) | `toInternalPath` |
| create | `app/routes/offers.tsx` (+ `offers.test.ts`) | Loader, meta, headers, page, ErrorBoundary |
| modify | `app/routes.ts` | `route("offers", "routes/offers.tsx")` under `_shop` |
| create | `app/features/offers/{OffersHero,PerksStrip,OfferCard,OfferGroup,OffersEmpty}.tsx` | Page UI |
| create | `app/features/offers/offers-ui.test.ts` | Component tests in uk/en |
| modify | `app/features/catalog/ProductCard.tsx` | Optional `headingLevel` |
| modify | `app/components/layout/nav.ts`, `Header.tsx`, `MobileMenu.tsx` | Offers link |
| modify | `app/components/layout/Header.test.ts`, `Footer.test.ts` | Expect the link |
| modify | `app/features/account/*` (empty orders state) | Link to `/offers` |
| modify | `app/lib/i18n/uk.ts`, `en.ts` | `nav.offers`, `offers` namespace, account link |
| modify | `docs/design.md` | `C+ Offers` row in "Pages and issues" |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [ ] **1. Strapi content type** — Create `cms/src/api/offer/` (schema, controller, router,
  service via `factories.createCore*("api::offer.offer")`) and `cms/src/components/offers/
  product-ref.json` per the decisions above. Add `api::offer.offer` to `PROTECTED_UIDS` in
  `cms/src/index.ts`. Run `pnpm cms:dev` once so Strapi regenerates `cms/types/generated/`, and
  check the type and both locales in the admin.
- [ ] **2. Seed offers** — In `cms/scripts/seed.ts`, add `OFFERS: SeedOffer[]` with `uk` and `en`
  copy and `seedOffers(strapi, imageId)` following `seedBlogPosts` (idempotent by `slug` + locale,
  `en` added via `update` on the `uk` document): a tester trio (`discovery-set`, priceNote "3 × 7
  мл — 499 ₴", CTA `/catalog/women`), gift ideas by budget (`gift`, up to 500 / 1000 / 2000 ₴), the
  free-delivery perk (`perk`, "Безкоштовна доставка Новою Поштою від 1000 ₴") and a welcome perk,
  one current seasonal campaign (`seasonal`, window spanning the seed date, e.g. St Nicholas Day
  to New Year) and one expired seasonal campaign to exercise filtering. `products` uses the fixed
  `publicId`s from the app's DB seed (`app/.server/db/seed-data.ts`), plus one made-up UUID in the
  gift offer to show that missing products are skipped. Update the header comment.
- [ ] **3. Token permissions** — Add `api::offer.offer.find` to `TOKEN_PERMISSIONS`. When the
  `jassmin-web` token already exists, add missing permissions to it (the api-token service's
  `update`, without regenerating the key) and log it, so existing setups don't 403. Update
  README's manual token list ("Offer: `find`"), the seed description and the content model table.
- [ ] **4. DTO and schema** — In `app/lib/cms.ts` add `OFFER_KINDS`, `OfferKind` and
  `interface Offer { locale, slug, kind, title, summary: string | null, body: string | null,
  image: CmsImage | null, startsAt: string | null, endsAt: string | null, priceNote: string |
  null, productIds: string[], ctaLabel: string | null, ctaUrl: string | null, sortOrder: number }`.
  In `schemas.ts` add `offerEntry` (`kind: z.enum(OFFER_KINDS)`, dates as `z.iso.date()`
  nullish, `products: z.array(z.object({ publicId: z.string() })).nullish()`, `image:
  strapiMedia.nullish()`) and its type.
- [ ] **5. Content query** — In `content.ts` add `toOffer(entry, baseUrl, requested)` (UUID-only
  `productIds`, de-duplicated; trims empty strings to `null`), `kyivToday(now)` returning
  `YYYY-MM-DD` in `Europe/Kyiv`, `isOfferActive(offer, today)`, and `listActiveOffers(locale,
  now = new Date())`: one `cmsFetch("offers", { filters: window, sort: ["sortOrder:asc",
  "startsAt:desc"], pagination: { page: 1, pageSize: MAX_PAGE_SIZE }, populate: { image: true,
  products: true } }, collectionResponse(offerEntry), { locale: "uk" })`, then the translation
  fetch by `documentId` for `en` as in `listBlogPosts`, mapping and a final
  `.filter(isOfferActive)`. Record `offers.json`, `offers.en.json` and `offers-empty.json` from the
  seeded Strapi.
- [ ] **6. CMS tests** — `schemas.test.ts`: the fixtures parse; an unknown `kind` is rejected.
  `content.test.ts`: `toOffer` maps absolute image URLs and drops non-UUID ids; `isOfferActive`
  for no dates, only start, only end, today on each boundary, and outside the window (including
  the Kyiv-vs-UTC midnight edge); `listActiveOffers` sends the window filter, sort and `locale=uk`,
  swaps in English translations and keeps Ukrainian where missing, and turns an outage into
  `CmsError`.
- [ ] **7. Product lookup** — Add `listProductSummariesByPublicIds(db, ids)` (same select as
  `listProducts`, `inArray(products.publicId, ids)`, inner join on `variantStats`) and
  `getProductSummaries(ids, db = defaultDb): Promise<Map<string, ProductSummary>>` in
  `services/products.ts` (returns an empty map without querying when `ids` is empty). Test it in
  `products.test.ts` with the existing DB test utilities: unknown ids and products without
  variants are missing.
- [ ] **8. View builder** — `app/lib/offers.ts`: `OFFER_GROUP_ORDER` (kinds minus `perk`) and
  `OffersPageView { hero: OfferView | null, perks: OfferView[], groups: { kind, offers }[] }`,
  where `OfferView` adds `bodyHtml`, `validUntilLabel`, `cta: { label, to } | null` and
  `products: ProductSummary[]`. `app/lib/links.ts`: `toInternalPath(href)` (+ tests).
  `app/.server/services/offers.ts`: `buildOffersPageView(offers, productsById, locale)` picks the
  hero, splits perks, groups the rest in `OFFER_GROUP_ORDER` (empty groups omitted), resolves
  products in editor order skipping missing ones, renders `body` with `renderMarkdown()` and
  formats `endsAt` with `createTranslator(locale).formatDate`. Unit-test hero choice, grouping,
  skipped products, unsafe CTA → `null`, and the empty case.
- [ ] **9. Route** — Add `route("offers", "routes/offers.tsx")` under the `_shop` layout in
  `app/routes.ts`. In `routes/offers.tsx`: `loader` gets the locale, `listActiveOffers(locale)
  .catch(cmsUnavailable)`, collects all `productIds`, calls `getProductSummaries` once, and returns
  `data(buildOffersPageView(...), { headers: blogCacheHeaders(request) })`; `headers` like
  `/blog`; `meta` with `metaTranslator(matches)` (`offers.metaTitle`, `offers.metaDescription`,
  og tags); `ErrorBoundary` via `ErrorContent` + `describeRouteError`. `routes/offers.test.ts`
  mocks `~/.server/cms/content` and `~/.server/services/products`: locale passed through, CMS down
  → 503, products resolved in one call and missing ones dropped, empty list → empty view, cache
  headers, meta in English.
- [ ] **10. Page UI** — In `app/features/offers/`: `OffersHero` (deep-pink `bg-primary` band,
  white text, image in the C+ arch, `priceNote`, primary `ButtonLink`), `PerksStrip` (blush row of
  short perks), `OfferGroup` (`h2` per kind from `offers.kinds.*`), `OfferCard` (image, `h3`
  title, summary, `RichText` body, optional "valid until {date}", optional price note,
  `ButtonLink` CTA, and a grid of `ProductCard headingLevel={4}`), `OffersEmpty` (blush panel like
  `/blog`'s empty state, links to both catalogs and the blog). Add `headingLevel` to
  `ProductCard`. Follow `docs/design.md` (tokens, focus rings, motion) and make it work at phone
  width. Component tests in `offers-ui.test.ts`: uk by default, English inside
  `<I18nProvider locale="en">`, valid-until label, CTA hidden when `null`, empty state.
- [ ] **11. Navigation, i18n and account link** — Add `nav.offers` ("Акції" / "Offers") and the
  `offers` namespace (title, intro, perks label, `kinds.*`, `validUntil`, empty state copy, meta)
  to `uk.ts` and `en.ts`. Add `OFFERS_LINK` to `nav.ts`, render it in `Header.tsx` and
  `MobileMenu.tsx`, and put it in `FOOTER_LINKS` after the catalogs; update `Header.test.ts` and
  `Footer.test.ts`. Add an `/offers` link to the account "No orders yet" state with
  `account.orders.empty.offers`.
- [ ] **12. Design** — Add the `C+ Offers` artboard to the C+ canvas (Q3): hero, perks strip,
  grouped cards, empty state, phone width, existing tokens and components only. Add the row
  `| \`C+ Offers\` | \`/offers\` | #55 |` to "Pages and issues" in `docs/design.md`, and match the
  implemented UI to it.
- [ ] **13. Follow-up issue** — Create the "discounts and promo codes at checkout" issue with
  `/create-issue` (Q4), and reference it from this issue's PR. Docs: list `listActiveOffers` in
  `app/.server/AGENTS.md`'s CMS section.

## Testing & verification
- Automated: steps 6, 7, 8, 9, 10, 11 add or update Vitest tests (`schemas.test.ts`,
  `content.test.ts`, `products.test.ts`, `services/offers.test.ts`, `links.test.ts`,
  `routes/offers.test.ts`, `offers-ui.test.ts`, `Header.test.ts`, `Footer.test.ts`).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test` before every commit; `pnpm build` before
  finishing.
- Manual (`pnpm aspire run`, then run `cms-seed` from the dashboard): `/offers` in Ukrainian and
  English (switch locale) shows the hero, perks, grouped cards and products, not the expired
  campaign; unpublish all non-perk offers → empty state; stop the `cms` resource → 503 page;
  delete a referenced product's variants → it disappears from its offer; header (desktop and
  mobile) and footer link to `/offers`; check at 375 px width; add a product from an offer to the
  cart and confirm the checkout total is unchanged (no discount).

## Acceptance criteria
- [ ] A C+ design mockup of the offers page is on the design canvas and listed in
  `docs/design.md` — step 12
- [ ] Strapi has a localized `offer` content type supporting the offer types above, with seed
  examples — steps 1, 2, 3
- [ ] `/offers` lists only offers whose date window includes today, grouped by type, in Ukrainian
  and English — steps 4, 5, 6, 8, 9, 10, 11
- [ ] Offers link to their products or catalog, and products that no longer exist are skipped —
  steps 7, 8, 9, 10
- [ ] The page shows an empty state when no offers are active, and a 503 error page when Strapi is
  down — steps 8, 9, 10
- [ ] "Offers" is linked from the header and footer — step 11
- [ ] No offer changes prices at checkout; price-changing promotions are tracked in a separate
  issue — decisions (editorial `priceNote` only, no checkout changes), step 13

## Out of scope
- Discount and promo-code calculation at checkout (`orders.discount_amount` stays `0`), bundle or
  trio pricing, and "add the whole set to cart" in one click.
- Personalized offers, email campaigns, offer detail pages (`/offers/:slug`) and offer analytics
  events.
- Admin UI in the app (Strapi is the admin), and moving products to Strapi (#40).
- Showing offers on the home page or product pages.
