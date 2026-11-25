import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { DeliveryAndPayment } from "~/features/legal/DeliveryAndPayment";
import { FREE_SHIPPING_THRESHOLD } from "~/lib/checkout";
import { createTranslator, I18nProvider, type Locale } from "~/lib/i18n";

const payments = vi.hoisted(() => ({ isCardPaymentAvailable: vi.fn(() => false) }));

vi.mock("~/.server/services/payments", () => payments);

const { loader, meta } = await import("./delivery-and-payment");

type MetaArgs = Parameters<typeof meta>[0];

function render(cardPaymentEnabled: boolean, locale: Locale | null = "en"): string {
  const element = createElement(DeliveryAndPayment, { cardPaymentEnabled });
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: ["/"] });
  const app = createElement(RouterProvider, { router });
  return renderToStaticMarkup(locale ? createElement(I18nProvider, { locale }, app) : app);
}

describe("delivery-and-payment loader", () => {
  it("says whether card payment is available", () => {
    expect(loader()).toEqual({ cardPaymentEnabled: false });
    payments.isCardPaymentAvailable.mockReturnValueOnce(true);
    expect(loader()).toEqual({ cardPaymentEnabled: true });
  });
});

describe("DeliveryAndPayment", () => {
  it("states the free-delivery threshold from the code", () => {
    const html = render(false);

    expect(html).toContain(
      `From ${createTranslator("en").formatPrice(FREE_SHIPPING_THRESHOLD)} delivery is free`,
    );
    expect(html).toContain("the recipient pays Nova Poshta&#x27;s rates");
  });

  it("lists card payment only while a provider is configured", () => {
    expect(render(false)).not.toContain("By card online");
    expect(render(true)).toContain("By card online");
    expect(render(false)).toContain("Cash on delivery");
  });

  it("is in Ukrainian by default and links to the returns page", () => {
    const html = render(false, null);

    expect(html).toContain("Доставка і оплата");
    expect(html).toContain("Новою Поштою");
    expect(html).toContain('href="/povernennia"');
  });
});

describe("delivery-and-payment meta", () => {
  it("has a translated title and canonical URL", () => {
    const tags = meta({
      matches: [{ id: "root", loaderData: { locale: "uk", site: { url: "https://jassmin.ua" } } }],
      location: { pathname: "/dostavka-i-oplata", search: "" },
    } as unknown as MetaArgs);

    expect(tags).toContainEqual({ title: "Доставка і оплата — Jassmin" });
    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://jassmin.ua/dostavka-i-oplata",
    });
  });
});
