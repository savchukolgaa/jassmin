# Plan: Support several fragrance families, scent notes and a store code per product (#65)

Issue: https://github.com/savchukolgaa/jassmin/issues/65
Branch: `issue/65`
Worktree: `.claude/worktrees/issue-65`
Status: Planned

## Goal

Shoppers should find a perfume under every one of its fragrance families and see its scent notes,
so they can choose by smell. A product gets an ordered list of families (the first is the primary
one, mirrored in the ML column `products.fragrance_family`), a list of notes and the store's own
product code. Staff edit all three in Strapi. The catalog filter matches any of a product's
families, family names are translated, the product page shows families and notes, and cards show
the primary family.

## Dependencies & prerequisites

- #40 (Strapi write-through and outbox push) is merged (`933e84f`), so `applyCmsProductChange`,
  `toStrapiProductData` and `cms/src/sync/middleware.ts` exist.
- #66 (importing the owner's list) depends on this issue. It decides the store-code uniqueness
  rule, so this issue only adds the column.
- #64 (home page rebuild, planned in parallel) will let the catalog search take **several**
  `fragrance_family` values for the "Build your trio" picker. This plan keeps the query layer
  list-based (step 4), so #64 only has to change URL parsing in `app/lib/catalog.ts`.
- New migration **`0013_product_families_notes_code`**, with a hand-written rollback. No new packages or env vars.
- Strapi: two new components and three new attributes on `api::product.product`. Strapi
  regenerates `cms/types/generated/*.d.ts` on `strapi develop` / `build`; commit them.

## Decisions & assumptions

- **Columns** (`products`, `app/.server/db/schema.ts`):
  - `fragranceFamilies: text().array().notNull().default(sql\`'{}'::text[]\`)`, with a GIN index
    `products_fragrance_families_idx` (`index(...).using("gin", t.fragranceFamilies)`).
  - `notes: text().array().notNull().default(sql\`'{}'::text[]\`)`.
  - `storeCode: varchar({ length: 20 })`, nullable, **no unique constraint yet** (#66 decides).
  - `fragranceFamily` stays as it is (ML feature). A new CHECK
    `products_fragrance_family_primary_check`:
    `fragrance_family is not distinct from fragrance_families[1]`. The backfill makes it hold for
    every existing row, and from then on PostgreSQL itself guarantees the acceptance criterion
    "always holds the first family" (the app still sets both on every write).
- **Backfill** in the migration:
  `update products set fragrance_families = array[fragrance_family] where fragrance_family is not null`.
  Values are copied verbatim, also ones outside the fixed list (e.g. the seed's `мікс`), so no ML
  data is lost. No DB CHECK restricts the array's values; the fixed list is enforced where values
  enter (the `~/lib/cms-sync` zod schema and the Strapi enumeration).
- **Fixed list:** `FRAGRANCE_FAMILIES` in `app/lib/enums.ts`, in the issue's order, lowercase
  Ukrainian (`"квіткові", "фруктові", "східні", "водяні", "шипрові", "деревні", "мускусні",
  "пряні", "гурманські", "зелені", "ванільні", "ароматичні", "альдегідні", "цитрусові", "свіжі",
  "фужерні"`), plus `type FragranceFamily` and `isFragranceFamily(value)`.
- **Labels:** i18n keys use ASCII slugs, not Cyrillic: `catalog.families.floral`, `fruity`,
  `oriental`, `aquatic`, `chypre`, `woody`, `musky`, `spicy`, `gourmand`, `green`, `vanilla`,
  `aromatic`, `aldehydic`, `citrus`, `fresh`, `fougere`. `FRAGRANCE_FAMILY_LABEL_KEYS:
  Record<FragranceFamily, TextKey>` in `app/lib/catalog.ts` maps value → key (same pattern as
  `CATALOG_SORT_LABEL_KEYS`), and `fragranceFamilyLabel(value: string, t)` returns the translation,
  or the raw value for a legacy value outside the list (so `мікс` still renders). `uk.ts` labels
  are capitalised Ukrainian (`Квіткові`), `en.ts` English (`Floral`).
- **Read types stay `string`/`string[]`**, not `FragranceFamily`, because legacy rows can hold
  other values; only the write path (`cms-sync`) narrows to `FragranceFamily[]`.
- **Filter is list-based underneath (for #64):** `ProductFilters.fragranceFamilies?: readonly
  string[]`, matched with Drizzle's `arrayOverlaps(products.fragranceFamilies, [...])`
  (`fragrance_families && array[…]`, served by the GIN index), i.e. "has **any** of these
  families". Today the service passes `search.fragranceFamily ? [search.fragranceFamily] : []`.
  `CatalogSearch` keeps its single `fragranceFamily` and the `fragrance_family` URL param keeps its
  Ukrainian value, so existing links work. #64 then changes only `parseCatalogSearch` /
  `catalogHref` (e.g. `params.getAll`) and the service mapping; if the trio needs "all of", it
  swaps `arrayOverlaps` for `arrayContains` in the one `familyFilter()` helper.
- **Filter options:** `listFilterOptions` returns the distinct values of
  `unnest(fragrance_families)` over the listed products. `CatalogFilters` shows
  `fragranceFamilyLabel(...)` as the option text and sorts by the translated label with
  `Intl.Collator(locale)`, so each language is alphabetical; `value` stays Ukrainian.
- **Strapi fields** (`cms/src/api/product/content-types/product/schema.json`):
  - `fragranceFamilies`: repeatable component `catalog.fragrance-family`
    (`{ family: enumeration [the 16 Ukrainian values], required }`). Staff drag to reorder; the
    first row is the primary family. Strapi 5 has no native multi-select, and a repeatable
    component keeps the order, which a plain multi-select wouldn't.
  - `notes`: repeatable component `catalog.note` (`{ name: string, required, maxLength 100 }`) (Q1, confirmed).
  - `storeCode`: `string`, `maxLength 20`.
  - The old `fragranceFamily` string attribute is **removed** from the Strapi content type: the
    app derives it, and two editable sources would contradict each other.
- **"At least one family"** is enforced by the app's zod schema for single perfumes
  (`packSize === 1`); sets (`packSize > 1`, like the seed's tester trio) may have none (Q2, confirmed). The Strapi component therefore has no `min`, and the app's 422 explains
  the refusal in Strapi (`cms/src/utils/app-sync.ts` already shows `invalid-input` issues).
- **Validation (`~/lib/cms-sync`)**: `fragranceFamilies: z.array(z.enum(FRAGRANCE_FAMILIES))`
  refined for duplicates (`"duplicate-family"`, like `"duplicate-volume"`); `notes`: each trimmed,
  1–100 chars, empty entries dropped, case-insensitive duplicates dropped, at most 40;
  `storeCode`: trimmed, max 20, empty → `null`.
- **Product page:** the single chip becomes a list (`<ul>`) of `rounded-pill bg-blush` chips, one per
  family, primary first, with translated labels; below the purchase box a "Notes" section
  (`product.notes` heading) lists the notes as small `ring-1 ring-line` pills (C+ chips,
  `docs/design.md` → Pills). Notes are Ukrainian on both sites; on `en` the list gets `lang="uk"`.
- **Cards:** `ProductSummary.fragranceFamily: string | null` (the primary), shown as a small blush
  chip above the volumes in `ProductCard` when set. #64's bestseller "family badge" reuses it.
- **Store code** is staff-only: stored and synced, not shown to shoppers (Q3, confirmed).

## Resolved questions

- **Q1: Notes in Strapi: repeatable component or comma-separated text?** — Repeatable component
  `catalog.note`, one row per note (owner, 2026-10-26).
- **Q2: May a product have no fragrance family?** — At least one is required only for single
  perfumes (`packSize === 1`); sets may have none (owner, 2026-10-26).
- **Q3: Do shoppers see the store code?** — No, it's staff-only (owner, 2026-10-26).

- **Can `fragrance_family` be replaced?** — No: it's an ML feature and must not be dropped or
  renamed (`AGENTS.md`, `app/.server/db/schema.ts` header comment); it holds the primary family.
- **Where do new product fields have to be wired?** — Strapi schema, `cms/src/sync/middleware.ts`
  `productPayload` / `applyProductAnswer`, `~/lib/cms-sync` (`productFields`, `CmsProductState`),
  `productWrite` + `applyCmsProductChange`, `findProductSyncState`, `toCmsProductState`,
  `toStrapiProductData` (`app/.server/AGENTS.md` → CMS sync; #40).
- **Do migrations need a rollback?** — Yes, `db/rollbacks/<tag>.sql`, run by `pnpm db:rollback`
  (`app/.server/AGENTS.md` → Database).
- **Which CMS fixtures?** — Products have no recorded Strapi responses in
  `app/.server/cms/__fixtures__/` (Strapi doesn't serve products to loaders); the "fixtures" are the
  product objects in `cms-sync.test.ts`, `cms-push.test.ts`, `routes/cms.products.test.ts` and
  `cms/src/utils/app-sync.test.ts`.
- **Does the Strapi seed create products?** — No; products reach Strapi through
  `pnpm db:sync-cms --all` (`cms/scripts/seed.ts` only references them by `publicId` in offers), so
  only the app seed (`seed-data.ts`) changes.
- **URL compatibility** — the filter value stays the Ukrainian family (issue → Technical), so
  `?fragrance_family=деревні` keeps working.
- **Is the store code unique?** — Not in this issue: codes repeat between the women's and men's
  lists; #66 settles the rule (issue → Assumptions).
- **Search by note, translating notes, the import** — out of scope (issue).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | `FRAGRANCE_FAMILIES`, `FragranceFamily`, `isFragranceFamily` |
| modify | `app/lib/catalog.ts` | `FRAGRANCE_FAMILY_LABEL_KEYS`, `fragranceFamilyLabel` |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `catalog.families.*`, `product.families`, `product.notes` |
| modify | `app/.server/db/schema.ts` | new columns, GIN index, primary-family CHECK |
| create | `app/.server/db/migrations/0013_product_families_notes_code.sql` (+ `meta/`) | generated migration + backfill |
| create | `app/.server/db/rollbacks/0013_product_families_notes_code.sql` | reverse |
| modify | `app/.server/db/schema.test.ts` | new columns in the column table |
| modify | `app/.server/db/migrator.test.ts` | backfill + CHECK tests; add 0013 to the rollback chain |
| modify | `app/.server/db/queries/products.ts` | list-based family filter, options via `unnest`, new columns in detail/summary/sync/write |
| modify | `app/.server/services/products.ts` (+ test) | DTO mapping, family list into filters |
| modify | `app/lib/products.ts` | `ProductSummary.fragranceFamily`, `ProductDetail.fragranceFamilies` / `notes` |
| modify | `app/lib/cms-sync.ts` | zod fields + `CmsProductState` |
| modify | `app/.server/services/cms-sync.ts` (+ test) | `productWrite` sets families, primary, notes, code |
| modify | `app/.server/services/cms-push.ts` (+ test) | `toCmsProductState`, `toStrapiProductData` component shapes |
| modify | `app/routes/cms.products.test.ts` | new fields through the route |
| create | `cms/src/components/catalog/fragrance-family.json`, `cms/src/components/catalog/note.json` | Strapi components |
| modify | `cms/src/api/product/content-types/product/schema.json` | new attributes, drop `fragranceFamily` |
| modify | `cms/src/sync/middleware.ts` | payload mapping and answer write-back |
| modify | `cms/src/utils/app-sync.test.ts` | payload/answer cases |
| modify | `cms/types/generated/*.d.ts` | regenerated by Strapi |
| modify | `app/features/catalog/CatalogFilters.tsx`, `ProductCard.tsx`, `catalog-ui.test.ts` | translated options, card chip |
| modify | `app/routes/product.tsx`, `app/features/product/product-ui.test.ts` | family chips + notes |
| modify | `app/.server/db/seed-data.ts`, `seed.ts`, `seed.test.ts` | sample families/notes |
| modify | `app/.server/AGENTS.md` | document the columns, CHECK and filter |

## Steps

- [x] **1. Shared list and labels** — Add `FRAGRANCE_FAMILIES` / `FragranceFamily` /
  `isFragranceFamily` to `app/lib/enums.ts`. Add `catalog.families.<slug>` (16 keys) to `uk.ts`
  and `en.ts`, plus `product.families` ("Ароматичні родини" / "Fragrance families") and
  `product.notes` ("Ноти" / "Notes"). Add `FRAGRANCE_FAMILY_LABEL_KEYS` and
  `fragranceFamilyLabel(value, t)` to `app/lib/catalog.ts`. Tests in `app/lib/catalog.test.ts`:
  every family has a key, `uk` and `en` labels for one value, unknown value → raw value.
  `pnpm typecheck` catches missing keys.
- [x] **2. Schema and migration** — Add the three columns, the GIN index and the CHECK to
  `products` in `schema.ts` (comments: primary family mirrored by `fragrance_family`, store code
  uniqueness left to #66). `pnpm db:generate --name product_families_notes_code`, then append the
  backfill `UPDATE` to `0013_…sql` **before** the `ADD CONSTRAINT … CHECK` statement (reorder by
  hand if drizzle-kit emits the check first). Write the rollback: drop the check, index and the
  three columns. Update `schema.test.ts` for the new columns. Run `pnpm db:migrate`, then
  `pnpm db:rollback` and migrate again locally.
- [x] **3. Migration tests** (`migrator.test.ts`) — In the rollback-chain test, add
  `0013_product_families_notes_code` first. New test: roll back 0013, insert a product with
  `fragrance_family = 'деревні'` and one with `null`, migrate, and expect
  `fragrance_families = {деревні}` / `{}`, `notes = {}`, `store_code = null`; then expect the
  CHECK to reject `fragrance_families = {квіткові}` with `fragrance_family = 'деревні'`.
- [x] **4. Queries** (`db/queries/products.ts`) — `ProductFilters.fragranceFamily` →
  `fragranceFamilies?: readonly string[]`; a `familyFilter(families)` helper returns
  `arrayOverlaps(products.fragranceFamilies, [...families])` or `undefined` for an empty list,
  used by `whereFilters`. `listFilterOptions`: families from
  `select distinct unnest(fragrance_families) as value … where listed` (raw `sql` in a subquery or
  `db.execute`), dropping the `isNotNull(fragranceFamily)` query. Add `fragranceFamily` to
  `summaryColumns`; `fragranceFamilies`, `notes` to `findProductByPublicId`; `fragranceFamilies`,
  `notes`, `storeCode` to `findProductSyncState` and `ProductWrite`.
- [x] **5. Service and DTOs** — `app/lib/products.ts`: `ProductSummary.fragranceFamily: string |
  null`; `ProductDetail` replaces `fragranceFamily` with `fragranceFamilies: string[]` and adds
  `notes: string[]`. `services/products.ts`: map them in `toSummary` / `toDetail`; `getCatalogPage`
  passes `fragranceFamilies: search.fragranceFamily ? [search.fragranceFamily] : []`. Update
  `services/products.test.ts`: filtering by a **secondary** family lists the product, the options
  include secondary families, the archived-product case still holds.
- [x] **6. CMS sync contract** (`~/lib/cms-sync`, `services/cms-sync.ts`, `cms-push.ts`) — Replace
  `fragranceFamily` in `productFields` with `fragranceFamilies`, `notes`, `storeCode` (rules in
  Decisions), with a `.superRefine` on the object for "at least one family when `packSize === 1`"
  (`"family-required"`, path `fragranceFamilies`). `CmsProductState` gets the same three fields
  (no `fragranceFamily`). `productWrite` sets `fragranceFamilies`, `fragranceFamily:
  fragranceFamilies[0] ?? null`, `notes`, `storeCode`. `toCmsProductState` passes them through;
  `toStrapiProductData` turns them into component rows: `fragranceFamilies: families.map((family)
  => ({ family }))`, `notes: notes.map((name) => ({ name }))`. Tests: create/update store all
  fields and the primary family; reordering families changes `fragrance_family`; invalid family,
  duplicate family, missing family (single perfume) are 422 `invalid-input`; set without family is
  accepted; notes are trimmed/deduped; `toStrapiProductData` shape; `routes/cms.products.test.ts`
  round trip.
- [ ] **7. Strapi** — Create `cms/src/components/catalog/fragrance-family.json` (enumeration
  `family`, the 16 values, required) and `note.json` (`name`, string, required, maxLength 100).
  In the product schema add `fragranceFamilies` (repeatable `catalog.fragrance-family`), `notes`
  (repeatable `catalog.note`), `storeCode` (string, maxLength 20), and remove `fragranceFamily`.
  In `middleware.ts` `productPayload`: `fragranceFamilies: records(merged.fragranceFamilies).map((r)
  => r.family)`, `notes: records(merged.notes).map((r) => r.name)`, `storeCode:
  text(merged.storeCode)`; in `applyProductAnswer` write the answer's families/notes back as
  component rows and `storeCode`, so Strapi stores the normalised values. Update
  `app-sync.test.ts`. Run `pnpm --dir cms build` (and `develop` once) to check that Strapi accepts
  Cyrillic enumeration values and to regenerate `cms/types/generated`; if Strapi rejects them,
  switch the enumeration to the ASCII slugs from step 1 and map slug ↔ value in the middleware.
- [ ] **8. UI** — `CatalogFilters.tsx`: options show `fragranceFamilyLabel(family, t)`, sorted by
  label with `Intl.Collator(locale)` (`useT()` exposes the locale). `ProductCard.tsx`: primary
  family chip when set. `product.tsx`: families as a `<ul aria-label={t("product.families")}>` of
  chips, then (after `ProductPurchase`) a "Notes" section when `notes.length > 0`, `lang="uk"` on
  the list when the locale is `en`. Tests (`catalog-ui.test.ts`, `product-ui.test.ts`): labels in
  `uk` and in `<I18nProvider locale="en">`, option `value` stays Ukrainian, chips and notes render,
  nothing renders for empty lists.
- [ ] **9. Seed** — In `seed-data.ts` give each sample perfume 1–3 families from the list (primary
  = its current `fragranceFamily`) and 4–8 notes; the tester set gets `fragranceFamilies: []` and
  `fragranceFamily: null` (per Q2). Because the seed skips existing products
  (`onConflictDoNothing`), add an update in `seed.ts` that fills `fragrance_families` / `notes`
  for sample products whose `notes` are still empty, so existing dev databases get them.
  `seed.test.ts`: every sample perfume has ≥1 family, `fragranceFamily === fragranceFamilies[0]`,
  and notes.
- [ ] **10. Docs and checks** — Update `app/.server/AGENTS.md` (Database: new columns, the CHECK,
  `fragrance_family` = primary; CMS sync: new fields; catalog filter is list-based). Run
  `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Testing & verification

- Unit: `catalog.test.ts` (labels), `cms-sync` schema cases, `cms-push.test.ts`
  (`toStrapiProductData`), `cms/src/utils/app-sync.test.ts`, UI tests in `uk` and `en`.
- Integration (need a database): `migrator.test.ts` (backfill, CHECK, rollback),
  `services/products.test.ts` (secondary-family filter, options), `cms-sync.test.ts` (primary kept in
  sync on create/update/reorder), `routes/cms.products.test.ts`, `seed.test.ts`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm --dir cms build`.
- Manual (`pnpm aspire run`): in Strapi edit a product, add two families and notes and a store
  code, save, check the row in PostgreSQL (`fragrance_family` = first); reorder families and
  check again; filter `/catalog/women` by the second family; switch to English and check the
  option labels and the product page chips; check notes on the product page.

## Acceptance criteria

- [ ] A product can have several fragrance families and a list of notes, editable in the Strapi
  admin and saved to PostgreSQL — steps 2, 6, 7
- [ ] `products.fragrance_family` still exists and always holds the first family — steps 2, 3, 6
- [ ] Filtering the catalog by a family lists every product that has it, not only those where it
  comes first — steps 4, 5
- [ ] Family names are shown in English on the English site and in Ukrainian on the Ukrainian
  site — steps 1, 8
- [ ] The product page shows all families and the notes — steps 5, 8
- [ ] Products can store the shop's own product code, editable in Strapi — steps 2, 6, 7
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 10

## Out of scope

- Importing the owner's list and the store-code uniqueness rule (#66).
- Several `fragrance_family` values in the URL / trio builder (#64; the query layer is ready).
- Translating notes, search or filtering by note.
- Restricting legacy out-of-list values in the database (no CHECK on array contents).
