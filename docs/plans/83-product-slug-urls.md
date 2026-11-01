# Plan: Use readable product slugs in URLs with redirects from old links (#83)

Issue: https://github.com/savchukolgaa/jassmin/issues/83
Branch: `issue/83`
Worktree: `.claude/worktrees/issue-83`
Status: Planned

## Goal
As a customer, I want product URLs to contain the perfume's name, so that search results and
shared links show what the page is about. Product pages move from `/products/<uuid>` to
`/products/<slug>`. Old UUID links and old slugs (after a rename in Strapi) answer `301` to the
current slug URL, and unknown handles answer 404.

## Dependencies & prerequisites
- #40 (CMS sync): done on `main`. `products.slug` exists (`varchar(255)`, unique
  `products_slug_unique`, nullable), Strapi requires it, and `applyCmsProductChange`
  (`app/.server/services/cms-sync.ts`) writes it through `productWrite` / `updateProduct`.
  `backfillProductSlugs` (`db/queries/products.ts`) fills `null` slugs during `pnpm db:sync-cms --all`.
- No new packages or env vars. One Drizzle migration (`0016_product_slug_history`) plus its
  hand-written rollback `db/rollbacks/0016_product_slug_history.sql`.
- The following SEO issues (canonical, hreflang, sitemap, locale prefix) build on `productHref`.

## Decisions & assumptions
- **Route param** renamed `:id` → `:handle` (`route("products/:handle", "routes/product.tsx")`).
- **Resolution order** in the loader (a new service `resolveProductHandle(handle)` in
  `services/products.ts`):
  1. `handle` is a UUID (`z.uuid()`) → listed product by `public_id`. With a slug →
     `301 /products/<slug>`; without a slug → render (issue assumption).
  2. Otherwise → listed product by current `products.slug` → render.
  3. Otherwise → `product_slug_history` by `slug` → its product, if listed and it has a slug →
     `301 /products/<current slug>`.
  4. Otherwise → 404.
  The redirect keeps `new URL(request.url).search`. The current slug always wins over history, so
  a slug freed by one product and taken by another resolves to the new owner.
- **Exact-match slugs.** Strapi's zod rule (`~/lib/cms-sync`: `^[A-Za-z0-9._~-]+$`) allows
  capitals; lookup is case-sensitive, matching what `productHref` emits. No case-folding redirect.
- **Archived products** (`active = false`): unchanged — every lookup uses `isListed`, so a UUID,
  current slug or old slug of an archived product is a 404, as today.
- **`product_slug_history` table** (`db/schema.ts`): `slug varchar(255)` **primary key**,
  `productId integer not null references products(id) on delete cascade`,
  `createdAt timestamptz not null default now()`, plus an index on `product_id`. Slug as the key
  (rather than a surrogate id) makes the lookup a PK hit and stops one old slug pointing at two
  products.
- **Writing history** in `applyCmsProductChange`, inside its existing transaction:
  - `update`: read the locked product's current slug (extend `lockProductByPublicId` to return
    `{ id, slug }`, or a small `findProductSlug(tx, id)`); if it is non-null and differs from
    `change.slug`, upsert `(oldSlug, productId)` with `onConflictDoUpdate` (refresh `productId`,
    `createdAt`).
  - `create` and `update`: delete any history row whose `slug` equals the new slug, so history never
    shadows (or duplicates) a current slug.
  - `delete` (archive) writes nothing. `backfillProductSlugs` (`null` → slug) writes nothing: there
    was no old URL.
  - A `slug-taken` failure rolls back the history writes with everything else.
  - Query functions go in a new `db/queries/product-slugs.ts` (`recordOldSlug`, `forgetSlug`,
    `findProductIdBySlugHistory`).
- **One link helper** `productHref(product: { id: string; slug: string | null })` in
  `app/lib/products.ts`: `/products/${encodeURIComponent(slug)}` when there is a slug, else
  `/products/${id}` (like `blogPostHref` in `app/lib/blog.ts`). The old `productHref(id)` in
  `features/catalog/ProductCard.tsx` is removed.
- **DTOs** gain `slug: string | null`: `ProductBase` in `app/lib/products.ts` (so
  `ProductSummary` and `ProductDetail` both have it) and `CartLine` in `app/lib/cart.ts`.
- **Where links are built today** (grep for `/products/`): only `ProductCard` (catalog, home
  bestsellers, offers, popular) and `CartLineItem`. Checkout, account orders and order emails don't
  link to products, so nothing changes there; the issue's list is covered by those two call sites.
- **Analytics:** `product_view` is recorded only when the page renders (not on a redirect), with the
  same `properties: { publicId }`.
- **UUID-shaped slugs** are refused by the CMS sync schema: a `.refine` on `slug` in
  `~/lib/cms-sync` (any UUID, matched like `z.uuid()`, case-insensitive) fails validation, so the
  sync route answers 422 and Strapi shows the error. Step 1 of the resolution order would always
  shadow such a slug.

## Resolved questions
- **Refuse a slug that looks like a UUID?** — Yes, with a validation error in Strapi (confirmed by
  the owner while planning).
- **Do products without a slug still exist?** — Yes until the first `pnpm db:sync-cms --all`;
  `importCatalog` inserts products with `slug = null`. They keep working by UUID (source:
  `app/.server/db/import-catalog.ts`, `backfillProductSlugs`, issue assumption).
- **Which pages link to products?** — `ProductCard` and `CartLineItem` only; account orders,
  checkout and emails have no product links (source: grep of `app/` for `/products/` and
  `productHref`; `app/.server/services/order-email.ts`).
- **What happens to archived products?** — Already a 404 via `isListed` in
  `findProductByPublicId` (source: `app/.server/db/queries/products.ts`); kept.
- **Are CMS offer CTAs with `/products/<uuid>` hrefs a problem?** — No: they get the 301 (source:
  `app/lib/links.ts`, `toInternalPath`).
- **How are migrations rolled back?** — Hand-written `db/rollbacks/<tag>.sql`, run by
  `pnpm db:rollback` (source: `app/.server/AGENTS.md` → Database).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/db/schema.ts` | `productSlugHistory` table |
| create | `app/.server/db/migrations/0016_product_slug_history.sql` (+ journal/snapshot) | generated by `pnpm db:generate --name product_slug_history` |
| create | `app/.server/db/rollbacks/0016_product_slug_history.sql` | `drop table product_slug_history;` |
| create | `app/.server/db/queries/product-slugs.ts` (+ `.test.ts`) | record / forget / look up old slugs |
| modify | `app/.server/db/queries/products.ts` | `slug` in `summaryColumns`, `findProductByPublicId`; new `findProductBySlug`; lock returns current slug |
| modify | `app/.server/db/queries/cart.ts` | `slug` in `listCartLines` |
| modify | `app/.server/services/products.ts` | `slug` in `toSummary` / `toDetail`; `resolveProductHandle` |
| modify | `app/.server/services/cms-sync.ts` (+ test) | write slug history on rename |
| modify | `app/lib/products.ts` (+ test) | `slug` on `ProductBase`; `productHref` |
| modify | `app/lib/cart.ts` | `slug` on `CartLine` |
| modify | `app/lib/cms-sync.ts` (+ test) | refuse UUID-shaped slugs |
| modify | `app/routes.ts`, `app/routes.test.ts` | `products/:handle` |
| modify | `app/routes/product.tsx` (+ test) | resolve handle, 301s, 404 |
| modify | `app/features/catalog/ProductCard.tsx` | use `productHref(product)`, drop local helper |
| modify | `app/features/cart/CartLineItem.tsx` | use `productHref(line)` |
| modify | `app/features/catalog/catalog-ui.test.ts`, `app/features/product/product-ui.test.ts`, other fixtures | add `slug` to fixtures, expect slug links |
| modify | `app/.server/db/seed-data.ts` | give sample products a slug, so dev links are readable (optional) |
| modify | `app/.server/AGENTS.md` | document slug URLs and `product_slug_history` |

## Steps
- [x] **1. Schema and migration** — Add `productSlugHistory` to `db/schema.ts` (columns and keys as
  above, explicit constraint/index names, e.g. `product_slug_history_product_id_idx`). Run
  `pnpm db:generate --name product_slug_history`, write the rollback, and check with
  `pnpm db:migrate` + `pnpm db:rollback` + `pnpm db:migrate` on a dev DB. Mirror the row type in
  `~/lib/commerce` only if `schema.test.ts` requires it for this table (it covers commerce tables).
- [x] **2. Slug history queries** — `db/queries/product-slugs.ts`:
  `recordOldSlug(tx, productId, slug)` (insert … `onConflictDoUpdate` on `slug`),
  `forgetSlug(tx, slug)` (delete by slug), `findProductIdBySlugHistory(db, slug)`. Integration test
  with `createTestDatabase()`.
- [x] **3. `productHref` and DTOs** — Add `slug: string | null` to `ProductBase` and `CartLine`.
  Add `productHref` to `app/lib/products.ts` with unit tests (slug, `null` slug → UUID, encoding).
  Select `products.slug` in `summaryColumns`, `findProductByPublicId` and `listCartLines`; map it in
  `toSummary` / `toDetail` / the cart view. Fix fixtures so `pnpm typecheck` passes.
- [x] **4. Use the helper everywhere** — `ProductCard` (both variants) and `CartLineItem` call
  `productHref(...)`; delete the old helper. `grep -rn '/products/\${' app` must find only
  `productHref`. Update the UI tests to expect `/products/<slug>`.
- [x] **5. CMS sync writes history** — In `applyCmsProductChange`: on `update`, get the current slug
  under the row lock, `recordOldSlug` when it changes; on `create`/`update`, `forgetSlug(newSlug)`.
  Add the UUID-shaped-slug refine to `~/lib/cms-sync`, with a test in `app/lib/cms-sync.test.ts`
  (a UUID, upper- or lower-case, is refused; a slug ending in a UUID's last 8 hex digits, as
  `backfillProductSlugs` makes, is accepted). Check how the route's 422 reaches Strapi's error
  message and add the Ukrainian text there if validation errors are listed per field. Tests in
  `cms-sync.test.ts`: rename
  writes history; same slug writes nothing; renaming back removes the history row; another product
  taking a freed slug removes it; `slug-taken` writes nothing; archive writes nothing.
- [x] **6. Resolve handles** — `findProductBySlug(db, slug)` in `db/queries/products.ts` (same
  columns and `isListed` as `findProductByPublicId`; share the column object).
  `resolveProductHandle(handle, db)` in `services/products.ts` returns
  `{ kind: "product"; id; product } | { kind: "redirect"; slug } | null`, following the resolution
  order above.
- [ ] **7. Route** — `app/routes.ts`: `products/:handle`; update `routes.test.ts`. In
  `routes/product.tsx` the loader calls `resolveProductHandle(params.handle)`: `redirect` →
  `throw redirect(productHref({ id, slug }) + search, 301)`; `null` → 404; `product` → record
  `product_view` and return as today. Rewrite `product.test.ts` (mocking `resolveProductHandle`):
  slug renders + event; UUID with slug → 301 keeping `?ref=offers`; old slug → 301; UUID without
  slug renders; unknown / malformed → 404 without an event.
- [ ] **8. Docs and seed** — Note in `app/.server/AGENTS.md` (Database / CMS sync) that product URLs
  use `products.slug`, `productHref` is the only link builder, and `product_slug_history` is written
  on rename. Optionally add slugs to `SAMPLE_PRODUCTS`.
- [ ] **9. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; manual checks below.

## Testing & verification
- Unit: `productHref` (`app/lib/products.test.ts`); product loader cases (`product.test.ts`);
  `cms-sync` schema refine (`app/lib/cms-sync.test.ts`); route table (`routes.test.ts`).
- Integration (`describe.skipIf(!hasDatabase)`, `createTestDatabase()`): slug history queries;
  `applyCmsProductChange` rename cases; `resolveProductHandle` against real rows (slug, UUID,
  history, archived, unknown).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`): catalog, home, offers, popular and cart links show `/products/<slug>`;
  open `/products/<uuid>?ref=x` → 301 to `/products/<slug>?ref=x`; rename the slug in Strapi, open
  the old URL → 301 to the new one; `/products/nope` → 404 page; an archived product → 404.

## Acceptance criteria
- [ ] Every product link on the site points to `/products/<slug>` — steps 3, 4
- [ ] `/products/<uuid>` answers 301 to the slug URL — steps 6, 7
- [ ] After renaming a slug in Strapi, the old slug URL answers 301 to the new one — steps 1, 2, 5, 6, 7
- [ ] Unknown handles answer 404 — steps 6, 7
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 9

## Out of scope
- Localized slugs and the locale URL prefix.
- Canonical URLs, hreflang and the sitemap (following SEO issues).
- Case-insensitive slug matching or a redirect to lower case.
- Changing behaviour for archived products, or links from order history / emails (none exist).
