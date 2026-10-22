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

- `db/index.ts` exports the single Drizzle client `db` (with `casing: "snake_case"`) and the `Db` type. Don't create other pools.
- Define tables and enums in `db/schema.ts`, in TypeScript camelCase. The `snake_case` casing maps them to snake_case columns.
- Migrations are generated into `db/migrations/` with drizzle-kit (set up in #3). Never edit an applied migration.
- Put query functions in `db/queries/<area>.ts` and keep them small and typed. Put business rules that combine several queries in `services/`.
- Use `db.transaction(async (tx) => …)` whenever multiple writes must succeed together, and pass `tx` down instead of `db`.
- Raw `db.execute(sql\`…\`)` returns `timestamptz` values as **strings**, so convert them with `new Date()`. Typed queries built with the query builder return `Date`s.

## Session: `session.ts`

- Cookie session storage (`__jassmin_session`, httpOnly, sameSite lax, secure in production). Use `getSession`, `commitSession` and `destroySession`, and type new fields in `SessionData`.

## Tests

- Unit tests sit next to the code (`*.test.ts`).
- DB integration tests use `describe.skipIf(!hasDatabase)`, import modules dynamically inside the test (so the env is only validated when a DB exists) and close the pool in `afterAll` (`db.$client.end()`).
