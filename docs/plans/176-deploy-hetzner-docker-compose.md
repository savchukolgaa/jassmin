# Plan: Deploy the shop from Aspire to a Hetzner server with Docker Compose (#176)

Issue: https://github.com/savchukolgaa/jassmin/issues/176
Branch: `issue/176`
Worktree: `.claude/worktrees/issue-176`
Status: In progress

## Goal

The store owner wants the shop online on one Hetzner CX23 server for about €7 a month, with the
database and Strapi uploads kept between deploys. `pnpm aspire deploy` builds the site and Strapi
images, pushes them to GHCR, and starts them with Docker Compose over SSH. The server also runs
PostgreSQL on a persistent volume, Caddy for HTTPS, the scheduled jobs and nightly `pg_dump`
backups. `pnpm aspire run` stays exactly as it is today.

## Dependencies & prerequisites

- **Aspire 13.6.4 TypeScript AppHost** (`aspire.config.json`). The generated SDK in
  `aspire-apphost/.aspire/modules/aspire.mts` already has what the publish side needs:
  `builder.executionContext().isPublishMode()`, `addDockerfile(name, contextPath, { dockerfilePath,
  stage })`, `addContainerRegistry(name, endpoint, { repository })`, `withContainerRegistry`,
  `addParameter(name, { secret })`, `addParameterWithGeneratedValue`, `withVolume`,
  `withBindMount`, `withComputeEnvironment`, and `builder.pipeline().addStep(name, callback,
  { dependsOn, requiredBy })` (pipeline step callbacks run in the AppHost's Node process, so they
  can call `ssh`/`scp` through `node:child_process`).
- **Missing:** the Docker Compose integration (`Aspire.Hosting.Docker`, which provides
  `addDockerComposeEnvironment`) isn't installed. Step 1 adds it with `pnpm aspire add docker`.
  That records the package in `aspire.config.json` and regenerates `.aspire/modules/`.
- **Local tools:** Docker (v29 is installed), and OpenSSH `ssh`/`scp` on the PATH (Windows 11
  includes them).
- **Server-side, done by hand following `docs/deploy.md`:** a CX23 server running Ubuntu 24.04
  with Docker Engine and the Compose plugin, a `deploy` user in the `docker` group, the firewall,
  DNS records, and `docker login ghcr.io` with a read-only token.
- **Related issues:** #134 (Brevo `SMTP_URL`, `EMAIL_WEBHOOK_SECRET`) is done (see `docs/email.md`).
  #143 (`TRUSTED_PROXY_HOPS`, CSP) is done (see `docs/security.md`). #167 (the AI perfumer in
  production) isn't needed: no `AI_*` variable is published, so the perfumer stays off.
- No new npm packages in the root workspace, and no DB migrations.

## Decisions & assumptions

1. **Publish mode is a separate module, so run mode keeps its exact code.** `apphost.mts` checks
   `await (await builder.executionContext()).isPublishMode()`. In run mode it declares the current
   resources unchanged. In publish mode it calls `addProductionResources(builder)` from a new
   `aspire-apphost/production.mts`, which is added to `tsconfig.apphost.json`'s `include`. The dev
   resources are therefore never declared when publishing: smtp4dev, every `db-*` one-off,
   `cms-seed`, synth, dbt and Jupyter. The run-mode code moves into a function, but its
   statements stay identical.
2. **One root `Dockerfile` with two targets, plus `cms/Dockerfile`.**
   - `Dockerfile` → stage `web`: a `node:24-bookworm-slim` runtime with production dependencies
     only, `build/` and `public/`. It runs `pnpm start` as user `node`.
   - `Dockerfile` → stage `jobs`: the full install, including dev dependencies, plus the source
     (`app/`, `drizzle.config.ts`, `tsconfig.json`, `package.json`), with
     [supercronic](https://github.com/aptible/supercronic) and `deploy/crontab`. The jobs and
     `db:migrate` are `tsx` and `drizzle-kit` scripts (`package.json`), both dev dependencies, so
     the slim `web` image can't run them. `db-migrate` and `scheduler` both use this image.
   - `cms/Dockerfile` builds from the **repo root** context, because the `cms` package is in the
     root pnpm workspace and lockfile: `pnpm install --filter jassmin-cms...`, then
     `pnpm --filter jassmin-cms build`, then `strapi start` with `NODE_ENV=production`.
   - In every image, pnpm comes from Corepack at `packageManager`'s version. The global virtual
     store is turned off (`pnpm_config_enable_global_virtual_store=false`) so `node_modules` is
     self-contained, and the `allowBuilds` list from `pnpm-workspace.yaml` applies.
3. **Production resources in `production.mts`:**
   - `compose = builder.addDockerComposeEnvironment("jassmin")`.
   - `ghcr = builder.addContainerRegistry("ghcr", "ghcr.io", { repository: <ghcr-repository parameter> })`.
   - `postgres = builder.addPostgres("postgres", { password: postgresPassword }).withDataVolume()`,
     with the databases `jassmindb` and `strapidb`. It has no host port.
   - `db-migrate`: `addDockerfile("db-migrate", "..", { stage: "jobs" })` with the command
     `pnpm db:migrate`, `withReference(db)` and `waitFor(db)`.
   - `web`: `addDockerfile("web", "..", { stage: "web" })` with an `http` endpoint (target port
     3000, no host port), `waitForCompletion(dbMigrate)`, and the environment from Decision 6.
   - `cms`: `addDockerfile("cms", "..", { dockerfilePath: "cms/Dockerfile" })` with an `http`
     endpoint (1337, no host port), the `strapi-uploads` volume at `/app/cms/public/uploads`, and
     `/_health` as its health check.
   - `scheduler`: the `jobs` image with the command `supercronic /app/deploy/crontab`. It gets the
     same jobs environment as `web` (Decision 6).
   - `pg-backup`: `addDockerfile("pg-backup", "../deploy/pg-backup")`, based on `postgres:18` plus
     supercronic. Every night it runs `pg_dump -Fc` of both databases into a bind mount at
     `/srv/jassmin/backups` on the host, and deletes dumps older than 7 days.
   - `proxy`: `addDockerfile("proxy", "../deploy/caddy")`, `caddy:2` with `deploy/caddy/Caddyfile`
     built into the image, so no host files need copying. It publishes host ports 80 and 443,
     with volumes `caddy-data` and `caddy-config`. The Caddyfile reads `{$SITE_DOMAIN}` and
     `{$ADMIN_DOMAIN}` and proxies them to `web:3000` and `cms:1337`. Caddy issues Let's Encrypt
     certificates automatically. `www.{$SITE_DOMAIN}` redirects to the bare domain.
   - Every built image is pushed to GHCR (`withContainerRegistry(ghcr)`): `web`, `cms`,
     `db-migrate`, `scheduler`, `pg-backup` and `proxy`. Aspire has a `push-<resource>` step for
     each `addDockerfile` resource, so the small `pg-backup` and `proxy` images go to GHCR too and
     the server never builds anything. Postgres comes from Docker Hub.
4. **Deploying over SSH is an AppHost pipeline step, not a separate script.** The TypeScript SDK
   has `builder.pipeline().addStep()`, so `production.mts` adds a `deploy-ssh` step. It depends
   on the Compose publish step and the image push step, and is required by `deploy`. The step:
   1. reads `DEPLOY_SSH_TARGET` (e.g. `deploy@203.0.113.7`) from a parameter;
   2. copies the generated `docker-compose.yaml` and `.env` from the publish output folder
      (`aspire-output/`, git-ignored) with `scp` to `/srv/jassmin/` on the server;
   3. runs `ssh <target> "cd /srv/jassmin && docker compose pull && docker compose up -d
      --remove-orphans && docker image prune -f"`;
   4. reports progress with `context.reportingStep()` and writes the site URL to
      `context.summary()`.

   Step 1 of this plan checks the step names (`publish-<env>`, `push`) in the generated SDK and
   with `pnpm aspire do --list-steps` (or the equivalent). **Fallback, as the issue allows:** if
   the TypeScript pipeline step can't depend on the Compose steps, `scripts/deploy.mjs` runs
   `pnpm aspire publish -o aspire-output`, then `docker compose build/push`, then the same
   `scp`/`ssh`. A `pnpm deploy:prod` script wraps it.
5. **Secrets and settings are Aspire parameters.** Nothing is committed: Aspire asks for them on
   the first `aspire deploy` and keeps them in its deployment state. The generated `.env` holds
   the values and is copied to the server, while the committed Compose file only has
   `${VAR}` placeholders.
   - **Prompted** (they come from outside or the owner has to see them): `site-domain`,
     `admin-domain`, `ghcr-repository`, `deploy-ssh-target`, `smtp-url`,
     `email-webhook-secret` (pasted into Brevo too), `strapi-api-token`, `strapi-sync-token`.
   - **Generated** with `addParameterWithGeneratedValue(..., { secret: true, persist: true })`,
     because they're random and nobody types them: `postgres-password`, `session-secret`,
     `cms-sync-secret`, `email-unsubscribe-secret`, and Strapi's `app-keys`, `api-token-salt`,
     `admin-jwt-secret`, `transfer-token-salt`, `jwt-secret` and `encryption-key`.
     `ENCRYPTION_KEY` and `SESSION_SECRET` are required by the code (`cms/config/admin.ts`,
     `app/.server/env.ts`) but missing from the issue's list. The owner chose generated values
     (Q2), so `docs/deploy.md` says to back up Aspire's deployment state after the first deploy.
6. **Environment wiring:**
   - `web`/`scheduler` get:
     - `NODE_ENV=production`, `JASSMINDB_URI` (from `withReference(db)`) and `SESSION_SECRET`;
     - `PUBLIC_SITE_URL=https://{site-domain}`, `TRUSTED_PROXY_HOPS=1` and `CSP_MODE=report-only`;
     - `STRAPI_URL=http://cms:1337` (internal only; browsers get images through the app's
       `/uploads/*` proxy, Decision 10), `STRAPI_API_TOKEN`, `STRAPI_SYNC_TOKEN` and
       `CMS_SYNC_SECRET`;
     - `SMTP_URL`, `EMAIL_WEBHOOK_SECRET` and `EMAIL_UNSUBSCRIBE_SECRET`.
   - `PAYMENT_PROVIDER` isn't set, so card payment is off. `env.ts` already refuses `simulator`
     in production, so no code change is needed.
   - `cms` gets:
     - `NODE_ENV=production`, `DATABASE_CLIENT=postgres` and `DATABASE_URL` (from
       `strapiDb.uriExpression()`);
     - the six Strapi secrets and `CMS_SYNC_SECRET`;
     - `JASSMIN_APP_URL=http://web:3000` and `PUBLIC_URL=https://{admin-domain}`.
7. **Strapi behind the proxy:** `cms/config/server.ts` gains `url: env("PUBLIC_URL", "")` and
   `proxy: { koa: env.bool("IS_PROXIED", false) }`, so admin links and secure cookies work
   behind Caddy. Both are unset in development, so nothing changes there.
8. **Cron schedule** (`deploy/crontab`, UTC on the server; the times match `docs/setup.md`):
   - `*/5 * * * *`: `pnpm db:sync-cms` and `pnpm db:send-order-emails`;
   - `0 * * * *`: `pnpm db:mark-abandoned-carts`, then `pnpm db:send-cart-reminders`;
   - `30 * * * *`: `pnpm db:cancel-unpaid-orders`;
   - `15 3 * * *`: `pnpm db:expire-gift-cards`;
   - `30 3 * * *`: `pnpm db:prune-rate-limits`;
   - `0 2 * * *` in `pg-backup`: the dumps.

   supercronic logs every run to stdout, so `docker compose logs scheduler` shows them.
9. **`.dockerignore`** keeps out `.env`, `cms/.env`, `**/node_modules`, `.claude/`, `analytics/`,
   `build/`, `.react-router/`, `aspire-apphost/`, `aspire-output/`, `cms/.tmp`, `cms/dist`,
   `cms/public/uploads`, `.git` and `docs/`.
10. **Strapi media goes through an app-side proxy at `/uploads/*` (Q1).** Browsers never talk to
    Strapi for images; the app fetches them from the internal `STRAPI_URL` on the server side.
    The same code runs in development (proxying to `http://localhost:1337`), so dev and
    production behave alike.
    - **New resource route** `app/routes/uploads.$.ts`, declared in `app/routes.ts` outside
      the locale prefixes. Its `loader`:
      - validates the splat with a `*.schema.ts` zod schema: one or more path segments of
        `[A-Za-z0-9._-]`, no `..`, no empty segments. Anything else gets a 404.
      - fetches `${STRAPI_URL}/uploads/<path>` with `GET` and `AbortSignal.timeout(10_000)`.
        It forwards only `If-None-Match` and `If-Modified-Since`.
      - streams the body back with `Content-Type`, `Content-Length`, `ETag` and
        `Last-Modified`, plus `Cache-Control: public, max-age=31536000, immutable`. Strapi's
        file names carry a hash, so a changed image gets a new URL.
      - passes 304 and 404 through, answers 502 when Strapi is down or times out, and never
        passes on Strapi's other headers (cookies, `Server`).
      - `HEAD` works through the same loader.
    - **The server code lives in** `app/.server/cms/uploads-proxy.ts`, so it can be tested
      with a mocked `fetch`. The route only wires it up.
    - **Media URLs become same-origin paths.** A new `toMediaPath(url)` helper in
      `app/.server/cms/media.ts` turns Strapi's `/uploads/…` (relative, or absolute on any
      origin) into `/uploads/…`, and leaves other URLs as they are (e.g. an external
      `https://` image). Three places use it instead of resolving against `STRAPI_URL`:
      - `toImage`/`toSrcSet` in `content.ts`;
      - the `/cms/products` route (`app/routes/cms.products.ts`);
      - `toProductImageWrite` in `product-image-backfill.ts`.

      New `products.image_url`/`image_formats` values are therefore stored as `/uploads/…`.
    - **Rows stored before this change** hold absolute `http://localhost:1337/uploads/…` URLs.
      `toResponsiveImage`'s callers (`services/products.ts`, `services/cart.ts`) normalize them
      at read time with `toMediaPath`, so no data migration is needed. The production database
      starts empty anyway.
    - **Absolute URLs where they're needed.** The product feeds already use
      `absoluteUrl(row.imageUrl, origin)`. The cart-reminder and order emails
      (`photoOf` in `cart-reminder-email.ts`, and the order email lines) prefix a relative
      `/uploads/…` with `PUBLIC_SITE_URL` instead of falling back to the bottle photo. Any Open
      Graph image built from CMS media becomes absolute against the site origin; step 3 checks
      every user of `CmsImage.url`.
    - **CSP:** `img-src` becomes `'self' data:`, and `strapiOrigin` is dropped from
      `buildCsp`/`CspOptions`. A new external origin for images would need adding explicitly.
    - **robots.txt:** `/uploads/` stays crawlable, so product images can be indexed. The
      `docs/security.md` CSP section and the `docs/setup.md` Strapi section describe the proxy.

11. **Deviations found while implementing** (recorded here instead of silently changing the plan):
    - **Docker integration version.** `pnpm aspire add docker` picked `Aspire.Hosting.Docker`
      17.0.0, a newer major than the AppHost's SDK (13.6.3 in this checkout). It's pinned to
      **13.6.3** in `aspire.config.json`, matching the other integrations.
    - **The deploy command is `pnpm aspire:deploy`, not `pnpm aspire deploy`.** `--list-steps`
      showed that `deploy` also depends on Aspire's own `docker-compose-up-jassmin`, which runs
      `docker compose up` on the computer running the deploy. A pipeline step can't remove that
      dependency in the TypeScript SDK. So `deploy-ssh` depends on `push` (build and push every
      image) and `prepare-jassmin` (write the `.env` with the values). It runs through
      `aspire do deploy-ssh -o aspire-output`, wrapped as the new script `pnpm aspire:deploy`.
      `pnpm aspire publish` still writes the Compose file and an empty `.env` template. The
      `scripts/deploy.mjs` fallback isn't needed.
    - **`DEPLOY_SSH_TARGET` is an environment variable, not a parameter.** The TypeScript SDK
      can't read a parameter's value inside a pipeline step (`ParameterResource` has no value
      getter, and `ReferenceExpression.getValue` only works on server-returned expressions). The
      target isn't secret anyway, so the step reads `process.env.DEPLOY_SSH_TARGET`.
    - **`registry-endpoint` parameter.** `addContainerRegistry` refuses a string endpoint
      together with a parameter repository. The endpoint is therefore a parameter too, with
      `ghcr.io` as its published default, so nobody types it.
    - **`db-migrate` retries.** The Compose publisher has no health check for Postgres, so
      `depends_on` only waits for the container to start. `db-migrate` runs `pnpm db:migrate` in
      a 30 × 2 s retry loop, and `web`/`scheduler` wait for it to complete successfully.
    - **The `web` image runs `react-router-serve` directly** instead of `pnpm start`, so the
      runtime image needs no pnpm or Corepack. The `jobs` image keeps pnpm for the cron lines.
    - **Strapi media URLs.** `content.ts` keeps its `baseUrl` parameters. A new
      `strapiMediaUrl(url, strapiUrl)` (`app/.server/cms/media.ts`) returns `/uploads/…` paths
      for Strapi's uploads and resolves anything else against Strapi as before. `toMediaPath`
      only normalizes. Open Graph and JSON-LD images already went through `absoluteUrl(…,
      siteUrl)` (`app/lib/seo.ts`, `structured-data.ts`), and the product feed through
      `absoluteUrl(row.imageUrl, origin)`, so they needed no change. Order emails carry no
      product photos; only cart reminders do.

## Open questions

- [ ] **Q4: What are the domains?** — Why it matters: Caddy, `PUBLIC_SITE_URL`, the DNS records
  and the guide's examples need them. The owner hasn't decided yet (TBD). Plan: the shop and
  admin domains are the deploy parameters `site-domain` and `admin-domain`, so nothing in the
  code or the Compose file names a domain. `docs/deploy.md` writes `<shop-domain>` and
  `admin.<shop-domain>` as placeholders. The local smoke test uses `localhost`. Nothing in this
  issue is blocked on the answer. Affects steps: 4, 5, 8.

## Answered by the owner (2026-11-18)

- **Q1: Where should the browser load Strapi images from?** — Through a proxy in the app, on
  the server side, not a separate public Strapi URL. See Decision 10.
- **Q2: Should random secrets be generated or typed in?** — Generated by Aspire (Decision 5).
  `docs/deploy.md` tells the owner to back up the deployment state, because losing it would
  rotate `ENCRYPTION_KEY`, `EMAIL_UNSUBSCRIBE_SECRET` and `SESSION_SECRET`.
- **Q3: Should the GHCR images be private or public?** — Private. The server logs in once with
  a `read:packages` token (step 8).
- **Q5: The Strapi API tokens exist only after Strapi is up.** — Agreed: on the first deploy
  the owner enters the placeholder `pending`, then creates the tokens in Strapi, updates the
  two parameters and runs `pnpm aspire deploy` again (step 8).
- **Q6: Should the server be tested for real in this issue?** — No server exists yet.
  Verification stops at the local checks:
  - the image builds;
  - the publish output inspection;
  - a local `docker compose up` on `localhost` with Caddy's internal CA, including the
    scheduler logs, a dump and a restore.

  The criteria that need the real server (public HTTPS, Postgres closed from outside,
  surviving a reboot, the first nightly dump on the server) stay unchecked in the PR as
  manual checks for the owner's first deploy, which follows `docs/deploy.md`.

## Resolved questions

- **Can the TypeScript AppHost run a custom deploy step?** — Yes. The generated SDK has
  `DistributedApplicationPipeline.addStep(stepName, callback, { dependsOn, requiredBy })`, and
  `PipelineStepContext` provides `reportingStep()`, `summary()`, `logger()` and
  `executionContext()` (source: `aspire-apphost/.aspire/modules/aspire.mts`, around lines 1527,
  7318, 10926). The `scripts/deploy.mjs` fallback is kept only in case the Compose step names
  can't be depended on.
- **Is the Docker Compose integration available?** — Not yet. `aspire.config.json` lists only
  `Aspire.Hosting.JavaScript` and `Aspire.Hosting.PostgreSQL`, so step 1 runs
  `pnpm aspire add docker`.
- **Is the payment simulator refused in production?** — Yes, already done.
  `envSchema.refine(... PAYMENT_PROVIDER === "simulator" && NODE_ENV === "production")`
  (source: `app/.server/env.ts`).
- **Which database variable does the app read?** — `JASSMINDB_URI` wins over `DATABASE_URL`, in
  the app and in `drizzle.config.ts`, so `withReference(db)` works in Compose as it does in run
  mode (source: `app/.server/env.ts:153`, `drizzle.config.ts:15`).
- **Can the slim runtime image run the jobs?** — No. Every `db:*` script is `tsx …` and
  `db:migrate` is `drizzle-kit migrate`, both dev dependencies. Hence the separate `jobs` target
  (source: `package.json`).
- **How often do cart reminders run?** — Hourly, right after `db:mark-abandoned-carts`, not daily
  as the issue lists (source: `docs/email.md` → The job). The plan follows `docs/email.md`.
- **The other cron times** — Taken from `docs/setup.md`'s cron examples (`:00` abandoned carts,
  `:30` unpaid orders, `*/5` emails, `03:15` gift cards, `03:30` rate limits).
- **Which Node version?** — 24 (source: `.nvmrc`).
- **Which Postgres version?** — 18, the version Aspire runs locally and CI uses (source:
  `docs/ci.md`).
- **Does Strapi need extra secrets?** — Yes, `ENCRYPTION_KEY`, which `cms/config/admin.ts`
  requires through `requireEnv`.
- **Does Strapi need a public URL behind the proxy?** — Yes. `cms/config/server.ts` has no `url`
  or `proxy` yet, so step 3 adds both from environment variables.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `Dockerfile` | Multi-stage site image: `deps`, `build`, `web` (runtime), `jobs` (tsx + supercronic) |
| create | `cms/Dockerfile` | Strapi image built from the repo root context |
| create | `.dockerignore` | Keep secrets, `node_modules`, worktrees, analytics and build output out of the context |
| create | `deploy/crontab` | supercronic schedule for the jobs |
| create | `deploy/caddy/Dockerfile`, `deploy/caddy/Caddyfile` | HTTPS reverse proxy for the shop and admin domains |
| create | `deploy/pg-backup/Dockerfile`, `deploy/pg-backup/backup.sh`, `deploy/pg-backup/crontab` | Nightly `pg_dump` of both databases, kept 7 days |
| create | `aspire-apphost/production.mts` | Publish-mode resources, parameters, registry and the `deploy-ssh` pipeline step |
| modify | `aspire-apphost/apphost.mts` | Branch on `isPublishMode()`; run-mode resources unchanged |
| modify | `aspire-apphost/tsconfig.apphost.json` | Include `production.mts` (and any new generated module files) |
| modify | `aspire.config.json` | `Aspire.Hosting.Docker` package (via `pnpm aspire add docker`) |
| modify | `.gitignore` | `/aspire-output/` |
| modify | `cms/config/server.ts` | `url` and `proxy` from `PUBLIC_URL` / `IS_PROXIED` |
| create | `app/routes/uploads.$.ts`, `app/lib/uploads.schema.ts` | Resource route proxying `/uploads/*` to Strapi, and its path schema (Decision 10) |
| create | `app/.server/cms/uploads-proxy.ts` (+ `.test.ts`) | Fetch, header filtering, caching and error mapping for the proxy |
| create | `app/.server/cms/media.ts` (+ `.test.ts`) | `toMediaPath`: Strapi `/uploads/…` URLs → same-origin paths |
| modify | `app/routes.ts` | Declare `uploads/*` outside the locale prefixes |
| modify | `app/.server/cms/content.ts`, `app/routes/cms.products.ts`, `app/.server/services/product-image-backfill.ts`, `app/.server/services/products.ts`, `app/.server/services/cart.ts` (+ tests) | Store and serve `/uploads/…` paths instead of Strapi-origin URLs |
| modify | `app/.server/services/cart-reminder-email.ts`, order email line photos (+ tests) | Make relative `/uploads/…` absolute with `PUBLIC_SITE_URL` |
| modify | `app/.server/security-headers.ts` (+ test) | `img-src 'self' data:`; drop `strapiOrigin` |
| modify | `docs/security.md` | CSP `img-src` and the uploads proxy |
| create | `docs/deploy.md` | Server setup, DNS, first deploy, Strapi tokens, updates, logs, backups/restore, cost |
| modify | `aspire-apphost/AGENTS.md` | Publish mode and production resources |
| modify | `AGENTS.md`, `docs/setup.md`, `README.md` | Production deploys through Aspire; cron examples point to `deploy/crontab` |

## Steps

- [x] **1. Add the Docker integration and confirm the API.** In the worktree, run
  `pnpm aspire add docker` and `pnpm aspire restore`. In `.aspire/modules/aspire.mts`, look up
  `addDockerComposeEnvironment`, the Compose options (dashboard off), how ports are published
  (`withHostPort` / `publishAsDockerComposeService`) and the pipeline step names for publish and
  push. Decide between the `deploy-ssh` pipeline step and the `scripts/deploy.mjs` fallback, and
  note the decision in this plan. Check: `pnpm aspire:build` passes.
- [x] **2. Dockerfiles and `.dockerignore`.**
  - Write `Dockerfile` with the `web` and `jobs` targets and `cms/Dockerfile`, as in Decision 2.
  - Use `--mount=type=cache` for the pnpm store, `pnpm install --frozen-lockfile`, and
    `CI=true` for non-interactive pnpm.
  - In `web`, run `pnpm prune --prod`, or reinstall with `--prod` into a clean stage.
  - Check: `docker build --target web -t jassmin-web .`,
    `docker build --target jobs -t jassmin-jobs .` and
    `docker build -f cms/Dockerfile -t jassmin-cms .` all succeed.
  - Check: `docker run --rm -e NODE_ENV=production ... jassmin-web` starts. With a local
    Postgres URL it answers `/`.
  - Check: `docker run --rm jassmin-jobs pnpm db:migrate --help` works.
- [x] **3. Small app and Strapi changes for production.**
  - `cms/config/server.ts`: add `url`/`proxy` (Decision 7).
  - **The `/uploads/*` proxy** (Decision 10):
    - write `media.ts` (`toMediaPath`), `uploads-proxy.ts` and the schema;
    - add the `uploads.$.ts` route to `app/routes.ts`;
    - switch `content.ts`, `cms.products.ts` and `product-image-backfill.ts` to `toMediaPath`,
      and normalize at read time in `services/products.ts` and `services/cart.ts`;
    - make email photos absolute with `PUBLIC_SITE_URL`;
    - narrow the CSP's `img-src` to `'self' data:`.
  - Before changing `CmsImage.url`, `grep` for every user of it (OG/meta tags, JSON-LD,
    product feeds, emails). Any that needs an absolute URL builds it from the site origin.
  - Update the affected tests (`content`, `home`, `blog`, `cms-sync`,
    `product-image-backfill`, `product-feed`, `security-headers`, the email tests) and add the
    new ones (see Testing).
  - Check by hand under `pnpm aspire run`: product, home and blog images load from
    `http://localhost:5173/uploads/…`, there are no CSP reports for images, and an image request
    shows the long `Cache-Control`. A second load gets a 304.
  - Check: `pnpm typecheck`, `pnpm lint` and `pnpm test` pass.
- [x] **4. `aspire-apphost/production.mts` and the publish branch in `apphost.mts`.**
  - Move the current run-mode declarations into `addDevelopmentResources(builder)`. They stay
    in `apphost.mts` with their statements unchanged.
  - Add the parameters (Decision 5), the Compose environment, the GHCR registry and the
    resources (Decision 3) with their environment (Decision 6). `postgres`, `web` and `cms`
    get no host ports; only `proxy` publishes 80/443.
  - Add the `deploy-ssh` step (Decision 4). Spawn `ssh`/`scp` with `stdio: "inherit"`, without a
    shell, the way `scripts/aspire.mjs` does.
  - Add `production.mts` to `tsconfig.apphost.json`'s `include`.
  - Check: `pnpm aspire:build` and `pnpm lint` pass.
- [ ] **5. Caddy, scheduler and backup files.**
  - `deploy/caddy/Caddyfile`:
    - a `{$SITE_DOMAIN}` block with `reverse_proxy web:3000` and `encode zstd gzip`, and a
      `www.{$SITE_DOMAIN}` redirect;
    - a `{$ADMIN_DOMAIN}` block with `reverse_proxy cms:1337`;
    - Caddy adds `X-Forwarded-For`, so `TRUSTED_PROXY_HOPS=1` is right.
  - `deploy/crontab` per Decision 8.
  - `deploy/pg-backup/backup.sh`:
    - reads `PGHOST`/`PGUSER`/`PGPASSWORD` from the environment;
    - writes `pg_dump -Fc` of each database to `/backups/<db>-<UTC date>.dump`;
    - runs `find /backups -name '*.dump' -mtime +7 -delete` and fails loudly (`set -euo
      pipefail`).
  - Check: `docker build` of both small images succeeds.
- [ ] **6. Verify run mode is unchanged.**
  - `pnpm aspire run`: the dashboard shows the same resources as on `main` (compare against a
    `main` checkout), and `web`, `cms`, `db-migrate` and `smtp4dev` come up.
  - No `proxy`, `scheduler` or `pg-backup` resource appears.
- [ ] **7. Verify the publish output.**
  - Run `pnpm aspire publish -o aspire-output`, then inspect `aspire-output/docker-compose.yaml`
    and `.env`.
  - The Compose file has no smtp4dev, `db-seed`, `cms-seed`, synth, dbt or Jupyter services.
  - Only `proxy` has `ports:`.
  - Every secret is `${…}`, with no literal values: `grep` the Compose file for each generated
    value.
  - Volumes exist for Postgres data, Strapi uploads and Caddy data. `web` depends on
    `db-migrate` with `service_completed_successfully`.
  - Smoke test: `docker compose up` with a throwaway `.env` and `SITE_DOMAIN=localhost`
    (Caddy's internal CA). Check that:
    - the site answers over `https://localhost`;
    - an image uploaded in Strapi shows on the site through `/uploads/…`;
    - the scheduler logs a job run;
    - `pg-backup` writes a dump when `backup.sh` is run by hand;
    - restoring that dump with the commands planned for `docs/deploy.md` works;
    - after `docker compose down` and `up`, the data and the upload are still there.
- [ ] **8. Write `docs/deploy.md`.** Cover:
  - **The server:** Hetzner Cloud CX23 on Ubuntu 24.04 with backups turned on (+20%), the SSH
    key, a firewall allowing only 22, 80 and 443, Docker Engine with the Compose plugin from
    Docker's apt repo, the `deploy` user, `PasswordAuthentication no`, and
    `mkdir -p /srv/jassmin/backups`.
  - **DNS:** A and AAAA records for the shop domain, `www` and `admin`.
  - **GHCR:** a token with `read:packages`, and `docker login ghcr.io` on the server; locally,
    `docker login ghcr.io` with `write:packages`.
  - **The first `pnpm aspire deploy`:** every parameter it asks for and what it means.
    Back up the deployment state (Q2).
  - **First Strapi admin:** create the admin user on `https://admin.<domain>/admin`, then the
    API tokens (the same permissions as `docs/setup.md`). Update the two token parameters and
    redeploy (Q5).
  - **One-time jobs:** `docker compose run --rm scheduler pnpm db:sync-cms -- --all`, and the
    one-off catalog imports with `docker compose run --rm scheduler pnpm db:…`.
  - **Brevo:** `SMTP_URL` and the webhook (link to `docs/email.md`).
  - **Day-to-day:**
    - updating is `pnpm aspire deploy`;
    - logs with `ssh … docker compose logs -f web|cms|scheduler`;
    - a reboot (`restart: unless-stopped` brings everything back).
  - **Backups and restore:** where the dumps are, copying one off the server, and restoring with
    `docker compose exec -T postgres pg_restore --clean --if-exists -d jassmindb < dump`,
    the same for `strapidb`, with `web`/`cms` stopped first. Also restoring a whole Hetzner
    snapshot.
  - **Monthly cost:** €5.99 + €1.20 backups, plus VAT, with 20 TB of traffic and IPv4 included.
- [ ] **9. Update the other docs.**
  - `aspire-apphost/AGENTS.md`: replace "local development only / production runs `pnpm build &&
    pnpm start`" with a publish-mode section listing the production resources and parameters.
  - Root `AGENTS.md` (Commands: `pnpm aspire deploy`).
  - `docs/setup.md`: point the cron examples at `deploy/crontab`, explain that images go through
    `/uploads/*`, and add the production section linking `docs/deploy.md`.
  - `docs/security.md`: the CSP's `img-src` is now `'self' data:`, and why.
  - `README.md`: a link to `docs/deploy.md`.
- [ ] **10. Final checks.**
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm aspire:build` pass.
  - The CI `cms` job still passes (`pnpm cms:build`).
  - There's no server yet (Q6), so the PR lists the server-only acceptance criteria as manual
    checks for the owner's first deploy.

## Testing & verification

- **Unit tests:**
  - `media.test.ts`: `toMediaPath` handles a relative `/uploads/a.jpg`, an absolute
    `http://localhost:1337/uploads/a.jpg`, `http://cms:1337/uploads/a.jpg`, a non-uploads
    `https://` URL (unchanged) and `null`.
  - `uploads-proxy.test.ts` (mocked `fetch`):
    - a 200 streams the body with the allowed headers and the long `Cache-Control`;
    - `Set-Cookie`/`Server` from Strapi are dropped;
    - `If-None-Match` is forwarded and a 304 is passed through;
    - a 404 is passed through;
    - a network error or timeout gives a 502;
    - `../`, encoded `%2e%2e`, empty segments and odd characters get a 404 without calling
      `fetch`.
  - `security-headers.test.ts`: `img-src` is `'self' data:`, with no Strapi origin.
  - `content`/`home`/`blog`/`cms-sync`/`product-image-backfill` tests: media URLs and stored
    `image_url`/`image_formats` are `/uploads/…`, while API fetches still use `STRAPI_URL`.
  - Email tests: a `/uploads/…` photo becomes `PUBLIC_SITE_URL` + path. `product-feed` still
    gives absolute image URLs.
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm aspire:build`,
  `pnpm cms:build`.
- **Local container checks** (steps 2, 5, 7): image builds, the publish output inspection, and
  the `docker compose up` smoke test on `localhost`.
- **Manual on the real server** (owner, at the first deploy following `docs/deploy.md`; there's
  no server yet, Q6):
  - HTTPS on both domains;
  - `nc -vz <ip> 5432` fails from outside;
  - a product edit and an upload survive `pnpm aspire deploy` and `sudo reboot`;
  - `docker compose logs scheduler` shows the 5-minute jobs;
  - a dump appears in `/srv/jassmin/backups` the next morning;
  - one restore into a scratch database (`createdb restore_test`, `pg_restore -d restore_test`).

## Acceptance criteria

- [ ] `pnpm aspire run` behaves exactly as before, and `pnpm aspire:build` passes — steps 4, 6, 10
- [ ] Publishing produces a Docker Compose deployment that contains no development resources and no secret values — steps 4, 7
- [ ] One deploy command builds, pushes and starts the site, Strapi and Postgres on a Hetzner server over SSH — steps 1, 2, 4, 8 (built and checked locally; the SSH run against a server is manual, Q6)
- [ ] The site is reachable over HTTPS on the shop's domain, Strapi admin on its own subdomain, and Postgres isn't reachable from the internet — steps 3, 4, 5, 7, 8 (checked on `localhost`; the real domain is manual, Q4/Q6)
- [ ] Data and Strapi uploads survive a redeploy and a server reboot — steps 4, 7, 8 (checked locally with `down`/`up`; the reboot is manual)
- [ ] The scheduled jobs run on their schedules (visible in the scheduler's logs) — steps 2, 5, 7
- [ ] A nightly database dump is created, and the restore steps in `docs/deploy.md` were tested once — steps 5, 7, 8 (restore tested locally against the smoke-test stack; on the server: manual)
- [ ] `docs/deploy.md` lets the owner set up a new server from scratch — step 8
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 10

## Out of scope

- The AI perfumer's model in production (#167): no `AI_*` variables are published.
- CI deploys on merge (`aspire do gh-action-dcenv`), a CDN and a staging server.
- Creating the server, DNS or SSH keys through the Hetzner API.
- A real payment provider: card payment stays off in production.
- Switching `CSP_MODE` to `enforce`: that's a separate decision after watching reports (see
  `docs/security.md`).
- Off-server backup copies (e.g. Hetzner Storage Box): the guide mentions them as an optional
  extra.
