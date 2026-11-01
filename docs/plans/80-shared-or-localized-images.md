# Plan: Let staff choose per image whether it's shared or language-specific (#80)

Issue: https://github.com/savchukolgaa/jassmin/issues/80
Branch: `issue/80`
Worktree: `.claude/worktrees/issue-80`
Status: Planned

## Goal
Staff want to upload a photo once for every language but still be able to use a language-specific
picture (e.g. a banner with Ukrainian text) where needed. Every CMS image slot (home hero, home
About, offer image, blog cover) gets a **shared** field (`<name>`, `i18n.localized: false`) and an
optional **per-language override** (`<name>Localized`, `localized: true`). The app shows the
override for the served locale when set, else the shared image. Alt text is configured per
language for every slot (`<name>Alt`, localized), whichever image is shown. DTOs and UI components
stay as they are.

## Dependencies & prerequisites
- Builds on #43 (i18n), #64 (home page fields), #55 (offers), #13 (blog) — all merged on `main`.
- Strapi 5.59.0 (`cms/package.json`). No new packages, env vars or app (Drizzle) migrations.
- One new Strapi **database migration** in `cms/database/migrations/` (runs before Strapi's
  schema sync, like `2026.10.24T00.00.00.default-locale-uk.js`).
- Run `pnpm install` in the worktree before working (it has no `node_modules` yet).

## Decisions & assumptions
- **Naming convention**: `<name>` = shared media (`localized: false`), `<name>Localized` =
  override media (`localized: true`), `<name>Alt` = alt text (`type: string`, `maxLength: 200`,
  `localized: true`). Documented in `app/.server/AGENTS.md` → CMS.
- **Home page**: Strapi can't make a field inside a localized component non-localized, so the
  shared images are top-level on the single type (`heroImage`, `aboutImage`) and the overrides
  and alt texts live inside the components (`hero.imageLocalized`, `hero.imageAlt`,
  `about.imageLocalized`, `about.imageAlt`). `hero.image` and `about.image` are removed in the
  same change, right after the migration moves their data (Q2 answered: remove).
- **Offers / blog posts**: keep `image` / `coverImage` (already shared), add `imageLocalized` /
  `coverImageLocalized` and `imageAlt` / `coverImageAlt`. No data change.
- **Alt text per language (Q1 answered)**: alt is copy, so each locale's entry has its own
  `<name>Alt`, used for whichever image is shown (shared or override). When it's blank, the alt
  falls back to the picked file's media-library `alternativeText`, then `""`, so today's alts keep
  working without a data migration.
- **One picker**: `pickImage({ localized, shared, alt }, baseUrl)` in `app/.server/cms/content.ts`
  returns `toImage(localized ?? shared, baseUrl)` with `alt` replaced by `textOrNull(alt)` when
  set. Used by `toHomePage`, `toOffer`, `toBlogPostSummary` (and so `toBlogPost`). `seo.ogImage`
  is out of scope (not in the issue's list).
- **Locale fallback**: when a translation is missing and the Ukrainian entry is served instead,
  that entry's Ukrainian override is shown. That's consistent: the text served is Ukrainian too,
  and `dto.locale` already says `uk`.
- **Alt text**: stays as today, the picked media file's `alternativeText` (see Q1).
- **Migration is a raw-knex Strapi DB migration**, not a bootstrap step, because after schema sync
  `hero.image` no longer exists in the content model and the document API can't read it. Media
  links in Strapi v5 live in the morph table `files_related_mph` (`file_id`, `related_id`,
  `related_type`, `field`, `order`), and component links in `home_pages_cmps` (`entity_id`,
  `cmp_id`, `component_type`, `field`). Both exist before the sync, and top-level media fields need
  no column, so the migration can write the new links before Strapi knows the fields.
  **Verify the table/column names against the local database first** (step 3).
- **Field descriptions** in the admin are set at bootstrap via the content-manager configuration
  (`metadatas.<field>.edit.description`), the same mechanism `lockOrderFields` uses in
  `cms/src/index.ts`. For the components, use the content-manager `components` service.

## Resolved questions
- **Q1: Alt text per language, even for a shared image?** — Yes: every slot gets a localized
  `<name>Alt` text field; blank falls back to the file's `alternativeText` (source: user, on the
  plan review).
- **Q2: Keep the old `hero.image` / `about.image` for a release?** — No, remove them in this
  change. The migration deletes the old morph rows only after inserting the new ones, in one knex
  transaction (source: user, on the plan review).
- **Where do image URLs get resolved?** — `toImage()` in `app/.server/cms/content.ts`, against
  `STRAPI_URL`; the picker reuses it (source: `app/.server/cms/content.ts`).
- **Are the offer and blog images already shared?** — Yes, `pluginOptions.i18n.localized: false`
  (source: `cms/src/api/offer/content-types/offer/schema.json`,
  `cms/src/api/blog-post/content-types/blog-post/schema.json`).
- **Do user migrations run before the i18n/schema sync?** — Yes, the existing migration relies on
  it (source: `cms/database/migrations/2026.10.24T00.00.00.default-locale-uk.js`).
- **How is the seed idempotent?** — Each locale's single type / slug is skipped when it exists
  (source: `cms/scripts/seed.ts` `seedHomePage`, `seedBlogPosts`, `seedOffers`).
- **Which UI reads these images?** — `HeroSection`, `AboutSection`, `OfferCard`, `OffersHero`,
  `BlogCover`/`BlogPostCard`/`BlogArticle`, plus `services/home.ts` (SEO image) and
  `routes/offers.tsx` (`og:image`). All read the DTO's single `image` / `coverImage`, so none change.
- **Where do test fixtures come from?** — Recorded Strapi responses in
  `app/.server/cms/__fixtures__/` (`<name>.json` = uk, `<name>.en.json` = en), re-recorded from a
  seeded Strapi (source: `app/.server/AGENTS.md` → CMS).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `cms/src/api/home-page/content-types/home-page/schema.json` | Add shared `heroImage`, `aboutImage` (`localized: false`) |
| modify | `cms/src/components/home/hero.json` | Replace `image` with `imageLocalized`; add `imageAlt` |
| modify | `cms/src/components/home/about.json` | Replace `image` with `imageLocalized`; add `imageAlt` |
| modify | `cms/src/api/offer/content-types/offer/schema.json` | Add `imageLocalized`, `imageAlt` (`localized: true`) |
| modify | `cms/src/api/blog-post/content-types/blog-post/schema.json` | Add `coverImageLocalized`, `coverImageAlt` (`localized: true`) |
| create | `cms/database/migrations/2026.11.01T00.00.00.shared-home-images.js` | Move home page component images to the shared fields |
| modify | `cms/src/index.ts` | Bootstrap: admin field descriptions for shared/override images |
| modify | `cms/scripts/seed.ts` | Seed shared images only |
| modify | `cms/types/generated/components.d.ts`, `contentTypes.d.ts` | Regenerated by `strapi develop` |
| modify | `app/.server/cms/schemas.ts` | Parse shared + override fields |
| modify | `app/.server/cms/content.ts` | `pickImage`, mappers, populate both fields |
| modify | `app/.server/cms/content.test.ts`, `schemas.test.ts` | Picker + mapper + populate tests |
| modify | `app/.server/cms/__fixtures__/home-page*.json`, `offers*.json`, `blog-post*.json` | Re-recorded shapes |
| modify | `app/features/home/HomePage.test.ts` | Fixtures, if they touch Strapi shapes |
| modify | `app/.server/AGENTS.md` | Document the naming convention |

## Steps
- [x] **1. Strapi schemas** — Home page: add top-level
  `heroImage` / `aboutImage` (`type: media`, `multiple: false`, `allowedTypes: ["images"]`,
  `pluginOptions.i18n.localized: false`). `hero.json` / `about.json`: remove `image`, add
  `imageLocalized` (same media options) and `imageAlt` (`type: string`, `maxLength: 200`);
  components inherit localization from the localized parent field. Offer: add `imageLocalized`
  and `imageAlt`, both `localized: true`. Blog post: add `coverImageLocalized` and
  `coverImageAlt`, both `localized: true`. Don't start Strapi yet (the migration must exist
  before the first boot on a database with data).
- [x] **2. Data migration** — `cms/database/migrations/2026.11.01T00.00.00.shared-home-images.js`,
  CommonJS like the existing one, in one `knex.transaction`:
  1. Return early unless `home_pages`, `home_pages_cmps` and `files_related_mph` exist (fresh DB).
  2. For each slot (`hero` → `heroImage`, component `home.hero`; `about` → `aboutImage`,
     component `home.about`): for every `home_pages` row, find its component (`home_pages_cmps`
     where `entity_id = row.id`, `field = slot`) and that component's file
     (`files_related_mph` where `related_type = 'home.<slot>'`, `related_id = cmp_id`,
     `field = 'image'`).
  3. Choose the source file: the `uk` row's, else the `en` row's (per `document_id`).
  4. For every `home_pages` row of that document that has no `files_related_mph` row with
     `related_type = 'api::home-page.home-page'` and `field = '<slot>Image'`, insert
     `{ file_id, related_id: row.id, related_type: 'api::home-page.home-page', field, order: 1 }`
     (idempotent: re-running inserts nothing).
  5. Delete the old `field = 'image'` morph rows for `home.hero` / `home.about`.
  Log what was moved via `console.info` (no Strapi logger in migrations).
- [x] **3. Verify the migration on a copy of real data** — Before trusting step 2's table names,
  inspect the local DB (`\d files_related_mph`, `\d home_pages_cmps`, and the rows for the current
  home page). Then boot Strapi (`pnpm cms:dev`) on a database that has the 26 Oct uploads: both
  locales of the home page show the former `uk` photos in **Hero image / About image**, the
  override fields are empty, and nothing in the media library is lost. Restart once more: no
  changes (idempotent). Commit the regenerated `cms/types/generated/*`.
- [x] **4. Admin descriptions** — In `cms/src/index.ts`, add `describeImageFields(strapi)` next to
  `lockOrderFields`: for each `{ uid, kind: "content-types" | "components", shared?, localized? }`
  (`api::home-page.home-page` → `heroImage`, `aboutImage`; `home.hero` / `home.about` →
  `imageLocalized`; `api::offer.offer` → `image`, `imageLocalized`; `api::blog-post.blog-post` →
  `coverImage`, `coverImageLocalized`, plus every `<name>Alt`), set
  `metadatas[field].edit.description` to "Спільне для всіх мов" / "Лише для цієї мови (замінює
  спільне)" / "Альтернативний текст для цієї мови (для спільного чи власного зображення)" (Strapi
  admin copy is Ukrainian, like the sync middleware's messages), and labels such as "Hero image
  (all languages)". Only
  update when something changed; catch and warn like `lockOrderFields`. Call it in `bootstrap`.
- [ ] **5. App schemas and picker** — `schemas.ts`: `homePageEntry` gets
  `heroImage: strapiMedia.nullish()`, `aboutImage: strapiMedia.nullish()`; `heroComponent` /
  `aboutComponent` replace `image` with `imageLocalized: strapiMedia.nullish()` and add
  `imageAlt: z.string().nullish()`; `offerEntry` adds `imageLocalized`, `imageAlt`;
  `blogPostSummaryEntry` adds `coverImageLocalized`, `coverImageAlt`. `content.ts`: export
  `pickImage({ localized, shared, alt }, baseUrl): CmsImage | null` (override wins, else shared,
  else `null`; `alt` = `textOrNull(alt)` ?? the file's `alternativeText` ?? `""`); use it in
  `toHomePage` (`pickImage({ localized: hero.imageLocalized, shared: entry.heroImage, alt:
  hero.imageAlt }, …)`, same for about), `toOffer`, `toBlogPostSummary`.
- [ ] **6. Populate both fields** — `getHomePage`: `populate: { heroImage: true, aboutImage: true,
  hero: { populate: ["imageLocalized"] }, about: { populate: ["imageLocalized"] }, location: true }`.
  `OFFER_POPULATE = { image: true, imageLocalized: true, products: true }`. `listBlogPosts`:
  `populate: ["coverImage", "coverImageLocalized"]` in both requests. `getBlogPostBySlug`:
  add `coverImageLocalized: true`.
- [x] **7. Seed** — `seedHomePage`: set `heroImage` / `aboutImage` at the top level of `data`, drop
  `image` from the `hero` / `about` components, and update the comment (images are now shared).
  Seed `imageAlt` per locale in `HOME_PAGE_COPY` (uk: "Тестери парфумів Jassmin", en: "Jassmin
  perfume testers", and the About photo likewise), and `coverImageAlt` / `imageAlt` in the posts'
  and offers' per-locale copy. Offers and posts keep setting the shared `image` / `coverImage`;
  no overrides are seeded.
  Existing skip-if-present logic keeps it idempotent.
- [ ] **8. Fixtures and tests** — Re-record `__fixtures__/home-page.json` / `.en.json`,
  `offers*.json`, `blog-posts*.json`, `blog-post-by-slug*.json` from a freshly seeded Strapi (or
  edit them by hand to the new shape if Strapi isn't available). Add a `pickImage` describe
  block: override wins; falls back to shared; neither → `null`; URLs absolute; the entry's alt
  wins over the file's `alternativeText` for both a shared and an override image; a blank alt
  falls back to `alternativeText`, then `""`. Update `toHomePage`
  tests (hero/about from shared, override wins for one locale, `null` when neither), `toOffer` and
  `toBlogPostSummary` tests, the populate assertions (`populate[imageLocalized]`), and
  `schemas.test.ts`. Update `HomePage.test.ts` only if its fixtures use Strapi shapes (it uses
  view models, so likely no change).
- [ ] **9. Docs** — `app/.server/AGENTS.md` → CMS: a bullet stating the `<name>` /
  `<name>Localized` / `<name>Alt` convention, the home page exception (shared top-level, override
  and alt in the component), the alt fallback, that `pickImage` is the only way to map them, and
  that new image fields must follow it. Fix the `seed.ts` header comment if it mentions per-locale images.
- [ ] **10. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; then the manual
  checks below.

## Testing & verification
- Unit: `pickImage` (3 cases), mappers for home page / offer / blog post with and without overrides,
  populate query params, zod schemas accepting both fields and `null`s.
- Commands: `pnpm --dir .claude/worktrees/issue-80 typecheck | lint | test | build`.
- Manual (with `pnpm aspire run` from the worktree, or `pnpm cms:dev` + app):
  1. Migration on existing data: both `/` (uk) and `/` with `locale=en` show the 26 Oct photos.
  2. Set an English-only hero override → `en` shows it, `uk` still shows the shared photo.
  3. Remove that override → `en` falls back to the shared photo.
  4. Set a shared offer image while editing the `en` locale → visible in `uk` too.
  5. Blog cover override on one locale only.
  6. Set a different alt on each locale for a shared hero image → each site's `<img alt>` is its
     own; clear the `en` alt → `en` uses the file's alternative text.
  7. Clear every image → pages render without `<img>` (placeholders), no errors.
  8. Fresh DB: `pnpm cms:seed` works; second run logs "already exists, skipping" and changes nothing.
  9. Admin shows the descriptions on each image and alt field.

## Acceptance criteria
- [ ] Staff can set a shared image, a current-language image, or both for the hero, About, each offer and each blog post — steps 1, 4
- [ ] A shared image set while editing either locale shows on both sites — steps 1, 5, 6
- [ ] A language-specific image shows only for that language and overrides the shared one; the other language keeps the shared image — steps 5, 6, 8
- [ ] Removing a language-specific image falls back to the shared image — steps 5, 8
- [ ] After migration, existing home page photos (uk), offer images and blog covers show in both languages, no upload lost — steps 2, 3
- [ ] `pnpm cms:seed` works on a fresh DB and a re-run changes nothing — step 7
- [ ] Pages render without `<img>` when no image is set — steps 5, 8
- [ ] Alt text can be set per language for every image slot, shared or not (from the plan review) — steps 1, 5, 7, 8
- [ ] Naming convention documented in `app/.server/AGENTS.md` — step 9
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` pass — step 10

## Out of scope
- Product images (product type isn't localized; synced to `products.image_url`, #40/#66).
- Site settings (no images) and `seo.ogImage` on blog posts.
- Any UI/component change: DTOs keep a single `image` / `coverImage`.
