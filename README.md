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
| CMS | [Strapi](https://strapi.io) v5 (`cms/`) for blog posts, home page copy and contact details |
| Validation | zod 4 (env vars, all `action` input) |
| Lint / format | [Biome](https://biomejs.dev) |
| Tests | Vitest |
| Local orchestration | [Aspire](https://aspire.dev) (TypeScript AppHost) |
| Package manager | pnpm |

## Prerequisites

- **Node.js 24 LTS** (see `.nvmrc`)
- **pnpm 12**: `npm install -g pnpm` (the version is pinned in `package.json` → `packageManager`)
- **Docker Desktop**, running
- **PostgreSQL 18+** if you run without Aspire (the schema uses the built-in `uuidv7()`). Aspire and the Docker command below already use `postgres:18`.
- **Aspire CLI ≥ 13.4**:
  - Windows: `irm https://aspire.dev/install.ps1 | iex`
  - macOS/Linux: `curl -sSL https://aspire.dev/install.sh | bash`
- A trusted HTTPS dev certificate: `aspire certs trust`. `aspire doctor` checks the whole setup.

## Quick start

```bash
cp .env.example .env        # then set SESSION_SECRET to a random 32+ character string
cp cms/.env.example cms/.env  # then replace every "tobemodified" secret (see "Content (Strapi CMS)")
pnpm install
pnpm aspire run             # starts PostgreSQL, Strapi and the dev server, prints the dashboard URL
```

pnpm installs with its global virtual store (`enableGlobalVirtualStore` in `pnpm-workspace.yaml`): `node_modules` is a small tree of links into one shared store inside the pnpm store (`pnpm store path`), so the main checkout and every issue worktree share one copy of each package.

Under Aspire, the `db-migrate` resource applies the database migrations on every run, before `web` starts. To load the sample products, start the `db-seed` resource from the dashboard.

Open the Aspire dashboard and click the `web` resource's endpoint. The home page shows the hero headline from Strapi plus the database time and PostgreSQL version, all rendered on the server. Until you've created the Strapi API token (see below), it shows a 503 "content temporarily unavailable" page instead.

> Use `pnpm aspire …` rather than plain `aspire …`. Aspire installs the AppHost with `pnpm install --ignore-workspace`, and pnpm then rejects esbuild's build script. The wrapper `scripts/aspire.mjs` approves only that one build and then runs the Aspire CLI with your arguments (`run`, `start`, `stop`, `ps`, …).
