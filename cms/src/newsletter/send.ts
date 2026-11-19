import type { Core } from "@strapi/strapi";
import { AppSyncError, postToApp } from "../utils/app-sync";

/**
 * Sending a newsletter (#181). The admin's "Надіслати тест собі" and "Надіслати підписникам"
 * buttons (`src/admin/app.tsx`) call the admin-only routes registered here. The handler reads the
 * newsletter (both languages, its products), sends it to the app's
 * `/cms/newsletters/:documentId/send` with `CMS_SYNC_SECRET`, and for a real send stores the
 * status and counts the app answers with. The app owns the rules (once per newsletter, at most once
 * a week, who gets it) and the sending; later counts arrive through its pushes.
 */

export const NEWSLETTER_UID = "api::newsletter.newsletter";

/** Featured products a newsletter may have; the app refuses more. */
export const NEWSLETTER_MAX_PRODUCTS = 4;

/** The fields only the shop writes; staff see them read-only. */
export const NEWSLETTER_READ_ONLY_FIELDS = [
  "newsletterStatus",
  "queuedCount",
  "sentCount",
  "failedCount",
  "skippedCount",
  "sentAt",
] as const;

/** What a new or cloned newsletter starts with. */
export const NEWSLETTER_DRAFT_STATE = {
  newsletterStatus: "draft",
  queuedCount: 0,
  sentCount: 0,
  failedCount: 0,
  skippedCount: 0,
  sentAt: null,
} as const;

type Data = Record<string, unknown>;

const isRecord = (value: unknown): value is Data =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export type NewsletterMode = "send" | "test";

/** The admin user who pressed the button. */
export interface AdminUser {
  email: string;
  firstname?: string | null;
}

/**
 * The body the app's send route takes: the slug, the uk text, the en text (absent when that
 * language has no version) and the featured products' `publicId`s in the order staff picked them.
 */
export function newsletterSendBody(
  mode: NewsletterMode,
  uk: Data,
  en: Data | null,
  admin: AdminUser,
): Data {
  const products = Array.isArray(uk.products) ? uk.products.filter(isRecord) : [];
  return {
    mode,
    slug: text(uk.slug),
    content: {
      uk: { subject: text(uk.subject), preheader: text(uk.preheader), body: text(uk.body) },
      ...(en
        ? { en: { subject: text(en.subject), preheader: text(en.preheader), body: text(en.body) } }
        : {}),
    },
    productPublicIds: products.map((product) => text(product.publicId)).filter(Boolean),
    ...(mode === "test"
      ? { testEmail: admin.email, ...(admin.firstname ? { testName: admin.firstname } : {}) }
      : {}),
  };
}

/** The app's answer to a send, as the newsletter's read-only fields. */
export function toNewsletterStateData(answer: unknown): Data {
  const state = isRecord(answer) ? answer : {};
  const counts = isRecord(state.counts) ? state.counts : {};
  const count = (value: unknown) => (typeof value === "number" ? value : 0);
  return {
    newsletterStatus: typeof state.status === "string" ? state.status : "sending",
    queuedCount: count(counts.queued),
    sentCount: count(counts.sent),
    failedCount: count(counts.failed),
    skippedCount: count(counts.skipped),
    sentAt: typeof state.sentAt === "string" ? state.sentAt : null,
  };
}

/** The admin's message for a successful send or test. */
export function describeNewsletterResult(mode: NewsletterMode, answer: unknown): string {
  const state = isRecord(answer) ? answer : {};
  if (mode === "test") {
    const sent = typeof state.sent === "number" ? state.sent : 0;
    return sent > 1
      ? `Надіслали ${sent} тестові листи (українською та англійською) на вашу адресу.`
      : "Надіслали тестовий лист на вашу адресу.";
  }
  const counts = isRecord(state.counts) ? state.counts : {};
  const queued = typeof counts.queued === "number" ? counts.queued : 0;
  return `Розсилку поставлено в чергу для ${queued} клієнтів. Магазин надсилатиме її частинами, у межах денного ліміту.`;
}

interface DocumentsApi {
  findOne(params: { documentId: string; locale?: string; populate?: unknown }): Promise<unknown>;
}

/** The newsletter in `locale`, with its products' `publicId`s; `null` when that language has none. */
async function findNewsletter(
  strapi: Core.Strapi,
  documentId: string,
  locale: string,
): Promise<Data | null> {
  const documents = strapi.documents(NEWSLETTER_UID as never) as unknown as DocumentsApi;
  const found = await documents.findOne({
    documentId,
    locale,
    populate: { products: { fields: ["publicId"] } },
  });
  return isRecord(found) ? found : null;
}

interface RouteContext {
  params: { documentId?: string };
  state: { user?: unknown };
  status: number;
  body: unknown;
}

function fail(ctx: RouteContext, status: number, message: string): void {
  ctx.status = status;
  ctx.body = { error: { status, name: "NewsletterError", message } };
}

/** Handles a press of one of the two buttons. */
export async function handleNewsletterAction(
  strapi: Core.Strapi,
  ctx: RouteContext,
  mode: NewsletterMode,
): Promise<void> {
  const documentId = ctx.params.documentId ?? "";
  const admin = isRecord(ctx.state.user) ? ctx.state.user : {};
  if (typeof admin.email !== "string") {
    fail(ctx, 401, "Увійдіть в адмінку ще раз.");
    return;
  }
  const uk = await findNewsletter(strapi, documentId, "uk");
  if (!uk) {
    fail(ctx, 404, "Збережіть розсилку українською, перш ніж надсилати її.");
    return;
  }
  if (mode === "send" && uk.newsletterStatus !== "draft") {
    fail(ctx, 409, "Цю розсилку вже надіслано. Щоб надіслати схожу, дублюйте її.");
    return;
  }
  const products = Array.isArray(uk.products) ? uk.products : [];
  if (products.length > NEWSLETTER_MAX_PRODUCTS) {
    fail(ctx, 422, `У розсилці може бути щонайбільше ${NEWSLETTER_MAX_PRODUCTS} товари.`);
    return;
  }
  const en = await findNewsletter(strapi, documentId, "en");

  let answer: unknown;
  try {
    answer = await postToApp(
      `/cms/newsletters/${encodeURIComponent(documentId)}/send`,
      newsletterSendBody(mode, uk, en, {
        email: admin.email,
        firstname: typeof admin.firstname === "string" ? admin.firstname : null,
      }),
    );
  } catch (error) {
    if (error instanceof AppSyncError) {
      fail(ctx, 422, error.message);
      return;
    }
    throw error;
  }

  if (mode === "send") {
    // Straight to the database: the shared fields are stored on every language's row, and this
    // isn't a staff edit for the document middleware to guard.
    await strapi.db.query(NEWSLETTER_UID as never).updateMany({
      where: { documentId },
      data: toNewsletterStateData(answer),
    });
  }
  ctx.status = 200;
  ctx.body = { message: describeNewsletterResult(mode, answer) };
}

/**
 * Registers the buttons' admin-only routes: `POST /jassmin/newsletters/:documentId/send` and
 * `…/test`. Admin routes need a signed-in admin (the admin panel's own token), never an API token.
 */
export function registerNewsletterRoutes(strapi: Core.Strapi): void {
  const route = (mode: NewsletterMode) => ({
    method: "POST" as const,
    path: `/newsletters/:documentId/${mode}`,
    handler: (ctx: RouteContext) => handleNewsletterAction(strapi, ctx, mode),
    config: { policies: ["admin::isAuthenticatedAdmin"] },
  });
  strapi.server.routes({
    type: "admin",
    prefix: "/jassmin",
    routes: [route("send"), route("test")],
  } as unknown as Parameters<Core.Strapi["server"]["routes"]>[0]);
}
