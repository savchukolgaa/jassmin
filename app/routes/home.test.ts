import { afterEach, describe, expect, it, vi } from "vitest";
import { CmsError } from "~/.server/cms/errors";
import type { HomePage, SiteSettings } from "~/lib/cms";

const content = vi.hoisted(() => ({ getHomePage: vi.fn(), getSiteSettings: vi.fn() }));
const contact = vi.hoisted(() => ({ submitContactMessage: vi.fn() }));
vi.mock("~/.server/cms/content", () => content);
vi.mock("~/.server/services/contact", () => contact);

const { action, loader, shouldRevalidate } = await import("./home");

const homePage: HomePage = {
  locale: "uk",
  hero: {
    headline: "Order 3 Testers only for 499₴",
    ctaLabel: "Order Now",
    ctaHref: "/popular",
    image: null,
  },
  about: { title: "About Jassmin", body: "Our **story**." },
  location: {
    address: "вул. Хрещатик, 1, Київ",
    openingHours: null,
    mapEmbedUrl: "javascript:alert(1)",
  },
};
const siteSettings: SiteSettings = {
  locale: "uk",
  phone: "+380 44 123 45 67",
  email: "hello@jassmin.ua",
  customerServiceHours: null,
  socialLinks: [],
};

const valid = { name: "Olha", email: "olha@example.com", message: "Do you have Chanel testers?" };

type ActionArgs = Parameters<typeof action>[0];
type RevalidateArgs = Parameters<typeof shouldRevalidate>[0];

function post(fields: Record<string, string>, headers: Record<string, string> = {}) {
  const request = new Request("http://localhost/?index", {
    method: "POST",
    body: new URLSearchParams(fields),
    headers,
  });
  return action({ request, params: {} } as unknown as ActionArgs);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("home loader", () => {
  it("loads both CMS documents and prepares them for rendering", async () => {
    content.getHomePage.mockResolvedValue(homePage);
    content.getSiteSettings.mockResolvedValue(siteSettings);

    const view = await loader();

    expect(view.about.bodyHtml).toBe("<p>Our <strong>story</strong>.</p>\n");
    expect(view.location.mapEmbedUrl).toBeNull();
    expect(view.contacts).toEqual(siteSettings);
    expect(view.seo.title).toBe("Jassmin — Order 3 Testers only for 499₴");
  });

  it("turns a CMS outage into a 503 for the error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    content.getHomePage.mockResolvedValue(homePage);
    content.getSiteSettings.mockRejectedValue(new CmsError("unreachable", "fetch failed"));

    await expect(loader()).rejects.toMatchObject({ init: { status: 503 } });
  });
});

describe("home action", () => {
  it("returns field errors with a 400 and doesn't send anything", async () => {
    const result = await post({ name: "", email: "nope", message: "hi" });

    expect(result.init?.status).toBe(400);
    expect(result.data).toMatchObject({
      status: "invalid",
      fieldErrors: {
        name: expect.any(String),
        email: expect.any(String),
        message: expect.any(String),
      },
      values: { name: "", email: "nope", message: "hi" },
    });
    expect(contact.submitContactMessage).not.toHaveBeenCalled();
  });

  it("sends a valid message once and reports success", async () => {
    contact.submitContactMessage.mockResolvedValue({ status: "sent" });

    const result = await post(valid, { "x-forwarded-for": "203.0.113.7" });

    expect(result.data).toEqual({ status: "success" });
    expect(contact.submitContactMessage).toHaveBeenCalledExactlyOnceWith({
      message: valid,
      honeypot: false,
      clientKey: "203.0.113.7",
    });
  });

  it("reports success for honeypot submissions", async () => {
    contact.submitContactMessage.mockResolvedValue({ status: "ignored" });

    const result = await post({ ...valid, website: "https://spam.test" });

    expect(result.data).toEqual({ status: "success" });
    expect(contact.submitContactMessage).toHaveBeenCalledWith(
      expect.objectContaining({ honeypot: true }),
    );
  });

  it("answers 429 with Retry-After when rate-limited", async () => {
    contact.submitContactMessage.mockResolvedValue({
      status: "rate_limited",
      retryAfterSeconds: 120,
    });

    const result = await post(valid);

    expect(result.init?.status).toBe(429);
    expect(new Headers(result.init?.headers).get("Retry-After")).toBe("120");
    expect(result.data).toEqual({ status: "rate_limited", retryAfterSeconds: 120, values: valid });
  });

  it("answers 503 and keeps the values when the email can't be sent", async () => {
    contact.submitContactMessage.mockResolvedValue({ status: "delivery_failed" });

    const result = await post(valid);

    expect(result.init?.status).toBe(503);
    expect(result.data).toEqual({ status: "delivery_failed", values: valid });
  });
});

describe("home shouldRevalidate", () => {
  const args = (overrides: Partial<RevalidateArgs>) =>
    ({ defaultShouldRevalidate: true, ...overrides }) as RevalidateArgs;

  it("skips reloading CMS content after the contact form", () => {
    expect(shouldRevalidate(args({ formMethod: "POST", formAction: "/?index" }))).toBe(false);
  });

  it("follows the default otherwise", () => {
    expect(shouldRevalidate(args({}))).toBe(true);
    expect(shouldRevalidate(args({ formMethod: "POST", formAction: "/cart" }))).toBe(true);
  });
});
