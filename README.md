# Jassmin

E-commerce site for **Jassmin**, a small perfume store in Ukraine.

It's a single full-stack, server-rendered app. Pages load data in route `loader`s and change data in route `action`s, so there is no separate REST backend and no client-side data-fetching layer.

## Stack

| Area | Choice |
|------|--------|
| Framework | [React Router](https://reactrouter.com) v8, framework mode, SSR (`ssr: true`) |
| Language | TypeScript 7, `strict` + `noUncheckedIndexedAccess` |
| Styling | Tailwind CSS v4 |
| Database | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team) (`pg` driver) |
| Validation | zod 4 (env vars, all `action` input) |
| Lint / format | [Biome](https://biomejs.dev) |
| Tests | Vitest |
| Local orchestration | [Aspire](https://aspire.dev) (TypeScript AppHost) |
| Package manager | pnpm |

## Prerequisites

- **Node.js 24 LTS** (see `.nvmrc`)
- **pnpm 12**: `npm install -g pnpm` (the version is pinned in `package.json` → `packageManager`)
- **Docker Desktop**, running
- **Aspire CLI ≥ 13.4**:
  - Windows: `irm https://aspire.dev/install.ps1 | iex`
  - macOS/Linux: `curl -sSL https://aspire.dev/install.sh | bash`
- A trusted HTTPS dev certificate: `aspire certs trust`. `aspire doctor` checks the whole setup.

## Quick start

```bash
cp .env.example .env        # then set SESSION_SECRET to a random 32+ character string
pnpm install
pnpm aspire run             # starts PostgreSQL + the dev server, prints the dashboard URL
```

Open the Aspire dashboard and click the `web` resource's endpoint. The home page shows the database time and PostgreSQL version, rendered on the server.

> Use `pnpm aspire …` rather than plain `aspire …`. Aspire installs the AppHost with `pnpm install --ignore-workspace`, and pnpm then rejects esbuild's build script. The wrapper `scripts/aspire.mjs` approves only that one build and then runs the Aspire CLI with your arguments (`run`, `start`, `stop`, `ps`, …).

### Without Aspire

Point `DATABASE_URL` in `.env` at any PostgreSQL database, for example:

```bash
docker run -d --name jassmin-pg -p 5432:5432 \
  -e POSTGRES_USER=jassmin -e POSTGRES_PASSWORD=jassmin -e POSTGRES_DB=jassmin postgres:18
pnpm dev                    # http://localhost:5173
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes* | PostgreSQL connection string. *Under Aspire, `JASSMINDB_URI` is injected instead and used as a fallback. |
| `SESSION_SECRET` | yes | Secret for signing the session cookie, at least 32 characters. |
| `PORT` | no | Port for `pnpm start` (default `3000`). |

The variables are validated with zod in `app/.server/env.ts`, and the server fails at startup with a readable error if any are missing or invalid. A `.env` file is loaded automatically, but variables already set in the environment take precedence.

## Scripts

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Dev server with HMR (Vite) |
| `pnpm build` | Production build into `build/` |
| `pnpm start` | Serve the production build with `react-router-serve` |
| `pnpm typecheck` | Generate route types (`react-router typegen`), then `tsc` |
| `pnpm lint` | Biome lint + format check |
| `pnpm format` | Biome autofix: format, organize imports, safe lint fixes |
| `pnpm test` | Vitest, run once |
| `pnpm test:watch` | Vitest, watch mode |
| `pnpm aspire <cmd>` | Aspire CLI via the pnpm-compatible wrapper (`pnpm aspire run`) |
| `pnpm aspire:build` | Type-check the Aspire AppHost |

`app/.server/db/queries/health.test.ts` is an integration test. It runs only when a database is configured (`DATABASE_URL` in `.env`, or Aspire's Postgres) and is reported as skipped otherwise.

## Project structure

```
app/
  root.tsx             document <Layout>, error boundary
  routes.ts            route config
  routes/              route modules (loader / action / component / meta)
  components/          shared UI components
  features/            feature-specific UI (cart, catalog, auth, …)
  lib/                 isomorphic helpers and shared types (enums, DTOs)
  .server/             server-only code, never bundled for the browser
    env.ts             zod-validated environment
    session.ts         cookie session storage
    db/                Drizzle client, schema, queries (migrations from #3)
    services/          business logic (orders, auth, cart, …)
aspire-apphost/        Aspire TypeScript AppHost (local dev orchestration)
scripts/aspire.mjs     Aspire CLI wrapper for pnpm
docs/plans/            implementation plans while an issue is in progress
```

Anything under `app/.server/` is server-only. Importing it from code that reaches the browser makes the build fail ("Server-only module referenced by client").

## Conventions

- Read data in `loader`s and write data in `action`s. Validate every `action` input with zod.
- No `any`: Biome's `noExplicitAny` is an error, and `tsc` runs in strict mode.
- Use database transactions wherever data integrity matters (e.g. checkout: stock, order, cart status).
- Work is tracked in GitHub issues. Each issue is planned, implemented and reviewed on its own `issue/<number>` branch in a separate git worktree (see `AGENTS.md`).
