# Plan: Scaffold full-stack SSR app with React Router framework mode (#1)

Issue: https://github.com/savchukolgaa/jassmin/issues/1
Branch: `issue-1-scaffold-react-router-app`
Status: Planned

## Goal
Create the foundation every other Jassmin issue builds on: a single full-stack, server-rendered app built with React Router v7 in framework mode (Vite + Node server). It ships with strict TypeScript, ESLint + Prettier, a typed PostgreSQL connection under `app/.server/db`, and a clear folder layout that separates routes, UI and server-only code. A placeholder home page proves that a `loader` can query PostgreSQL and that the result is server-rendered.

## Dependencies & prerequisites
- **No issue dependencies.** This is the first issue. #2 (Tailwind theme), #3 (schema/migrations) and #19 (cron job) build on it.
- **Node.js is not installed on the dev machine** (`node`/`npm` were not found on PATH in Bash or PowerShell). Install Node.js 24 LTS (React Router v7 needs Node ≥ 20) before step 1.
- **PostgreSQL:** Docker Desktop is installed, so local Postgres runs through `docker compose` (step 5). Nothing else is needed.
- **Packages added:** `react-router`, `@react-router/node`, `@react-router/serve`, `@react-router/dev` (from the template), plus `kysely`, `pg`, `@types/pg`, `zod`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `eslint-config-prettier`, `globals`, `prettier`, `prettier-plugin-tailwindcss`.
- **Env vars:** `DATABASE_URL`, `SESSION_SECRET`, `PORT` (in `.env.example`).
- **Migrations:** none in this issue. Schema and the migration tooling come in #3.

## Decisions & assumptions
- **Scaffold method.** The repo already contains `.claude/`, `docs/` and the guidelines file, so `create-react-router` cannot safely target `.`. Instead, scaffold into a scratch directory with the default template (`npx create-react-router@latest <tmp>/jassmin --no-install --no-git-init`), then copy the generated files into the repo root. The default template already has `ssr: true`, `app/routes.ts`, typegen and Tailwind v4.
- **Keep Tailwind from the template, but don't theme it.** The template ships Tailwind v4 through `@tailwindcss/vite`. Keep it so #2 only has to add the theme and `Button`. Brand colours and components are out of scope.
- **Server runtime: `react-router-serve`, no custom Express server.** #19 runs the abandoned-cart job as a standalone script driven by an external scheduler, so no in-process background jobs are needed (see Resolved questions). We can switch to `@react-router/express` later if middleware requires it.
- **DB access: Kysely + `pg`** **(unconfirmed, Q1).** Kysely gives typed SQL and has built-in up/down migrations, which #3's acceptance criterion "Migrations run up and down cleanly" needs. Drizzle Kit has no rollback command.
- **Typed env.** `app/.server/env.ts` parses `process.env` with zod once and exports a typed `env` object. The app fails fast at startup with a readable error if `DATABASE_URL`/`SESSION_SECRET` are missing.
- **DB singleton.** `app/.server/db/index.ts` creates one `Kysely<Database>` over a `pg.Pool`. In dev it caches the instance on `globalThis` so Vite HMR doesn't leak connections. `app/.server/db/types.ts` exports an empty `Database` interface that #3 fills in.
- **Session storage.** `app/.server/session.ts` exports a `createCookieSessionStorage` instance (httpOnly, sameSite `lax`, `secure` in production, secret from `env.SESSION_SECRET`) with typed `SessionData`/`SessionFlashData` placeholders. Auth logic stays in #9.
- **Placeholder data.** Without a schema (#3), the home loader runs `select now() as server_time, version() as pg_version` through Kysely's `sql` tag. That proves the DB round trip without any tables.
- **No test runner yet** **(unconfirmed, Q2).** The issue lists only `dev`, `build`, `start`, `typecheck` and `lint`. For this issue, verification means those scripts plus manual checks.
- **The guidelines doc vs. the issue.** `Project Overview & Guidelines for Claude.md` lists Express/Supabase, React Query/Axios and Zustand. Issue #1 supersedes those choices: there is no REST backend and no client data-fetching layer, because data flows through loaders and actions. The plan follows the issue.

## Open questions
- [ ] **Q1: Kysely or Drizzle for PostgreSQL access?** Why it matters: #3 builds its migrations and schema on this choice. #3 suggests "e.g. Drizzle Kit" but also requires migrations that run "up and down", and Drizzle Kit has no rollback. Recommended default: **Kysely + `pg`**, with Kysely's `Migrator` handling `db:migrate`/`db:rollback` in #3. Affects steps: 5, 6.
- [ ] **Q2: Add a test runner (Vitest) now?** Why it matters: later issues (checkout transactions, cart job) will want unit and integration tests, and the scaffold is the natural place to set one up. Recommended default: **not in #1**. Add Vitest when the first issue with testable business logic needs it. Affects steps: none (it would add a `test` script in step 4).
- [ ] **Q3: Should the untracked `Project Overview & Guidelines for Claude.md` be committed (e.g. as `CLAUDE.md`)?** Why it matters: it holds the project guidelines that later sessions rely on. Recommended default: leave it untouched in this issue. The README links to the issues for scope. Affects steps: none.

## Resolved questions
- **Does production need a custom Express server for background jobs?** No. #19 specifies a standalone `scripts/mark-abandoned-carts.ts` run hourly by an external scheduler (system or platform cron), so `react-router-serve` is enough (source: #19).
- **Is the Tailwind theme or DB schema part of this issue?** No. Both are explicitly out of scope: the theme is #2 and the schema/migrations are #3 (source: #1 Context, #2, #3).
- **Express + React Query/Axios (guidelines) vs. loaders/actions (issue)?** Loaders and actions. Issue #1 states there is "no separate REST backend or client-side data-fetching layer" (source: #1, superseding `Project Overview & Guidelines for Claude.md` §2).
- **How should local PostgreSQL run?** Through Docker. Docker Desktop is installed and there is no local `psql`/Postgres (source: environment check), so the repo gets a `docker-compose.yml`.
- **Where should shared enum types go?** In `app/lib/`, which #3 populates (source: #3 Technical). #1 only creates the folder.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `package.json`, `package-lock.json` | Template deps plus Kysely/pg/zod/ESLint/Prettier; scripts `dev`, `build`, `start`, `typecheck`, `lint`, `format`; `engines.node >= 20` |
| create | `.nvmrc` | Pin Node 24 |
| create | `react-router.config.ts` | `ssr: true` |
| create | `vite.config.ts` | Template config (`reactRouter()`, `tailwindcss()`, `tsconfigPaths()`) |
| create | `tsconfig.json` | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `~/*` path alias, `.react-router/types` rootDirs |
| create | `eslint.config.js` | Flat config: typescript-eslint (type-checked), react, react-hooks, jsx-a11y, prettier; `@typescript-eslint/no-explicit-any: error` |
| create | `.prettierrc`, `.prettierignore` | Formatting rules |
| create | `.gitignore` | `node_modules`, `build`, `.react-router`, `.env` |
| create | `.env.example` | `DATABASE_URL`, `SESSION_SECRET`, `PORT` |
| create | `docker-compose.yml` | Local `postgres:17` with a named volume, matching `.env.example` |
| create | `app/root.tsx` | Document `<Layout>`, `<Outlet>`, typed `ErrorBoundary`, `links` |
| create | `app/app.css` | Template Tailwind entry (`@import "tailwindcss"`) |
| create | `app/routes.ts` | `index("routes/home.tsx")` |
| create | `app/routes/home.tsx` | `meta`, `loader` querying Postgres, placeholder component using `Route.ComponentProps` |
| create | `app/.server/env.ts` | zod-validated `env` |
| create | `app/.server/db/index.ts` | Kysely + `pg.Pool` singleton |
| create | `app/.server/db/types.ts` | Empty `Database` interface (to be filled by #3) |
| create | `app/.server/db/queries/health.ts` | `getDatabaseInfo()` used by the home loader |
| create | `app/.server/services/.gitkeep` | Business-logic folder |
| create | `app/.server/session.ts` | Cookie session storage |
| create | `app/components/.gitkeep`, `app/features/.gitkeep`, `app/lib/.gitkeep` | Folder layout from the issue |
| create | `public/favicon.ico` | From the template |
| create | `README.md` | Setup, env, Docker DB, scripts, folder structure, `.server` rule |

Template files not listed (e.g. `app/welcome/`, the Dockerfile) are deleted when copying.

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [ ] **1. Install prerequisites.** Install Node.js 24 LTS. Confirm with `node -v` (≥ 20) and `npm -v`, and confirm Docker with `docker compose version`.
- [ ] **2. Scaffold from the template.** Run `npx create-react-router@latest "<scratchpad>/jassmin" --no-install --no-git-init` (default template). Copy `app/`, `public/`, `package.json`, `react-router.config.ts`, `vite.config.ts`, `tsconfig.json` and `.gitignore` into the repo root. Drop `app/welcome/`, the template `Dockerfile` and `.dockerignore`. Set `"name": "jassmin"` in `package.json` and add `.nvmrc` (`24`) and `engines`. Run `npm install`. Check: `npm run dev` serves the template page at http://localhost:5173.
- [ ] **3. Harden TypeScript and set up the folder layout.** In `tsconfig.json`, keep `strict: true` and add `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch`. Keep the `~/*` → `./app/*` alias and the `.react-router/types` `rootDirs`. Create `app/components/`, `app/features/`, `app/lib/` and `app/.server/{db/queries,services}/` (use `.gitkeep` where empty). Make `react-router.config.ts` explicit: `{ ssr: true } satisfies Config`. Add the scripts `"typecheck": "react-router typegen && tsc"`, `"dev": "react-router dev"`, `"build": "react-router build"` and `"start": "react-router-serve ./build/server/index.js"`. Check: `npm run typecheck` passes.
- [ ] **4. Add ESLint and Prettier.** Create `eslint.config.js` (flat config) with `@eslint/js` recommended, `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` (with `parserOptions.projectService`), `eslint-plugin-react` (jsx-runtime), `react-hooks`, `jsx-a11y` and `eslint-config-prettier` last. Set the rules `@typescript-eslint/no-explicit-any: "error"` and `@typescript-eslint/consistent-type-imports`. Ignore `build/`, `.react-router/`, `node_modules/` and `.claude/`. Add `.prettierrc` (with `prettier-plugin-tailwindcss`) and `.prettierignore`. Add the scripts `"lint": "eslint ."` and `"format": "prettier --write ."`. Run `npm run format`, then check that `npm run lint` passes. Sanity-check that adding `const x: any = 1` makes lint fail, then remove it.
- [ ] **5. Configure the env and local Postgres.** Add `.env.example` (`DATABASE_URL=postgres://jassmin:jassmin@localhost:5432/jassmin`, `SESSION_SECRET=change-me-to-a-long-random-string`, `PORT=3000`) and a matching `docker-compose.yml` (`postgres:17`, user/password/db `jassmin`, port 5432, volume `pgdata`, healthcheck `pg_isready`). Create `app/.server/env.ts`: a zod schema (`DATABASE_URL: z.string().url()`, `SESSION_SECRET: z.string().min(32)`, `PORT: z.coerce.number().int().positive().default(3000)`, `NODE_ENV: z.enum(["development","production","test"]).default("development")`) that is parsed once and exports `env`, throwing a readable message listing any invalid keys. Load `.env` with Node's built-in `--env-file-if-exists=.env` in `dev`/`start` (Node ≥ 22), or `process.loadEnvFile()` in `env.ts`, so no `dotenv` dependency is needed. Check: `docker compose up -d` starts a healthy DB, and the app with a missing `.env` fails with a clear error.
- [ ] **6. Add the typed DB module.** `app/.server/db/types.ts` exports `export interface Database {}`, documented as filled in by #3; if lint flags the empty interface, use `Record<string, never>` instead. `app/.server/db/index.ts` creates `new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: env.DATABASE_URL, max: 10 }) }) })`, cached on `globalThis` outside production, and exports `db`. `app/.server/db/queries/health.ts` exports `getDatabaseInfo(): Promise<{ serverTime: Date; pgVersion: string }>`, which uses `` sql<…>`select now() as server_time, version() as pg_version`.execute(db) `` and maps the row (handling `rows[0]` being `undefined` under `noUncheckedIndexedAccess`). Check: typecheck and lint pass.
- [ ] **7. Add session storage.** Create `app/.server/session.ts` with `createCookieSessionStorage<SessionData, SessionFlashData>` (cookie `__jassmin_session`, `httpOnly`, `sameSite: "lax"`, `path: "/"`, `secure: env.NODE_ENV === "production"`, `secrets: [env.SESSION_SECRET]`, `maxAge` 30 days). It exports `getSession`, `commitSession` and `destroySession`. `SessionData` holds an optional `userId: number` for #9. Check: typecheck passes.
- [ ] **8. Build the placeholder home route.** `app/routes.ts`: `[index("routes/home.tsx")] satisfies RouteConfig`. In `app/routes/home.tsx`: `meta` (title "Jassmin", description), an `async loader()` that calls `getDatabaseInfo()` and returns `{ serverTime: serverTime.toISOString(), pgVersion }`, and a default component typed with `Route.ComponentProps` that renders "Jassmin — coming soon" plus the DB server time and Postgres version. Update `app/root.tsx`: `lang="uk"`, keep the template `Layout`/`ErrorBoundary` (typed with `Route.ErrorBoundaryProps`), and remove the template font links if they're unused. Check: `npm run dev`; view-source on `/` shows the Postgres version string in the HTML.
- [ ] **9. Verify the `.server` boundary.** Temporarily import `~/.server/db` from a client-only path (e.g. use `db` inside the home component body) and confirm that `npm run build` fails with React Router's server-only module error. Revert the change. Document the rule in the README.
- [ ] **10. Verify the production build.** Run `npm run build && npm run start` and open http://localhost:3000: the page renders with DB data, and view-source shows it.
- [ ] **11. Write the README.** Cover: what Jassmin is, the stack (React Router v7 framework mode, SSR, TypeScript strict, Kysely/Postgres, zod, Tailwind), prerequisites (Node 24, Docker), setup (`cp .env.example .env`, `docker compose up -d`, `npm install`, `npm run dev`), a script table (`dev`, `build`, `start`, `typecheck`, `lint`, `format`), the folder structure tree from the issue with one line per folder, and conventions (data in `loader`s, mutations in `action`s validated with zod, server-only code in `app/.server/`, no `any`).
- [ ] **12. Final pass.** Run `npm run typecheck && npm run lint && npm run build`. Make sure `.env`, `build/` and `.react-router/` are not tracked.

## Testing & verification
- Commands: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run start`.
- Lint sanity check: an explicit `any` must fail lint (step 4).
- Boundary check: importing `app/.server/*` into client code must fail the build (step 9).
- Manual: `docker compose up -d`, `npm run dev`, then load `/` and check that view-source contains the Postgres version/time (steps 8 and 10). Stopping the DB container should render the root `ErrorBoundary`, not crash the server.
- Env check: removing `SESSION_SECRET` from `.env` must give a clear startup error (step 5).
- No automated test suite in this issue (see Q2).

## Acceptance criteria
- [ ] `npm run dev` serves a server-rendered placeholder home page — steps 2, 8
- [ ] `npm run build && npm run start` runs the production SSR build — steps 3, 10
- [ ] `npm run typecheck` and `npm run lint` pass with strict settings — steps 3, 4, 12
- [ ] A loader can query PostgreSQL and the result renders on first page load (view-source shows the data) — steps 5, 6, 8
- [ ] Server-only modules live under `app/.server/` and cannot be imported into client code — steps 3, 6, 7, 9
- [ ] README documents setup and scripts — step 11

## Out of scope
- Brand theme, colours and the `Button` component (#2). Tailwind is installed but unthemed.
- Database schema, migration tooling and seed scripts (#3–#5).
- Authentication logic (#9). Only session storage is set up here.
- Header/layout UI (#6) and real home page content (#7).
- Background jobs or a custom Express server (#19).
- A test runner and CI (see Q2) and deployment configuration.
