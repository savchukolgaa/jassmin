import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CmsError } from "~/.server/cms/errors";
import type { HomePage, SiteSettings } from "~/lib/cms";

const content = vi.hoisted(() => ({ getHomePage: vi.fn(), getSiteSettings: vi.fn() }));
const contact = vi.hoisted(() => ({ submitContactMessage: vi.fn() }));
const shop = vi.hoisted(() => ({
  getBestsellers: vi.fn(),
  getTrioFamilies: vi.fn(),
  getTesterTrioOffer: vi.fn(),
}));
vi.mock("~/.server/cms/content", () => content);
vi.mock("~/.server/services/contact", () => contact);
vi.mock("~/.server/services/products", () => ({
  getBestsellers: shop.getBestsellers,
  getTrioFamilies: shop.getTrioFamilies,
}));
vi.mock("~/.server/services/trio", () => ({ getTesterTrioOffer: shop.getTesterTrioOffer }));

const { action, loader, meta, shouldRevalidate } = await import("./home");

type MetaArgs = Parameters<typeof meta>[0];

const homePage: HomePage = {
  locale: "uk",
  hero: {
    headline: "Order 3 Testers only for 499₴",
    ctaLabel: "Order Now",
    ctaHref: "/popular",
    image: null,
    eyebrow: null,
    subtitle: null,
    secondaryCta: null,
  },
  about: { title: "About Jassmin", body: "Our **story**.", image: null },
  location: {
    address: "вул. Хрещатик, 1, Київ",
    openingHours: null,
    mapEmbedUrl: "javascript:alert(1)",
    streetAddress: null,
    addressLocality: null,
    postalCode: null,
    latitude: null,
    longitude: null,
  },
};
const siteSettings: SiteSettings = {
  locale: "uk",
  phone: "+380 44 123 45 67",
  email: "hello@jassmin.ua",
  customerServiceHours: null,
  legalName: null,
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

const trioOffer = { price: "499.00", setSize: 3, volumeMl: 10 };
const families = ["квіткові", "деревні", "свіжі", "східні"];

beforeEach(() => {
  shop.getBestsellers.mockResolvedValue([]);
  shop.getTrioFamilies.mockResolvedValue(families);
  shop.getTesterTrioOffer.mockResolvedValue(trioOffer);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

type LoaderArgs = Parameters<typeof loader>[0];

function load(headers?: HeadersInit, path = "/") {
  return loader({ request: new Request(`http://localhost${path}`, { headers }) } as LoaderArgs);
}

describe("home loader", () => {
  it("loads both CMS documents and prepares them for rendering", async () => {
    content.getHomePage.mockResolvedValue(homePage);
    content.getSiteSettings.mockResolvedValue(siteSettings);

    const view = await load();

    expect(view.about.bodyHtml).toBe("<p>Our <strong>story</strong>.</p>\n");
    expect(view.location.mapEmbedUrl).toBeNull();
    expect(view.contacts).toEqual(siteSettings);
    expect(view.seo.title).toBe("Jassmin — Order 3 Testers only for 499₴");
  });

  it("adds the trio offer, the families and the bestsellers from the shop", async () => {
    content.getHomePage.mockResolvedValue(homePage);
    content.getSiteSettings.mockResolvedValue(siteSettings);

    const view = await load();

    expect(view.trioOffer).toEqual(trioOffer);
    expect(view.trio).toEqual({ families, selected: [], gender: "women" });
    expect(shop.getBestsellers).toHaveBeenCalledOnce();
  });

  it("reads the trio picks of a no-JS submission, at most three known families", async () => {
    content.getHomePage.mockResolvedValue(homePage);
    content.getSiteSettings.mockResolvedValue(siteSettings);
    const query = ["свіжі", "nope", "деревні", "квіткові", "східні"]
      .map((family) => `family=${encodeURIComponent(family)}`)
      .join("&");

    const view = await load(undefined, `/?${query}`);

    expect(view.trio.selected).toEqual(["свіжі", "деревні", "квіткові"]);
  });

  it("keeps the trio gender of a no-JS submission, women when missing or invalid (#102)", async () => {
    content.getHomePage.mockResolvedValue(homePage);
    content.getSiteSettings.mockResolvedValue(siteSettings);

    const men = await load(undefined, `/?gender=men&family=${encodeURIComponent("свіжі")}`);
    expect(men.trio).toMatchObject({ gender: "men", selected: ["свіжі"] });
    expect((await load(undefined, "/?gender=unisex")).trio.gender).toBe("women");
    expect((await load(undefined, "/")).trio.gender).toBe("women");
  });

  it("turns a CMS outage into a 503 for the error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    content.getHomePage.mockResolvedValue(homePage);
    content.getSiteSettings.mockRejectedValue(new CmsError("unreachable", "fetch failed"));

    await expect(load()).rejects.toMatchObject({ init: { status: 503 } });
  });

  it("asks for the CMS content in Ukrainian by default", async () => {
    content.getHomePage.mockResolvedValue(homePage);
    content.getSiteSettings.mockResolvedValue(siteSettings);

    await load();

    expect(content.getHomePage).toHaveBeenCalledExactlyOnceWith("uk");
    expect(content.getSiteSettings).toHaveBeenCalledExactlyOnceWith("uk");
  });

  it("asks for the CMS content in the visitor's locale", async () => {
    content.getHomePage.mockResolvedValue({ ...homePage, locale: "en" });
    content.getSiteSettings.mockResolvedValue({ ...siteSettings, locale: "en" });

    const view = await load({}, "/en");

    expect(content.getHomePage).toHaveBeenCalledExactlyOnceWith("en");
    expect(content.getSiteSettings).toHaveBeenCalledExactlyOnceWith("en");
    expect(view.contentLocale).toBe("en");
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

  it("skips reloading after a bestseller's quick add", () => {
    expect(shouldRevalidate(args({ formMethod: "POST", formAction: "/koshyk" }))).toBe(false);
    expect(shouldRevalidate(args({ formMethod: "POST", formAction: "/en/cart" }))).toBe(false);
    expect(shouldRevalidate(args({ formMethod: "POST", formAction: "/en?index" }))).toBe(false);
  });

  it("follows the default otherwise", () => {
    expect(shouldRevalidate(args({}))).toBe(true);
    expect(shouldRevalidate(args({ formMethod: "POST", formAction: "/locale" }))).toBe(true);
    expect(shouldRevalidate(args({ formMethod: "GET", formAction: "/" }))).toBe(true);
  });
});

describe("home meta", () => {
  const matches = [
    { id: "root", loaderData: { locale: "uk", site: { url: "https://jassmin.ua" } } },
  ];
  const location = { pathname: "/", search: "?utm_source=instagram" };

  it("uses the CMS SEO title and image, with a clean canonical URL", () => {
    const tags = meta({
      matches,
      location,
      loaderData: {
        seo: { title: "Jassmin — парфуми", description: "", image: "https://cms.test/og.jpg" },
      },
    } as unknown as MetaArgs);

    expect(tags).toContainEqual({ title: "Jassmin — парфуми" });
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://jassmin.ua/" });
    expect(tags).toContainEqual({ property: "og:image", content: "https://cms.test/og.jpg" });
    expect(tags).toContainEqual(
      expect.objectContaining({ name: "description", content: expect.stringContaining("Jassmin") }),
    );
  });

  it("falls back to the default share image", () => {
    const tags = meta({
      matches,
      location,
      loaderData: { seo: { title: "Jassmin", description: "Опис", image: null } },
    } as unknown as MetaArgs);

    expect(tags).toContainEqual({
      property: "og:image",
      content: "https://jassmin.ua/og-default.jpg",
    });
  });
});
