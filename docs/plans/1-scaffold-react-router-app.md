# Plan: Scaffold full-stack SSR app with React Router framework mode (#1)

Issue: https://github.com/savchukolgaa/jassmin/issues/1
Branch: `issue-1-scaffold-react-router-app`
Status: Planned

## Goal
Create the foundation every other Jassmin issue builds on: a single full-stack, server-rendered app built with React Router (v8) in framework mode (Vite + Node server). It ships with strict TypeScript, Biome (lint + format), a typed PostgreSQL connection under `app/.server/db`, and a clear folder layout that separates routes, UI and server-only code. Local development is orchestrated by **Aspire** with a TypeScript AppHost. One `aspire run` starts a PostgreSQL container and the React Router dev server, wires the connection string, and opens the Aspire dashboard. A placeholder home page proves that a `loader` can query PostgreSQL and that the result is server-rendered.

## Dependencies & prerequisites
- **No issue dependencies.** This is the first issue. #2 (Tailwind theme), #3 (schema/migrations) and #19 (cron job) build on it.
- **Node.js is not installed on the dev machine** (`node`/`npm` were not found on PATH in Bash or PowerShell). Install Node.js 24 LTS before step 1. React Router v7 needs Node ≥ 20, and Aspire's TypeScript AppHost needs Node 22 or 24 LTS.
- **Aspire CLI ≥ 13.4** (TypeScript AppHosts are GA from 13.4). Install it on Windows with `irm https://aspire.dev/install.ps1 | iex`, or with `npm install -g @microsoft/aspire-cli`.
- **Container runtime:** Docker Desktop is installed and must be running. Aspire uses it for the Postgres container.
- **Packages added:** `react-router`, `@react-router/node`, `@react-router/serve`, `@react-router/dev` (from the template), plus `drizzle-orm`, `pg`, `@types/pg`, `drizzle-kit` (dev), `zod`, `@biomejs/biome`. The AppHost's own deps live in `aspire-apphost/package.json`, managed by `aspire init` / `aspire add`.
- **Env vars:** `DATABASE_URL`, `SESSION_SECRET`, `PORT` (in `.env.example`). Under Aspire, the DB URL is injected as `JASSMINDB_URI` (see Decisions).
- **Migrations:** none in this issue. Schema and the migration tooling come in #3.

## Decisions & assumptions
- **Scaffold method.** The repo already contains `.claude/`, `docs/` and the guidelines file, so `create-react-router` cannot safely target `.`. Instead, scaffold into a scratch directory with the default template (`npx create-react-router@latest <tmp>/jassmin --no-install --no-git-init`), then copy the generated files into the repo root. The default template already has `ssr: true`, `app/routes.ts`, typegen and Tailwind v4.
- **Deviation: React Router v8, not v7.** `create-react-router@latest` (Oct 2026) generates React Router **8.5** with Vite 8. The framework-mode concepts the issue relies on (`loader`/`action`, `app/routes.ts`, `+types` typegen, `.server` modules, `react-router-serve`) are unchanged, so we kept the current major. Vite 8 resolves tsconfig `paths` natively (`resolve.tsconfigPaths: true`), so `vite-tsconfig-paths` is not needed. The template's bundled `.agents/` React Router agent skill was not copied. `@types/node` was bumped to `^24` to match `.nvmrc`.
- **Deviation: Biome instead of ESLint + Prettier (user request).** `@biomejs/biome` (pinned exactly, as Biome recommends) handles both linting and formatting through `biome.json`: the recommended preset plus the React domain, `suspicious/noExplicitAny: error`, `style/useImportType`, `useExportType`, `noNonNullAssertion`, Tailwind directive parsing for `app.css`, organize imports, 2-space indent, LF line endings. It respects `.gitignore` and also ignores `.claude/`, `aspire-apphost/.aspire/` and Markdown files. A `.gitattributes` (`* text=auto eol=lf`) keeps LF endings on Windows. This also allowed TypeScript 7: the latest typescript-eslint only supports TypeScript <6.1, but Biome has no such peer dependency. Biome lints syntactically, without type information, so the type-aware strictness comes from `tsc` (`strict`, `noUncheckedIndexedAccess`).
- **Deviation: pnpm instead of npm (user request).** The root uses `packageManager: "pnpm@12.15.0"` and `pnpm-lock.yaml`, and `package-lock.json` was removed. The AppHost in `aspire-apphost/` is a **separate, standalone pnpm package with its own lockfile**, not a workspace member. Aspire installs it with `pnpm install --ignore-workspace` (seen in the CLI logs), which skips every `pnpm-workspace.yaml`, including the AppHost's own. pnpm 12 fails such an install on esbuild's unapproved build script (`ERR_PNPM_IGNORED_BUILDS`; esbuild comes in through `tsx`, which Aspire uses to run `apphost.mts`). Neither `allowBuilds` in a workspace file or the global config, nor `pnpm.*` fields in `package.json`, nor `.npmrc` is honoured there. Only the environment variable `pnpm_config_allow_builds={"esbuild":true}` is. So Aspire is started through `scripts/aspire.mjs` (`pnpm aspire run`, `pnpm aspire start`, …), which sets that variable and then runs the Aspire CLI. The AppHost's generated ESLint setup was removed, since Biome covers `apphost.mts`. Its `tsconfig.apphost.json` gained `"types": ["node"]`, because TypeScript 7 no longer auto-includes `@types`.
- **AppHost API as generated (Aspire 13.6.3).** `addPostgres("postgres").withDataVolume()`, `.addDatabase("jassmindb")`, `addViteApp("web", "..").withPnpm().withReference(db).waitFor(db).withExternalHttpEndpoints()`. Builder calls return chainable promises, so only the final chain and `build().run()` are awaited. `pnpm aspire:build` type-checks it.
- **`aspire run` is not yet verified on the dev machine.** Aspire's control plane (DCP) cannot open its local TLS connection: `aspire doctor` reports "The SSL connection could not be established" for both the ephemeral and the dev certificate, even after `aspire certs clean` + `aspire certs trust`. No containers start, and runs fail with "container volumes did not become ready" or "Service web should have valid address". The suspected cause is Avast's HTTPS scanning. Until that's fixed, the DB steps are verified against a plain `docker run postgres` container via `DATABASE_URL`.
- **pnpm build-script approval at the root.** The root `pnpm-workspace.yaml` exists only to set `allowBuilds: { esbuild: true }`, because `drizzle-kit` pulls in esbuild and pnpm 12 fails installs on unapproved build scripts. It has no `packages`, so the AppHost stays standalone.
- **Drizzle versions.** The current `latest` tags are `drizzle-orm` 0.45 and `drizzle-kit` 0.31. The `Db` type is `NodePgDatabase<typeof schema> & { $client: Pool }`.
- **Latest dependency versions (user request).** Every dependency is installed at its latest version (TypeScript 7.0, Biome 2.6, React Router 8.5, Vite 8), with one exception:
  - **`@types/node` stays on the latest 24.x, not 26.x.** It must match the Node 24 LTS runtime, otherwise the types would allow APIs that don't exist at runtime.
- **Keep Tailwind from the template, but don't theme it.** The template ships Tailwind v4 through `@tailwindcss/vite`. Keep it so #2 only has to add the theme and `Button`.
- **Aspire for local orchestration (replaces `docker-compose`).** The setup runs `aspire init --language typescript` at the repo root. Because a root `package.json` exists, this creates a nested `aspire-apphost/` package with `apphost.mts`, `tsconfig.apphost.json`, a generated SDK in `.aspire/modules/`, a root `aspire.config.json`, and `aspire:*` delegate scripts in the root `package.json`. `aspire add postgres` adds the PostgreSQL hosting integration. The AppHost:
  ```ts
  import { createBuilder } from "./.aspire/modules/aspire.mjs";

  const builder = await createBuilder();

  const postgres = await builder.addPostgres("postgres").withDataVolume();
  const db = await postgres.addDatabase("jassmindb");

  await builder
    .addViteApp("web", "..")          // React Router dev server is Vite; runs `pnpm dev`
    .withReference(db)
    .waitFor(db)
    .withExternalHttpEndpoints();

  await builder.build().run();
  ```
  Treat the exact method names and chaining (`withDataVolume`, awaits) as **(unconfirmed)** until checked against the generated `.aspire/modules` typings in step 6. The CLI type-checks the AppHost before it starts.
- **Connection string mapping.** `withReference(db)` injects `JASSMINDB_URI` (plus `_HOST`, `_PORT`, `_USERNAME`, `_PASSWORD`, `_DATABASENAME`). `app/.server/env.ts` reads `DATABASE_URL` and falls back to `JASSMINDB_URI`. The app keeps one canonical setting (`DATABASE_URL`, used in production and in non-Aspire runs) while working unchanged under Aspire.
- **`SESSION_SECRET` under Aspire** stays in the root `.env`, which `pnpm dev` loads through `--env-file-if-exists`. That also works when Aspire launches the app. Aspire secret parameters are not used.
- **Aspire covers local dev only.** Production still runs `pnpm build && pnpm start` (`react-router-serve`). Aspire publish/deploy is out of scope.
- **Server runtime: `react-router-serve`, no custom Express server.** #19 runs its job as a standalone script on an external scheduler (see Resolved questions).
- **DB access: Drizzle ORM + `pg` (node-postgres driver).** Tables are defined in TypeScript (`app/.server/db/schema.ts`), queries are fully typed, and there is a relational query API (`db.query.<table>.findMany({ with: … })`). It runs on a `pg.Pool`, so `db.transaction()` covers the checkout integrity rule. `drizzle-kit` generates SQL migrations from the schema. `drizzle.config.ts` is added here so #3 only has to define tables and add the `db:*` scripts.
- **Rollback caveat for #3.** Drizzle Kit generates "up" migrations only and has no built-in rollback. #3's criterion "Migrations run up and down cleanly" will therefore need a hand-written `down.sql` next to each generated migration, plus a small `db:rollback` script that runs the latest one and removes its row from `drizzle.__drizzle_migrations`. That design belongs to #3. This plan only records the constraint.
- **Typed env.** `app/.server/env.ts` parses `process.env` with zod once and exports a typed `env` object. The app fails fast at startup with a readable error.
- **DB singleton.** `app/.server/db/index.ts` creates one `pg.Pool` and `drizzle({ client: pool, schema })`, cached on `globalThis` in dev for Vite HMR. `app/.server/db/schema.ts` starts empty (`export {}`), and #3 adds the enums and tables.
- **Session storage.** `app/.server/session.ts` exports a `createCookieSessionStorage` instance. Auth logic stays in #9.
- **Placeholder data.** Without a schema (#3), the home loader runs ``db.execute(sql`select now() as server_time, version() as pg_version`)`` using Drizzle's `sql` tag.
- **The root lint and typecheck exclude `aspire-apphost/`.** The AppHost has its own `tsconfig.apphost.json`, generated code and validation. Generated `.aspire/modules/` is git-ignored, because `aspire restore` regenerates it.
- **Vitest as the test runner.** It is Vite-native, so it shares the TS/alias setup. It gets its own `vitest.config.ts` (with native `resolve.tsconfigPaths`, without the `reactRouter()` plugin, which must not run under tests) and `environment: "node"`. Tests sit next to the code as `*.test.ts`. Unit tests always run. DB integration tests use `describe.skipIf(!dbUrl)` and run whenever `DATABASE_URL`/`JASSMINDB_URI` is set, for example with Aspire's Postgres up. Component tests (jsdom, Testing Library) wait for the first UI issue (#2).
- **Env access is a memoized `getEnv()` rather than an eagerly parsed `env` constant.** This way importing `parseEnv` in unit tests doesn't validate the real `process.env`. `getEnv()` loads `.env` with Node's `process.loadEnvFile()` (no `dotenv` dependency, and existing variables such as Aspire's `JASSMINDB_URI` win), then validates once. The DB module calls it at import time, so a misconfigured production server still fails on startup. With zod 4, `z.url()` and `z.prettifyError` are used.
- **Testable env parsing.** `app/.server/env.ts` exports a pure `parseEnv(source: NodeJS.ProcessEnv)` alongside the `env` singleton, so tests can check validation without changing `process.env`.
- **Guidelines file stays local.** `Project Overview & Guidelines for Claude.md` is added to `.gitignore` and never committed.
- **The guidelines doc vs. the issue.** `Project Overview & Guidelines for Claude.md` lists Express/Supabase, React Query/Axios and Zustand. Issue #1 supersedes those choices: data flows through loaders and actions.

## Resolved questions
- **Add a test runner now?** Yes, Vitest, with unit tests plus DB integration tests that skip when there is no DB (step 12) (source: user).
- **Commit `Project Overview & Guidelines for Claude.md`?** No. Add it to `.gitignore` as a safeguard (step 2) (source: user).
- **How far should Aspire go in #1?** Local orchestration only. The app reads `JASSMINDB_URI` as a fallback, `SESSION_SECRET` comes from `.env`, and there are no secret parameters, OpenTelemetry or Aspire deployment (source: user).
- **Query builder or ORM?** ORM: **Drizzle ORM**. The user asked for an ORM, and the issue (#1 Technical) and #3 ("e.g. Drizzle Kit") both name Drizzle. Prisma was not chosen because it is heavier (its own schema language and code generation) and also lacks automatic down migrations (source: user, #1, #3).
- **Does production need a custom Express server for background jobs?** No. #19 specifies a standalone `scripts/mark-abandoned-carts.ts` run by an external scheduler, so `react-router-serve` is enough (source: #19).
- **Is the Tailwind theme or DB schema part of this issue?** No. Both are explicitly out of scope: the theme is #2 and the schema/migrations are #3 (source: #1 Context, #2, #3).
- **Express + React Query/Axios (guidelines) vs. loaders/actions (issue)?** Loaders and actions (source: #1, superseding `Project Overview & Guidelines for Claude.md` §2).
- **How should local PostgreSQL run?** As an Aspire-managed container (`addPostgres` + `withDataVolume`) on Docker Desktop, which is installed (source: user request, environment check).
- **Where should shared enum types go?** In `app/lib/`, which #3 populates (source: #3 Technical).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `package.json`, `package-lock.json` | Template deps plus Drizzle/pg/zod/Biome/Vitest; scripts `dev`, `build`, `start`, `typecheck`, `lint`, `format`, `test`, `test:watch`, plus `aspire:*` delegates added by `aspire init`; `engines.node >= 22` |
| create | `.nvmrc` | Pin Node 24 |
| create | `react-router.config.ts` | `ssr: true` |
| create | `vite.config.ts` | Template config (`reactRouter()`, `tailwindcss()`, `tsconfigPaths()`) |
| create | `tsconfig.json` | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `~/*` alias; excludes `aspire-apphost` |
| create | `biome.json` | Biome lint + format config; `noExplicitAny: error` |
| create | `.gitattributes` | LF line endings |
| create | `.gitignore` | `node_modules`, `build`, `.react-router`, `.env`, `aspire-apphost/.aspire/modules`, `coverage`, `Project Overview & Guidelines for Claude.md` |
| create | `vitest.config.ts` | Vitest config: node environment, `~` alias via `resolve.tsconfigPaths`, `app/**/*.test.ts` |
| create | `app/.server/env.test.ts` | Unit tests for `parseEnv` |
| create | `app/.server/db/queries/health.test.ts` | DB integration test for `getDatabaseInfo` (skipped without a DB) |
| create | `.env.example` | `DATABASE_URL`, `SESSION_SECRET`, `PORT` |
| create | `aspire.config.json` | Aspire CLI config pointing at the AppHost (generated by `aspire init`) |
| create | `aspire-apphost/apphost.mts` | Postgres container + database, Vite app with reference and wait |
| create | `aspire-apphost/package.json`, `aspire-apphost/tsconfig.apphost.json` | AppHost package (generated, then edited) |
| create | `app/root.tsx` | Document `<Layout>`, `<Outlet>`, typed `ErrorBoundary`, `links` |
| create | `app/app.css` | Template Tailwind entry |
| create | `app/routes.ts` | `index("routes/home.tsx")` |
| create | `app/routes/home.tsx` | `meta`, `loader` querying Postgres, placeholder component |
| create | `app/.server/env.ts` | zod-validated `env` (`DATABASE_URL` with `JASSMINDB_URI` fallback) |
| create | `drizzle.config.ts` | Drizzle Kit config: `dialect: "postgresql"`, schema `app/.server/db/schema.ts`, out `app/.server/db/migrations` |
| create | `app/.server/db/index.ts` | Drizzle + `pg.Pool` singleton |
| create | `app/.server/db/schema.ts` | Drizzle schema (empty; tables added in #3) |
| create | `app/.server/db/queries/health.ts` | `getDatabaseInfo()` used by the home loader |
| create | `app/.server/services/.gitkeep` | Business-logic folder |
| create | `app/.server/session.ts` | Cookie session storage |
| create | `app/components/.gitkeep`, `app/features/.gitkeep`, `app/lib/.gitkeep` | Folder layout from the issue |
| create | `public/favicon.ico` | From the template |
| create | `README.md` | Setup (Node, Docker, Aspire CLI), `aspire run`, env, scripts, folder structure, `.server` rule |

Template files not listed (e.g. `app/welcome/`, the Dockerfile) are deleted when copying. There is no `docker-compose.yml`: Aspire manages the database container.

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [x] **1. Install prerequisites.** Install Node.js 24 LTS and the Aspire CLI (`irm https://aspire.dev/install.ps1 | iex`), and make sure Docker Desktop is running. Check: `node -v` (24.x), `npm -v`, `aspire --version` (≥ 13.4), `docker info`.
- [x] **2. Scaffold from the template.** Run `npx create-react-router@latest "<scratchpad>/jassmin" --no-install --no-git-init` (default template). Copy `app/`, `public/`, `package.json`, `react-router.config.ts`, `vite.config.ts`, `tsconfig.json` and `.gitignore` into the repo root. Drop `app/welcome/`, the template `Dockerfile` and `.dockerignore`. Add `Project Overview & Guidelines for Claude.md` to `.gitignore`, and check that `git status` no longer lists it. Set `"name": "jassmin"`, add `.nvmrc` (`24`) and `"engines": { "node": ">=22" }`, then run `pnpm install`. Check: `pnpm dev` serves the template page at http://localhost:5173.
- [x] **3. Harden TypeScript and set up the folder layout.** In `tsconfig.json`, keep `strict: true`, add `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch`, and add `"exclude": ["aspire-apphost"]`. Create `app/components/`, `app/features/`, `app/lib/` and `app/.server/{db/queries,services}/`. Make `react-router.config.ts` explicit: `{ ssr: true } satisfies Config`. Add the scripts `"typecheck": "react-router typegen && tsc"` and `"start": "react-router-serve ./build/server/index.js"`. Check: `pnpm typecheck` passes.
- [x] **4. Add Biome.** Run `pnpm add -D -E @biomejs/biome@latest` and `npx biome init`, then edit `biome.json` as described in Decisions. Add the scripts `"lint": "biome check ."` and `"format": "biome check --write ."`, plus `.gitattributes`. Run `pnpm format`. Check: `pnpm lint` passes, and a temporary `const x: any = 1` fails it with `lint/suspicious/noExplicitAny`.
- [x] **5. Configure the env.** Add `.env.example` (`DATABASE_URL=postgres://jassmin:jassmin@localhost:5432/jassmin`, used only when running without Aspire; `SESSION_SECRET=change-me-to-a-long-random-string`; `PORT=3000`). Create `app/.server/env.ts` with a zod schema: `DATABASE_URL: z.string().url()`, filled from `process.env.DATABASE_URL ?? process.env.JASSMINDB_URI`; `SESSION_SECRET: z.string().min(32)`; `PORT: z.coerce.number().int().positive().default(3000)`; `NODE_ENV: z.enum(["development","production","test"]).default("development")`. It exports a pure `parseEnv(source)` and an `env` singleton (`parseEnv(process.env)`, parsed once), and throws a readable error listing any invalid keys. Load `.env` with `node --env-file-if-exists=.env` in the `dev`/`start` scripts, or with `process.loadEnvFile()` guarded by an existence check in `env.ts`. Check: with no `.env`, startup fails with a clear error.
- [x] **6. Add the Aspire AppHost.** *(AppHost written and type-checked; `aspire run` verification is blocked by DCP/TLS, see Decisions.)* From the repo root, run `aspire init --language typescript` and accept the nested `aspire-apphost/` layout, then run `aspire add postgres`. Write `aspire-apphost/apphost.mts` as shown in Decisions: `addPostgres("postgres").withDataVolume()`, `.addDatabase("jassmindb")`, `addViteApp("web", "..")` with `.withReference(db).waitFor(db).withExternalHttpEndpoints()`. Adjust the method names to the generated `.aspire/modules` typings if they differ. Make sure `.aspire/modules/` is git-ignored and that the root `package.json` has the `aspire:*` delegate scripts. Check: `aspire run` starts the Postgres container and the `web` resource, the dashboard shows both healthy, and the `web` resource's environment in the dashboard contains `JASSMINDB_URI`. If `addViteApp` does not pick up React Router's dev port, add `.withHttpEndpoint({ env: "PORT" })` and read `PORT` in `vite.config.ts` `server.port`.
- [x] **7. Add the Drizzle ORM module.** Install `drizzle-orm pg` and `-D drizzle-kit @types/pg`. Create `app/.server/db/schema.ts` (`export {}`, with a comment that #3 adds tables and enums). `app/.server/db/index.ts` creates `new Pool({ connectionString: env.DATABASE_URL, max: 10 })` and `drizzle({ client: pool, schema, casing: "snake_case" })` from `drizzle-orm/node-postgres`, caches both on `globalThis` outside production, and exports `db` and the `Db` type (`typeof db`). Add `drizzle.config.ts` (`defineConfig({ dialect: "postgresql", schema: "./app/.server/db/schema.ts", out: "./app/.server/db/migrations", casing: "snake_case", dbCredentials: { url: process.env.DATABASE_URL ?? process.env.JASSMINDB_URI ?? "" } })`), loading `.env` the same way as step 5. `app/.server/db/queries/health.ts` exports `getDatabaseInfo(): Promise<{ serverTime: Date; pgVersion: string }>`, using ``db.execute<{ server_time: Date; pg_version: string }>(sql`select now() as server_time, version() as pg_version`)`` and handling `result.rows[0]` being `undefined`. Check: typecheck and lint pass, and `npx drizzle-kit check` runs against the config.
- [x] **8. Add session storage.** Create `app/.server/session.ts` with `createCookieSessionStorage<SessionData, SessionFlashData>` (cookie `__jassmin_session`, `httpOnly`, `sameSite: "lax"`, `path: "/"`, `secure: env.NODE_ENV === "production"`, `secrets: [env.SESSION_SECRET]`, `maxAge` 30 days). It exports `getSession`, `commitSession` and `destroySession`. `SessionData` holds an optional `userId: number` for #9. Check: typecheck passes.
- [x] **9. Build the placeholder home route.** *(Verified with `pnpm dev` against a plain Docker Postgres 18 because `aspire run` is blocked; view-source shows the DB time and `PostgreSQL 18.6`. Drizzle's node-postgres driver returns raw `timestamptz` values from `db.execute` as strings, so `getDatabaseInfo` converts them with `new Date()`.)* `app/routes.ts`: `[index("routes/home.tsx")] satisfies RouteConfig`. In `app/routes/home.tsx`: `meta` (title "Jassmin"), an `async loader()` that calls `getDatabaseInfo()` and returns `{ serverTime: serverTime.toISOString(), pgVersion }`, and a component typed with `Route.ComponentProps` that renders "Jassmin — coming soon" plus the DB time and version. In `app/root.tsx`: set `lang="uk"`, keep the typed `ErrorBoundary`, and remove unused template font links. Check: `aspire run`, open the `web` endpoint from the dashboard, and confirm that view-source on `/` contains the Postgres version string.
- [x] **10. Verify the `.server` boundary.** Temporarily import `~/.server/db` from client code (e.g. use `db` inside the home component body) and confirm that `pnpm build` fails with React Router's server-only module error. Revert the change.
- [x] **11. Verify the production build.** With the Aspire Postgres running (or any Postgres at `DATABASE_URL`), run `pnpm build && pnpm start` and open http://localhost:3000. Check that the page renders with DB data and that view-source shows it. When running outside Aspire, take the connection string from the dashboard's `postgres`/`jassmindb` resource or use a fixed `DATABASE_URL`.
- [x] **12. Add Vitest.** Install `-D vitest@latest` (5.0). Create `vitest.config.ts` (`defineConfig({ resolve: { tsconfigPaths: true }, test: { environment: "node", include: ["app/**/*.test.ts"] } })`; Vite 8 resolves the `~` alias natively) and add the scripts `"test": "vitest run"` and `"test:watch": "vitest"`. Write the tests:
  - `app/.server/env.test.ts`:
    - `parseEnv` accepts a valid env and coerces `PORT`.
    - It defaults `PORT` to 3000.
    - It falls back from `DATABASE_URL` to `JASSMINDB_URI`.
    - It rejects a short `SESSION_SECRET` and a missing DB URL with a message naming the key.
  - `app/.server/db/queries/health.test.ts`: under `describe.skipIf(!process.env.DATABASE_URL && !process.env.JASSMINDB_URI)`, `getDatabaseInfo()` returns a `Date` and a version string containing `PostgreSQL`. Close the pool in `afterAll`.

  Test files are linted by Biome and type-checked by `tsc`, since they're covered by `tsconfig.json`'s include. Check: `ppnpm test` passes, the integration test runs with a DB URL set and is reported as skipped otherwise, and `pnpm typecheck`/`pnpm lint` still pass.
- [ ] **13. Write the README.** Cover: what Jassmin is; the stack (React Router v7 framework mode, SSR, strict TypeScript, Drizzle ORM/Postgres, zod, Tailwind, Aspire for local dev); prerequisites (Node 24, Docker Desktop, Aspire CLI ≥ 13.4); quick start (`cp .env.example .env`, set `SESSION_SECRET`, `pnpm install`, `aspire run`, open the dashboard and the `web` endpoint); running without Aspire (`DATABASE_URL` + `pnpm dev`); a script table (`dev`, `build`, `start`, `typecheck`, `lint`, `format`, `test`, `test:watch`, `aspire:*`); how to run DB integration tests (start Aspire's Postgres, set `DATABASE_URL`, run `ppnpm test`); the folder structure, including `aspire-apphost/`; and conventions (data in loaders, mutations in actions validated with zod, server-only code in `app/.server/`, no `any`).
- [ ] **14. Final pass.** Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, and confirm that `aspire run` starts cleanly. Make sure `.env`, `build/`, `.react-router/`, `coverage/`, `aspire-apphost/.aspire/modules/` and `Project Overview & Guidelines for Claude.md` are not tracked.

## Testing & verification
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm start`, `aspire run`.
- Lint sanity check: an explicit `any` must fail lint (step 4).
- Boundary check: importing `app/.server/*` into client code must fail the build (step 10).
- Aspire check: the dashboard shows `postgres`, `jassmindb` and `web` as running/healthy, and `web` has `JASSMINDB_URI` in its environment (step 6).
- Manual: view-source on `/` contains the Postgres version and time, both under `aspire run` (step 9) and in the production build (step 11). Stopping the Postgres resource from the dashboard should render the root `ErrorBoundary`, not crash the server.
- Env check: a missing `SESSION_SECRET`, or a missing DB URL with Aspire not running, must give a clear startup error (step 5).
- Automated tests (step 12): `ppnpm test` runs the `parseEnv` unit tests, plus the `getDatabaseInfo` integration test when a DB URL is set.

## Acceptance criteria
- [ ] `pnpm dev` serves a server-rendered placeholder home page — steps 2, 6, 9 (`aspire run` launches `pnpm dev` via `addViteApp`)
- [ ] `pnpm build && pnpm start` runs the production SSR build — steps 3, 11
- [ ] `pnpm typecheck` and `pnpm lint` pass with strict settings — steps 3, 4, 12, 14
- [ ] A loader can query PostgreSQL and the result renders on first page load (view-source shows the data) — steps 5, 6, 7, 9
- [ ] Server-only modules live under `app/.server/` and cannot be imported into client code — steps 3, 7, 8, 10
- [ ] README documents setup and scripts — step 13

## Out of scope
- Brand theme, colours and the `Button` component (#2).
- Database schema, migration tooling and seed scripts (#3–#5).
- Authentication logic (#9). Only session storage is set up here.
- Header/layout UI (#6) and real home page content (#7).
- Background jobs or a custom Express server (#19).
- Aspire deployment/publishing, OpenTelemetry instrumentation and Aspire secret parameters (local orchestration only).
- Component/UI tests (jsdom + Testing Library), coverage thresholds and CI.
