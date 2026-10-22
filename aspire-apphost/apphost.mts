// Aspire TypeScript AppHost: local development orchestration for Jassmin.
// `aspire run` starts PostgreSQL in a container and the React Router dev server,
// and injects the database connection into the app as JASSMINDB_URI.
// See https://aspire.dev

import { createBuilder } from "./.aspire/modules/aspire.mjs";

const builder = await createBuilder();

const postgres = builder.addPostgres("postgres").withDataVolume();
const db = postgres.addDatabase("jassmindb");

await builder
  .addViteApp("web", "..")
  .withPnpm()
  .withReference(db)
  .waitFor(db)
  .withExternalHttpEndpoints();

await builder.build().run();
