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

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await warnAboutPublicAccess(strapi);
  },
};
