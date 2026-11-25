import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import siteSetting from "~/.server/cms/__fixtures__/site-setting.json";
import { toSiteSettings } from "~/.server/cms/content";
import { singleResponse, siteSettingEntry } from "~/.server/cms/schemas";
import { OfferTerms } from "~/features/legal/OfferTerms";
import { FREE_SHIPPING_THRESHOLD } from "~/lib/checkout";
import { GIFT_CARD_AMOUNTS } from "~/lib/gift-cards";
import { createTranslator, I18nProvider, type Locale } from "~/lib/i18n";
import type { SellerDetails } from "~/lib/legal";

const content = vi.hoisted(() => ({ getSiteSettings: vi.fn() }));
const env = vi.hoisted(() => ({ getEnv: vi.fn(() => ({ NODE_ENV: "development" })) }));

vi.mock("~/.server/cms/content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/.server/cms/content")>()),
  getSiteSettings: content.getSiteSettings,
}));
vi.mock("~/.server/env", () => env);

const { loader, meta } = await import("./offer-terms");

type LoaderArgs = Parameters<typeof loader>[0];
type MetaArgs = Parameters<typeof meta>[0];

/** The Strapi fixture with every seller detail filled in (#190). */
const filled = {
  ...toSiteSettings(singleResponse(siteSettingEntry).parse(siteSetting).data),
  legalName: "Іваненко Марія Петрівна",
  taxId: "1234567890",
};

function load(locale: Locale = "uk") {
  const request = new Request(`http://localhost${locale === "en" ? "/en/offer-terms" : "/oferta"}`);
  return loader({ request, params: {}, context: {} } as unknown as LoaderArgs);
}

function render(
  seller: SellerDetails | null,
  locale: Locale | null = "en",
  showPlaceholders = true,
): string {
  const element = createElement(OfferTerms, { seller, showPlaceholders });
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: ["/"] });
  const app = createElement(RouterProvider, { router });
  return renderToStaticMarkup(locale ? createElement(I18nProvider, { locale }, app) : app);
}

afterEach(() => {
  vi.clearAllMocks();
  env.getEnv.mockReturnValue({ NODE_ENV: "development" });
});

describe("offer-terms loader", () => {
  it("passes on the seller's details from the CMS in the visitor's language", async () => {
    content.getSiteSettings.mockResolvedValue(filled);

    expect(await load()).toEqual({
      seller: {
        legalName: "Іваненко Марія Петрівна",
        taxId: "1234567890",
        legalAddress: "м. Київ, вул. Хрещатик, 1, кв. 1",
        registrationNote: "Запис в ЄДР № 2010000000000123456 від 01.03.2024",
        phone: "+380 44 123 45 67",
        email: "hello@jassmin.ua",
      },
      showPlaceholders: true,
    });
    expect(content.getSiteSettings).toHaveBeenCalledWith("uk");
  });

  it("falls back to the Ukrainian address when the English one is empty", async () => {
    content.getSiteSettings.mockImplementation(async (locale: Locale) =>
      locale === "en" ? { ...filled, locale, legalAddress: null, registrationNote: null } : filled,
    );

    const { seller } = await load("en");

    expect(content.getSiteSettings).toHaveBeenCalledWith("en");
    expect(seller?.legalAddress).toBe("м. Київ, вул. Хрещатик, 1, кв. 1");
    expect(seller?.registrationNote).toBe("Запис в ЄДР № 2010000000000123456 від 01.03.2024");
  });

  it("hides placeholders in production", async () => {
    env.getEnv.mockReturnValue({ NODE_ENV: "production" });
    content.getSiteSettings.mockResolvedValue(filled);

    expect((await load()).showPlaceholders).toBe(false);
  });

  it("still renders the page when the CMS is down", async () => {
    content.getSiteSettings.mockRejectedValue(new Error("Strapi down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await load()).toEqual({ seller: null, showPlaceholders: true });
    consoleError.mockRestore();
  });
});

describe("OfferTerms", () => {
  const seller: SellerDetails = {
    legalName: "Іваненко Марія Петрівна",
    taxId: "1234567890",
    legalAddress: "Kyiv, 1 Khreshchatyk St.",
    registrationNote: null,
    phone: "+380 44 123 45 67",
    email: "hello@jassmin.ua",
  };

  it("names the seller with their details, at the top and again at the end", () => {
    const html = render(seller);

    expect(html.match(/Sole proprietor \(ФОП\) Іваненко Марія Петрівна/g)).toHaveLength(2);
    expect(html).toContain("1234567890");
    expect(html).toContain("Kyiv, 1 Khreshchatyk St.");
    expect(html).toContain("hello@jassmin.ua");
    expect(html).not.toContain("Registration");
    expect(html).toContain("11. Seller details");
  });

  it("is in Ukrainian by default", () => {
    const html = render(seller, null);

    expect(html).toContain("Публічна оферта");
    expect(html).toContain("ФОП Іваненко Марія Петрівна");
    expect(html).toContain("статей 633 і 641 Цивільного кодексу України");
    expect(html).toMatch(/<time datetime="\d{4}-\d{2}-\d{2}">Редакція від /i);
  });

  it("formats the free-delivery threshold and gift-card amounts from the code", () => {
    const { formatPrice } = createTranslator("en");
    const html = render(seller);

    expect(html).toContain(`From ${formatPrice(FREE_SHIPPING_THRESHOLD)} the seller pays`);
    expect(html).toContain(
      `amounts of ${GIFT_CARD_AMOUNTS.map((amount) => formatPrice(String(amount))).join(", ")}`,
    );
  });

  it("shows a placeholder for a missing required detail outside production", () => {
    const html = render({ ...seller, taxId: null, legalAddress: "" });

    expect(html).toContain('data-missing="taxId"');
    expect(html).toContain('data-missing="legalAddress"');
    expect(html).toContain("not filled in the site settings (Strapi)");
    expect(html).not.toContain('data-missing="registrationNote"');
  });

  it("leaves a missing detail out in production", () => {
    const html = render({ ...seller, taxId: null }, "en", false);

    expect(html).not.toContain("data-missing");
    expect(html).not.toContain("Tax number (РНОКПП)");
  });

  it("explains where the details are when Strapi is down", () => {
    expect(render(null)).toContain("The seller&#x27;s details couldn&#x27;t be loaded right now.");
  });

  it("links to delivery, returns, offers and privacy in the page's language", () => {
    const html = render(seller);

    for (const href of ["/en/delivery-and-payment", "/en/returns", "/en/offers", "/en/privacy"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(render(seller, null)).toContain('href="/povernennia"');
  });
});

describe("offer-terms meta", () => {
  it("has a translated title, description and canonical URL", () => {
    const tags = meta({
      matches: [{ id: "root", loaderData: { locale: "en", site: { url: "https://jassmin.ua" } } }],
      location: { pathname: "/en/offer-terms", search: "" },
    } as unknown as MetaArgs);

    expect(tags).toContainEqual({ title: "Public offer — Jassmin" });
    expect(tags).toContainEqual(expect.objectContaining({ name: "description" }));
    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://jassmin.ua/en/offer-terms",
    });
  });
});
