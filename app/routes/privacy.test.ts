import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PrivacyContacts, PrivacyPolicy } from "~/features/privacy/PrivacyPolicy";
import { COOKIE_INVENTORY } from "~/lib/consent";
import { I18nProvider, type Locale } from "~/lib/i18n";

const content = vi.hoisted(() => ({ getSiteSettings: vi.fn() }));
const ai = vi.hoisted(() => ({
  getAiProviderName: vi.fn((): string | null => null),
  isPerfumerEnabled: vi.fn(() => false),
}));

vi.mock("~/.server/cms/content", () => content);
vi.mock("~/.server/ai/config", () => ai);

const { loader, meta } = await import("./privacy");

type LoaderArgs = Parameters<typeof loader>[0];
type MetaArgs = Parameters<typeof meta>[0];

/** The loader for the page in `locale` (from its URL). */
function load(locale = "uk") {
  const request = new Request(`http://localhost${locale === "en" ? "/en" : ""}/privacy`);
  return loader({ request, params: {}, context: {} } as unknown as LoaderArgs);
}

const contacts: PrivacyContacts = {
  legalName: "Іваненко Марія",
  email: "hello@jassmin.ua",
  phone: "+380 44 123 45 67",
};

// The "Cookie settings" `<Form>` needs a data router. Without a locale, the default (Ukrainian).
function renderPolicy(
  props: PrivacyContacts | null,
  locale: Locale | null = "en",
  aiProvider: string | null = null,
  perfumerEnabled = false,
) {
  const element = createElement(PrivacyPolicy, { contacts: props, aiProvider, perfumerEnabled });
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: ["/privacy"] });
  const app = createElement(RouterProvider, { router });
  return renderToStaticMarkup(locale ? createElement(I18nProvider, { locale }, app) : app);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("privacy loader", () => {
  it("passes on the data controller and contacts from the CMS, in the visitor's language", async () => {
    content.getSiteSettings.mockResolvedValueOnce({
      ...contacts,
      locale: "en",
      customerServiceHours: null,
      socialLinks: [],
    });

    expect(await load("en")).toEqual({ contacts, aiProvider: null, perfumerEnabled: false });
    expect(content.getSiteSettings).toHaveBeenCalledWith("en");
  });

  it("passes on the hosted AI perfumer's provider, even when the CMS is down (#167)", async () => {
    ai.getAiProviderName.mockReturnValue("OpenRouter");
    ai.isPerfumerEnabled.mockReturnValue(true);
    content.getSiteSettings.mockRejectedValueOnce(new Error("Strapi down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await load()).toEqual({
      contacts: null,
      aiProvider: "OpenRouter",
      perfumerEnabled: true,
    });
    consoleError.mockRestore();
    ai.getAiProviderName.mockReturnValue(null);
    ai.isPerfumerEnabled.mockReturnValue(false);
  });

  it("still renders the page when the CMS is down", async () => {
    content.getSiteSettings.mockRejectedValueOnce(new Error("Strapi down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await load()).toEqual({ contacts: null, aiProvider: null, perfumerEnabled: false });
    consoleError.mockRestore();
  });
});

describe("PrivacyPolicy", () => {
  it("names the ФОП and how to reach them", () => {
    const html = renderPolicy(contacts);

    expect(html).toContain("sole proprietor (ФОП) Іваненко Марія");
    expect(html).toContain("email hello@jassmin.ua or call +380 44 123 45 67");
  });

  it("falls back to a general sentence without a name or contacts", () => {
    expect(renderPolicy({ ...contacts, legalName: null })).toContain(
      "controlled by the sole proprietor (ФОП) who runs the Jassmin online store",
    );
    expect(renderPolicy(null)).toContain("use the contacts on the home page");
  });

  it("lists every cookie with its purpose and lifetime", () => {
    const html = renderPolicy(contacts);

    for (const cookie of COOKIE_INVENTORY) {
      expect(html).toMatch(new RegExp(`<th scope="row"[^>]*>${cookie.name}</th>`));
    }
    expect(html).toContain("Keeps you logged in.");
    expect(html).toContain("Until you close the browser");
  });

  it("states the retention and the consent-only statistics", () => {
    const html = renderPolicy(contacts);

    expect(html).toContain("Visit statistics for 26 months.");
    expect(html).toContain("Only with your consent, statistics");
    expect(html).toMatch(/<time datetime="2026-11-19">Updated 19 November 2026<\/time>/i);
  });

  it("explains the newsletter consent and the delivery city (#128)", () => {
    const html = renderPolicy(contacts);

    expect(html).toContain("agreed to the newsletter");
    expect(html).toContain("unsubscribe at any time");
    expect(html).toContain("the delivery city of your latest order");
  });

  it("names the AI perfumer's provider only when its messages leave the shop (#167)", () => {
    expect(renderPolicy(contacts, "en", "OpenRouter")).toContain(
      "The messages you write to the AI perfumer are sent to the language model provider, OpenRouter, only to prepare the answer.",
    );
    expect(renderPolicy(contacts, null, "OpenRouter")).toContain(
      "передаються постачальнику мовної моделі, OpenRouter,",
    );
    expect(renderPolicy(contacts)).not.toContain("language model provider");
  });

  it("describes the saved AI perfumer chats and their retention while the perfumer is on (#180)", () => {
    const html = renderPolicy(contacts, "en", null, true);
    expect(html).toContain("Your conversation with the AI perfumer, if you use it");
    expect(html).toContain("for 90 days after its last message, then it");
    expect(html).toContain("“Delete chat”");

    const uk = renderPolicy(contacts, null, null, true);
    expect(uk).toContain("Розмова з AI парфумером, якщо ви ним користуєтеся");
    expect(uk).toContain("90 днів після останнього повідомлення");

    const off = renderPolicy(contacts);
    expect(off).not.toContain("Your conversation with the AI perfumer, if you use it");
    expect(off).not.toContain("for 90 days after its last message");
  });

  it("no longer says the shop doesn't store the conversation (#180)", () => {
    expect(renderPolicy(contacts, "en", "OpenRouter", true)).not.toContain(
      "We don't store the conversation's text",
    );
    expect(renderPolicy(contacts, null, "OpenRouter", true)).not.toContain(
      "Ми не зберігаємо текст розмови",
    );
  });

  it("lets the visitor change their cookie choice", () => {
    const html = renderPolicy(contacts);

    expect(html).toMatch(/<form(?=[^>]*method="post")(?=[^>]*action="\/consent")/);
    expect(html).toMatch(
      /<button(?=[^>]*name="consent")(?=[^>]*value="reset")[^>]*>Cookie settings</,
    );
  });

  it("is in Ukrainian by default", () => {
    const html = renderPolicy(contacts, null);

    expect(html).toContain("Політика конфіденційності та cookie");
    expect(html).toContain("ФОП Іваненко Марія");
    expect(html).toContain("Закону України «Про захист персональних даних»");
  });
});

describe("privacy meta", () => {
  it("has a translated title, description and canonical URL", () => {
    const tags = meta({
      matches: [{ id: "root", loaderData: { locale: "en", site: { url: "https://jassmin.ua" } } }],
      location: { pathname: "/privacy", search: "?fbclid=x" },
    } as unknown as MetaArgs);

    expect(tags).toContainEqual({ title: "Privacy and cookie policy — Jassmin" });
    expect(tags).toContainEqual(expect.objectContaining({ name: "description" }));
    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://jassmin.ua/privacy",
    });
    expect(tags).toContainEqual({ property: "og:locale", content: "en_US" });
  });
});
