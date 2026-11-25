# Plan: Add public offer, delivery and payment, and returns pages (#190)

Issue: https://github.com/savchukolgaa/jassmin/issues/190
Branch: `issue/190`
Worktree: `.claude/worktrees/issue-190`
Status: Planned

## Goal

Customers can read the shop's public offer (публічна оферта), delivery and payment terms and
return rules, in Ukrainian and English, before they order, so they know who the seller is and what
their rights are. The owner gets the pages Ukrainian law and payment providers (LiqPay, WayForPay,
Monobank) expect. The pages show the seller's legal details from Strapi, are linked from the
footer, checkout, the order and gift-card emails and the sitemap, and every new order records which
version of the offer the customer accepted.

## Dependencies & prerequisites

- **Privacy page (#18)**: exists. `app/routes/privacy.tsx` + `app/features/privacy/PrivacyPolicy.tsx`
  are the pattern to copy; `PRIVACY_POLICY_UPDATED_AT` lives in `app/lib/consent.ts`.
- **Localized paths (#84)**, **SEO meta (#85)**, **sitemap with hreflang (#87)**: exist
  (`app/lib/paths.ts`, `app/lib/seo.ts` → `seoMeta`, `app/.server/services/sitemap.ts`).
- **Order and gift-card emails (#45, #125, #134)**: exist in `app/.server/services/order-email.ts`
  with the shared layout `app/.server/email/layout.ts` (`EmailFooter`, `renderEmail`).
- **Nova Poshta (#136, #137)**, **card payments (#44)**, **gift cards (#125)**, **couple offer
  (#124)**: closed; the pages describe them.
- **New DB migration**: `orders.offer_version date` (nullable), generated with `pnpm db:generate`
  as `app/.server/db/migrations/0036_*.sql`.
- **Strapi schema change**: three new fields on `site-setting`; Strapi must be restarted to pick
  them up, and `cms/types/generated/contentTypes.d.ts` regenerates on `strapi develop`.
- No new environment variables or packages.

## Decisions & assumptions

- **One isomorphic module `app/lib/legal.ts`** holds `OFFER_UPDATED_AT`, `RETURNS_UPDATED_AT`,
  `DELIVERY_UPDATED_AT` (for the sitemap's `lastmod`), `RETURN_REPORT_DAYS = 14`, the
  `SellerDetails` DTO and `missingSellerDetails(details)` (the list of empty required fields).
  Dates are `"YYYY-MM-DD"` strings like `PRIVACY_POLICY_UPDATED_AT`.
- **Required seller details**: `legalName`, `taxId`, `legalAddress`, `phone`, `email`.
  `registrationNote` is optional (shown when filled). `phone`/`email` are already required in
  Strapi, so in practice only the first three can be missing.
- **Strapi fields** on `site-setting`: `taxId` (string, not localized, `regex: ^\d{10}$`,
  maxLength 10), `legalAddress` (string, localized, maxLength 255), `registrationNote` (text,
  localized, maxLength 500). `legalName` stays non-localized (the ФОП's name is shown in
  Cyrillic on the English page too). Strapi serves the whole `en` entry, so an English
  `legalAddress` left empty arrives as `null`; whether that falls back to the Ukrainian value is
  settled by Q3 (fall back to Ukrainian).
- **The seed** (`cms/scripts/seed.ts`) leaves the new fields empty, so a fresh dev setup shows the
  placeholders.
- **Missing details on the page**: outside production a highlighted placeholder
  (`legal.seller.missing`: "⚠ {field} — не заповнено в налаштуваннях сайту (Strapi)") replaces the
  value; in production the line is left out. (Q1: confirmed)
- **Strapi down**: like `/konfidentsiinist`, the loaders catch the CMS error, log it and render the
  pages with `seller: null` (a fallback sentence pointing to the contacts on the home page) instead
  of a 503. A legal page must stay readable.
- **Prices and amounts come from code**: `FREE_SHIPPING_THRESHOLD` (`app/lib/checkout.ts`),
  `GIFT_CARD_AMOUNTS` and `GIFT_CARD_VALIDITY_MONTHS` (`app/lib/gift-cards.ts`) and
  `RETURN_REPORT_DAYS`, formatted with `formatPrice`/placeholders. `SHIPPING_AMOUNT` is `"0.00"`:
  below the threshold the recipient pays Nova Poshta's own rate on collection, so the copy says
  that rather than printing "0 ₴" (see Resolved questions).
- **Trio and couple offer** values live in the `discounts` table, not in code, so the offer's
  discounts section describes them in general terms and links to the offers page (`aktsii`) where
  the current conditions are shown. No numbers typed into the copy.
- **Card payment** is mentioned on the delivery-and-payment page only while a provider is
  configured: the loader passes `cardPaymentEnabled = getPaymentProvider(getEnv()) !== null`
  (`app/.server/payments/provider.ts`). The offer's prices-and-payment section says "cash on
  delivery and, where offered at checkout, by card", so its text doesn't depend on env.
- **Offer acceptance**: no checkbox. Under the checkout submit button, the notice + `<Link>` pattern
  from `app/routes/register.tsx` (`checkout.offerNotice` + `checkout.offerLink`).
- **`orders.offer_version`** (`date`, nullable, `mode: "string"`) is set to `OFFER_UPDATED_AT` by
  the server in the order insert (`app/.server/db/queries/orders.ts`, inside the existing checkout
  transaction). The form doesn't post a version: the server's current version is what was shown.
  Older orders stay `NULL`. No ML column is touched.
- **Emails**: `EmailFooter` gets optional `legalLinks: { label, url }[]`, rendered in the HTML and
  text footers by `renderEmail`. Only the order confirmation (`buildOrderConfirmationEmail`) and the
  gift-card buyer email (`buildGiftCardEmail`) pass them, and only when `PUBLIC_SITE_URL` is set
  (absolute URLs). Links: offer and returns.
- **Footer**: `navLinks().footer` keeps privacy last and adds offer, delivery & payment and returns
  before it. (Q4: a second row of legal links)
- **Startup warning**: `warnIfSellerDetailsMissing()` in a new `app/.server/legal.ts`, called once
  from `app/entry.server.tsx` next to `warnIfNoTrustedProxy()`. In production only, it fetches the
  Ukrainian (and English) site settings without blocking start-up and `console.warn`s the missing
  field names, or that the check couldn't run because Strapi was unreachable. Deps injectable for
  tests.
- **Components** in `app/features/legal/`: `LegalPage.tsx` (shared article shell: title, updated
  `<time>`, intro; the `Section` helper moves here or is duplicated from `PrivacyPolicy`),
  `SellerDetails.tsx` (the details block, used at the top and the bottom of the offer),
  `OfferTerms.tsx`, `DeliveryAndPayment.tsx`, `Returns.tsx`.
- **Copy** under a new `legal` namespace in `app/lib/i18n/uk.ts` (source of truth) and `en.ts`:
  `legal.offer.*`, `legal.delivery.*`, `legal.returns.*`, `legal.seller.*`, `legal.nav.*`. The text
  is a careful draft; `docs/legal.md` and the PR say the owner (or a lawyer) must review it. The page
  itself carries no disclaimer.

## Open questions

All answered on 2026-11-25: the owner accepted every recommended default.


- [x] **Q1: What should production show when a required seller detail is empty?** — Why it matters:
  the issue says "a clear placeholder in development" and only a log warning in production, leaving
  the production page unspecified. Recommended default: omit the empty line in production (no
  "not filled" text in front of customers); the startup warning tells the owner. Affects steps: 5, 6.
- [x] **Q2: Should the gift-card purchase form also say that paying accepts the offer?** — Why it
  matters: a gift card is a sale too, and the offer gets a gift-card section. Recommended default:
  yes, the same one-line notice under the "Pay" button on `podarunkovi-kartky`, but no version column
  on `gift_cards` (storing it is out of scope per the issue). Affects steps: 8.
- [x] **Q3: Is an English legal address required, or may the English page fall back to the
  Ukrainian one?** — Why it matters: `legalAddress` is localized, so with only the Ukrainian value
  filled the English page would report it missing. Recommended default: fall back to the Ukrainian
  value (fetched alongside, as the sitemap/blog code does for translations) and warn only when the
  Ukrainian one is empty. Affects steps: 2, 6.
- [x] **Q4: Footer layout with four legal links.** — Why it matters: the C+ footer is one links row;
  three more links make it long on mobile. Recommended default: keep the existing row and add a
  second, smaller row of legal links (offer · delivery & payment · returns · privacy) below it, per
  `docs/design.md` tokens. Affects steps: 7.
- [x] **Q5: Should `offer_version` be shown read-only on the order in Strapi?** — Why it matters:
  staff handling a dispute may want to see which offer the customer accepted. Recommended default:
  no for now (it's in the database; `cms-push`/order sync stay unchanged). Affects steps: none.

## Resolved questions

- **What does delivery cost below the threshold?** — The shop charges nothing (`SHIPPING_AMOUNT =
  "0.00"`); the recipient pays Nova Poshta's rate when collecting the parcel, so the page states the
  threshold from `FREE_SHIPPING_THRESHOLD` and "otherwise by Nova Poshta's rates on receipt"
  (source: `app/lib/checkout.ts`).
- **Are trio/couple numbers code constants?** — No, they're `discounts` rows identified by
  `TESTER_TRIO_DISCOUNT_SLUG` / `COUPLE_OFFER_DISCOUNT_SLUG`; the pages link to the offers page
  (source: `app/lib/discounts.ts`, #124).
- **Gift-card amounts and validity** — `GIFT_CARD_AMOUNTS = [500, 1000, 2000]`,
  `GIFT_CARD_VALIDITY_MONTHS = 12` (source: `app/lib/gift-cards.ts`).
- **Is card payment always available?** — Only when `PAYMENT_PROVIDER` is set
  (`getPaymentProvider` returns `null` otherwise) (source: `app/.server/payments/provider.ts`, #44).
- **Where does a startup warning go?** — `app/entry.server.tsx` runs module-level checks once when
  the server starts (`warnIfNoTrustedProxy`) (source: `app/entry.server.tsx`,
  `app/.server/client-ip.ts`).
- **How do pages get hreflang and sitemap entries?** — `indexable: true` in `PAGES`; the sitemap
  lists `SITEMAP_PAGES` and a test checks it covers every indexable page (source: `app/lib/paths.ts`,
  `app/.server/services/sitemap.ts`).
- **Where is the order inserted?** — `app/.server/db/queries/orders.ts` (`insert(orders)`), called
  inside the checkout transaction (source: that file, `app/.server/services/orders.ts`).
- **Does a new nullable `orders` column break the analytics projects?** — No: the generator loads
  the app schema via the app's migrations (`--load-app-schema`) and the warehouse selects explicit
  columns (source: `analytics/README.md`, `analytics/warehouse/models/staging/stg_orders.sql`).
- **How do CMS fields reach the app?** — Schema in `app/.server/cms/schemas.ts`, DTO in
  `app/lib/cms.ts`, mapper `toSiteSettings` in `app/.server/cms/content.ts`, fixtures in
  `app/.server/cms/__fixtures__/` (source: `app/.server/AGENTS.md` → CMS).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `cms/src/api/site-setting/content-types/site-setting/schema.json` | `taxId`, `legalAddress`, `registrationNote` |
| modify | `cms/types/generated/contentTypes.d.ts` | regenerated Strapi types |
| modify | `app/.server/cms/schemas.ts` | `siteSettingEntry` gets the three fields (nullish) |
| modify | `app/lib/cms.ts` | `SiteSettings` gets `taxId`, `legalAddress`, `registrationNote` |
| modify | `app/.server/cms/content.ts` | `toSiteSettings` trims → `null` |
| modify | `app/.server/cms/__fixtures__/site-setting*.json` | fixtures with the new fields |
| modify | `app/.server/cms/content.test.ts` | mapper tests |
| create | `app/lib/legal.ts` (+ `legal.test.ts`) | version dates, `RETURN_REPORT_DAYS`, `SellerDetails`, `missingSellerDetails` |
| modify | `app/lib/paths.ts` | `offerTerms`, `deliveryAndPayment`, `returns` pages |
| modify | `app/routes.ts` | register the three routes |
| create | `app/routes/offer-terms.tsx`, `delivery-and-payment.tsx`, `returns.tsx` (+ `*.test.ts`) | loaders, meta, components |
| create | `app/features/legal/LegalPage.tsx`, `SellerDetailsList.tsx`, `OfferTerms.tsx`, `DeliveryAndPayment.tsx`, `Returns.tsx` | page UI |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `legal` namespace, `checkout.offerNotice/offerLink`, email footer labels |
| modify | `app/components/layout/nav.ts`, `Footer.tsx`, `Footer.test.ts` | legal links |
| modify | `app/features/checkout/CheckoutForm.tsx`, `checkout-ui.test.ts` | acceptance line under submit |
| modify | `app/features/gift-cards/GiftCardPurchaseForm.tsx`, `gift-cards-ui.test.ts` | acceptance line (Q2) |
| create | `app/features/legal/OfferNotice.tsx` | the shared acceptance line with the offer link |
| modify | `app/.server/db/schema.ts` | `orders.offerVersion` |
| create | `app/.server/db/migrations/0036_orders_offer_version.sql` (+ meta), `app/.server/db/rollbacks/0036_orders_offer_version.sql` | generated migration and its rollback |
| modify | `app/lib/commerce.ts`, `app/.server/db/schema.test.ts` | `Order.offerVersion` |
| modify | `app/.server/db/queries/orders.ts` | set `offerVersion: OFFER_UPDATED_AT` |
| modify | `app/.server/db/migrator.test.ts`, `app/.server/services/orders.test.ts` | column and stored version |
| modify | `app/.server/email/layout.ts` (+ test) | `EmailFooter.legalLinks` |
| modify | `app/.server/services/order-email.ts` (+ test) | links in confirmation and gift-card emails |
| modify | `app/.server/services/sitemap.ts` (+ test) | the three pages with `lastmod` |
| create | `app/.server/legal.ts` (+ `legal.test.ts`) | `warnIfSellerDetailsMissing` |
| modify | `app/entry.server.tsx` | call it at start-up |
| create | `docs/legal.md` | pages, laws, owner review checklist, how to update |
| modify | `docs/setup.md`, `docs/email.md`, `app/.server/AGENTS.md` | site-setting fields, email footer links, CMS note |

## Steps

- [x] **1. Strapi fields.** Add `taxId`, `legalAddress`, `registrationNote` to the `site-setting`
  schema (localization as above), update the content type's description, run Strapi once
  (`pnpm aspire run` or `pnpm cms:dev`) to regenerate `contentTypes.d.ts`. Fill test values in the
  admin to check the fields save.
- [x] **2. CMS read path.** Extend `siteSettingEntry`, `SiteSettings` and `toSiteSettings` (trim,
  empty → `null`); update both fixtures (one with values, one with `null`s); tests in
  `content.test.ts`. The Q3 fallback to the Ukrainian `legalAddress`/`registrationNote` lives in
  `getSellerDetails` (`app/.server/legal.ts`, step 6) so `getSiteSettings` stays one request. Update the privacy loader test's `getSiteSettings` mock shape.
- [x] **3. `app/lib/legal.ts`.** Version constants, `RETURN_REPORT_DAYS`, `SellerDetails`
  (`legalName`, `taxId`, `legalAddress`, `registrationNote`, `phone`, `email`),
  `REQUIRED_SELLER_FIELDS`, `missingSellerDetails()`. Unit tests. (Building `SellerDetails` from
  the CMS moved to `getSellerDetails` in `app/.server/legal.ts`, with the Q3 fallback.)
- [x] **4. Paths and routes.** Add to `PAGES`: `offerTerms` (`oferta` / `offer-terms`),
  `deliveryAndPayment` (`dostavka-i-oplata` / `delivery-and-payment`), `returns` (`povernennia` /
  `returns`), all `indexable: true`; register them in `app/routes.ts` next to `privacy`. Check
  `routes.test.ts` / `redirects.test.ts` still pass.
- [x] **5. Copy.** Write the `legal` namespace in `uk.ts` first, then `en.ts`: offer sections
  (parties & details, subject, placing an order, prices & payment, delivery, transfer of ownership,
  returns → link, gift cards & discounts, personal data → privacy link, liability & disputes, seller
  details again), delivery & payment, returns (the four rules from the issue, 14 days via
  `{days}`), seller labels and the missing-detail placeholder, the Strapi-down fallback, footer
  labels, `checkout.offerNotice`/`offerLink`, email footer link labels. Values via placeholders only.
  `pnpm typecheck` checks both files match.
- [x] **6. Pages.** Build `features/legal/*` and the three route modules after `privacy.tsx`: each
  loader catches CMS errors (`seller: null`), passes `showPlaceholders = NODE_ENV !== "production"`
  (Q1) and, on the delivery page, `cardPaymentEnabled`; `meta` uses `seoMeta` with title and
  description from the copy (canonical URL comes with it). The offer and returns pages show their
  updated `<time>`. Route tests: uk and en render with the fixture details, a missing detail shows
  the placeholder (and is omitted with `showPlaceholders: false`), Strapi down still renders, prices
  come from the constants (assert the formatted `FREE_SHIPPING_THRESHOLD` and gift-card amounts),
  meta has title/description/canonical.
- [x] **7. Footer.** Add the three links to `navLinks()` and render them per Q4; update
  `Footer.test.ts` (labels, order, hrefs in uk and en). Check the footer at phone width.
- [x] **8. Checkout (and gift-card form).** Add the acceptance line with the offer link under the
  submit button in `CheckoutForm.tsx`; test in `checkout-ui.test.ts`. Same on the gift-card purchase
  form if Q2 = yes.
- [x] **9. `orders.offer_version`.** Add `offerVersion: date({ mode: "string" })` with a doc comment
  to `orders`; `pnpm db:generate`; set it in the insert in `queries/orders.ts`. Tests: migrator test
  that older rows are `NULL`; checkout/orders test that a new order stores `OFFER_UPDATED_AT`.
- [ ] **10. Email links.** Add `legalLinks` to `EmailFooter` and render them in `renderEmail` (HTML
  and text, escaped, only `http(s)`); pass offer and returns URLs (`PUBLIC_SITE_URL` + `pathFor`
  in the email's locale) from `buildOrderConfirmationEmail` and `buildGiftCardEmail`. Tests in
  `layout.test.ts` and `order-email.test.ts`; other emails unchanged.
- [x] **11. Sitemap.** Add the three pages to `SITEMAP_PAGES` and `sitemapPages` with
  `lastmod` = their version dates; tests in `sitemap.test.ts` (entries with hreflang alternates).
- [ ] **12. Startup warning.** `app/.server/legal.ts` → `warnIfSellerDetailsMissing({ env, load })`:
  once, production only, async and non-throwing; warns
  `[legal] Seller details missing in Strapi site settings: taxId, legalAddress (see docs/legal.md)`
  or that Strapi couldn't be reached. Call from `entry.server.tsx`. Tests with injected deps
  (production vs development, all filled, missing, CMS error).
- [ ] **13. Docs.** Write `docs/legal.md` (each page's content, the laws: Civil Code arts. 633,
  641; Law "On Consumer Rights Protection"; CMU resolution No. 172 of 19.03.1994; Law "On
  Electronic Commerce"; the owner's pre-launch checklist: review the copy, fill the Strapi details,
  confirm return rules, check the payment provider's requirements; how to edit the text and bump
  `OFFER_UPDATED_AT`/`RETURNS_UPDATED_AT`, and that `offer_version` then changes for new orders).
  Update `docs/setup.md` (site-setting fields), `docs/email.md` (footer links),
  `app/.server/AGENTS.md` (CMS note), and link `docs/legal.md` from `README.md`.
- [ ] **14. Verify.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; manual check in the
  running app.

## Testing & verification

- Unit/integration tests as listed per step: `app/lib/legal.test.ts`, the three route tests,
  `content.test.ts`, `Footer.test.ts`, `checkout-ui.test.ts`, `migrator.test.ts`,
  orders/checkout service test, `layout.test.ts`, `order-email.test.ts`, `sitemap.test.ts`,
  `app/.server/legal.test.ts`. `client-bundle.guard.test.ts` must stay green (no zod in
  `features/legal` or `app/lib/legal.ts`).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`): open `/oferta`, `/dostavka-i-oplata`, `/povernennia` and their `/en/…`
  versions with empty and filled Strapi details; follow the footer and checkout links; place an
  order and check `orders.offer_version`; view the confirmation and gift-card emails in smtp4dev;
  open `/sitemap.xml`; stop Strapi and reload a page.

## Acceptance criteria

- [ ] The public offer, delivery and payment, and returns pages exist in Ukrainian and English, with
  the seller's details from Strapi — steps 1, 2, 3, 4, 5, 6
- [ ] Prices, the free-delivery threshold and gift-card amounts on the pages come from the code, not
  typed text — steps 5, 6
- [ ] The footer, checkout and order emails link to the pages, and they're in the sitemap — steps 7,
  8, 10, 11
- [ ] Checkout states that placing an order accepts the offer, and each new order stores the offer
  version — steps 8, 9
- [ ] Production warns at startup when the seller's details are missing — step 12
- [ ] `docs/legal.md` lists what the owner must review before launch — step 13
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 14

## Out of scope

- Real card payments with a hosted provider (separate issue).
- An FAQ page.
- Gift-card terms beyond one section of the offer; storing an offer version on `gift_cards`.
- Showing `offer_version` in Strapi or pushing it with the order sync (Q5).
- Legal review of the copy: the owner (or a lawyer) does that before launch.
