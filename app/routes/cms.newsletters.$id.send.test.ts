import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SendNewsletterResult,
  SendNewsletterTestResult,
} from "~/.server/services/newsletters";

const SECRET = "s".repeat(32);
const DOC = "abcdefghijklmnopqrstuvwx";

const state = {
  status: "sending",
  counts: { queued: 3, sent: 0, failed: 0, skipped: 0 },
  sentAt: "2026-11-19T10:00:00.000Z",
} as const;

const sendNewsletter = vi.hoisted(() =>
  vi.fn(async (): Promise<SendNewsletterResult> => ({ ok: true, newsletterId: 1, state })),
);
const sendNewsletterTest = vi.hoisted(() =>
  vi.fn(async (): Promise<SendNewsletterTestResult> => ({ ok: true, sent: 2 })),
);
const pushToCms = vi.hoisted(() => vi.fn());

vi.mock("~/.server/services/newsletters", () => ({ sendNewsletter, sendNewsletterTest }));
vi.mock("~/.server/services/cms-sync", () => ({ pushToCms }));
vi.mock("~/.server/services/mailer", () => ({ getMailer: () => null }));
vi.mock("~/.server/db", () => ({ db: {} }));
vi.mock("~/.server/env", () => ({ getEnv: () => ({ CMS_SYNC_SECRET: SECRET }) }));

type ActionArgs = Parameters<typeof import("./cms.newsletters.$id.send").action>[0];

const body = {
  mode: "send",
  slug: "autumn-news",
  content: { uk: { subject: "Осінь", preheader: "", body: "Текст" } },
  productPublicIds: [],
};

function post(payload: unknown, { id = DOC, secret = SECRET } = {}): ActionArgs {
  const request = new Request(`http://localhost/cms/newsletters/${id}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return { request, params: { id }, context: {} } as unknown as ActionArgs;
}

describe("cms newsletter send route", () => {
  beforeEach(() => {
    sendNewsletter.mockClear();
    sendNewsletterTest.mockClear();
    pushToCms.mockClear();
  });

  it("sends the newsletter and answers with its status and counts", async () => {
    const { action } = await import("./cms.newsletters.$id.send");
    const response = await action(post(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(state);
    expect(sendNewsletter).toHaveBeenCalledWith(
      DOC,
      {
        slug: "autumn-news",
        uk: { subject: "Осінь", preheader: null, body: "Текст" },
        en: null,
        productPublicIds: [],
      },
      expect.objectContaining({ mailer: null }),
    );
    expect(pushToCms).toHaveBeenCalledOnce();
    expect(sendNewsletterTest).not.toHaveBeenCalled();
  });

  it("sends a test only to the address Strapi names", async () => {
    const { action } = await import("./cms.newsletters.$id.send");
    const response = await action(
      post({ ...body, mode: "test", testEmail: "Olha@Jassmin.ua", testName: "Ольга" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 2 });
    expect(sendNewsletterTest).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "autumn-news" }),
      { email: "olha@jassmin.ua", name: "Ольга" },
      expect.anything(),
    );
    expect(sendNewsletter).not.toHaveBeenCalled();
    expect(pushToCms).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: false, error: "already-sent" }, 409],
    [{ ok: false, error: "newsletter-slug-taken", slug: "autumn-news" }, 409],
    [{ ok: false, error: "another-sending" }, 409],
    [{ ok: false, error: "too-soon", nextAllowedAt: "2026-11-26T10:00:00.000Z" }, 422],
    [{ ok: false, error: "no-recipients" }, 422],
    [{ ok: false, error: "mail-not-configured", missing: ["SMTP_URL"] }, 503],
  ] as const)("answers a refused send %o with %i", async (result, status) => {
    const { action } = await import("./cms.newsletters.$id.send");
    sendNewsletter.mockResolvedValueOnce(result as SendNewsletterResult);
    const response = await action(post(body));

    expect(response.status).toBe(status);
    const { ok: _ok, ...error } = result;
    expect(await response.json()).toEqual(error);
    expect(pushToCms).not.toHaveBeenCalled();
  });

  it("answers a failed test send", async () => {
    const { action } = await import("./cms.newsletters.$id.send");
    sendNewsletterTest.mockResolvedValueOnce({ ok: false, error: "mail-failed" });
    const response = await action(post({ ...body, mode: "test", testEmail: "a@jassmin.ua" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "mail-failed" });
  });

  it("validates the body before sending anything", async () => {
    const { action } = await import("./cms.newsletters.$id.send");

    const invalid = await action(post({ ...body, slug: "Not A Slug" }));
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({
      error: "invalid-newsletter",
      issues: [{ path: "slug" }],
    });

    expect((await action(post("not json"))).status).toBe(400);
    expect((await action(post(body, { id: "../x" }))).status).toBe(404);
    expect(sendNewsletter).not.toHaveBeenCalled();
  });

  it("refuses a request without the sync secret", async () => {
    const { action } = await import("./cms.newsletters.$id.send");
    expect((await action(post(body, { secret: "w".repeat(32) }))).status).toBe(401);
    expect(sendNewsletter).not.toHaveBeenCalled();
  });

  it("answers GET with 405", async () => {
    const { loader } = await import("./cms.newsletters.$id.send");
    expect(loader().status).toBe(405);
  });
});
