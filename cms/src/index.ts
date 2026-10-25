import type { Core } from "@strapi/strapi";
import { createSyncMiddleware, ORDER_UID, PRODUCT_UID } from "./sync/middleware";

/**
 * Content types the Jassmin app reads with its read-only API token (or writes with its sync
 * token, #40), never publicly.
 */
const PROTECTED_UIDS = [
  "api::blog-post.blog-post",
  "api::home-page.home-page",
  "api::offer.offer",
  "api::site-setting.site-setting",
  PRODUCT_UID,
  ORDER_UID,
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

/** The only order fields staff change; the shop owns the rest (#40). */
const EDITABLE_ORDER_FIELDS = new Set(["orderStatus", "paymentStatus"]);

interface EditMetadata {
  edit?: { editable?: boolean };
}

interface ContentTypesService {
  findConfiguration(contentType: unknown): Promise<{
    settings?: unknown;
    layouts?: unknown;
    metadatas?: Record<string, EditMetadata>;
  }>;
  updateConfiguration(contentType: unknown, configuration: unknown): Promise<unknown>;
}

/**
 * Makes every order field except the statuses read-only in the order's edit view. Only a hint
 * for staff: the sync middleware replaces whatever the form sends with the shop's values.
 */
async function lockOrderFields(strapi: Core.Strapi): Promise<void> {
  try {
    const service = strapi
      .plugin("content-manager")
      .service("content-types") as ContentTypesService;
    const contentType = strapi.contentType(ORDER_UID);
    const configuration = await service.findConfiguration(contentType);
    const metadatas = configuration.metadatas ?? {};
    let changed = false;
    for (const [field, metadata] of Object.entries(metadatas)) {
      const editable = EDITABLE_ORDER_FIELDS.has(field);
      if (metadata.edit && metadata.edit.editable !== editable) {
        metadata.edit.editable = editable;
        changed = true;
      }
    }
    if (changed) {
      await service.updateConfiguration(contentType, {
        settings: configuration.settings,
        layouts: configuration.layouts,
        metadatas,
      });
    }
  } catch (error) {
    strapi.log.warn(`Could not make the order fields read-only: ${String(error)}`);
  }
}

export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    // Product and order edits made in the admin write through to the shop's database (#40).
    strapi.documents.use(createSyncMiddleware(strapi));
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureLocales(strapi);
    await warnAboutPublicAccess(strapi);
    await lockOrderFields(strapi);
  },
};
