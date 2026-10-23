# AGENTS.md: app/.server

Server-only code. Nothing in this folder may be imported by code that ends up in the browser bundle. Import it only from route `loader`/`action` functions or from other `.server` modules.

## Environment: `env.ts`

- Read configuration only through `getEnv()`, never through `process.env` directly. `getEnv()` loads `.env` (existing variables win), validates with zod and memoizes the result.
- To add a variable, extend `envSchema`, add it to `.env.example` and the README table, and add a case to `env.test.ts`.
- The database URL is `JASSMINDB_URI` (injected by Aspire for the `jassmindb` resource) when it's set, otherwise `DATABASE_URL`. Aspire's value must win, because `.env` usually keeps a `DATABASE_URL` for runs without Aspire. Keep this precedence in `env.ts` and `drizzle.config.ts`.
- `STRAPI_URL` defaults to `http://localhost:1337` and falls back to `CMS_HTTP` (Aspire's `cms` reference). `STRAPI_API_TOKEN` is optional on purpose, so the app boots before a Strapi admin has created the token.

## CMS: `cms/`

Editorial content (blog, home page copy, contact details) lives in Strapi (`cms/` at the repo root). Products, orders and users stay in PostgreSQL.

- Loaders read CMS content only through `cms/content.ts` (`getHomePage`, `getSiteSettings`, `listBlogPosts`, `getBlogPostBySlug`). These return the DTOs from `~/lib/cms`, never raw Strapi shapes, with media URLs already absolute.
- `cms/client.ts` (`cmsFetch`) always adds `status=published`, sends the read-only token and times out after `CMS_TIMEOUT_MS`. Every response is validated with a schema from `cms/schemas.ts`. When you add a field in Strapi, add it to the schema, the DTO, the mapper and the fixtures.
- Failures throw `CmsError` (`cms/errors.ts`). In loaders, wrap CMS calls with `.catch(cmsUnavailable)`, which turns them into a 503 for the `ErrorBoundary`. A missing blog post is `null`, so throw a 404 for it in the route.
- Tests use the recorded Strapi responses in `cms/__fixtures__/`. Re-record them from a seeded Strapi (`pnpm cms:seed`) when the content model changes.

## Database: `db/`

- `db/index.ts` exports the single Drizzle client `db` (with `casing: "snake_case"`) and the `Db` type. Don't create other pools in app code. `db/client.ts` (`createDb(url)`) is only for CLI scripts (`db/scripts/`) and integration tests, which connect without `getEnv()` and close their own pool.
- Define tables and enums in `db/schema.ts`, in TypeScript camelCase. The `snake_case` casing maps them to snake_case columns. drizzle-kit doesn't apply the casing to auto-generated constraint names, so give `.unique()` and similar constraints an explicit snake_case name (e.g. `products_public_id_unique`).
- Build enums from the value arrays in `~/lib/enums` (`pgEnum("gender_type", GENDERS)`), so the TS unions and the database can't drift apart.
- `products.price` is `numeric(10, 2)` and comes back as a string, so never use floats for money. `volume_ml` is the volume of one unit, and the total is `pack_size * volume_ml`. `public_id` (UUID v7 from `uuidv7()`, PostgreSQL 18+) is the stable external key, while `id` stays the FK target.
- Commerce tables (`carts`, `cart_items`, `orders`, `order_items`): every order amount and `order_items.price_at_purchase` is also `numeric(10, 2)`, computed on the server. Their row types are mirrored in `~/lib/commerce`, and `schema.test.ts` fails if the two drift apart. `orders.payment_method` is limited to `PAYMENT_METHODS` by a CHECK constraint. `carts.user_id` and `orders.user_id` use `on delete restrict`, so a user with carts or orders can't be deleted. `carts.session_id` gets its FK to `sessions` in #5.
- `carts.updated_at` and `orders.updated_at` are refreshed by Drizzle's `$onUpdate` on every query-builder update. Raw SQL updates must set `updated_at = now()` themselves, and changes to `cart_items` must bump their cart's `updated_at` (the abandoned-cart job relies on it).
- Migrations: `pnpm db:generate --name <name>` writes them to `db/migrations/`. Every migration needs a hand-written reverse in `db/rollbacks/<tag>.sql`, which `pnpm db:rollback` (`rollbackLatest` in `db/migrator.ts`) runs. Never edit an applied migration.
- `pnpm db:seed` (`db/seed.ts`) inserts `SAMPLE_PRODUCTS` from `db/seed-data.ts` with `onConflictDoNothing` on `public_id`. Give new sample products a fresh fixed UUID v7, and never change an existing one.
- Put query functions in `db/queries/<area>.ts` and keep them small and typed. Put business rules that combine several queries in `services/`.
- Use `db.transaction(async (tx) => …)` whenever multiple writes must succeed together, and pass `tx` down instead of `db`.
- Raw `db.execute(sql\`…\`)` returns `timestamptz` values as **strings**, so convert them with `new Date()`. Typed queries built with the query builder return `Date`s.

## Session: `session.ts`

- Cookie session storage (`__jassmin_session`, httpOnly, sameSite lax, secure in production). Use `getSession`, `commitSession` and `destroySession`, and type new fields in `SessionData`.

## Tests

- Unit tests sit next to the code (`*.test.ts`).
- DB integration tests use `describe.skipIf(!hasDatabase)`, import modules dynamically inside the test (so the env is only validated when a DB exists) and close the pool in `afterAll` (`db.$client.end()`).
- Tests that migrate or write data use `createTestDatabase()` from `db/test-utils.ts` (a throwaway database, dropped in `afterAll`), never the development database.
