# Plan: Import the store's perfume range into the catalog (#66)

Issue: https://github.com/savchukolgaa/jassmin/issues/66
Branch: `issue/66`
Worktree: `.claude/worktrees/issue-66`
Status: Planned (owner answers Q1–Q7 in; Q8 open with a default)

## Goal

As the store owner, I want every perfume we actually sell in the catalog, so shoppers can find and
buy it. The owner's list (75 women's and 53 men's perfumes, each with a store code, name, brand,
fragrance families and notes) becomes a committed, typed data file. An idempotent
`pnpm db:import-catalog` loads it into PostgreSQL, gives every perfume the same sizes at one price
table's prices with stock 0, and queues the new products for the Strapi push (`pnpm db:sync-cms`).
The owner's sizes are 5, 10, 30, 50 and 100 ml, so the shop's sizes change first: 7 ml is removed
everywhere and 5 ml is added.

## Dependencies & prerequisites

- **#65 (merged, `380d2da`)**: `products.fragrance_families`, `products.notes`, `products.store_code`,
  the `products_fragrance_family_primary_check` CHECK and `FRAGRANCE_FAMILIES` in `app/lib/enums.ts`.
- **#40 (merged, `933e84f`)**: `cms_outbox` with `enqueueCmsSync` (`db/queries/cms-outbox.ts`),
  `deliverCmsSync`, `pnpm db:sync-cms`, and the slug backfill on a product's first push
  (`services/cms-push.ts:128`).
- **Source list**: `makrtextfiles/catalog.md` in the main checkout (`C:\Users\КТС\jassmin`). It's
  untracked and stays that way: the converter reads it from a path argument, and only the converted
  data file is committed. Since the first plan, the owner has marked 30 lines `(popular)` (Q8).
- **One migration** (step 1): `product_variants_volume_ml_check` becomes `(5, 10, 30, 50, 100)` and
  existing 7 ml sizes are deleted. No new packages or env vars. The scripts use
  `getDatabaseUrl(process.env)` (`JASSMINDB_URI`, else `DATABASE_URL`) like `db/scripts/seed.ts`.

## Decisions & assumptions

- **Sizes: 7 ml goes away, 5 ml comes in (Q1).** `PERFUME_VOLUMES_ML` becomes
  `[5, 10, 30, 50, 100]`. It drives the variant CHECK, the CMS-sync zod schema (`~/lib/cms-sync`) and
  the seed, so a 7 ml size is refused from then on, including from Strapi.
  - The migration deletes every `product_variants` row with `volume_ml = 7`. Cart lines on them go
    with them (`cart_items.variant_id` cascades). Order lines keep their `volume_ml = 7` snapshot and
    `price_at_purchase`, and their `variant_id` becomes null (`on delete set null`), so order history
    stays intact. Products whose deprecated `products.volume_ml` is 7 get the price and volume of
    their smallest remaining size. Every affected product is queued in `cms_outbox` (same SQL as
    `enqueueCmsSync`), so the next `pnpm db:sync-cms` removes the 7 ml size in Strapi too. A product
    whose only size was 7 ml has no sizes left and drops out of the catalog until staff add a size in
    Strapi.
  - Rollback (`db/rollbacks/<tag>.sql`) deletes 5 ml sizes and restores the old CHECK. Deleted 7 ml
    sizes aren't restored.
  - The sample catalog (`seed-data.ts`) swaps its 7 ml sizes for 5 ml ones. The seed only adds
    missing rows, so existing dev databases get the 5 ml sizes and lose 7 ml through the migration.
    Tests that use 7 ml switch to 5 ml.
  - The tester trio stays as it is (three single 10 ml sizes for 499 ₴; three 10 ml testers otherwise
    cost 720 ₴). Its Strapi copy still says "3 × 7 мл". `cms/scripts/seed.ts` and the
    `cms/__fixtures__/offers*.json` fixtures change to 10 ml (and "мініатюри 7 мл" to 5 мл). Staff
    edit the existing Strapi offer by hand, because the CMS seed doesn't overwrite content.
- **Prices (Q1)**: `CATALOG_PRICES = { 5: "119.00", 10: "240.00", 30: "459.00", 50: "629.00",
  100: "969.00" }`, typed `Partial<Record<PerfumeVolumeMl, string>>`, decimal strings
  (`numeric(10, 2)`, never floats). The deprecated `products.price` / `volume_ml` / `stock_quantity`
  come from the smallest size (5 ml, 119.00, 0), as `productWrite` does in `services/cms-sync.ts`.
- **Codes and identity (Q2–Q4).** Codes stay exactly as on the bottles, even where two products share
  one: `11-L` is both Lolita Lempicka and Lift in the women's list, and codes repeat between the lists.
  So no combination of list and code is unique. Each entry's `publicId` is a deterministic name-based
  UUID (SHA-256 of a fixed namespace plus `"<list>:<storeCode>:<source title>"`, version 8 and variant
  bits set; `catalogPublicId()`). The source title is the title **as written in the owner's list**,
  before `fixes.ts`, so applying a fix never changes an id. The import upserts by
  `products.public_id`, like `pnpm db:seed`, and a staff edit in Strapi never makes it create a copy.
  `store_code` stays non-unique in the database; the `storeCode` comment in `db/schema.ts` ("not
  unique yet (#66 decides)") is updated to say so. All 128 perfumes are imported, both `15-D` and
  `14-Z` included (Q3).
- **Re-runs never touch existing products (Q7).** Products are inserted with `onConflictDoNothing` on
  `public_id`, and their sizes are created only together with a new product. A product that already
  exists, whatever staff did to it (title, families, prices, stock, sizes, `active = false`), is left
  alone.
- **Queue for Strapi in the same transaction**: `enqueueCmsSync(tx, "product", insertedIds)`.
  (`applyCmsProductChange` doesn't queue anything, because Strapi saves its answer directly, so the
  import queues itself, like `createOrder` does.) The script then tells the user to run
  `pnpm db:sync-cms`, which pushes the products and backfills their slugs. The import doesn't push, so
  it needs no Strapi variables.
- **Conversion is reproducible from the owner's original file.** `parseCatalogMarkdown()` (pure) does
  the mechanical normalisation, and owner-approved corrections live in a committed `fixes.ts` keyed by
  `(list, code, source title)`. The converter applies them to the original list or to a corrected
  one, and a fix whose source line no longer exists fails the conversion loudly.
  - Families: split on `,`, trimmed, `toLocaleLowerCase("uk")`, aliases applied (`цитрус` →
    `цитрусові`, `древовидні` → `деревні`), duplicates dropped (`Пряні, пряні` → `["пряні"]`), and
    every value must be in `FRAGRANCE_FAMILIES` or the conversion fails. The first is the primary, and
    the import sets `fragranceFamily: families[0]`.
  - Notes: split on `,`, trimmed, lower-cased with `toLocaleLowerCase("uk")` (as the seed stores them),
    spelling map from `fixes.ts` applied, duplicates dropped.
  - Title: `(Unisex)` (any case) is removed and sets `gender = "unisex"`, otherwise the list gives
    `women` / `men`. Whitespace is collapsed.
  - A trailing `(popular)` (any case) is removed from the line, so it never ends up in a note. It's
    kept as `popular: boolean` in `CATALOG_PRODUCTS` but **not stored in the database (unconfirmed,
    Q8)**.
  - The parser rejects Latin words containing Cyrillic look-alikes (`Bvlgarі`) so they can't come back.
- **Generated file**: `pnpm db:convert-catalog <path>` writes `app/.server/db/catalog-data.ts`
  (`CATALOG_PRODUCTS`, with a "generated, don't edit by hand" header) and formats it with Biome. The
  prices are hand-written in `app/.server/db/catalog-prices.ts`, so a re-conversion never overwrites
  them.
- **Other columns**: `packSize` 1; `description` / `imageUrl` / `slug` null (photos and descriptions
  come later in Strapi, and `ProductImage` already handles a missing image); `active` true.
- **Data fixes (Q5, Q6)**: the Appendix is applied as proposed.

## Open questions

- [ ] **Q8: What should "(popular)" do?** The owner marked 30 perfumes `(popular)` after the plan was
  written. The home page's bestsellers come from units sold (`listBestsellers`,
  `db/queries/products.ts:152`), and there's no popular flag in the schema or in Strapi. — Why it
  matters: storing and showing it means a column, a migration, a Strapi field, the CMS sync schema and
  a change to the bestsellers query, which is more than this issue covers. Recommended default: the
  parser strips the marker and keeps `popular` in the committed data, but nothing is stored or shown.
  A follow-up issue adds a staff-editable "popular" flag, seeded from that data, if the owner wants
  these perfumes featured (e.g. topping up the bestsellers until there are sales). Affects steps: 3, 5.

## Resolved questions

- **Q1 Prices**: 5 ml 119 ₴, 10 ml (tester) 240 ₴, 30 ml 459 ₴, 50 ml 629 ₴, 100 ml 969 ₴; 7 ml is
  removed from the shop entirely. (source: owner, 2026-10-26)
- **Q2 `11-L`**: Lolita Lempicka and Lift are different products and both keep `11-L`. (owner)
- **Q3 `15-D` / `14-Z`**: different products; both are imported unchanged. (owner)
- **Q4 Codes**: codes repeated between the lists are different products; codes aren't changed.
  (owner)
- **Q5 Same-name titles**: "Woman"/"Man" and "Pour Homme" as proposed. (owner)
- **Q6 Name, brand, family and note fixes**: the Appendix defaults. (owner)
- **Q7 Sizes on a re-run**: sizes are created only with a new product. (owner)
- **How many perfumes are there?** 75 women's and 53 men's lines, 128 products. (source:
  `makrtextfiles/catalog.md`)
- **Are all families valid values?** Yes, after lower-casing and two aliases (`цитрус`, `древовидні`):
  every one is in `FRAGRANCE_FAMILIES`. (source: `app/lib/enums.ts:110`)
- **Do unisex perfumes show in both catalogs?** Yes, `GENDER_SCOPE` lists `unisex` under both `women`
  and `men`; no Unisex page is added. (source: `app/.server/services/products.ts:22`, memory "No Unisex
  catalog")
- **Do notes fit the limits?** The longest entry (Escada Magnetism) has 24 notes, under
  `MAX_PRODUCT_NOTES` (40). (source: `app/lib/cms-sync.ts:51`)
- **Can products have no slug, image or description?** Yes: the first push backfills a slug
  (`services/cms-push.ts:128`), and `ProductImage` renders a placeholder for a null image
  (`app/features/catalog/ProductImage.tsx:22`).
- **Is the 5 ml size blocked anywhere besides the CHECK?** `PERFUME_VOLUMES_ML` feeds the CHECK
  (`db/schema.ts:151`) and the CMS sync validation (`app/lib/cms-sync.ts:36`); the Strapi variant
  component only requires `min: 1` (`cms/src/components/catalog/variant.json`, whose description text
  lists the sizes). The catalog has no volume filter. Order lines' `volume_ml` has no CHECK, so old
  7 ml lines stay valid.
- **What about the sample "La Vie Est Belle"?** `pnpm db:seed` is for local development only and has
  its own fixed `publicId`, so a seeded dev database shows it next to the imported `1-L`. Production
  isn't seeded. (source: `app/.server/db/seed-data.ts`)
- **Where do the scripts and the Aspire resource go?** `db/scripts/*.ts` run with `tsx` and close their
  own pool (`createDb(url, 1)`); the Aspire resource copies `db-seed`. (source:
  `app/.server/db/scripts/seed.ts`, `aspire-apphost/apphost.mts:38`)

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts`, `app/lib/enums.test.ts` | `PERFUME_VOLUMES_ML = [5, 10, 30, 50, 100]` |
| create | `app/.server/db/migrations/0014_volume_5ml.sql` (+ `meta/`) | New CHECK; delete 7 ml sizes, fix legacy columns, queue products |
| create | `app/.server/db/rollbacks/0014_volume_5ml.sql` | Reverse |
| modify | `app/.server/db/migrator.test.ts` | Migration test; 7 ml → 5 ml in existing cases |
| modify | `app/.server/db/seed-data.ts`, `seed.test.ts` | Sample 7 ml sizes → 5 ml |
| modify | `app/.server/services/{cart,orders,products,cms-push,order-email}.test.ts`, `app/.server/cms/content.test.ts` | 7 ml → 5 ml / 10 ml |
| modify | `cms/src/components/catalog/variant.json` | Description lists 5, 10, 30, 50, 100 ml |
| modify | `cms/scripts/seed.ts`, `app/.server/cms/__fixtures__/offers.json`, `offers.en.json` | Trio copy says 10 ml, minis 5 ml |
| create | `app/.server/db/catalog/parse.ts` | `parseCatalogMarkdown`, `normalizeFamilies`, `normalizeNotes`, `catalogPublicId`, `CatalogEntry` / `CatalogList` |
| create | `app/.server/db/catalog/parse.test.ts` | Parser tests on inline sample lines (not the owner's file) |
| create | `app/.server/db/catalog/fixes.ts` | Owner-approved corrections: per-entry overrides, family aliases, note spelling map |
| create | `app/.server/db/catalog/render.ts` | `renderCatalogData(entries)`: the source text of `catalog-data.ts` |
| create | `app/.server/db/scripts/convert-catalog.ts` | `pnpm db:convert-catalog <path>` |
| create | `app/.server/db/catalog-data.ts` | Generated `CATALOG_PRODUCTS` (128 entries) |
| create | `app/.server/db/catalog-prices.ts` | `CATALOG_PRICES` |
| create | `app/.server/db/catalog-data.test.ts` | Invariants of the committed data and prices |
| create | `app/.server/db/import-catalog.ts` | `importCatalog(db, entries, prices)` |
| create | `app/.server/db/import-catalog.test.ts` | DB integration tests |
| create | `app/.server/db/scripts/import-catalog.ts` | `pnpm db:import-catalog` |
| modify | `package.json` | `db:convert-catalog` and `db:import-catalog` scripts |
| modify | `aspire-apphost/apphost.mts`, `aspire-apphost/AGENTS.md` | Explicit-start `db-import-catalog` under `jassmindb` |
| modify | `README.md` | Script table rows; import step in "Products and orders in Strapi" |
| modify | `app/.server/AGENTS.md` | Sizes, the import (identity, re-run rule, outbox) |
| modify | `app/.server/db/schema.ts` | `storeCode` comment (comment only) |

## Steps

- [x] **1. Sizes: 5 ml in, 7 ml out** — Change `PERFUME_VOLUMES_ML` and its test. Run
  `pnpm db:generate --name volume_5ml` (drop and re-add `product_variants_volume_ml_check`), then add
  to the generated SQL, **before** the new CHECK: (a) queue the products that have a 7 ml size
  (`insert into cms_outbox (entity, entity_id) select 'product', product_id … on conflict (entity,
  entity_id) do update set version = cms_outbox.version + 1, attempts = 0, next_attempt_at = now(),
  last_error = null, synced_at = null`), (b) `delete from product_variants where volume_ml = 7`,
  (c) set `products.price` / `volume_ml` from the smallest remaining size where `volume_ml = 7`. Write
  the rollback. Extend `migrator.test.ts`: a 7 ml size with a cart line and an order line before the
  migration → size and cart line gone, order line kept with `volume_ml = 7` and `variant_id` null,
  legacy columns updated, product queued; 5 ml accepted and 7 ml refused afterwards; rollback works.
  Switch the sample data and the tests from 7 ml to 5 ml (see Files), and update
  `variant.json`'s description, the CMS seed copy and the offer fixtures (10 ml trio, 5 ml minis).
  Check: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- [ ] **2. Prices** — `db/catalog-prices.ts`: `CATALOG_PRICES` as in Decisions, with a comment that
  the owner set it on 2026-10-26 for every perfume (#66).
- [ ] **3. Parser and fixes** — In `db/catalog/parse.ts`, define `CATALOG_LISTS = ["women", "men"]`,
  `CatalogEntry { publicId, list, storeCode, title, brand, gender, fragranceFamilies:
  FragranceFamily[], notes: string[], popular: boolean }` and `parseCatalogMarkdown(text, fixes)`: the
  headings `**Womens perfume**` / `**Mens perfume**` switch the list; each `- **code** | **title** |
  brand | families | notes [(popular)]` line becomes an entry; any other non-blank line after the
  first heading, the wrong number of fields, an unknown family, an empty family or note list, or a
  Latin word with Cyrillic letters throws with the line number. `catalogPublicId(list, code,
  sourceTitle)` builds the name-based UUID with `node:crypto`. Put the Appendix in
  `db/catalog/fixes.ts` (`ENTRY_FIXES`, `FAMILY_ALIASES`, `NOTE_SPELLING`); a fix that matches no line
  throws. Write `parse.test.ts` first: plain line; unisex in any case; `(popular)` stripped and
  flagged; families split, lower-cased, aliased and de-duplicated; notes trimmed, lower-cased,
  de-duplicated and respelled; a title or brand fix leaving `publicId` unchanged; two entries with the
  same list and code but different titles getting different ids; each failure; `catalogPublicId`
  stable and a valid UUID.
- [ ] **4. Conversion script and data file** — `db/catalog/render.ts` turns entries into a TypeScript
  module (`import type { CatalogEntry } from "./catalog/parse"`, then `export const CATALOG_PRODUCTS:
  readonly CatalogEntry[] = [...]`) with `JSON.stringify` for every string. `db/scripts/convert-catalog.ts`
  reads `process.argv[2]`, writes `app/.server/db/catalog-data.ts` and runs
  `pnpm exec biome format --write` on it. Add `"db:convert-catalog"` to `package.json`, run
  `pnpm db:convert-catalog "C:\Users\КТС\jassmin\makrtextfiles\catalog.md"` and commit the output
  (never the Markdown). Check it has 128 entries and reads sensibly.
- [ ] **5. Data tests** — `db/catalog-data.test.ts`: 75 women's and 53 men's entries, 30 popular;
  every `publicId` unique and `(list, storeCode, title)` unique; both `11-L` entries and both
  `15-D` / `14-Z` present; every family in `FRAGRANCE_FAMILIES`, no duplicates, at least one; at least
  one note and at most `MAX_PRODUCT_NOTES`; no title contains "unisex" or "popular" (any case), and the
  known unisex ones (e.g. `9-A` Baccarat Rouge 540) have `gender: "unisex"`; others have their list's
  gender; no two entries of the same gender share a title (Q5); `storeCode` ≤ 20 and title/brand ≤ 255
  characters. `CATALOG_PRICES`: keys exactly `PERFUME_VOLUMES_ML`, values match `/^\d+\.\d{2}$/` and
  are > 0.
- [ ] **6. `importCatalog`** — `db/import-catalog.ts`, `importCatalog(db: Db, entries:
  readonly CatalogEntry[], prices: Partial<Record<PerfumeVolumeMl, string>>): Promise<{ inserted:
  number; variantsInserted: number; queued: number }>`. Throws if `prices` has no sizes. In one
  `db.transaction`: insert every entry (`fragranceFamily: families[0] ?? null`, legacy columns from the
  smallest size, `stockQuantity: 0`, `packSize: 1`; `popular` isn't a column) with
  `onConflictDoNothing({ target: products.publicId })` and `returning({ id })`; insert each new
  product's sizes (stock 0) with `onConflictDoNothing` on `(productId, volumeMl)`; then
  `enqueueCmsSync(tx, "product", insertedIds)`. Existing products get nothing (Q7). 128 rows × ~15
  columns fit one statement, and 640 sizes × 4 columns too.
- [ ] **7. Import tests** — `db/import-catalog.test.ts`, `describe.skipIf(!hasDatabase)`, a migrated
  `createTestDatabase()` (as in `seed.test.ts`): with a small entry list and the full
  `CATALOG_PRODUCTS` + `CATALOG_PRICES`: counts of products and sizes (128 / 640); every product has
  exactly 5, 10, 30, 50 and 100 ml at the table's prices with stock 0; both `11-L` products exist;
  unisex entries are stored as `unisex` and listed by `listProducts` for both women and men; families,
  primary family, notes and store code stored; one `cms_outbox` row per new product. Re-run: returns
  0 / 0 / 0 and adds no rows; a product whose stock, price, title and families were changed and one
  size deleted keeps all of that; an `active = false` product stays inactive. An empty price table
  throws and writes nothing.
- [ ] **8. Script, Aspire, docs** — `db/scripts/import-catalog.ts` (shaped like `scripts/seed.ts`)
  prints "Imported N of 128 perfumes with M sizes; queued N for Strapi. Run `pnpm db:sync-cms` to push
  them." Add `"db:import-catalog"` to `package.json`. In `apphost.mts`, add `db-import-catalog` after
  `db-seed` (`addJavaScriptApp(..., { runScriptName: "db:import-catalog" })`,
  `withPnpm({ install: false })`, `withReference(db)`, `waitForCompletion(dbMigrate)`,
  `withParentRelationship(db)`, `withExplicitStart()`) and document it in `aspire-apphost/AGENTS.md`.
  README: rows for `pnpm db:import-catalog` and `pnpm db:convert-catalog <path>`, and a step in
  "Products and orders in Strapi" (import, then `pnpm db:sync-cms`). `app/.server/AGENTS.md`: the
  sizes, the import, and the `storeCode` comment in `schema.ts`.
- [ ] **9. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm aspire:build`, `pnpm build`.
  Under `pnpm aspire run`: `db-migrate`, then `db-import-catalog` twice (the second run imports 0),
  then `db-sync-cms`; check the Strapi admin and `/catalog/women` and `/catalog/men`.
- [ ] **10. Remove the plan** before the PR is merged (`docs/plans/66-import-perfume-catalog.md`).

## Testing & verification

- Unit: `db/catalog/parse.test.ts` (step 3), `db/catalog-data.test.ts` (step 5), `enums.test.ts`.
- Integration (needs a database): `migrator.test.ts` (step 1), `db/import-catalog.test.ts` (step 7),
  and the existing cart/order/product tests on 5 ml.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm aspire:build`, `pnpm build`.
- Manual: in the Strapi admin the 128 products show with families, notes, store code and five sizes at
  stock 0, and no product has a 7 ml size. Baccarat Rouge 540 is listed in both catalogs without
  "(Unisex)". A product page offers 5–100 ml at 119–969 ₴, and a size with 0 stock can't be added to
  the cart until staff set stock in Strapi. The tester trio still prices three 10 ml sizes at 499 ₴.

## Acceptance criteria

- [ ] Every perfume in the owner's list is in the catalog with its brand, all families, notes and store
  code — steps 3, 4, 5, 6, 7
- [ ] Perfumes marked "(Unisex)" appear in both the Women and Men catalogs without "(Unisex)" in the
  name — steps 3, 5, 7
- [ ] Every imported perfume has the same sizes and prices from one price table, with stock 0 —
  steps 1, 2, 6, 7
- [ ] Running the import twice creates no duplicates and doesn't overwrite staff changes — steps 6, 7
- [ ] Imported products appear in the Strapi admin after `pnpm db:sync-cms` — steps 6, 8, 9
- [ ] The duplicate code, duplicate perfume and typos listed above are resolved with the owner before
  import — resolved Q2–Q6, step 3 (`fixes.ts`)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 9

## Out of scope

- Product photos, descriptions, English names and stock levels (Strapi, later).
- Storing or showing "popular" (Q8: follow-up issue by default).
- A Unisex catalog page or link.
- A uniqueness constraint on `store_code`.
- Updating existing products from a changed list or price table (a re-run only adds new perfumes).
- Changing the tester trio rule, and editing the live Strapi offer text (staff do that).
- Committing the owner's Markdown file.

## Appendix: data fixes (Q5, Q6 — approved)

| List | Code | In the list | Fixed |
|---|---|---|---|
| women | 2-H | Hugo Boss | "Hugo Boss Woman" |
| men | 1-H | Hugo Boss | "Hugo Boss Man" |
| women | 1-D | Davidoff Cool Water | "Davidoff Cool Water Woman" |
| men | 2-D | Davidoff Cool Water | "Davidoff Cool Water Man" |
| men | 11-J | Eclat D'Arpege | "Eclat D'Arpege Pour Homme" |
| women | 12-O | Omnia Bvlgarі (Cyrillic і) | "Omnia Bvlgari" |
| women | 4-P | Fame Poco Rabanne | "Fame Paco Rabanne" |
| men | 4-Y | Spisebomb | "Spicebomb" |
| men, women | 4-Y, 1-V | brand Viktor Rolf | "Viktor&Rolf" |
| men | 1-X | Xeryus Rouge / Kelys Pyu | brand "Givenchy" |
| men | 8-Z | Molecule 02 Escentric / Monmole 02 | "Molecule 02" / brand "Escentric Molecules" |
| men | 4-G | Ganymede / Marc-Antone | brand "Marc-Antoine Barrois" |
| men | 1-A | Angel (men's list) | "A*Men" / brand "Mugler" |
| men | 2-Y | Lordly / Versace | kept as is |
| men | 3-G | Givenchy, Blue Label | "Givenchy Blue Label" |
| men | 9-J | Angel's Share / brand Angel's Share | brand "Kilian" |
| men | 2-S | Sculpture Homme / Nikos | kept (Nikos is the brand) |
| men | 3-G | families "Пряні, пряні" | `["пряні"]` (automatic dedupe) |
| men | 4-Y | families "Пряні, древовидні" | `["пряні", "деревні"]` (alias) |
| men | 2-Y, 1-X | family "Цитрус" | "цитрусові" (alias) |

`11-L` (both), `15-D`, `14-Z` and the codes repeated between the lists are kept unchanged (Q2–Q4).

Note spelling map (`NOTE_SPELLING`, applied after lower-casing): `іпельсин` → `апельсин`, `перец` →
`перець` (then de-duplicated in 8-J), `рожевий перец` → `рожевий перець`, `янтарь` → `амбра`,
`гардения` → `гарденія`, `онов` → `морські ноти`, `еламі` → `елемі`, `вистери` → `гліцинія`, `піон` →
`півонія`, `перловий півонія` → `перлова півонія`, `деревинні ноти` / `деревний` → `деревні ноти`,
`мандарини` → `мандарин`, `персики` → `персик`. Kept as written: `блазень` (women 5-E), `вітьки`
(men 11-J), `абелит`, `кока` (men 16-J), `мегаланід` (men 10-E), `ялина мускус` (men 9-A),
`червоні ноти` (men 5-P), `багато фруктів` (women 12-S).
