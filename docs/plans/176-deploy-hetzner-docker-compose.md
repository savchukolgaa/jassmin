# Plan: Deploy the shop from Aspire to a Hetzner server with Docker Compose (#176)

Issue: https://github.com/savchukolgaa/jassmin/issues/176
Branch: `issue/176`
Worktree: `.claude/worktrees/issue-176`
Status: Planned

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
   - Every built image is pushed to GHCR (`withContainerRegistry(ghcr)`). Caddy and Postgres
     aren't pushed: `pg-backup` and `proxy` are small and built on the server's Docker by the
     deploy step (Decision 4). **(unconfirmed: if Aspire pushes every `addDockerfile` image to
     the registry anyway, all five go to GHCR, which works just as well)**
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
     `app/.server/env.ts`) but missing from the issue's list. **(unconfirmed: Q2)**
6. **Environment wiring:**
   - `web`/`scheduler` get:
     - `NODE_ENV=production`, `JASSMINDB_URI` (from `withReference(db)`) and `SESSION_SECRET`;
     - `PUBLIC_SITE_URL=https://{site-domain}`, `TRUSTED_PROXY_HOPS=1` and `CSP_MODE=report-only`;
     - `STRAPI_URL=http://cms:1337`, `STRAPI_PUBLIC_URL=https://{admin-domain}` (Q1),
       `STRAPI_API_TOKEN`, `STRAPI_SYNC_TOKEN` and `CMS_SYNC_SECRET`;
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

## Open questions

- [ ] **Q1: Where should the browser load Strapi images from?** — Why it matters: `content.ts`
  resolves `/uploads/…` against `STRAPI_URL`, and `buildCsp` adds `STRAPI_URL`'s origin to
  `img-src`. In production the server should reach Strapi at `http://cms:1337`, but browsers
  can't. Recommended default: add an optional `STRAPI_PUBLIC_URL` to `env.ts` (default
  `STRAPI_URL`), used for media URLs and the CSP's `img-src`, with tests. The alternative is to
  set `STRAPI_URL=https://admin.<domain>`, so every server-side CMS request goes out to the
  internet and back through Caddy. Affects steps: 3, 5.
- [ ] **Q2: Should random secrets be generated by Aspire or typed in by the owner?** — Why it
  matters: generated values live only in Aspire's deployment state on the owner's PC. Losing it
  and redeploying would rotate `ENCRYPTION_KEY` (Strapi's encrypted tokens),
  `EMAIL_UNSUBSCRIBE_SECRET` (links in sent emails) and `SESSION_SECRET` (logs everyone out).
  Recommended default: generate them, and have `docs/deploy.md` tell the owner to back up the
  deployment state file to a password manager after the first deploy. Affects steps: 4, 8.
- [ ] **Q3: Should the GHCR images be private or public?** — Why it matters: private images need
  a `read:packages` token and `docker login ghcr.io` on the server. Public images show the built
  code, but no secrets. Recommended default: private, with the one-time login in
  `docs/deploy.md`. Affects steps: 4, 8.
- [ ] **Q4: What are the domains?** — Why it matters: Caddy, `PUBLIC_SITE_URL` and the docs need
  them. Recommended default: `jassmin.ua` and `admin.jassmin.ua` (`docs/email.md` already uses
  `jassmin.ua`), entered as parameters so nothing is hard-coded. Affects steps: 4, 8.
- [ ] **Q5: The Strapi API tokens exist only after Strapi is up.** — Why it matters: the first
  deploy asks for `strapi-api-token` and `strapi-sync-token` before they exist. Recommended
  default: on the first deploy the owner enters the placeholder `pending`. CMS pages answer 503
  and sync jobs fail until then (the same behaviour as a missing token). The guide then creates
  the tokens, updates the two parameters and runs `pnpm aspire deploy` again. Affects step: 8.
- [ ] **Q6: Should the server be tested for real in this issue?** — Why it matters: the
  acceptance criteria include HTTPS, a reboot, the scheduler logs and a tested restore. These
  need a paid server and DNS, which only the owner can provide. Recommended default: I verify
  everything up to `docker compose up` locally (the publish output, an image build, and a local
  `docker compose up` with a self-signed Caddy `localhost` site). The owner then runs the first
  real deploy following `docs/deploy.md`, and the PR lists those checks as manual. Affects
  steps: 9, 10.

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
| modify | `app/.server/env.ts`, `app/.server/cms/content.ts`, `app/.server/security-headers.ts` (+ tests) | `STRAPI_PUBLIC_URL` for media and CSP (Q1) |
| create | `docs/deploy.md` | Server setup, DNS, first deploy, Strapi tokens, updates, logs, backups/restore, cost |
| modify | `aspire-apphost/AGENTS.md` | Publish mode and production resources |
| modify | `AGENTS.md`, `docs/setup.md`, `README.md` | Production deploys through Aspire; cron examples point to `deploy/crontab` |

## Steps

- [ ] **1. Add the Docker integration and confirm the API.** In the worktree, run
  `pnpm aspire add docker` and `pnpm aspire restore`. In `.aspire/modules/aspire.mts`, look up
  `addDockerComposeEnvironment`, the Compose options (dashboard off), how ports are published
  (`withHostPort` / `publishAsDockerComposeService`) and the pipeline step names for publish and
  push. Decide between the `deploy-ssh` pipeline step and the `scripts/deploy.mjs` fallback, and
  note the decision in this plan. Check: `pnpm aspire:build` passes.
- [ ] **2. Dockerfiles and `.dockerignore`.**
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
- [ ] **3. Small app and Strapi changes for production.**
  - `cms/config/server.ts`: add `url`/`proxy` (Decision 7).
  - If Q1's default is kept, add `STRAPI_PUBLIC_URL` to `cmsSyncEnvSchema`'s neighbour in
    `envSchema`, falling back to `STRAPI_URL`. Use it in `content.ts` (wherever `baseUrl` is
    resolved for media) and in `security-headers.ts` (`strapiOrigin`).
  - Update `env.test.ts`, `security-headers.test.ts` and the affected `content`/`home`/`blog`
    tests. Document the variable in the `docs/setup.md` env table.
  - Check: `pnpm typecheck`, `pnpm lint` and `pnpm test` pass.
- [ ] **4. `aspire-apphost/production.mts` and the publish branch in `apphost.mts`.**
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
    (Caddy's internal CA). The site answers over `https://localhost`, the scheduler logs a job
    run, and `pg-backup` writes a dump when `backup.sh` is run by hand.
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
  - `docs/setup.md`: point the cron examples at `deploy/crontab`, and add `STRAPI_PUBLIC_URL`
    and the production section linking `docs/deploy.md`.
  - `README.md`: a link to `docs/deploy.md`.
- [ ] **10. Final checks.**
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm aspire:build` pass.
  - The CI `cms` job still passes (`pnpm cms:build`).
  - Mark the server-only acceptance criteria as manual checks for the owner's first deploy (Q6).

## Testing & verification

- **Unit tests:**
  - `env.test.ts`: `STRAPI_PUBLIC_URL` defaults to `STRAPI_URL`, and its trailing slash is
    stripped.
  - `security-headers.test.ts`: `img-src` uses the public origin.
  - The `content`/`home`/`blog` tests: media URLs use the public origin, while fetches still use
    `STRAPI_URL`.
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm aspire:build`,
  `pnpm cms:build`.
- **Local container checks** (steps 2, 5, 7): image builds, the publish output inspection, and
  the `docker compose up` smoke test on `localhost`.
- **Manual on the real server** (owner, following `docs/deploy.md`):
  - HTTPS on both domains;
  - `nc -vz <ip> 5432` fails from outside;
  - a product edit and an upload survive `pnpm aspire deploy` and `sudo reboot`;
  - `docker compose logs scheduler` shows the 5-minute jobs;
  - a dump appears in `/srv/jassmin/backups` the next morning;
  - one restore into a scratch database (`createdb restore_test`, `pg_restore -d restore_test`).

## Acceptance criteria

- [ ] `pnpm aspire run` behaves exactly as before, and `pnpm aspire:build` passes — steps 4, 6, 10
- [ ] Publishing produces a Docker Compose deployment that contains no development resources and no secret values — steps 4, 7
- [ ] One deploy command builds, pushes and starts the site, Strapi and Postgres on a Hetzner server over SSH — steps 1, 2, 4, 8
- [ ] The site is reachable over HTTPS on the shop's domain, Strapi admin on its own subdomain, and Postgres isn't reachable from the internet — steps 3, 4, 5, 8 (real server: manual, Q6)
- [ ] Data and Strapi uploads survive a redeploy and a server reboot — steps 4, 8 (manual)
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
