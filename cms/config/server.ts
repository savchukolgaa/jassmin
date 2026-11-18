import type { Core } from "@strapi/strapi";
import { requireEnv } from "../src/utils/env";

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env("HOST", "0.0.0.0"),
  port: env.int("PORT", 1337),
  // Behind Caddy in production (#176): the admin's public URL (`https://admin.<domain>`) and
  // trusting the proxy's X-Forwarded-* headers, so links and secure cookies are right. Both are
  // unset in development.
  url: env("PUBLIC_URL", ""),
  proxy: { koa: env.bool("IS_PROXIED", false) },
  app: {
    keys: requireEnv("APP_KEYS", env.array("APP_KEYS")),
  },
  webhooks: {
    populateRelations: env.bool("WEBHOOKS_POPULATE_RELATIONS", false),
  },
});

export default config;
