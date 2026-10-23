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

Under Aspire, the `db-migrate` resource applies the database migrations on every run, before `web` starts. To load the sample products, start the `db-seed` resource from the dashboard.

Open the Aspire dashboard and click the `web` resource's endpoint. The home page shows the hero headline from Strapi plus the database time and PostgreSQL version, all rendered on the server. Until you've created the Strapi API token (see below), it shows a 503 "content temporarily unavailable" page instead.

> Use `pnpm aspire …` rather than plain `aspire …`. Aspire installs the AppHost with `pnpm install --ignore-workspace`, and pnpm then rejects esbuild's build script. The wrapper `scripts/aspire.mjs` approves only that one build and then runs the Aspire CLI with your arguments (`run`, `start`, `stop`, `ps`, …).

### Without Aspire

Point `DATABASE_URL` in `.env` at any PostgreSQL database, for example:

```bash
docker run -d --name jassmin-pg -p 5432:5432 \
  -e POSTGRES_USER=jassmin -e POSTGRES_PASSWORD=jassmin -e POSTGRES_DB=jassmin postgres:18
pnpm db:migrate             # create the schema
pnpm db:seed                # optional: sample products
pnpm dev                    # http://localhost:5173
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes* | PostgreSQL connection string. *Under Aspire, the injected `JASSMINDB_URI` takes precedence, so a `DATABASE_URL` in `.env` is ignored there. |
| `SESSION_SECRET` | yes | Secret for signing the session cookie, at least 32 characters. |
| `PORT` | no | Port for `pnpm start` (default `3000`). |
| `STRAPI_URL` | no | Strapi base URL (default `http://localhost:1337`). Under Aspire it's set to the `cms` endpoint. |
| `STRAPI_API_TOKEN` | no* | Read-only Strapi API token. *Without it the app still starts, but CMS-backed pages answer with a 503. |
| `SMTP_URL` | no* | SMTP server for contact form emails (`smtp://` or `smtps://`, e.g. `smtp://localhost:2525` for smtp4dev). Under Aspire it's set to the `smtp4dev` container. *Without it, development logs contact messages instead of sending them, and production shows a "couldn't send" error. |
| `CONTACT_INBOX` | no | Address that receives contact form emails (default `hello@jassmin.ua`). |
| `CONTACT_FROM` | no | Sender of contact form emails (default `Jassmin website <no-reply@jassmin.ua>`). |

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
| `pnpm cms:dev` | Strapi in development mode (admin at http://localhost:1337/admin) |
| `pnpm cms:build` | Build the Strapi admin panel |
| `pnpm cms:seed` | Seed Strapi with demo content (`-- --token` also creates the app's API token) |
| `pnpm db:generate` | Generate a migration from `app/.server/db/schema.ts` (`--name <name>`) |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:rollback` | Roll back the latest applied migration |
| `pnpm db:seed` | Add the sample products that don't exist yet (safe to re-run) |
| `pnpm db:make-admin <email>` | Give a registered user the admin role (`--revoke` takes it away), see [Admin area](#admin-area) |

The `db:*` scripts use `JASSMINDB_URI` or `DATABASE_URL`, like the app. Aspire generates the password of its database, so under Aspire run them through the dashboard resources (`db-migrate` runs automatically, while `db-seed` and `db-rollback` start by hand) instead of from a terminal.

The DB tests (`health.test.ts`, `migrator.test.ts`, `seed.test.ts`) are integration tests. They run only when a database is configured (`DATABASE_URL` in `.env`, or Aspire's Postgres) and are reported as skipped otherwise. The migration and seed tests create and drop their own throwaway databases on that server, so the configured user needs `CREATEDB`.

## Database migrations

The schema lives in `app/.server/db/schema.ts`, and the migrations generated from it live in `app/.server/db/migrations/`. Drizzle Kit has no down migrations, so each migration has a hand-written reverse in `app/.server/db/rollbacks/<tag>.sql`. To change the schema:

1. Edit `schema.ts`, then run `pnpm db:generate --name <what_changed>` and review the generated SQL.
2. Write `rollbacks/<tag>.sql` with the reverse statements, separated by `--> statement-breakpoint`.
3. Run `pnpm db:migrate`, then `pnpm db:rollback` and `pnpm db:migrate` again to check that both directions work.

Never edit a migration that has already been applied anywhere.

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
    db/                Drizzle client, schema, migrations + rollbacks, seed, queries
    services/          business logic (orders, auth, cart, …)
    cms/               Strapi client: content queries, zod schemas, CmsError
cms/                   Strapi v5 CMS (content types in src/api, components in src/components)
aspire-apphost/        Aspire TypeScript AppHost (local dev orchestration)
scripts/aspire.mjs     Aspire CLI wrapper for pnpm
docs/plans/            implementation plans while an issue is in progress
```

Anything under `app/.server/` is server-only. Importing it from code that reaches the browser makes the build fail ("Server-only module referenced by client").

## Content (Strapi CMS)

Editorial content is managed in [Strapi](https://docs.strapi.io) v5, in the `cms/` workspace package: blog posts, home page copy and the store's contact details. Products, stock, carts, orders, users and analytics stay in the app's PostgreSQL database. Strapi has its own `strapidb` database on the same PostgreSQL server.

The app reads published content on the server only, through `app/.server/cms/content.ts`, using a read-only API token. Strapi admin accounts are separate from Jassmin customer and admin accounts.

### Running Strapi

- **With Aspire:** `pnpm aspire run` starts the `cms` resource (port 1337) on the `strapidb` database and passes its URL to `web` as `STRAPI_URL`. `web` doesn't wait for `cms`: if Strapi is down, the shop works and CMS pages show a 503.
- **Without Aspire:** point `DATABASE_URL` (or `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`) in `cms/.env` at an existing PostgreSQL database, then run `pnpm cms:dev`.

`cms/.env` holds Strapi's secrets. Generate each of `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET` and `ENCRYPTION_KEY` with:

```bash
node -e "console.log(require('node:crypto').randomBytes(16).toString('base64'))"
```

`APP_KEYS` is a comma-separated list of at least two such values.

### First-time setup

1. Open http://localhost:1337/admin and register the first Strapi admin. This account exists only in Strapi.
2. Seed demo content and create the app's token. Under Aspire, start the `cms-seed` resource (a child of `cms`) from the dashboard and read the token in its console logs. Aspire generates the `strapidb` password, so a terminal run can't reach it. Without Aspire, run:
   ```bash
   pnpm cms:seed -- --token
   ```
   The seed creates the home page, site settings, two published blog posts and one draft, and prints `STRAPI_API_TOKEN=…` once (Strapi stores only a hash). Copy that line into the root `.env` and restart `web`. Running the seed again leaves existing content and the token alone. It uses the same database variables as `pnpm cms:dev`.
3. **Or create the token by hand:** go to Settings → API Tokens → Create new API Token, choose type **Custom** and duration **Unlimited**, and enable only:
   - Blog-post: `find`, `findOne`
   - Home-page: `find`
   - Site-setting: `find`

   Save the token and copy it into `STRAPI_API_TOKEN` in `.env`.

Don't give the Public or Authenticated roles (Settings → Users & Permissions → Roles) any permission on these content types. Strapi doesn't grant any by default, unauthenticated requests get a 403, and Strapi logs a warning at startup if someone enables one. The token's `find` permission can technically request drafts (`?status=draft`). The app never does, because `cmsFetch` always sends `status=published`.

Media uploads use Strapi's local provider and are stored in `cms/public/uploads/` (git-ignored). The app turns their URLs into absolute URLs on `STRAPI_URL`.

### Content model

Schemas are committed in `cms/src/api/*/content-types/*/schema.json` and `cms/src/components/**`. The generated typings are in `cms/types/generated/`.

| Type | Kind | Fields |
|------|------|--------|
| `blog-post` | Collection, Draft & Publish | `title` (required), `slug` (UID from title, required, unique), `excerpt` (text, max 300), `content` (Markdown, required), `coverImage` (image), `authorName`, `seo` (`shared.seo`) |
| `home-page` | Single type | `hero` (`home.hero`), `about` (`home.about`), `location` (`home.location`) |
| `site-setting` ("Site settings") | Single type | `phone`, `email`, `customerServiceHours`, `socialLinks` (repeatable `shared.social-link`) |

| Component | Fields |
|-----------|--------|
| `home.hero` | `headline`, `ctaLabel`, `ctaHref`, `image` |
| `home.about` | `title`, `body` (Markdown) |
| `home.location` | `address`, `openingHours`, `mapEmbedUrl` |
| `shared.seo` | `metaTitle` (max 60), `metaDescription` (max 160), `ogImage` |
| `shared.social-link` | `platform` (`instagram`, `facebook`, `tiktok`, `telegram`, `viber`, `youtube`), `url` |

The single types have Draft & Publish off, so saving publishes. REST endpoints: `/api/blog-posts`, `/api/home-page`, `/api/site-setting`. When you change the model, update the zod schemas, the DTOs in `app/lib/cms.ts` and the fixtures in `app/.server/cms/__fixtures__/` (see `app/.server/AGENTS.md`).

## Home page and contact form

The home page (`/`) shows four sections: Hero, About us (`/#about`), Location and Contacts (`/#contacts`). All their text, images, the address, opening hours, map and contact details come from Strapi (`home-page` and `site-settings`), so editors change them in the Strapi admin without a deploy. The "About us" body is Markdown, rendered and sanitized on the server. If Strapi is unreachable, the page shows a 503 error page.

The contact form posts to the home route's `action` and works without JavaScript. Valid messages are emailed as plain text to `CONTACT_INBOX`, with the visitor's address as reply-to; they aren't stored. Each client can send 5 messages per 10 minutes (in memory, per server process), and a hidden honeypot field silently drops bots.

Locally, emails go to **smtp4dev**, which catches every message instead of delivering it:

- **With Aspire:** `pnpm aspire run` starts the `smtp4dev` container and passes its SMTP endpoint to `web` as `SMTP_URL`. Open its web UI from the dashboard to read the messages.
- **Without Aspire:** run `docker run --rm -p 5000:80 -p 2525:25 rnwood/smtp4dev:v3`, set `SMTP_URL=smtp://localhost:2525` in `.env`, and open http://localhost:5000.

Without `SMTP_URL`, development logs the message to the server console instead, and production shows a "couldn't send" error.

## Admin area

`/admin` is where staff manage products (`/admin/products`, #16) and orders (`/admin/orders`, #17). Blog and site content aren't managed here: the sidebar's "Content (Strapi)" link opens the Strapi admin (`STRAPI_URL` + `/admin`), which has its own accounts.

Every user has a role, `customer` (the default) or `admin`, in `users.role`. Logged-out visitors are sent to `/login` and come back afterwards; logged-in customers get a 403 page. The role is read from the database on every request, so promoting or demoting someone takes effect immediately, without logging in again.

### Creating the first admin

1. Register a normal account at `/register` (or use an existing one).
2. Give it the admin role:
   - **Without Aspire:** with `DATABASE_URL` in `.env` pointing at the app database, run
     ```bash
     pnpm db:make-admin you@example.com
     ```
   - **With Aspire:** Aspire generates the database password, so copy the connection string first. In the dashboard, open the `web` resource's details, reveal the `JASSMINDB_URI` environment variable and copy it. Then run (the variable wins over `DATABASE_URL` in `.env`):
     ```bash
     JASSMINDB_URI='postgresql://…' pnpm db:make-admin you@example.com
     ```
3. Open `/admin`. If you were logged in already, just reload the page.

`pnpm db:make-admin you@example.com --revoke` turns an admin back into a customer. The email is matched case-insensitively, and the command fails with a message if no account has it.

## Conventions

- Read data in `loader`s and write data in `action`s. Validate every `action` input with zod.
- No `any`: Biome's `noExplicitAny` is an error, and `tsc` runs in strict mode.
- Use database transactions wherever data integrity matters (e.g. checkout: stock, order, cart status).
- Work is tracked in GitHub issues. Each issue is planned, implemented and reviewed on its own `issue/<number>` branch in a separate git worktree (see `AGENTS.md`).
