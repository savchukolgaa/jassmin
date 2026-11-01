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
| `SESSION_SECRET` | yes | Secret for signing the session and analytics visitor cookies, at least 32 characters. |
| `PORT` | no | Port for `pnpm start` (default `3000`). |
| `PUBLIC_SITE_URL` | prod | The site's public origin (e.g. `https://jassmin.ua`) for canonical and Open Graph URLs (#85); never taken from the `Host` header. Required when `NODE_ENV=production`; in development the request's origin is used when it's unset. |
| `STRAPI_URL` | no | Strapi base URL (default `http://localhost:1337`). Under Aspire it's set to the `cms` endpoint. |
| `STRAPI_API_TOKEN` | no* | Read-only Strapi API token. *Without it the app still starts, but CMS-backed pages answer with a 503. |
| `STRAPI_SYNC_TOKEN` | no* | Strapi API token that may write products and orders (#40). *Without it, new orders and stock changes stay queued for Strapi (`pnpm db:sync-cms` pushes them later). |
| `CMS_SYNC_SECRET` | no* | Shared secret (32+ characters) that Strapi sends to the app's `/cms/*` sync routes; the same value goes in `cms/.env`. *Without it, saving a product or an order in the Strapi admin fails. |
| `PAYMENT_PROVIDER` | no* | Where card payments go. Only `simulator` for now, a local fake payment page that's refused when `NODE_ENV=production` (see [Card payments](#card-payments-simulator)). *Without it the app still starts, but card payment is unavailable at checkout. |
| `SMTP_URL` | no* | SMTP server for contact form and order emails (`smtp://` or `smtps://`, e.g. `smtp://localhost:2525` for smtp4dev). Under Aspire it's set to the `smtp4dev` container. *Without it, development logs contact messages instead of sending them, production shows a "couldn't send" error, and order confirmations stay queued (see [Order emails](#order-emails)). |
| `CONTACT_INBOX` | no | Address that receives contact form emails (default `hello@jassmin.ua`). |
| `CONTACT_FROM` | no | Sender of contact form emails (default `Jassmin website <no-reply@jassmin.ua>`). |
| `ORDER_FROM` | no | Sender of order confirmation emails (default: `CONTACT_FROM`). Replies go to `CONTACT_INBOX`. |
| `ABANDONED_CART_HOURS` | no | Hours without activity after which `pnpm db:mark-abandoned-carts` marks a cart with items `abandoned` (whole number, default `24`). Only the job reads it. |

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
| `pnpm herdr:plans <n> [<n> ...]` | Inside a Herdr pane: prepare each issue's worktree, link its `.env` and `cms/.env` to the main checkout's, and run `/create-plan <n>` in its own tab (`--kind <agent>`, default `claude`) |
| `pnpm worktree:remove <n>` | Remove issue `<n>`'s worktree after its PR is merged: deletes its `node_modules` without following links into pnpm's shared store, then runs `git worktree remove` |
| `pnpm cms:dev` | Strapi in development mode (admin at http://localhost:1337/admin) |
| `pnpm cms:build` | Build the Strapi admin panel |
| `pnpm cms:seed` | Seed Strapi with demo content (`-- --token` also creates the app's read-only and sync API tokens) |
| `pnpm db:generate` | Generate a migration from `app/.server/db/schema.ts` (`--name <name>`) |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:rollback` | Roll back the latest applied migration |
| `pnpm db:seed` | Add the sample products that don't exist yet (safe to re-run) |
| `pnpm db:import-catalog` | Add the shop's perfume range (`app/.server/db/catalog-data.ts`) that isn't in the database yet, every size at the price table's price (`catalog-prices.ts`) and stock 0; existing products are never changed (safe to re-run). Then run `pnpm db:sync-cms` |
| `pnpm db:convert-catalog <path>` | Convert the owner's Markdown perfume list into `catalog-data.ts`, applying `app/.server/db/catalog/fixes.ts` (the list itself isn't committed) |
| `pnpm db:make-admin <email>` | Give a registered user the admin role (`--revoke` takes it away), see [Admin role](#admin-role) |
| `pnpm db:mark-abandoned-carts` | Mark inactive carts as abandoned (safe to re-run), see [Abandoned carts](#abandoned-carts) |
| `pnpm db:send-order-emails` | Send the queued order emails that are due (safe to re-run), see [Order emails](#order-emails) |
| `pnpm db:sync-cms` | Push queued order and stock changes to Strapi (safe to re-run; `-- --all` queues every product and order first), see [Products and orders in Strapi](#products-and-orders-in-strapi) |

The `db:*` scripts use `JASSMINDB_URI` or `DATABASE_URL`, like the app. Aspire generates the password of its database, so under Aspire run them through the dashboard resources (`db-migrate` runs automatically, while `db-seed`, `db-import-catalog`, `db-rollback`, `db-mark-abandoned-carts`, `db-send-order-emails` and `db-sync-cms` start by hand) instead of from a terminal.

The DB tests (`health.test.ts`, `migrator.test.ts`, `seed.test.ts`, `import-catalog.test.ts`) are integration tests. They run only when a database is configured (`DATABASE_URL` in `.env`, or Aspire's Postgres) and are reported as skipped otherwise. The migration, seed and import tests create and drop their own throwaway databases on that server, so the configured user needs `CREATEDB`.

## Abandoned carts

`pnpm db:mark-abandoned-carts` marks every `active` cart that has items and no activity for more than `ABANDONED_CART_HOURS` (default 24) as `abandoned`, sets `carts.abandoned_at`, and logs how many carts it changed. It leaves `updated_at` alone, so that stays the shopper's last activity. Empty and converted carts are never touched, and a second run changes nothing, so it's safe to run as often as you like.

The app server only handles requests, so run the job hourly from an external scheduler. With system cron, for example:

```cron
0 * * * * cd /srv/jassmin && pnpm db:mark-abandoned-carts >> /var/log/jassmin/abandoned-carts.log 2>&1
```

Like the other `db:*` scripts it runs TypeScript with `tsx`, a dev dependency, so install dev dependencies (plain `pnpm install`) where it runs. Under Aspire, start the `db-mark-abandoned-carts` resource from the dashboard.

A shopper whose cart was abandoned sees an empty cart when they come back, and their next add starts a new cart. The abandoned cart stays as it was, for analytics.

## Order emails

Every placed order gets a plain-text confirmation email (#45) in the language the shopper checked out in, from `ORDER_FROM` (default `CONTACT_FROM`) with replies going to `CONTACT_INBOX`. It's queued in the `order_emails` table in the same transaction as the order, so an order never exists without its email and a failed checkout queues nothing. Right after the order commits, the checkout tries to send it without waiting; a mail failure is logged and never affects the order or the redirect.

`pnpm db:send-order-emails` sends whatever is still due: it retries a failed email after 1, 5 and 15 minutes, then 1, 3, 6, 12 and 24 hours, and after 8 attempts (about two days) marks it `failed` with the last error in `last_error`. Sending a row first pushes its next attempt out, so two senders never send the same email and a crash mid-send only means a later retry. Without `SMTP_URL`, nothing is sent and the emails stay `pending` until it's set.

Run the job every 5 minutes from an external scheduler, like the abandoned-cart job. With system cron, for example:

```cron
*/5 * * * * cd /srv/jassmin && pnpm db:send-order-emails >> /var/log/jassmin/order-emails.log 2>&1
```

It needs the database URL and the mail variables (`SMTP_URL`, `ORDER_FROM`, `CONTACT_FROM`, `CONTACT_INBOX`), but not `SESSION_SECRET`. Under Aspire, start the `db-send-order-emails` resource from the dashboard; it sends to smtp4dev.

## Card payments (simulator)

A shopper who picks card is sent to a hosted payment page right after checkout (#44), and the page's signed callback marks the order paid. Cash on delivery isn't affected. For now the only provider is a **local simulator**: set `PAYMENT_PROVIDER=simulator` in `.env` and restart the app. It needs no merchant account, tunnel or network access, and the app refuses it when `NODE_ENV=production`. Without `PAYMENT_PROVIDER`, the card option is disabled at checkout.

After a card checkout, the simulator page at `/payments/simulator` shows the payment's reference and the exact order total. Its buttons play the bank: each one POSTs a signed callback to `/payments/callback` over HTTP, like a real provider, and then returns you to the order's success page.

- **Pay**: the order becomes `paid`, with `paid_at` set.
- **Pay and send the confirmation twice**: sends the same callback twice. The order is still paid only once.
- **Decline the payment**: the attempt is `failed` and the order stays `unpaid`. The success page offers **Try again**, which starts a new attempt.
- **Return without paying**: no callback. The success page shows the payment as pending, with a **Pay now** button.

Every attempt is a row in `payments`, with a reference like `42-1`, `42-2`. The amount always comes from the order's stored `total_amount`. A real Ukrainian provider (LiqPay, WayForPay or monobank) is a follow-up: one more `PaymentProvider` in `app/.server/payments/` plus a migration that allows it in `payments_provider_check`.

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
    analytics.ts       analytics visitor cookies and sessions (getVisitor)
    db/                Drizzle client, schema, migrations + rollbacks, seed, queries
    services/          business logic (orders, auth, cart, …)
    cms/               Strapi client: content queries, zod schemas, CmsError, sync writer
cms/                   Strapi v5 CMS (content types in src/api, components in src/components,
                       product and order write-through in src/sync)
aspire-apphost/        Aspire TypeScript AppHost (local dev orchestration)
scripts/aspire.mjs     Aspire CLI wrapper for pnpm
docs/plans/            implementation plans while an issue is in progress
```

Anything under `app/.server/` is server-only. Importing it from code that reaches the browser makes the build fail ("Server-only module referenced by client").

## Content (Strapi CMS)

[Strapi](https://docs.strapi.io) v5, in the `cms/` workspace package, is the shop's only admin interface. Staff edit editorial content there (blog posts, home page copy, the store's contact details, special offers) and manage products and orders (#40, see [Products and orders in Strapi](#products-and-orders-in-strapi)). Products, stock, carts, orders, users and analytics still live in the app's PostgreSQL database, which stays the system of record. Strapi has its own `strapidb` database on the same PostgreSQL server.

The app reads published content on the server only, through `app/.server/cms/content.ts`, using a read-only API token. Strapi admin accounts are separate from Jassmin customer accounts.

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
   The seed creates the home page and site settings in Ukrainian and English, two published blog posts (one translated, one Ukrainian only), one draft, and special offers for `/offers` (a current and an expired campaign, a tester trio, gift ideas and three perks), and prints `STRAPI_API_TOKEN=…` and `STRAPI_SYNC_TOKEN=…` once each (Strapi stores only a hash). Copy both lines into the root `.env` and restart `web`. Running the seed again leaves existing content alone. With `--token`, an existing token keeps its key and is granted any permissions it lacks (such as `offer.find`, added in #55). It uses the same database variables as `pnpm cms:dev`.
3. **Or create the token by hand:** go to Settings → API Tokens → Create new API Token, choose type **Custom** and duration **Unlimited**, and enable only:
   - Blog-post: `find`, `findOne`
   - Home-page: `find`
   - Offer: `find`
   - Site-setting: `find`

   Save the token and copy it into `STRAPI_API_TOKEN` in `.env`. Create a second **Custom**, **Unlimited** token for `STRAPI_SYNC_TOKEN` with only `find`, `findOne`, `create` and `update` on Product and Order.

Don't give the Public or Authenticated roles (Settings → Users & Permissions → Roles) any permission on these content types. Strapi doesn't grant any by default, unauthenticated requests get a 403, and Strapi logs a warning at startup if someone enables one. The token's `find` permission can technically request drafts (`?status=draft`). The app never does, because `cmsFetch` always sends `status=published`.

Media uploads use Strapi's local provider and are stored in `cms/public/uploads/` (git-ignored). The app turns their URLs into absolute URLs on `STRAPI_URL`.

### Content model

Schemas are committed in `cms/src/api/*/content-types/*/schema.json` and `cms/src/components/**`. The generated typings are in `cms/types/generated/`.

| Type | Kind | Fields |
|------|------|--------|
| `blog-post` | Collection, Draft & Publish | `title` (required), `slug` (UID from title, required, unique), `excerpt` (text, max 300), `content` (Markdown, required), `coverImage` (image), `authorName`, `seo` (`shared.seo`) |
| `home-page` | Single type | `hero` (`home.hero`), `about` (`home.about`), `location` (`home.location`) |
| `product` (#40) | Collection, no Draft & Publish | `name`, `slug` (UID from name), `brand`, `description`, `gender` (`women`, `men`, `unisex`), `fragranceFamily`, `image`, `packSize`, `active`, `variants` (repeatable `catalog.variant`, at least one), `publicId` (set by the app) |
| `order` (#40) | Collection, no Draft & Publish | `orderId` (the app's order id, unique), `orderStatus`, `paymentStatus`, `paymentMethod`, customer name, email and phone, `userId`, `shippingAddress`, `freeShipping`, amounts, `placedAt`, `paidAt`, `shippedAt`, `completedAt`, `cancelledAt`, `refundedAt`, `items` (repeatable `orders.item`) |
| `offer` | Collection, Draft & Publish | `title` (required), `slug` (UID from title), `kind` (`discovery-set`, `seasonal`, `gift`, `bundle`, `featured`, `last-units`, `perk`), `summary`, `body` (Markdown), `image`, `startsAt` / `endsAt` (date-times, optional), `priceNote`, `products` (repeatable `offers.product-ref`), `ctaLabel`, `ctaUrl` (app path), `sortOrder` |
| `site-setting` ("Site settings") | Single type | `phone`, `email`, `customerServiceHours`, `socialLinks` (repeatable `shared.social-link`) |

| Component | Fields |
|-----------|--------|
| `catalog.variant` | `volumeMl` (7, 10, 30, 50 or 100, checked by the app), `price` (UAH, over 0), `stock` |
| `orders.item` | `productPublicId`, `productName`, `brand`, `volumeMl`, `quantity`, `unitPrice` (a snapshot at checkout) |
| `home.hero` | `headline`, `ctaLabel`, `ctaHref`, `image` |
| `home.about` | `title`, `body` (Markdown) |
| `home.location` | `address`, `openingHours`, `mapEmbedUrl` |
| `offers.product-ref` | `publicId` (a shop product's `public_id`, UUID) |
| `shared.seo` | `metaTitle` (max 60), `metaDescription` (max 160), `ogImage` |
| `shared.social-link` | `platform` (`instagram`, `facebook`, `tiktok`, `telegram`, `viber`, `youtube`), `url` |

The single types have Draft & Publish off, so saving publishes. REST endpoints: `/api/blog-posts`, `/api/home-page`, `/api/offers`, `/api/site-setting`, plus `/api/products` and `/api/orders` for the app's sync token. When you change the model, update the zod schemas, the DTOs in `app/lib/cms.ts` and the fixtures in `app/.server/cms/__fixtures__/` (see `app/.server/AGENTS.md`).

### Translations (Ukrainian and English)

All content types use Strapi's built-in Internationalization (#43). The locales are **Ukrainian (`uk`, default)** and **English (`en`)**. Strapi creates them at startup (`ensureLocales` in `cms/src/index.ts`), so a fresh setup needs no clicking in Settings → Internationalization. Existing content was kept as Ukrainian by the migration in `cms/database/migrations/`, which makes `uk` the default before Strapi tags existing entries with a locale.

Which fields are per language:

| Type | Per language | Shared by both languages |
|------|--------------|--------------------------|
| `blog-post` | `title`, `excerpt`, `content`, `authorName`, `seo` | `slug`, `coverImage` |
| `home-page` | `hero`, `about`, `location` (whole components, including the hero image, CTA link and map URL) | — |
| `site-setting` | `customerServiceHours` | `phone`, `email`, `socialLinks` |
| `offer` | `title`, `summary`, `body`, `priceNote`, `ctaLabel` | `slug`, `kind`, `image`, `startsAt`, `endsAt`, `products`, `ctaUrl`, `sortOrder` |

Strapi can't share single fields inside a localized component, so the hero `image` and `ctaHref` and the location `mapEmbedUrl` are stored once per language. Keep them the same in both.

**Adding an English translation (editors):**

1. Open the entry in the Content Manager. Ukrainian is shown first.
2. Pick **English (en)** in the locale dropdown at the top right.
3. Click **Fill in from another locale** and pick Ukrainian. This copies every field, including the hero image, CTA link and map URL on the home page.
4. Translate the text fields and save. For a blog post, also click **Publish**: an English draft isn't shown.

Shared fields (a post's slug and cover, the phone, email and social links) are edited in either language and change in both.

**What visitors see:** the app asks Strapi for the visitor's language (the `locale` cookie, then `Accept-Language`). When an entry has no English version yet, the Ukrainian one is shown, never an error. Ukrainian content must therefore always exist. The English blog list contains every published Ukrainian post, each in English when it has a published translation. A post published only in English isn't listed. `/blog/<slug>` is the same URL in both languages.

## Special offers

`/offers` (#55) lists the published Strapi `offer` entries whose window includes the current moment: `startsAt` (inclusive) up to `endsAt` (exclusive). Both are date-times, compared as instants, so a campaign can end at 23:59 Kyiv time. An empty `startsAt` means "already started" and an empty `endsAt` means "no end". Which offers are active is decided by the Ukrainian entry; English translations only replace the text.

- **Kind** groups the cards: discovery sets, seasonal, gifts, bundles, featured, last units. `perk` entries (free delivery, discovery sizes, the welcome offer) form the strip under the hero instead.
- **Sort order** (lowest first) orders offers within each group. The active non-perk offer with the lowest `sortOrder` becomes the hero at the top of the page, so lowering a campaign's `sortOrder` features it.
- **Products** are shop products by their `public_id` (copy it from the product URL, `/products/<id>`). Products that no longer exist, or have no sizes for sale, are left out.
- **CTA link** (`ctaUrl`) must be a path in the shop, such as `/catalog/women`; anything else hides the button.
- **Prices aren't changed.** Checkout has no discounts yet, so `priceNote` is plain text ("3 × 7 мл — від 499 ₴"). Word offers as curated picks unless the cart prices already match.

When no offer is active the page shows an empty state, and when Strapi is down a 503 error page.

## Home page and contact form

The home page (`/`) shows four sections: Hero, About us (`/#about`), Location and Contacts (`/#contacts`). All their text, images, the address, opening hours, map and contact details come from Strapi (`home-page` and `site-settings`), so editors change them in the Strapi admin without a deploy. The "About us" body is Markdown, rendered and sanitized on the server. If Strapi is unreachable, the page shows a 503 error page.

The contact form posts to the home route's `action` and works without JavaScript. Valid messages are emailed as plain text to `CONTACT_INBOX`, with the visitor's address as reply-to; they aren't stored. Each client can send 5 messages per 10 minutes (in memory, per server process), and a hidden honeypot field silently drops bots.

Locally, emails go to **smtp4dev**, which catches every message instead of delivering it:

- **With Aspire:** `pnpm aspire run` starts the `smtp4dev` container and passes its SMTP endpoint to `web` as `SMTP_URL`. Open its web UI from the dashboard to read the messages.
- **Without Aspire:** run `docker run --rm -p 5000:80 -p 2525:25 rnwood/smtp4dev:v3`, set `SMTP_URL=smtp://localhost:2525` in `.env`, and open http://localhost:5000.

Without `SMTP_URL`, development logs the message to the server console instead, and production shows a "couldn't send" error.

## Products and orders in Strapi

There is no admin area in the app any more (#40): staff manage the catalogue and orders in the Strapi admin (`STRAPI_URL` + `/admin`), next to the editorial content. The app's PostgreSQL database stays the system of record, because checkout locks and decrements stock there and carts, order lines, offers and analytics point at its rows. Strapi is the screen staff use, and every save writes through to the app:

- **Saving a product or an order in the Strapi admin** first sends the change to the app (`POST /cms/products` or `/cms/orders/:id`, authenticated with `CMS_SYNC_SECRET`). The app checks it, applies it in one transaction and answers with what it stored, which is what Strapi saves. When the app refuses, the save fails with a message in Ukrainian and nothing changes on either side. When the app is down, saves fail with a clear message too.
- **Products:** name, slug, brand, description, gender, fragrance family, image, pack size, `active` and the sizes (`variants`: volume, price, stock). A stock number is applied as the **difference** from the number the form showed, so units sold while the form was open stay sold, and the form then shows the real stock. Removing a size deletes it in the shop (cart lines with it go; order lines keep their size). Unticking **Active** or deleting a product archives it: it disappears from the catalogue, product page, offers and checkout, and its past orders keep their title and image.
- **Orders:** only **Order status** (`orderStatus`, because Strapi reserves `status`) and **Payment status** can be changed; every other field is read-only and set by the shop. The shop checks each change against the lifecycle in `app/lib/order-status.ts`:
  - `pending` → `paid`, `shipped` (cash on delivery only: shipped while the payment is still pending) or `cancelled`
  - `paid` → `shipped` or `cancelled`
  - `shipped` → `completed`, `returned` or `unclaimed`
  - `completed` → `returned`
  - payment: `unpaid` → `paid` → `refunded`

  It sets `paid_at`, `shipped_at`, `completed_at`, `cancelled_at` and `refunded_at`. Completing a cash-on-delivery order marks it paid. `cancelled` and `unclaimed` put the units back in stock in the same transaction (`returned` doesn't: the perfume may have been opened). Orders can't be created or deleted in Strapi. Customers see each change on `/account` straight away.
- **From the app to Strapi:** new orders, card payments and stock changes (checkout, restocks) are queued in `cms_outbox` in the same transaction and pushed with `STRAPI_SYNC_TOKEN` right after it commits. `pnpm db:sync-cms` retries whatever failed (run it every 5 minutes from cron in production; under Aspire it's the `db-sync-cms` resource).

**Setup:**

1. Set the same `CMS_SYNC_SECRET` (32+ characters) in the root `.env` and in `cms/.env`, and `JASSMIN_APP_URL` (the app's URL, e.g. `http://localhost:5173`) in `cms/.env`. Under `pnpm aspire run`, Aspire generates the secret and sets both.
2. Run `pnpm cms:seed -- --token` (or the `cms-seed` resource) and copy `STRAPI_SYNC_TOKEN=…` into the root `.env`.
3. Copy the existing catalogue and orders into Strapi once: `pnpm db:sync-cms -- --all`. Products from before #40 get a slug from their title. It only upserts, so running it again is safe.
4. Load the shop's perfume range with `pnpm db:import-catalog` (or the `db-import-catalog` resource), then push it with `pnpm db:sync-cms`. Staff add photos, descriptions and stock in Strapi; a re-run of the import only adds perfumes that aren't there yet.

## Admin role

The in-app `/admin` area was removed in #40. Every user still has a role, `customer` (the default) or `admin`, in `users.role`, and `requireAdmin` (`app/.server/services/auth.ts`) is kept for future admin-only endpoints. The role is read from the database on every request.

### Making someone an admin

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
`pnpm db:make-admin you@example.com --revoke` turns an admin back into a customer. The email is matched case-insensitively, and the command fails with a message if no account has it.

## Conventions

- Read data in `loader`s and write data in `action`s. Validate every `action` input with zod.
- No `any`: Biome's `noExplicitAny` is an error, and `tsc` runs in strict mode.
- Use database transactions wherever data integrity matters (e.g. checkout: stock, order, cart status).
- Work is tracked in GitHub issues. Each issue is planned, implemented and reviewed on its own `issue/<number>` branch in a separate git worktree (see `AGENTS.md`).
