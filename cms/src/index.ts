import type { Core } from "@strapi/strapi";

/** Content types the Jassmin app reads with its read-only API token, never publicly. */
const PROTECTED_UIDS = [
  "api::blog-post.blog-post",
  "api::home-page.home-page",
  "api::site-setting.site-setting",
];

interface RoleWithPermissions {
  type: string;
  permissions?: { action: string }[];
}

/**
 * Warns when the Public or Authenticated role has been granted any action on the protected
 * content types. Strapi gives new content types no role permissions, so this only fires after
 * someone enables them in Settings → Users & Permissions.
 */
async function warnAboutPublicAccess(strapi: Core.Strapi): Promise<void> {
  const roles: RoleWithPermissions[] = await strapi.db
    .query("plugin::users-permissions.role")
    .findMany({ where: { type: { $in: ["public", "authenticated"] } }, populate: ["permissions"] });

  for (const role of roles) {
    const leaked = (role.permissions ?? [])
      .map((permission) => permission.action)
      .filter((action) => PROTECTED_UIDS.some((uid) => action.startsWith(`${uid}.`)));

    if (leaked.length > 0) {
      strapi.log.warn(
        `The ${role.type} role can access Jassmin content without the API token: ${leaked.join(", ")}. ` +
          "Remove these permissions in Settings → Users & Permissions → Roles.",
      );
    }
  }
}

/** Content locales, matching the app's `LOCALES` (`app/lib/i18n/locales.ts`). The first is the default. */
const LOCALES = [
  { code: "uk", name: "Ukrainian (uk)" },
  { code: "en", name: "English (en)" },
] as const;

interface LocalesService {
  findByCode(code: string): Promise<unknown>;
  create(locale: { code: string; name: string }): Promise<unknown>;
  getDefaultLocale(): Promise<string | null | undefined>;
  setDefaultLocale(locale: { code: string }): Promise<unknown>;
}

/**
 * Creates the `uk` and `en` locales when they're missing and makes `uk` the default, so a fresh
 * setup has them without clicking in the admin. Existing databases get `uk` from the migration in
 * `database/migrations/`, which must run before i18n tags existing content.
 */
async function ensureLocales(strapi: Core.Strapi): Promise<void> {
  const locales = strapi.plugin("i18n").service("locales") as LocalesService;

  for (const locale of LOCALES) {
    if (!(await locales.findByCode(locale.code))) {
      await locales.create(locale);
      strapi.log.info(`Created the ${locale.name} locale`);
    }
  }

  const [defaultLocale] = LOCALES;
  if ((await locales.getDefaultLocale()) !== defaultLocale.code) {
    await locales.setDefaultLocale({ code: defaultLocale.code });
    strapi.log.info(`Made ${defaultLocale.name} the default locale`);
  }
}

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureLocales(strapi);
    await warnAboutPublicAccess(strapi);
  },
};
