# Plan: Set up Strapi CMS for blog and site content and integrate it with the app (#20)

Issue: https://github.com/savchukolgaa/jassmin/issues/20
Branch: `issue/20`
Worktree: `../jassmin-worktrees/issue-20`
Status: Planned

## Goal
Store admins should be able to publish blog articles and edit home page copy and contact details without code changes, using Strapi instead of a custom CMS. This issue adds a Strapi v5 TypeScript project in `cms/` that runs under Aspire on its own `strapidb` database. It also gives the React Router app a typed, zod-validated, server-only client (`app/.server/cms/`) that loaders use to read published content as app-level DTOs.

## Dependencies & prerequisites
- **#1 (closed, merged in `8db031c`):** Aspire AppHost (`aspire-apphost/apphost.mts` with `postgres`, `jassmindb`, `web`), zod env in `app/.server/env.ts`, and the root `pnpm-workspace.yaml`. Everything this issue builds on exists.
- **#3 (open):** core schema. It already states that there is no `blog_posts` table, so there's nothing to remove here.
- **Consumers, not prerequisites:** #7 (home page) and #13 (blog routes) call the functions added here. #15 is closed (replaced by Strapi).
- **New packages:** `@strapi/strapi@^5`, `@strapi/plugin-users-permissions@^5` (default plugin), `pg`, `react`, `react-dom`, `react-router-dom@^6`, `styled-components@^6` (Strapi admin peer deps), all in `cms/package.json`. The app needs no new runtime dependency, because it uses `fetch` and zod.
- **pnpm build approvals:** Strapi pulls in native/postinstall packages (e.g. `@swc/core`, `sharp`, `@parcel/watcher`, `esbuild`). Add whichever ones `pnpm install` reports to `allowBuilds` in `pnpm-workspace.yaml`.
- **New env vars:** app: `STRAPI_URL`, `STRAPI_API_TOKEN`. CMS: `HOST`, `PORT`, `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`, `ENCRYPTION_KEY`, `DATABASE_CLIENT`, `DATABASE_URL`, `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`, `DATABASE_SSL`.

## Decisions & assumptions
- **Scaffold:** `pnpm dlx create-strapi@latest cms --typescript --no-run --skip-cloud --dbclient=postgres --use-pnpm --no-example --no-git-init`, then trim it: drop the generated SQLite config and the example content. `cms/` becomes a workspace package (`packages: ["cms"]` in `pnpm-workspace.yaml`, keeping the root `.` implicit) named `jassmin-cms`.
- **Isolation from app tooling:** add `cms` to `exclude` in the root `tsconfig.json`, since Strapi has its own `cms/tsconfig.json` and is compiled by `strapi build`. Exclude `cms/dist`, `cms/.strapi`, `cms/types/generated`, `cms/public/uploads`, `cms/.tmp` and `cms/database/migrations` from Biome. Biome does lint `cms/src` and `cms/config`. Vitest already only includes `app/**/*.test.ts`.
- **gitignore:** `cms/.env`, `cms/dist/`, `cms/.strapi/`, `cms/.tmp/`, `cms/public/uploads/*` (keep `.gitkeep`), `cms/node_modules/`. The generated `cms/types/generated/*.d.ts` **is committed**: Strapi regenerates it on `develop`, and committing it keeps the content model reviewable.
- **Database config:** `cms/config/database.ts` supports only `postgres` and prefers `DATABASE_URL` (`connection.connectionString`), falling back to the discrete `DATABASE_HOST/PORT/NAME/USERNAME/PASSWORD` variables for non-Aspire setups.
- **Aspire wiring** (method names checked against `aspire-apphost/.aspire/modules/aspire.mts`):
  ```ts
  const strapiDb = postgres.addDatabase("strapidb");
  const cms = builder
    .addJavaScriptApp("cms", "../cms", { runScriptName: "develop" })
    .withPnpm({ install: false })          // the root workspace install done by `web` covers cms
    .withHttpEndpoint({ port: 1337, env: "PORT" })
    .withEnvironment("HOST", "0.0.0.0")
    .withEnvironment("DATABASE_CLIENT", "postgres")
    .withEnvironment("DATABASE_URL", await strapiDb.uriExpression())
    .withReference(strapiDb)
    .waitFor(strapiDb)
    .withHttpHealthCheck({ path: "/_health" })
    .withExternalHttpEndpoints();
  // web: add .withReference(cms).withEnvironment("STRAPI_URL", cms.getEndpoint("http"))
  ```
  The Strapi secrets (`APP_KEYS` etc.) come from `cms/.env`. Strapi loads it itself, and the Aspire-injected variables win, the same way the app's `.env` works. Have `web` start without waiting for `cms`, so the shop still works when the CMS is down. CMS pages show a 503 instead.
- **`STRAPI_URL` fallback:** `parseEnv` uses `source.STRAPI_URL || source.CMS_HTTP` (empty strings count as unset, and the same goes for `STRAPI_API_TOKEN`). The variable names come from Aspire's `withReference(cms)` service discovery. Check which names Aspire actually injects (Aspire dashboard → `web` → Environment) and keep only those. The explicit `withEnvironment("STRAPI_URL", …)` is the main path, and the fallback mirrors `DATABASE_URL` → `JASSMINDB_URI`.
- **Required vs optional env (Q1):** `STRAPI_URL` gets a default of `http://localhost:1337`. `STRAPI_API_TOKEN` is optional in the schema. If it's missing, the CMS client throws `CmsError` with `kind: "not_configured"`, so the app still boots before the first Strapi admin and token exist.
- **Content type naming:** Strapi needs `singularName ≠ pluralName`, and single-type REST routes use the singular name. So:
  - `api::blog-post.blog-post`: singular `blog-post`, plural `blog-posts` → `/api/blog-posts`.
  - `api::home-page.home-page`: singular `home-page`, plural `home-pages` → `/api/home-page`.
  - `api::site-setting.site-setting`: singular `site-setting`, plural `site-settings`, display name **"Site settings"** → `/api/site-setting`.
- **Field details** beyond the issue: `content` and `about.body` use the `richtext` type (Markdown). `excerpt` is `text` with `maxLength: 300`. `coverImage`, `hero.image` and `seo.ogImage` are single media restricted to `images`. `socialLinks.platform` is an `enumeration` (`instagram`, `facebook`, `tiktok`, `telegram`, `viber`, `youtube`) (Q3). `location.openingHours` is `text`. `ctaHref`, `url` and `mapEmbedUrl` are required strings. `seo.metaTitle` is max 60 characters and `seo.metaDescription` max 160. Components are `home.hero`, `home.about`, `home.location`, `shared.seo` and `shared.social-link`. Only `blog-post` has Draft & Publish. The single types have it off, so saved = live.
- **Access:** Strapi v5 gives Public and Authenticated no permissions on new content types, so nothing needs revoking. A bootstrap check in `cms/src/index.ts` logs a warning if Public ever gains permissions on these three UIDs. The read-only token is a **custom** API token with exactly `api::blog-post.blog-post.find`, `api::blog-post.blog-post.findOne`, `api::home-page.home-page.find` and `api::site-setting.site-setting.find`.
- **Seed:** a TypeScript script `cms/scripts/seed.ts`, run with `pnpm cms:seed`. It boots Strapi programmatically (`compileStrapi()` + `createStrapi(appContext).load()`, as in Strapi's official seed examples) and uses the Document Service API (`strapi.documents(uid)`). It's idempotent: existing single types are left alone, and posts are matched by slug. It uploads 2 small images from `cms/scripts/seed-data/` through the upload plugin service. It creates the home page (hero "Order 3 Testers only for 499₴"), site settings, 2 published posts and 1 draft post (to show that drafts are never returned). With `--token`, it also creates the read-only API token and prints the access key once, and skips if a token named `jassmin-web` already exists (Q2). A script is preferred over a `strapi import` archive because it's diffable, reviewable and survives schema changes.
- **CMS client design** (`app/.server/cms/`):
  - `errors.ts`: `class CmsError extends Error` with `kind: "not_configured" | "unreachable" | "timeout" | "http" | "invalid_response"`, an optional `status` and `cause`. Also `isCmsError(e)` and `cmsUnavailable(error): never`, which throws `data({ message: "Content is temporarily unavailable" }, { status: 503 })` for `CmsError` and rethrows anything else.
  - `client.ts`: `cmsFetch<T>(path, query, schema: z.ZodType<T>, { signal? })`. It builds the URL from `getEnv().STRAPI_URL` + `/api/` + path, serializes nested Strapi query params (`populate[seo][populate][0]=ogImage`, `filters[slug][$eq]=…`, `pagination[page]`) with a tiny typed `toStrapiQuery()` helper (no `qs` dependency), always adds `status=published`, and sends `Authorization: Bearer …` and `Accept: application/json`. It uses `AbortSignal.timeout(CMS_TIMEOUT_MS = 5000)`. It maps network errors to `unreachable`, abort to `timeout`, non-2xx to `http` (keeping `status`, and the 404 case for single types too), and `schema.safeParse` failures to `invalid_response`. No `any`: `res.json()` is typed as `unknown`.
  - `schemas.ts`: zod schemas for Strapi v5's flattened response shape (`{ data, meta }`, `documentId`, no `attributes`): `strapiMedia`, `seoComponent`, `heroComponent`, `aboutComponent`, `locationComponent`, `socialLinkComponent`, `blogPostEntry`, `homePageEntry`, `siteSettingEntry`, `paginationMeta`, plus wrappers `singleResponse(schema)` and `collectionResponse(schema)`. Use `.loose()`-style tolerance of unknown keys (z.object strips by default), and treat nullable optional fields as `.nullable()`.
  - `content.ts`: `getHomePage()`, `getSiteSettings()`, `listBlogPosts({ page, pageSize })` (zod-validated input: `page ≥ 1`, `1 ≤ pageSize ≤ 50`, default 12; `sort=publishedAt:desc`) and `getBlogPostBySlug(slug)` (`filters[slug][$eq]`, `pagination[pageSize]=1`, returns `null` when `data` is empty). They use pure mappers `toHomePage`, `toSiteSettings`, `toBlogPostSummary`, `toBlogPost` and `toMedia(media, baseUrl)`. `toMedia` resolves relative `/uploads/…` URLs to absolute URLs with `new URL(url, STRAPI_URL)` and leaves already-absolute URLs alone. The mappers are exported for tests.
  - A missing single type (Strapi 404 on `/api/home-page`) is a `CmsError` (`http`, 404) → 503, because the page can't render without it. A missing blog post is `null` → the route throws 404.
- **DTOs** in `app/lib/cms.ts` (isomorphic, plain types): `CmsImage { url; alt; width; height }`, `Seo`, `HomePage { hero; about; location }`, `SiteSettings { phone; email; customerServiceHours; socialLinks: SocialLink[] }`, `SocialPlatform` (const array + union), `BlogPostSummary { slug; title; excerpt; coverImage; authorName; publishedAt: string (ISO) }`, `BlogPost = BlogPostSummary & { content: string; seo: Seo | null }` and `Paginated<T> { items; page; pageSize; pageCount; total }`. Dates are ISO strings so loader data serializes cleanly. `content` stays raw Markdown, and rendering and sanitizing it is #13's job.
- **Error display:** extend `ErrorBoundary` in `app/root.tsx` to show a "Content temporarily unavailable" message for status 503. To prove this end to end now, the placeholder `home` loader also loads `getHomePage()` and shows the hero headline, wrapped in `cmsUnavailable` (Q4). #7 replaces that page anyway.

### Implementation notes
- **Ignore rules:** the scaffold's `cms/.gitignore` already ignores `.env`, `dist`, `.strapi`, `.tmp`, `public/uploads/*` and `node_modules`, so the root `.gitignore` is unchanged. Biome additionally skips `cms/types/generated`, `cms/database/migrations`, `cms/dist` and `cms/.strapi`.
- **Scaffold trimming:** removed `@strapi/plugin-cloud`, the `deploy`/`upgrade` scripts, the Strapi boilerplate README and the `src/admin/*.example.*` files. `cms` keeps `typescript@^5`, because `strapi build` compiles with the TypeScript compiler API, which TypeScript 7 (the root's version) no longer ships.
- **pnpm build approvals:** `@swc/core: true` (it installs its native binary) and `core-js-pure: false` (its postinstall only prints a banner). `sharp` uses prebuilt optional packages and needs no approval.
- **No `!` assertions in Strapi config:** the scaffold's `env("…")!` calls fail Biome's `noNonNullAssertion`. They're replaced by `requireEnv()` in `cms/src/utils/env.ts`, which also fails fast with a readable message when a secret is missing.
- **Postgres only:** `cms/config/database.ts` drops the scaffold's MySQL/SQLite branches.
- **Seed:** runs with `tsx` (a `cms` dev dependency) and creates the token through `strapi.service("admin::api-token-content-api")`. The seed images (`hero.jpg`, `blog-cover.jpg`) are small generated JPEG placeholders.
- **CMS URL building:** `cmsFetch` resolves `api/<path>` relative to `STRAPI_URL` with a trailing slash, so a base URL with a path prefix keeps it. `listBlogPosts` throws a `RangeError` for out-of-range pagination, because that's a programmer error rather than a CMS outage. Routes (#13) validate `?page=` before calling it.
- **Drafts and the token:** Strapi's `find` permission lets the token request `?status=draft` too. Strapi has no published-only permission, so drafts are kept out by the client, which always sends `status=published`, rather than by the token. The README documents this.

## Resolved questions
- **Q1: Should `STRAPI_API_TOKEN` be required at startup?** No, it's optional. `STRAPI_URL` defaults to `http://localhost:1337`. A missing token gives `CmsError("not_configured")` → 503 on CMS-backed pages only, so the app boots before the first Strapi admin and token exist (source: user, 2026-10-22).
- **Q2: Should the seed also create the read-only API token?** Yes, with `pnpm cms:seed -- --token`. It prints the key once and skips if a token named `jassmin-web` already exists. The README also documents the manual admin-panel path (source: user, 2026-10-22).
- **Q3: Which social platforms should `socialLinks.platform` allow?** An enumeration: `instagram`, `facebook`, `tiktok`, `telegram`, `viber`, `youtube` (source: user, 2026-10-22).
- **Q4: Should the placeholder home page call the CMS in this issue?** Yes. A minimal hero headline goes on the current placeholder page so the 503 behaviour can be checked end to end, and #7 replaces it (source: user, 2026-10-22).
- **Does `blog_posts` need removing from the schema?** No. #3's body already says it has no `blog_posts` table, and `app/.server/db/schema.ts` on `main` has none (source: #3, `app/.server/db/schema.ts`).
- **How is the DB connection injected by Aspire?** As `<RESOURCE>_URI` (`JASSMINDB_URI` today). The database resource also exposes `uriExpression()` (`postgresql://{user}:{password}@{host}:{port}/{database}`), which maps straight to Strapi's `DATABASE_URL` (source: `app/.server/env.ts`, `aspire-apphost/.aspire/modules/aspire.mts` `PostgresDatabaseResource`).
- **Which AppHost API runs a non-Vite Node app?** `addJavaScriptApp(name, appDirectory, { runScriptName })`, plus `withPnpm({ install })`, `withHttpEndpoint({ port, env })`, `withEnvironment(name, value | ReferenceExpression | EndpointReference)`, `getEndpoint("http")` and `withHttpHealthCheck` (source: `aspire-apphost/.aspire/modules/aspire.mts`).
- **Is the AppHost part of the root workspace?** No, it's a standalone package with its own lockfile. So adding `cms` to `pnpm-workspace.yaml` doesn't affect it (source: `aspire-apphost/AGENTS.md`).
- **Where do shared DTO types go?** `app/lib/`, which is isomorphic with no server imports (source: `AGENTS.md`).
- **How should new env vars be added?** Extend `envSchema`, `.env.example`, the README table and `env.test.ts` (source: `app/.server/AGENTS.md`).
- **Are Public/Authenticated permissions granted automatically?** No. Strapi v5 adds new content types with no role permissions, so unauthenticated requests get 403 by default. The bootstrap check guards against regressions (source: Strapi v5 Users & Permissions behaviour).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | `cms/` (package.json, tsconfig.json, config/*.ts, src/index.ts, src/admin/, public/uploads/.gitkeep, favicon) | Strapi v5 TypeScript project |
| create | `cms/.env.example` | Strapi secrets + `DATABASE_*` |
| create | `cms/config/database.ts` | Postgres config from `DATABASE_URL` or `DATABASE_*` |
| create | `cms/src/api/blog-post/**` | collection type schema, controller, route, service |
| create | `cms/src/api/home-page/**` | single type |
| create | `cms/src/api/site-setting/**` | single type ("Site settings") |
| create | `cms/src/components/home/{hero,about,location}.json` | home page components |
| create | `cms/src/components/shared/{seo,social-link}.json` | shared components |
| create | `cms/types/generated/{contentTypes,components}.d.ts` | committed Strapi typings |
| create | `cms/scripts/seed.ts`, `cms/scripts/seed-data/*` | idempotent seed + images |
| modify | `pnpm-workspace.yaml` | add `packages: [cms]`, `allowBuilds` for Strapi deps |
| modify | `package.json` | `cms:dev`, `cms:build`, `cms:seed` scripts |
| modify | `tsconfig.json`, `biome.json`, `.gitignore` | keep CMS out of app typecheck, ignore generated/build output |
| modify | `aspire-apphost/apphost.mts` | `strapidb`, `cms` resource, `web` → `cms` reference |
| modify | `aspire-apphost/AGENTS.md` | document the new resources |
| modify | `app/.server/env.ts`, `app/.server/env.test.ts` | `STRAPI_URL` (+ Aspire fallback), `STRAPI_API_TOKEN` |
| modify | `.env.example` | new app vars |
| create | `app/lib/cms.ts` | DTO types |
| create | `app/.server/cms/errors.ts` | `CmsError`, `cmsUnavailable` |
| create | `app/.server/cms/schemas.ts` | zod schemas for Strapi responses |
| create | `app/.server/cms/client.ts` | `cmsFetch` + `toStrapiQuery` |
| create | `app/.server/cms/content.ts` | `getHomePage`, `getSiteSettings`, `listBlogPosts`, `getBlogPostBySlug` + mappers |
| create | `app/.server/cms/__fixtures__/*.json` | recorded Strapi responses |
| create | `app/.server/cms/{schemas,client,content}.test.ts` | unit tests |
| modify | `app/.server/AGENTS.md` | CMS client rules |
| modify | `app/root.tsx` | 503 message in `ErrorBoundary` |
| modify | `app/routes/home.tsx` | show CMS hero headline (Q4) |
| modify | `README.md` | Strapi section, env table, scripts, structure |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [x] **1. Prepare the worktree.** Run `pnpm install` and copy `.env` from the main checkout. Check that `pnpm typecheck && pnpm lint && pnpm test` passes on a clean base.
- [x] **2. Scaffold Strapi in `cms/`.** Run `create-strapi` (see Decisions) and set `"name": "jassmin-cms"` and `engines.node` to match the root. Add `cms` to `pnpm-workspace.yaml` and run `pnpm install`, adding the build approvals pnpm asks for to `allowBuilds`. Add root scripts `cms:dev` (`pnpm --filter jassmin-cms develop`), `cms:build` (`pnpm --filter jassmin-cms build`) and `cms:seed` (`pnpm --filter jassmin-cms seed`). Update `tsconfig.json` `exclude`, `biome.json` `files.includes` and `.gitignore`. Check: `pnpm typecheck` and `pnpm lint` still pass, and `pnpm cms:build` builds the admin.
- [x] **3. Configure the database and env.** Write `cms/config/database.ts` (Postgres only, `DATABASE_URL` first, then `DATABASE_*`, optional `DATABASE_SSL`) and `cms/.env.example` with all secrets (placeholder values, plus a note on generating them with `node -e "console.log(require('crypto').randomBytes(16).toString('base64'))"`) and the `DATABASE_*` variables. Keep `server.ts` reading `HOST`/`PORT`. Check: with a local Postgres, `pnpm cms:dev` starts and serves `/admin`.
- [x] **4. Add the content types and components.** Create the schema JSON plus the default `factories.createCoreController/Router/Service` files for `blog-post`, `home-page` and `site-setting`, and the five component JSONs, with the fields, constraints and options in Decisions (the `slug` uid has `targetField: "title"`, `required`, and is unique by definition, and `blog-post` has `draftAndPublish: true`). Run `strapi develop` once to regenerate `cms/types/generated/*.d.ts` and commit them. Check: the admin's Content-Type Builder shows all types and fields exactly as listed.
- [x] **5. Lock down access.** In `cms/src/index.ts` `bootstrap`, query `plugin::users-permissions.permission` for the Public and Authenticated roles and log a warning if any action on the three UIDs is enabled. Check: `curl -i http://localhost:1337/api/blog-posts` and `/api/home-page` return 403 with no token.
- [x] **6. Write the seed script.** Create `cms/scripts/seed.ts` and add a `"seed": "tsx scripts/seed.ts"` script (with `tsx` as a dev dependency) or use Strapi's `strapi console`-compatible approach. Boot with `compileStrapi`/`createStrapi`. Upload the seed images, create the home page and site settings if they're missing, upsert 2 published posts plus 1 draft by slug (`strapi.documents("api::blog-post.blog-post").create({ data, status: "published" })`), and with `--token` create the custom API token with the 4 permissions (Q2). Always call `strapi.destroy()`. Check: running it twice gives the same data, and the admin shows 2 published and 1 draft post.
- [ ] **7. Wire Aspire.** In `apphost.mts`, add `strapidb` and the `cms` resource as in Decisions, and give `web` `.withReference(cms)` + `.withEnvironment("STRAPI_URL", cms.getEndpoint("http"))` (keeping `waitFor(db)` only). Update the header comment and `aspire-apphost/AGENTS.md`. Check: `pnpm aspire:build` passes, and `pnpm aspire run` shows `postgres`, `jassmindb`, `strapidb`, `cms` and `web` as healthy. The `web` env contains `STRAPI_URL`, and the Strapi tables are in `strapidb`, not `jassmindb`.
- [x] **8. Add app env and DTO types.** Extend `envSchema` with `STRAPI_URL: z.url().default("http://localhost:1337")` and `STRAPI_API_TOKEN: z.string().min(1).optional()` (Q1), with the Aspire fallback in `parseEnv` and its doc comment. Add both to `.env.example`. Add `env.test.ts` cases for the default, the explicit value, the Aspire fallback, precedence, and rejecting an invalid URL (also update the first test's `toEqual`). Create `app/lib/cms.ts` with the DTO types. Check: `pnpm typecheck && pnpm test`.
- [x] **9. Build the CMS client.** Write `errors.ts`, `schemas.ts`, `client.ts` and `content.ts` as described in Decisions. Record fixtures from the running seeded Strapi (`curl -H "Authorization: Bearer $TOKEN" ...` for home page, site settings, the blog list page 1 and a single post, plus an empty list) into `app/.server/cms/__fixtures__/`. Extend `root.tsx` `ErrorBoundary` for 503 and update the placeholder `home.tsx` loader to `Promise.all([getDatabaseInfo(), getHomePage().catch(cmsUnavailable)])` and render `hero.headline` (Q4). Add the CMS section to `app/.server/AGENTS.md`: always go through `content.ts`, never return raw Strapi shapes, and wrap loader calls with `cmsUnavailable`. Check: with Strapi up the headline renders, and with Strapi stopped `/` shows the 503 page and the server keeps running.
- [ ] **10. Write the unit tests.** Use these files:
  - `schemas.test.ts`: every fixture parses. A missing required field, a wrong type, or a v4-style `attributes` wrapper fails.
  - `content.test.ts`: the mappers produce the expected DTOs. Relative media URLs become absolute and absolute ones are unchanged. Null `coverImage`/`seo` is handled. Pagination meta maps to `Paginated`. `listBlogPosts` rejects `page: 0` and `pageSize: 500`.
  - `client.test.ts` (with `vi.stubGlobal("fetch", …)` and `vi.useFakeTimers` where useful): the request URL contains `status=published`, `populate`, `sort=publishedAt:desc` and an encoded slug filter, plus the `Authorization` header. `getBlogPostBySlug` returns `null` for an empty `data`. Network failures, timeouts, 500s, 404s on single types and malformed JSON or schema mismatches throw `CmsError` with the right `kind`. A missing token throws `not_configured`. `cmsUnavailable` turns `CmsError` into a 503 and rethrows other errors.

  Use `vi.resetModules()` + env stubs so `getEnv()` is re-evaluated. Check: `pnpm test`.
- [ ] **11. Write the docs.** Add a README section "Content (Strapi CMS)" that covers:
  - running Strapi through Aspire and standalone (`pnpm cms:dev`)
  - copying `cms/.env.example` and generating secrets
  - creating the first Strapi admin at `/admin` (separate from Jassmin accounts)
  - creating the read-only API token (Settings → API Tokens → Custom → the 4 permissions → copy into `STRAPI_API_TOKEN`), or `pnpm cms:seed -- --token`
  - running the seed
  - a content-model table (types, fields, components, Draft & Publish)
  - media stored in `cms/public/uploads`

  Also update the env var table, the scripts table and the project structure. Check: follow the README from scratch in a fresh worktree.
- [ ] **12. Final verification.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm aspire:build` and `pnpm cms:build`, then do the manual checks below. Set the plan status to "Implemented".

## Testing & verification
- **Automated:**
  - `app/.server/env.test.ts`: the new env cases.
  - `app/.server/cms/schemas.test.ts`, `content.test.ts` and `client.test.ts`, using the recorded fixtures and a stubbed `fetch`.
  - No integration test needs a running Strapi. Optionally add one gated by `describe.skipIf(!process.env.STRAPI_API_TOKEN)`, the same pattern as `health.test.ts`.
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm aspire:build`, `pnpm cms:build`.
- **Manual:**
  1. `pnpm aspire run`: all resources are healthy, `web` has `STRAPI_URL` in the dashboard, and `strapidb` has the Strapi tables.
  2. Create an admin and run `pnpm cms:seed -- --token`. Put the token in `.env` and restart `web`.
  3. Requests to `/api/blog-posts`, `/api/home-page` and `/api/site-setting` without a token return 403. With the token, GET works. With the token, `POST /api/blog-posts` and `GET /api/users` return 403.
  4. `/` shows the CMS headline. After stopping `cms` in the dashboard, `/` shows the 503 page and the server keeps running.
  5. The draft post is not returned by `listBlogPosts` or `getBlogPostBySlug` (check via the client test and a quick `curl` with `status=published`).

## Acceptance criteria
- [ ] `aspire run` starts PostgreSQL, Strapi (on its own `strapidb` database) and the web app, and the app receives the Strapi URL — steps 3, 7, 8
- [ ] The Strapi admin panel shows the `blog-post`, `home-page` and `site-settings` content types with the fields listed above, and their schemas are committed — step 4
- [ ] Unauthenticated requests to the Strapi content API are rejected, and the app's read-only token can only read these three types — steps 5, 6, 11
- [ ] The seed creates home page content, site settings and at least one published blog post — step 6
- [ ] `getHomePage`, `getSiteSettings`, `listBlogPosts` and `getBlogPostBySlug` return typed, zod-validated DTOs, and draft posts are never returned — steps 8, 9, 10
- [ ] When Strapi is down or returns an unexpected response, the app shows a 503 error, not a crash — steps 9, 10
- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass — steps 2, 8, 10, 12
- [ ] The README documents the Strapi setup and the content model — step 11

## Out of scope
- The real home page sections (#7), and the blog listing/article routes with Markdown rendering and sanitizing (#13).
- A production upload provider, and hosting or deploying Strapi.
- Live preview, webhook-based cache invalidation, and response caching / `Cache-Control` headers (#13 may add the headers).
- i18n/localized content in Strapi.
- Any change to Jassmin's own users/admin auth (#9, #14). Strapi admin accounts stay separate.
