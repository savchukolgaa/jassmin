import type { Core } from "@strapi/strapi";
import { requireEnv } from "../src/utils/env";

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Admin => ({
  auth: {
    secret: requireEnv("ADMIN_JWT_SECRET", env("ADMIN_JWT_SECRET")),
  },
  apiToken: {
    salt: requireEnv("API_TOKEN_SALT", env("API_TOKEN_SALT")),
  },
  transfer: {
    token: {
      salt: requireEnv("TRANSFER_TOKEN_SALT", env("TRANSFER_TOKEN_SALT")),
    },
  },
  secrets: {
    encryptionKey: requireEnv("ENCRYPTION_KEY", env("ENCRYPTION_KEY")),
  },
  flags: {
    nps: env.bool("FLAG_NPS", false),
    promoteEE: env.bool("FLAG_PROMOTE_EE", false),
    docLinks: env.bool("FLAG_DOC_LINKS", true),
  },
});

export default config;
