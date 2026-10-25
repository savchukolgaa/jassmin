// Aspire TypeScript AppHost: local development orchestration for Jassmin.
// `aspire run` starts PostgreSQL in a container, the Strapi CMS, smtp4dev and the React Router dev
// server. The app gets its database as JASSMINDB_URI, the CMS URL as STRAPI_URL and smtp4dev as
// SMTP_URL; Strapi gets its own `strapidb` database on the same server as DATABASE_URL.
// See https://aspire.dev

import { createBuilder } from "./.aspire/modules/aspire.mjs";

const builder = await createBuilder();

const postgres = builder.addPostgres("postgres").withDataVolume();
const db = postgres.addDatabase("jassmindb");
const strapiDb = postgres.addDatabase("strapidb");

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

// Strapi secrets (APP_KEYS, …) come from cms/.env; the variables set here take precedence.
const cms = builder
  .addJavaScriptApp("cms", "../cms", { runScriptName: "develop" })
  .withPnpm({ install: false })
  .withHttpEndpoint({ port: 1337, env: "PORT" })
  .withEnvironment("HOST", "0.0.0.0")
  .withEnvironment("DATABASE_CLIENT", "postgres")
  .withEnvironment("DATABASE_URL", await strapiDb.uriExpression())
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

// `web` doesn't wait for `cms` or `smtp4dev`: the shop keeps working while either is down;
// CMS-backed pages answer with a 503 and the contact form shows a "couldn't send" error instead.
await builder
  .addViteApp("web", "..")
  .withPnpm({ install: false })
  .withReference(db)
  .waitFor(db)
  .waitForCompletion(dbMigrate)
  .withReference(cms)
  .withEnvironment("STRAPI_URL", cms.getEndpoint("http"))
  .withEnvironment("SMTP_URL", smtp4dev.getEndpoint("smtp"))
  .withExternalHttpEndpoints();

await builder.build().run();
