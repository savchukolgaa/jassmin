# AGENTS.md: app/.server

Server-only code. Nothing in this folder may be imported by code that ends up in the browser bundle. Import it only from route `loader`/`action` functions or from other `.server` modules.

## Environment: `env.ts`

- Read configuration only through `getEnv()`, never through `process.env` directly. `getEnv()` loads `.env` (existing variables win), validates with zod and memoizes the result.
- To add a variable, extend `envSchema`, add it to `.env.example` and the README table, and add a case to `env.test.ts`.
- `DATABASE_URL` falls back to `JASSMINDB_URI`, which Aspire injects for the `jassmindb` resource. Keep that fallback.

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
