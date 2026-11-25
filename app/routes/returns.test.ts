import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Returns } from "~/features/legal/Returns";
import { I18nProvider, type Locale } from "~/lib/i18n";
import { RETURN_REPORT_DAYS, type SellerDetails } from "~/lib/legal";

const legal = vi.hoisted(() => ({ getSellerDetails: vi.fn() }));

vi.mock("~/.server/legal", () => legal);

const { loader, meta } = await import("./returns");

type LoaderArgs = Parameters<typeof loader>[0];
type MetaArgs = Parameters<typeof meta>[0];

const seller: SellerDetails = {
  legalName: null,
  taxId: null,
  legalAddress: null,
  registrationNote: null,
  phone: "+380 44 123 45 67",
  email: "hello@jassmin.ua",
};

function render(details: SellerDetails | null, locale: Locale | null = "en"): string {
  const element = createElement(Returns, { seller: details });
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: ["/"] });
  const app = createElement(RouterProvider, { router });
  return renderToStaticMarkup(locale ? createElement(I18nProvider, { locale }, app) : app);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("returns loader", () => {
  it("passes on the contacts in the visitor's language", async () => {
    legal.getSellerDetails.mockResolvedValueOnce(seller);
    const request = new Request("http://localhost/en/returns");

    expect(await loader({ request, params: {}, context: {} } as unknown as LoaderArgs)).toEqual({
      seller,
    });
    expect(legal.getSellerDetails).toHaveBeenCalledWith("en");
  });

  it("still renders the page when the CMS is down", async () => {
    legal.getSellerDetails.mockRejectedValueOnce(new Error("Strapi down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new Request("http://localhost/povernennia");

    expect(await loader({ request, params: {}, context: {} } as unknown as LoaderArgs)).toEqual({
      seller: null,
    });
    consoleError.mockRestore();
  });
});

describe("Returns", () => {
  it("states the return rules with the deadline and contacts", () => {
    const html = render(seller);

    expect(html).toContain("resolution No. 172 of 19 March 1994");
    expect(html).toContain(
      `Tell us within ${RETURN_REPORT_DAYS} days of receiving it: email hello@jassmin.ua or call +380 44 123 45 67.`,
    );
    expect(html).toContain("we pay for sending the item back");
    expect(html).toContain("refuse it before paying");
  });

  it("points to the home page's contacts when Strapi is down", () => {
    expect(render(null)).toContain("using the contacts on the home page");
  });

  it("is in Ukrainian by default", () => {
    const html = render(seller, null);

    expect(html).toContain("Повернення та обмін");
    expect(html).toContain("постанова Кабінету Міністрів України № 172 від 19.03.1994");
    expect(html).toContain(`протягом ${RETURN_REPORT_DAYS} днів`);
  });
});

describe("returns meta", () => {
  it("has a translated title and canonical URL", () => {
    const tags = meta({
      matches: [{ id: "root", loaderData: { locale: "en", site: { url: "https://jassmin.ua" } } }],
      location: { pathname: "/en/returns", search: "" },
    } as unknown as MetaArgs);

    expect(tags).toContainEqual({ title: "Returns and exchanges — Jassmin" });
    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://jassmin.ua/en/returns",
    });
  });
});
