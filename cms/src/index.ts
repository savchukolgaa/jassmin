import type { Core } from "@strapi/strapi";
import { createSyncMiddleware, GIFT_CARD_UID, ORDER_UID, PRODUCT_UID } from "./sync/middleware";

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
  GIFT_CARD_UID,
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

/** The only order fields staff change; the shop owns the rest (#40). The reason goes with a cancel (#128). */
const EDITABLE_ORDER_FIELDS = new Set(["orderStatus", "paymentStatus", "cancelReason"]);

interface EditMetadata {
  edit?: { editable?: boolean; label?: string; description?: string };
}

/** The content-manager's `content-types` and `components` services share these two methods. */
interface ConfigurationService {
  findConfiguration(model: unknown): Promise<{
    settings?: unknown;
    layouts?: unknown;
    metadatas?: Record<string, EditMetadata>;
  }>;
  updateConfiguration(model: unknown, configuration: unknown): Promise<unknown>;
}

type ModelKind = "content-types" | "components";

/**
 * Lets `change` adjust each field's edit-view metadata of a content type or component, and saves
 * the configuration only when it reports a change. `change` returns whether it changed anything.
 */
async function updateEditMetadata(
  strapi: Core.Strapi,
  kind: ModelKind,
  uid: string,
  change: (field: string, edit: NonNullable<EditMetadata["edit"]>) => boolean,
): Promise<void> {
  const service = strapi.plugin("content-manager").service(kind) as ConfigurationService;
  const model =
    kind === "components"
      ? strapi.components[uid as keyof typeof strapi.components]
      : strapi.contentType(uid as Parameters<typeof strapi.contentType>[0]);
  const configuration = await service.findConfiguration(model);
  const metadatas = configuration.metadatas ?? {};
  let changed = false;
  for (const [field, metadata] of Object.entries(metadatas)) {
    if (metadata.edit && change(field, metadata.edit)) {
      changed = true;
    }
  }
  if (changed) {
    await service.updateConfiguration(model, {
      settings: configuration.settings,
      layouts: configuration.layouts,
      metadatas,
    });
  }
}

/**
 * Makes every order field except the statuses read-only in the order's edit view. Only a hint
 * for staff: the sync middleware replaces whatever the form sends with the shop's values.
 */
async function lockOrderFields(strapi: Core.Strapi): Promise<void> {
  try {
    await updateEditMetadata(strapi, "content-types", ORDER_UID, (field, edit) => {
      const editable = EDITABLE_ORDER_FIELDS.has(field);
      if (edit.editable === editable) {
        return false;
      }
      edit.editable = editable;
      return true;
    });
  } catch (error) {
    strapi.log.warn(`Could not make the order fields read-only: ${String(error)}`);
  }
}

/**
 * Makes every gift card field read-only in its edit view (#125). Only a hint for staff: the sync
 * middleware refuses every admin save of a gift card.
 */
async function lockGiftCardFields(strapi: Core.Strapi): Promise<void> {
  try {
    await updateEditMetadata(strapi, "content-types", GIFT_CARD_UID, (_field, edit) => {
      if (edit.editable === false) {
        return false;
      }
      edit.editable = false;
      return true;
    });
  } catch (error) {
    strapi.log.warn(`Could not make the gift card fields read-only: ${String(error)}`);
  }
}

interface FieldHint {
  label: string;
  description: string;
}

const SHARED_IMAGE = "Спільне для всіх мов. Його замінює зображення для цієї мови, якщо воно є.";
const LOCALIZED_IMAGE =
  "Лише для цієї мови: замінює спільне зображення. Порожнє — показуємо спільне.";
const IMAGE_ALT =
  "Опис зображення для цієї мови (для незрячих і пошуковиків), і для спільного, і для власного.";

/**
 * Image slots follow the `<name>` (shared) / `<name>Localized` (this language) / `<name>Alt`
 * convention (#80, `app/.server/AGENTS.md`). These hints tell staff which is which.
 */
const IMAGE_FIELD_HINTS: { kind: ModelKind; uid: string; fields: Record<string, FieldHint> }[] = [
  {
    kind: "content-types",
    uid: "api::home-page.home-page",
    fields: {
      heroImage: { label: "Головне фото (усі мови)", description: SHARED_IMAGE },
      aboutImage: { label: "Фото «Про нас» (усі мови)", description: SHARED_IMAGE },
    },
  },
  {
    kind: "components",
    uid: "home.hero",
    fields: {
      imageLocalized: { label: "Головне фото (ця мова)", description: LOCALIZED_IMAGE },
      imageAlt: { label: "Опис головного фото", description: IMAGE_ALT },
    },
  },
  {
    kind: "components",
    uid: "home.about",
    fields: {
      imageLocalized: { label: "Фото «Про нас» (ця мова)", description: LOCALIZED_IMAGE },
      imageAlt: { label: "Опис фото «Про нас»", description: IMAGE_ALT },
    },
  },
  {
    kind: "content-types",
    uid: "api::offer.offer",
    fields: {
      image: { label: "Зображення (усі мови)", description: SHARED_IMAGE },
      imageLocalized: { label: "Зображення (ця мова)", description: LOCALIZED_IMAGE },
      imageAlt: { label: "Опис зображення", description: IMAGE_ALT },
    },
  },
  {
    kind: "content-types",
    uid: "api::blog-post.blog-post",
    fields: {
      coverImage: { label: "Обкладинка (усі мови)", description: SHARED_IMAGE },
      coverImageLocalized: { label: "Обкладинка (ця мова)", description: LOCALIZED_IMAGE },
      coverImageAlt: { label: "Опис обкладинки", description: IMAGE_ALT },
    },
  },
];

/**
 * Products aren't localized (#40), so each language of the description has its own field (#100).
 * These hints tell staff which is which.
 */
const PRODUCT_FIELD_HINTS: { kind: ModelKind; uid: string; fields: Record<string, FieldHint> }[] = [
  {
    kind: "content-types",
    uid: "api::product.product",
    fields: {
      description: {
        label: "Опис (українською)",
        description:
          "Звичайний текст до 5000 символів; порожній рядок починає новий абзац. Показуємо на українській сторінці товару.",
      },
      descriptionEn: {
        label: "Опис (англійською)",
        description:
          "Звичайний текст до 5000 символів; порожній рядок починає новий абзац. Показуємо на англійській сторінці; порожній — показуємо український.",
      },
    },
  },
  {
    kind: "content-types",
    uid: "api::order.order",
    fields: {
      cancelReason: {
        label: "Причина скасування",
        description:
          "Обов’язкова, коли ставите статус «Скасоване»: на прохання клієнта (customer_request), немає в наявності (out_of_stock), клієнт не відповідає (no_answer), оплата не пройшла (payment_failed), інше (other). Після скасування не змінюється.",
      },
      returnedAt: {
        label: "Повернено",
        description: "Коли посилка повернулася: «Повернене» або «Не забране». Ставить магазин.",
      },
    },
  },
];

/**
 * Labels and describes the shared, per-language and alt image fields, the product descriptions
 * and the order's cancel reason and return time in the edit views.
 */
async function describeFields(strapi: Core.Strapi): Promise<void> {
  for (const { kind, uid, fields } of [...IMAGE_FIELD_HINTS, ...PRODUCT_FIELD_HINTS]) {
    try {
      await updateEditMetadata(strapi, kind, uid, (field, edit) => {
        const hint = fields[field];
        if (!hint || (edit.label === hint.label && edit.description === hint.description)) {
          return false;
        }
        edit.label = hint.label;
        edit.description = hint.description;
        return true;
      });
    } catch (error) {
      strapi.log.warn(`Could not describe the fields of ${uid}: ${String(error)}`);
    }
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
    await lockGiftCardFields(strapi);
    await describeFields(strapi);
  },
};
