import type { Core } from "@strapi/strapi";
import { requireEnv } from "../src/utils/env";

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env("HOST", "0.0.0.0"),
  port: env.int("PORT", 1337),
  app: {
    keys: requireEnv("APP_KEYS", env.array("APP_KEYS")),
  },
  webhooks: {
    populateRelations: env.bool("WEBHOOKS_POPULATE_RELATIONS", false),
  },
});

export default config;
