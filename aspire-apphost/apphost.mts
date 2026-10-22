// Aspire TypeScript AppHost: local development orchestration for Jassmin.
// `aspire run` starts PostgreSQL in a container, the Strapi CMS and the React Router dev server.
// The app gets its database as JASSMINDB_URI and the CMS URL as STRAPI_URL; Strapi gets its own
// `strapidb` database on the same server as DATABASE_URL.
// See https://aspire.dev

import { createBuilder } from "./.aspire/modules/aspire.mjs";

const builder = await createBuilder();

const postgres = builder.addPostgres("postgres").withDataVolume();
const db = postgres.addDatabase("jassmindb");
const strapiDb = postgres.addDatabase("strapidb");

// Strapi secrets (APP_KEYS, …) come from cms/.env; the variables set here take precedence.
// The root `pnpm install` run for `web` also installs the cms workspace package.
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

// `web` doesn't wait for `cms`: the shop keeps working while the CMS is down,
// and CMS-backed pages answer with a 503 instead.
await builder
  .addViteApp("web", "..")
  .withPnpm()
  .withReference(db)
  .waitFor(db)
  .withReference(cms)
  .withEnvironment("STRAPI_URL", cms.getEndpoint("http"))
  .withExternalHttpEndpoints();

await builder.build().run();
