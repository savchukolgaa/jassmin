// Aspire TypeScript AppHost: local development orchestration for Jassmin.
// `aspire run` starts PostgreSQL in a container, the Strapi CMS, smtp4dev and the React Router dev
// server. The app gets its database as JASSMINDB_URI, the CMS URL as STRAPI_URL and smtp4dev as
// SMTP_URL; Strapi gets its own `strapidb` database on the same server as DATABASE_URL, and the
// app's URL as JASSMIN_APP_URL (product and order edits write through to the app, #40).
// See https://aspire.dev

import { createBuilder } from "./.aspire/modules/aspire.mjs";

// Without a name the dashboard is titled after the AppHost folder ("aspire-apphost").
const builder = await createBuilder({ dashboardApplicationName: "Jassmin" });

const postgres = builder.addPostgres("postgres").withDataVolume();

// Shared secret Strapi sends to the app's `/cms/*` sync routes (#40). Generated once and kept
// in the AppHost's user secrets; both `cms` and `web` get it as CMS_SYNC_SECRET.
const cmsSyncSecret = builder.addParameterWithGeneratedValue(
  "cms-sync-secret",
  { minLength: 48, special: false },
  { secret: true, persist: true },
);
const db = postgres.addDatabase("jassmindb");
const strapiDb = postgres.addDatabase("strapidb");
// Synthetic shop data for the analytics work (#131): a separate database that the app never uses.
const synthDb = postgres.addDatabase("jassmin-synth", { databaseName: "jassmin_synth" });

// Applies pending app migrations (`pnpm db:migrate`) on every run; `web` starts only after it
// completes. It owns the root `pnpm install`, which also installs the cms workspace package,
// so every other resource here uses `withPnpm({ install: false })`.
const dbMigrate = builder
  .addJavaScriptApp("db-migrate", "..", { runScriptName: "db:migrate" })
  .withPnpm()
  .withReference(db)
  .waitFor(db)
  .withParentRelationship(db);

// One-off scripts against `jassmindb`, whose password only Aspire knows: seed the sample
// products (`pnpm db:seed`), roll back the latest migration (`pnpm db:rollback`) or mark
// inactive carts as abandoned (`pnpm db:mark-abandoned-carts`, hourly cron in production).
// Start them from the dashboard.
await builder
  .addJavaScriptApp("db-seed", "..", { runScriptName: "db:seed" })
  .withPnpm({ install: false })
  .withReference(db)
  .waitForCompletion(dbMigrate)
  .withParentRelationship(db)
  .withExplicitStart();

// Loads the owner's perfume range (#66); `db-sync-cms` then pushes the new products to Strapi.
await builder
  .addJavaScriptApp("db-import-catalog", "..", { runScriptName: "db:import-catalog" })
  .withPnpm({ install: false })
  .withReference(db)
  .waitForCompletion(dbMigrate)
  .withParentRelationship(db)
  .withExplicitStart();

// Puts every perfume on the standard sizes and prices once (#98); then start `db-sync-cms`.
await builder
  .addJavaScriptApp("db-apply-catalog-prices", "..", { runScriptName: "db:apply-catalog-prices" })
  .withPnpm({ install: false })
  .withReference(db)
  .waitForCompletion(dbMigrate)
  .withParentRelationship(db)
  .withExplicitStart();

await builder
  .addJavaScriptApp("db-rollback", "..", { runScriptName: "db:rollback" })
  .withPnpm({ install: false })
  .withReference(db)
  .waitFor(db)
  .withParentRelationship(db)
  .withExplicitStart();

await builder
  .addJavaScriptApp("db-mark-abandoned-carts", "..", { runScriptName: "db:mark-abandoned-carts" })
  .withPnpm({ install: false })
  .withReference(db)
  .waitForCompletion(dbMigrate)
  .withParentRelationship(db)
  .withExplicitStart();

// Cancels card orders still unpaid after UNPAID_ORDER_HOURS (#128, hourly cron in production);
// then start `db-sync-cms` to show them in Strapi.
await builder
  .addJavaScriptApp("db-cancel-unpaid-orders", "..", { runScriptName: "db:cancel-unpaid-orders" })
  .withPnpm({ install: false })
  .withReference(db)
  .waitForCompletion(dbMigrate)
  .withParentRelationship(db)
  .withExplicitStart();

// Marks gift cards past their 12 months as expired (#125, daily cron in production); then start
// `db-sync-cms` to show it in Strapi.
await builder
  .addJavaScriptApp("db-expire-gift-cards", "..", { runScriptName: "db:expire-gift-cards" })
  .withPnpm({ install: false })
  .withReference(db)
  .waitForCompletion(dbMigrate)
  .withParentRelationship(db)
  .withExplicitStart();

// Deletes ended rate-limit windows from `rate_limits` (#143, daily cron in production).
await builder
  .addJavaScriptApp("db-prune-rate-limits", "..", { runScriptName: "db:prune-rate-limits" })
  .withPnpm({ install: false })
  .withReference(db)
  .waitForCompletion(dbMigrate)
  .withParentRelationship(db)
  .withExplicitStart();

// Fills `jassmin_synth` with generated data (#131): `uv run analytics/generator/generate.py
// --load-app-schema` migrates it with the app's migrations (`pnpm db:migrate`, hence waiting for
// the root install of `db-migrate`) and loads `raw.*` and `public.*`. It gets only the synth
// database, never `jassmindb`, and refuses any other database name. Needs `uv` on the PATH.
await builder
  .addExecutable("synth-generate", "uv", "..", [
    "run",
    "analytics/generator/generate.py",
    "--load-app-schema",
  ])
  .withReference(synthDb)
  .withEnvironment("JASSMIN_SYNTH_URI", await synthDb.uriExpression())
  .waitFor(synthDb)
  .waitForCompletion(dbMigrate)
  .withParentRelationship(synthDb)
  .withExplicitStart();

// Strapi secrets (APP_KEYS, …) come from cms/.env; the variables set here take precedence.
const cms = builder
  .addJavaScriptApp("cms", "../cms", { runScriptName: "develop" })
  .withPnpm({ install: false })
  .withHttpEndpoint({ port: 1337, env: "PORT" })
  .withEnvironment("HOST", "0.0.0.0")
  .withEnvironment("DATABASE_CLIENT", "postgres")
  .withEnvironment("DATABASE_URL", await strapiDb.uriExpression())
  .withEnvironment("CMS_SYNC_SECRET", cmsSyncSecret)
  .withReference(strapiDb)
  .waitFor(strapiDb)
  .withHttpHealthCheck({ path: "/_health", statusCode: 204 })
  .withExternalHttpEndpoints();

// One-off seed (`pnpm cms:seed -- --token`) against the Aspire-managed `strapidb`, whose password
// only Aspire knows. Start it from the dashboard; the app's API token is printed in its logs.
await builder
  .addJavaScriptApp("cms-seed", "../cms", { runScriptName: "seed" })
  .withRunScript("seed", { args: ["--token"] })
  .withPnpm({ install: false })
  .withEnvironment("DATABASE_CLIENT", "postgres")
  .withEnvironment("DATABASE_URL", await strapiDb.uriExpression())
  .withReference(strapiDb)
  .waitFor(cms)
  .withParentRelationship(cms)
  .withExplicitStart();

// Fake SMTP server for local development: catches every email the app sends (contact form, order
// confirmations) and shows it in its web UI, so nothing reaches real inboxes.
const smtp4dev = builder
  .addContainer("smtp4dev", "rnwood/smtp4dev")
  .withImageTag("v3")
  .withHttpEndpoint({ targetPort: 80, name: "http" })
  .withEndpoint({ targetPort: 25, name: "smtp", scheme: "smtp" })
  .withExternalHttpEndpoints();

// Sends the queued order emails that are due (`pnpm db:send-order-emails`, every 5 minutes from
// cron in production), e.g. after smtp4dev was down at checkout. Start it from the dashboard.
await builder
  .addJavaScriptApp("db-send-order-emails", "..", { runScriptName: "db:send-order-emails" })
  .withPnpm({ install: false })
  .withReference(db)
  .withEnvironment("SMTP_URL", smtp4dev.getEndpoint("smtp"))
  .waitForCompletion(dbMigrate)
  .withParentRelationship(db)
  .withExplicitStart();

// Pushes queued order and stock changes to Strapi (`pnpm db:sync-cms`, #40; every 5 minutes from
// cron in production), e.g. after Strapi was down at checkout. `STRAPI_SYNC_TOKEN` comes from the
// root .env. Start it from the dashboard; run `pnpm db:sync-cms -- --all` once by hand to copy an
// existing catalog and its orders into a fresh Strapi.
await builder
  .addJavaScriptApp("db-sync-cms", "..", { runScriptName: "db:sync-cms" })
  .withPnpm({ install: false })
  .withReference(db)
  .withEnvironment("STRAPI_URL", cms.getEndpoint("http"))
  .waitForCompletion(dbMigrate)
  .waitFor(cms)
  .withParentRelationship(db)
  .withExplicitStart();

// Stores the size and resized formats of every product's Strapi image (`pnpm
// db:backfill-product-images`, #88), for products synced before #88. Start it once from the
// dashboard; Strapi edits keep them up to date afterwards.
await builder
  .addJavaScriptApp("db-backfill-product-images", "..", {
    runScriptName: "db:backfill-product-images",
  })
  .withPnpm({ install: false })
  .withReference(db)
  .withEnvironment("STRAPI_URL", cms.getEndpoint("http"))
  .waitForCompletion(dbMigrate)
  .waitFor(cms)
  .withParentRelationship(db)
  .withExplicitStart();

// `web` doesn't wait for `cms` or `smtp4dev`: the shop keeps working while either is down;
// CMS-backed pages answer with a 503 and the contact form shows a "couldn't send" error instead.
const web = builder
  .addViteApp("web", "..")
  .withPnpm({ install: false })
  .withReference(db)
  .waitFor(db)
  .waitForCompletion(dbMigrate)
  .withReference(cms)
  .withEnvironment("STRAPI_URL", cms.getEndpoint("http"))
  .withEnvironment("CMS_SYNC_SECRET", cmsSyncSecret)
  .withEnvironment("SMTP_URL", smtp4dev.getEndpoint("smtp"))
  .withExternalHttpEndpoints();

// Strapi calls the app before saving a product or order edit (#40). Set after `web` exists; `cms`
// doesn't wait for `web` (that would be a cycle), so an edit made while the app is down fails
// with a clear message in the Strapi admin.
await cms.withEnvironment("JASSMIN_APP_URL", web.getEndpoint("http"));
await web;

await builder.build().run();
