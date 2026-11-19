import type { Core } from "@strapi/strapi";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeNewsletterResult,
  handleNewsletterAction,
  NEWSLETTER_UID,
  newsletterSendBody,
  toNewsletterStateData,
} from "./send";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const uk = {
  documentId: "doc123456789",
  slug: "autumn-news",
  subject: "Осінь",
  preheader: null,
  body: "Текст",
  newsletterStatus: "draft",
  products: [{ publicId: "p-1" }, { publicId: "p-2" }],
};
const en = { subject: "Autumn", preheader: "New", body: "Text" };

describe("newsletterSendBody", () => {
  it("sends both languages, the products in order and, for a test, the admin", () => {
    expect(
      newsletterSendBody("test", uk, en, { email: "olha@jassmin.ua", firstname: "Ольга" }),
    ).toEqual({
      mode: "test",
      slug: "autumn-news",
      content: {
        uk: { subject: "Осінь", preheader: "", body: "Текст" },
        en: { subject: "Autumn", preheader: "New", body: "Text" },
      },
      productPublicIds: ["p-1", "p-2"],
      testEmail: "olha@jassmin.ua",
      testName: "Ольга",
    });
    const send = newsletterSendBody("send", { ...uk, products: undefined }, null, {
      email: "olha@jassmin.ua",
    });
    expect(send).toEqual({
      mode: "send",
      slug: "autumn-news",
      content: { uk: { subject: "Осінь", preheader: "", body: "Текст" } },
      productPublicIds: [],
    });
  });
});

describe("toNewsletterStateData", () => {
  it("turns the app's answer into the read-only fields", () => {
    expect(
      toNewsletterStateData({
        status: "sending",
        counts: { queued: 12, sent: 0, failed: 0, skipped: 0 },
        sentAt: "2026-11-19T10:00:00.000Z",
      }),
    ).toEqual({
      newsletterStatus: "sending",
      queuedCount: 12,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      sentAt: "2026-11-19T10:00:00.000Z",
    });
    expect(describeNewsletterResult("send", { counts: { queued: 12 } })).toContain(
      "для 12 клієнтів",
    );
    expect(describeNewsletterResult("test", { sent: 2 })).toContain("2 тестові листи");
    expect(describeNewsletterResult("test", { sent: 1 })).toBe(
      "Надіслали тестовий лист на вашу адресу.",
    );
  });
});

describe("handleNewsletterAction", () => {
  function fakeStrapi(byLocale: Record<string, unknown>) {
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const findOne = vi.fn(async ({ locale }: { locale: string }) => byLocale[locale] ?? null);
    const strapi = {
      documents: (uid: string) => {
        expect(uid).toBe(NEWSLETTER_UID);
        return { findOne };
      },
      db: { query: () => ({ updateMany }) },
    } as unknown as Core.Strapi;
    return { strapi, updateMany };
  }

  function ctx(documentId = "doc123456789", user: unknown = { email: "olha@jassmin.ua" }) {
    return { params: { documentId }, state: { user }, status: 0, body: undefined as unknown };
  }

  function stubApp(status: number, answer: unknown) {
    vi.stubEnv("JASSMIN_APP_URL", "http://app.test");
    vi.stubEnv("CMS_SYNC_SECRET", "secret");
    const fetchMock = vi.fn(async (_url: URL, _init?: RequestInit) =>
      Response.json(answer, { status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends to the app and stores the status and counts on every language", async () => {
    const { strapi, updateMany } = fakeStrapi({ uk, en });
    const fetchMock = stubApp(200, {
      status: "sending",
      counts: { queued: 3, sent: 0, failed: 0, skipped: 0 },
      sentAt: "2026-11-19T10:00:00.000Z",
    });
    const context = ctx();

    await handleNewsletterAction(strapi, context, "send");

    expect(context.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://app.test/cms/newsletters/doc123456789/send",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      mode: "send",
      content: { en: { subject: "Autumn" } },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { documentId: "doc123456789" },
      data: expect.objectContaining({ newsletterStatus: "sending", queuedCount: 3 }),
    });
  });

  it("sends a test without storing anything", async () => {
    const { strapi, updateMany } = fakeStrapi({ uk });
    const fetchMock = stubApp(200, { sent: 1 });
    const context = ctx();

    await handleNewsletterAction(strapi, context, "test");

    expect(context.body).toEqual({ message: "Надіслали тестовий лист на вашу адресу." });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      mode: "test",
      testEmail: "olha@jassmin.ua",
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("shows the app's refusal and stores nothing", async () => {
    const { strapi, updateMany } = fakeStrapi({ uk });
    stubApp(422, { error: "too-soon", nextAllowedAt: "2026-11-26T10:00:00.000Z" });
    const context = ctx();

    await handleNewsletterAction(strapi, context, "send");

    expect(context.status).toBe(422);
    expect(context.body).toMatchObject({
      error: { message: expect.stringContaining("26.11.2026") },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("refuses a sent newsletter, too many products, an unsaved one and a missing admin", async () => {
    const fetchMock = stubApp(200, {});
    const sent = ctx();
    await handleNewsletterAction(
      fakeStrapi({ uk: { ...uk, newsletterStatus: "sent" } }).strapi,
      sent,
      "send",
    );
    expect(sent.status).toBe(409);

    const many = ctx();
    const products = Array.from({ length: 5 }, (_, i) => ({ publicId: `p-${i}` }));
    await handleNewsletterAction(fakeStrapi({ uk: { ...uk, products } }).strapi, many, "test");
    expect(many.status).toBe(422);

    const missing = ctx();
    await handleNewsletterAction(fakeStrapi({}).strapi, missing, "test");
    expect(missing.status).toBe(404);

    const anonymous = ctx("doc123456789", null);
    await handleNewsletterAction(fakeStrapi({ uk }).strapi, anonymous, "test");
    expect(anonymous.status).toBe(401);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
