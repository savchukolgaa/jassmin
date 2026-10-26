# Plan: Import the store's perfume range into the catalog (#66)

Issue: https://github.com/savchukolgaa/jassmin/issues/66
Branch: `issue/66`
Worktree: `.claude/worktrees/issue-66`
Status: Planned (blocked on Q1, the price table, before the real import runs)

## Goal

As the store owner, I want every perfume we actually sell in the catalog, so shoppers can find and
buy it. The owner's list (75 women's and 53 men's perfumes, each with a store code, name, brand,
fragrance families and notes) becomes a committed, typed data file. An idempotent
`pnpm db:import-catalog` loads it into PostgreSQL, gives every perfume the same sizes at one price
table's prices with stock 0, and queues the new products for the Strapi push (`pnpm db:sync-cms`).

## Dependencies & prerequisites

- **#65 (merged, `380d2da`)**: `products.fragrance_families`, `products.notes`, `products.store_code`,
  the `products_fragrance_family_primary_check` CHECK and `FRAGRANCE_FAMILIES` in `app/lib/enums.ts`.
- **#40 (merged, `933e84f`)**: `cms_outbox` with `enqueueCmsSync` (`db/queries/cms-outbox.ts`),
  `deliverCmsSync`, `pnpm db:sync-cms`, and the slug backfill on a product's first push
  (`services/cms-push.ts:128`).
- **Source list**: `makrtextfiles/catalog.md` in the main checkout (`C:\Users\КТС\jassmin`). It's
  untracked and stays that way: the converter reads it from a path argument, and only the converted
  data file is committed.
- No new packages, env vars or migrations. The scripts use `getDatabaseUrl(process.env)`
  (`JASSMINDB_URI`, else `DATABASE_URL`) like `db/scripts/seed.ts`.
- **The price table (Q1) must be filled in** before the import runs against a real database. The code
  and tests can be written before that.

## Decisions & assumptions

- **Identity = (list, store code), without a new column.** Unisex perfumes come from both lists, so
  `gender` can't tell the lists apart, and staff may later edit `store_code` in Strapi. Each entry gets
  a deterministic `publicId` derived from `"<list>:<storeCode>"` (a name-based UUID: SHA-256 of a
  fixed namespace plus the name, with version 8 and variant bits set, in `catalogPublicId()`). The
  import upserts by `products.public_id`, like `pnpm db:seed`. No ids to store or keep in sync when the
  list is converted again, and a staff edit to a title or code never makes the import create a second
  copy. `store_code` stays non-unique in the database; uniqueness within a list is checked by the data
  tests. This resolves the "not unique yet (#66 decides)" comment on `products.storeCode` in
  `db/schema.ts`, which gets updated.
- **Re-runs never touch existing products.** Products are inserted with `onConflictDoNothing` on
  `public_id`; a product that exists, whatever staff did to it (title, families, `active = false`,
  prices, stock, sizes), is left alone. Sizes are only created together with their new product
  **(unconfirmed, Q7)**. This is how "never overwrites stock, prices or fields staff have since
  changed" holds, with no field-level comparison.
- **Queue for Strapi in the same transaction**: `enqueueCmsSync(tx, "product", insertedIds)`. (The
  issue says "as `applyCmsProductChange` does", but that function doesn't queue: Strapi saves its
  answer directly. The import has to queue itself, like `createOrder` does.) The script then prints a
  reminder to run `pnpm db:sync-cms`, which pushes the products and backfills their slugs. The import
  doesn't push itself, so it needs no Strapi variables.
- **Conversion is reproducible from the owner's original file.** `parseCatalogMarkdown()` (pure) does
  the mechanical normalisation, and owner-approved corrections live in a committed `fixes.ts` keyed by
  `(list, original code, original title)`, so the converter applies them to the original list or to a
  corrected one. A fix whose source line no longer exists fails the conversion loudly.
  - Families: split on `,`, trimmed, `toLocaleLowerCase("uk")`, aliases applied (`цитрус` →
    `цитрусові`, `древовидні` → `деревні`), duplicates dropped (`Пряні, пряні` → `["пряні"]`), and
    every value must be in `FRAGRANCE_FAMILIES` or the conversion fails. The first is the primary, and
    the import sets `fragranceFamily: families[0]`.
  - Notes: split on `,`, trimmed, lower-cased with `toLocaleLowerCase("uk")` (as the seed stores them),
    spelling map from `fixes.ts` applied, duplicates dropped (`Terre D'Hermes` lists `шавлія` twice).
  - Title: `(Unisex)` (any case) is removed and sets `gender = "unisex"`, otherwise the list gives
    `women` / `men`. Whitespace is collapsed.
  - The parser rejects Latin words containing Cyrillic look-alikes (`Bvlgarі`) so they can't come back.
- **Generated file**: `pnpm db:convert-catalog <path>` writes `app/.server/db/catalog-data.ts`
  (`CATALOG_PRODUCTS`, with a "generated, don't edit by hand" header) and formats it with Biome. The
  prices are hand-written in a separate `app/.server/db/catalog-prices.ts` (`CATALOG_PRICES`), so a
  re-conversion never overwrites them.
- **Prices**: `CATALOG_PRICES: Partial<Record<PerfumeVolumeMl, string>>`, decimal strings like
  `"350.00"` (`numeric(10, 2)`, never floats). Only the sizes with a price are created. The legacy
  `products.price` / `volume_ml` / `stock_quantity` come from the smallest size, as
  `productWrite` does in `services/cms-sync.ts`. `importCatalog` refuses an empty table.
- **Other columns**: `packSize` 1, `description` / `imageUrl` / `slug` null (photos and descriptions
  come later in Strapi; `ProductImage` already handles a missing image), `active` true.
- **Proposed data fixes** (Appendix) are applied as listed, all **(unconfirmed, Q2–Q6)** until the
  owner approves them.

## Open questions

- [ ] **Q1: What is the price per size?** The issue's table is still `[PRICE]` placeholders for 7, 10,
  30, 50 and 100 ml. — Why it matters: every variant's price, and which sizes exist at all. No prices
  are invented. Recommended default: none. Steps 1–6 and 8–9 can be done, with tests using their own
  price table; step 7 (the real import) and the final `CATALOG_PRICES` values wait for the answer.
  Also: is the 10 ml price meant to work with the tester trio (any three single 10 ml sizes for
  499 ₴, `services/trio.ts`)? Affects steps: 2, 7.
- [ ] **Q2: Which code does `Lift` get?** `11-L` is both Lolita Lempicka and Lift in the women's list.
  — Why it matters: (list, code) is the product's identity; a duplicate fails the data tests.
  Recommended default: Lolita Lempicka keeps `11-L`, Lift becomes `14-L` (the next free L code in the
  women's list), if that matches the bottle. Affects steps: 1, 3.
- [ ] **Q3: Are `15-D` "Dolce & Gabbana Anthology L'Imperatrice 3" and `14-Z` "D&G L'Imperatrice 3"
  the same perfume?** They have different families (квіткові, водяні vs. деревні, квіткові) and
  overlapping notes. — Why it matters: one perfume or two in the catalog. Recommended default: the same
  perfume; import `15-D` (fuller notes) as "Dolce & Gabbana L'Imperatrice 3" and skip `14-Z`, giving
  74 women's + 53 men's = **127** products. Affects steps: 1, 3.
- [ ] **Q4: Is a code unique only within its list?** `1-D`, `2-D`, `3-D`, `1-H`, `2-E`, `3-E`, `3-H`,
  `4-P`, `8-J`, `9-J`, `10-J` and `11-L` appear in both lists. Note that `9-J` is unisex in **both**
  (women: JPG Gaultier 2, men: Angel's Share), so in Strapi only the title tells them apart. — Why it
  matters: the identity rule and what staff see. Recommended default: yes, unique within a list, codes
  kept exactly as on the bottles; no prefix. Affects steps: 1, 3.
- [ ] **Q5: How should same-name perfumes be titled?** — Why it matters: shoppers see both in a unisex
  search or the "all" listing. Recommended default: women `2-H` "Hugo Boss Woman" / men `1-H` "Hugo
  Boss Man"; women `1-D` "Davidoff Cool Water Woman" / men `2-D` "Davidoff Cool Water Man"; women
  `17-L` "Eclat D'Arpege" / men `11-J` "Eclat D'Arpege Pour Homme". Affects steps: 1.
- [ ] **Q6: Does the owner accept the name, brand, family and note fixes in the Appendix?** — Why it
  matters: they're shown to shoppers and fixed in `fixes.ts`. Recommended default: apply them as
  proposed; any the owner rejects is removed from `fixes.ts` before step 3. Affects steps: 1, 3.
- [ ] **Q7: Should a re-run add sizes missing from existing products?** The issue says the import
  "creates missing sizes", which would also bring back a size staff deleted in Strapi. — Why it
  matters: staff changes vs. rolling a later price-table change (e.g. a new 7 ml price) out to existing
  products. Recommended default: no. Sizes are created only with a new product, so staff deletions
  stick; a later price-table change is a separate, explicit job. Affects steps: 5.

## Resolved questions

- **How many perfumes are there?** 75 women's and 53 men's lines (the issue says "about 50" men's), so
  127 products after the `14-Z` merge (Q3). (source: `makrtextfiles/catalog.md`)
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
- **What goes in the deprecated product columns?** The smallest size's price and volume, stock 0, as
  `productWrite` does. (source: `app/.server/services/cms-sync.ts:52`, `app/.server/AGENTS.md`)
- **Does `applyCmsProductChange` queue anything?** No, it returns the state Strapi saves; the import
  queues with `enqueueCmsSync` itself. (source: `app/.server/services/cms-sync.ts:90`,
  `db/queries/cms-outbox.ts:16`)
- **What about the sample "La Vie Est Belle"?** `pnpm db:seed` is for local development only and has
  its own fixed `publicId`, so a seeded dev database shows it next to the imported `1-L`. Production
  isn't seeded, so nothing is merged. (source: `app/.server/db/seed-data.ts`)
- **Where do the scripts and the Aspire resource go?** `db/scripts/*.ts` run with `tsx` and close their
  own pool (`createDb(url, 1)`); the Aspire resource copies `db-seed`. (source:
  `app/.server/db/scripts/seed.ts`, `aspire-apphost/apphost.mts:38`)

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `app/.server/db/catalog/parse.ts` | `parseCatalogMarkdown(text)`, `normalizeFamilies`, `normalizeNotes`, `catalogPublicId(list, code)`, `CatalogEntry` / `CatalogList` types |
| create | `app/.server/db/catalog/parse.test.ts` | Parser tests on inline sample lines (not the owner's file) |
| create | `app/.server/db/catalog/fixes.ts` | Owner-approved corrections: per-entry overrides and skips, family aliases, note spelling map |
| create | `app/.server/db/catalog/render.ts` | `renderCatalogData(entries)`: the source text of `catalog-data.ts` |
| create | `app/.server/db/scripts/convert-catalog.ts` | `pnpm db:convert-catalog <path>`: read the Markdown, apply fixes, write `catalog-data.ts`, run Biome on it |
| create | `app/.server/db/catalog-data.ts` | Generated `CATALOG_PRODUCTS` (127 entries) |
| create | `app/.server/db/catalog-prices.ts` | Hand-written `CATALOG_PRICES` (Q1) |
| create | `app/.server/db/catalog-data.test.ts` | Invariants of the committed data |
| create | `app/.server/db/import-catalog.ts` | `importCatalog(db, entries, prices)` |
| create | `app/.server/db/import-catalog.test.ts` | DB integration tests |
| create | `app/.server/db/scripts/import-catalog.ts` | `pnpm db:import-catalog` |
| modify | `package.json` | `db:convert-catalog` and `db:import-catalog` scripts |
| modify | `aspire-apphost/apphost.mts` | Explicit-start `db-import-catalog` under `jassmindb` |
| modify | `aspire-apphost/AGENTS.md` | Document the resource |
| modify | `README.md` | Script table rows, and a line in "Products and orders in Strapi" |
| modify | `app/.server/AGENTS.md` | Database bullet on the import (identity, re-run rule, outbox) |
| modify | `app/.server/db/schema.ts` | `storeCode` comment: unique within its list, by `public_id` (comment only, no migration) |

## Steps

- [ ] **1. Parser and fixes** — In `db/catalog/parse.ts`, define `CATALOG_LISTS = ["women", "men"]`,
  `CatalogEntry { publicId, list, storeCode, title, brand, gender, fragranceFamilies:
  FragranceFamily[], notes: string[] }` and `parseCatalogMarkdown(text, fixes)`: the section headings
  `**Womens perfume**` / `**Mens perfume**` switch the list; each `- **code** | **title** | brand |
  families | notes` line becomes an entry; any other non-blank line after the first heading, a line
  with the wrong number of fields, an unknown family, an empty family or note list, or a Latin word
  with Cyrillic letters throws with the line number. `catalogPublicId(list, code)` builds the
  name-based UUID with `node:crypto`. Put the Appendix corrections in `db/catalog/fixes.ts`
  (`ENTRY_FIXES`, `SKIPPED_ENTRIES`, `FAMILY_ALIASES`, `NOTE_SPELLING`); a fix that matches no line
  throws. Write `parse.test.ts` first: a line per case (plain, unisex with any case, families
  split/lower-cased/aliased/deduped, notes trimmed/lower-cased/deduped/respelled, a title or code fix,
  a skipped entry, each failure), and `catalogPublicId` being stable, distinct across lists and a valid
  UUID.
- [ ] **2. Price table** — `db/catalog-prices.ts`: `CATALOG_PRICES` typed
  `Partial<Record<PerfumeVolumeMl, string>>`, filled from Q1's answer. Until then it holds no sizes and
  a `// #66: fill in from the owner's price table` comment, and the data test for it is
  `it.todo`.
- [ ] **3. Conversion script and data file** — `db/catalog/render.ts` turns entries into a TypeScript
  module (`import type { CatalogEntry } from "./catalog/parse"`, then `export const CATALOG_PRODUCTS:
  readonly CatalogEntry[] = [...]`) with `JSON.stringify` for every string. The script
  `db/scripts/convert-catalog.ts` reads `process.argv[2]`, writes `app/.server/db/catalog-data.ts` and
  runs `pnpm exec biome format --write` on it. Add `"db:convert-catalog"` to `package.json`, then run
  `pnpm db:convert-catalog "C:\Users\КТС\jassmin\makrtextfiles\catalog.md"` and commit the output
  (never the Markdown). Check that it's 127 entries and reads sensibly.
- [ ] **4. Data tests** — `db/catalog-data.test.ts`: 74 women's (after Q3's skip) and 53 men's entries;
  `(list, storeCode)` unique and every `publicId` unique; every family in `FRAGRANCE_FAMILIES`, no
  duplicates, at least one; at least one note and at most `MAX_PRODUCT_NOTES`; no title contains
  "unisex" (any case), and the known unisex ones (e.g. `9-A` Baccarat Rouge 540) have `gender:
  "unisex"`; non-unisex entries have their list's gender; no two entries of the same gender share a
  title (Q5); `storeCode` ≤ 20 and title/brand ≤ 255 characters; `CATALOG_PRICES` keys are in
  `PERFUME_VOLUMES_ML` and values match `/^\d+\.\d{2}$/` and are > 0.
- [ ] **5. `importCatalog`** — `db/import-catalog.ts`, `importCatalog(db: Db, entries:
  readonly CatalogEntry[], prices: Partial<Record<PerfumeVolumeMl, string>>): Promise<{ inserted:
  number; variantsInserted: number; queued: number }>`. Throws if `prices` has no sizes. Sorts the
  sizes, and in one `db.transaction`: inserts every entry (`fragranceFamily: families[0] ?? null`,
  legacy columns from the smallest size, `stockQuantity: 0`, `packSize: 1`) with
  `onConflictDoNothing({ target: products.publicId })` and `returning({ id })`; inserts each new
  product's sizes (stock 0) with `onConflictDoNothing` on `(productId, volumeMl)`; calls
  `enqueueCmsSync(tx, "product", insertedIds)`. Existing products get nothing (Q7). Insert in chunks
  if needed to stay well under PostgreSQL's parameter limit (127 rows × ~15 columns is fine in one
  statement).
- [ ] **6. Import tests** — `db/import-catalog.test.ts`, `describe.skipIf(!hasDatabase)`, a migrated
  `createTestDatabase()` (as in `seed.test.ts`), with a small entry list and a test price table, plus
  one run over the full `CATALOG_PRODUCTS`: counts of products and variants; every product has exactly
  the table's sizes, prices and stock 0; unisex entries stored as `unisex` and listed by
  `listProducts` for both women and men; families, primary family, notes and store code stored; one
  `cms_outbox` row per new product. Re-run: returns 0 / 0 / 0, no new rows, and a product whose stock,
  price, title and families were changed and one size deleted keeps all of that; an `active = false`
  product stays inactive. An empty price table throws and writes nothing.
- [ ] **7. Script, Aspire, docs** — `db/scripts/import-catalog.ts` (copy of `scripts/seed.ts`'s
  shape): prints "Imported N of 127 perfumes with M sizes; queued N for Strapi. Run `pnpm
  db:sync-cms` to push them." Add `"db:import-catalog"` to `package.json`. In `apphost.mts`, add
  `db-import-catalog` after `db-seed` (`addJavaScriptApp(..., { runScriptName: "db:import-catalog" })`,
  `withPnpm({ install: false })`, `withReference(db)`, `waitForCompletion(dbMigrate)`,
  `withParentRelationship(db)`, `withExplicitStart()`) and document it in `aspire-apphost/AGENTS.md`.
  README: rows for `pnpm db:import-catalog` and `pnpm db:convert-catalog <path>`, and a step in
  "Products and orders in Strapi" (import, then `pnpm db:sync-cms`). `app/.server/AGENTS.md` and the
  `storeCode` comment in `schema.ts`. Once Q1 is answered and `CATALOG_PRICES` is filled: run the
  import twice on the Aspire database (`db-import-catalog`) and then `db-sync-cms`.
- [ ] **8. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm aspire:build`, `pnpm build`.
- [ ] **9. Remove the plan** before the PR is merged (`docs/plans/66-import-perfume-catalog.md`).

## Testing & verification

- Unit: `db/catalog/parse.test.ts` (step 1), `db/catalog-data.test.ts` (step 4).
- Integration (needs a database): `db/import-catalog.test.ts` (step 6).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm aspire:build`, `pnpm build`.
- Manual, under `pnpm aspire run`: start `db-import-catalog` twice (second run reports 0 imported),
  then `db-sync-cms`; in the Strapi admin the 127 products show with families, notes, store code and
  sizes at stock 0; `/catalog/women` and `/catalog/men` both list e.g. Baccarat Rouge 540 without
  "(Unisex)"; a product with 0 stock can't be added to the cart until stock is set in Strapi.

## Acceptance criteria

- [ ] Every perfume in the owner's list is in the catalog with its brand, all families, notes and store
  code — steps 1, 3, 4, 5, 6
- [ ] Perfumes marked "(Unisex)" appear in both the Women and Men catalogs without "(Unisex)" in the
  name — steps 1, 4, 6
- [ ] Every imported perfume has the same sizes and prices from one price table, with stock 0 —
  steps 2, 5, 6 (needs Q1)
- [ ] Running the import twice creates no duplicates and doesn't overwrite staff changes — steps 5, 6
- [ ] Imported products appear in the Strapi admin after `pnpm db:sync-cms` — steps 5, 7
- [ ] The duplicate code, duplicate perfume and typos listed above are resolved with the owner before
  import — Q2–Q6, step 1 (`fixes.ts`)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 8

## Out of scope

- Product photos, descriptions, English names and stock levels (Strapi, later).
- A Unisex catalog page or link.
- A database uniqueness constraint or migration for `store_code`.
- Updating existing products from a changed list or price table (a re-run only adds new perfumes).
- Committing the owner's Markdown file.

## Appendix: proposed fixes (Q2–Q6)

| List | Code | In the list | Proposed |
|---|---|---|---|
| women | 11-L | Lift (second `11-L`) | code `14-L` (Q2) |
| women | 14-Z | D&G L'Imperatrice 3 | skip; `15-D` titled "Dolce & Gabbana L'Imperatrice 3" (Q3) |
| women | 2-H | Hugo Boss | "Hugo Boss Woman" (Q5) |
| men | 1-H | Hugo Boss | "Hugo Boss Man" (Q5) |
| women | 1-D | Davidoff Cool Water | "Davidoff Cool Water Woman" (Q5) |
| men | 2-D | Davidoff Cool Water | "Davidoff Cool Water Man" (Q5) |
| men | 11-J | Eclat D'Arpege | "Eclat D'Arpege Pour Homme" (Q5) |
| women | 12-O | Omnia Bvlgarі (Cyrillic і) | "Omnia Bvlgari" |
| women | 4-P | Fame Poco Rabanne | "Fame Paco Rabanne" |
| men | 4-Y | Spisebomb | "Spicebomb" |
| men, women | 4-Y, 1-V | brand Viktor Rolf | "Viktor&Rolf" |
| men | 1-X | Xeryus Rouge / Kelys Pyu | brand "Givenchy" |
| men | 8-Z | Molecule 02 Escentric / Monmole 02 | "Molecule 02" / brand "Escentric Molecules" |
| men | 4-G | Ganymede / Marc-Antone | brand "Marc-Antoine Barrois" |
| men | 1-A | Angel (men's list) | "A*Men" / brand "Mugler" |
| men | 2-Y | Lordly / Versace | owner to confirm the perfume ("Versace Pour Homme"?); kept as is by default |
| men | 3-G | Givenchy, Blue Label | "Givenchy Blue Label" |
| men | 9-J | Angel's Share / brand Angel's Share | brand "Kilian" |
| men | 2-S | Sculpture Homme / Nikos | kept (Nikos is the brand) |
| men | 3-G | families "Пряні, пряні" | `["пряні"]` (automatic dedupe) |
| men | 4-Y | families "Пряні, древовидні" | `["пряні", "деревні"]` (alias) |
| men | 2-Y, 1-X | family "Цитрус" | "цитрусові" (alias) |

Note spelling map (`NOTE_SPELLING`, applied after lower-casing): `іпельсин` → `апельсин`, `перец` →
`перець` (then deduped in 8-J), `рожевий перец` → `рожевий перець`, `янтарь` → `амбра`, `гардения` →
`гарденія`, `онов` → `морські ноти` (owner to confirm; Invictus), `еламі` → `елемі`, `вистери` →
`гліцинія`, `піон` → `півонія`, `перловий півонія` → `перлова півонія`, `деревинні ноти` / `деревний`
→ `деревні ноти`, `мандарини` → `мандарин`, `персики` → `персик`. Notes the owner should check
because they look garbled, kept as written by default: `блазень` (women 5-E), `вітьки` (men 11-J),
`абелит`, `кока` (men 16-J), `мегаланід` (men 10-E), `ялина мускус` (men 9-A), `червоні ноти`
(men 5-P), `багато фруктів` (women 12-S).
