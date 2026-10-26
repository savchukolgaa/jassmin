import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";
import type { OffersPageView, OfferView } from "~/lib/offers";
import type { ProductSummary } from "~/lib/products";
import { OfferCard } from "./OfferCard";
import { OffersPage } from "./OffersPage";

// Ukrainian unless a test asks for English, like the storefront's default.
const render = (element: ReactElement, locale?: Locale) => {
  const router = createMemoryRouter([{ path: "*", element }]);
  const app = createElement(RouterProvider, { router });
  return renderToStaticMarkup(locale ? createElement(I18nProvider, { locale }, app) : app);
};

const sauvage: ProductSummary = {
  id: "01a1652b-6e25-7c44-8d5b-bce46a20ad83",
  title: "Sauvage Eau de Toilette",
  brand: "Dior",
  gender: "men",
  packSize: 1,
  imageUrl: null,
  fragranceFamily: null,
  minPrice: "790.00",
  hasPriceRange: true,
  volumes: [10, 50, 100],
  inStock: true,
  defaultVariant: { id: "01a1652b-6e25-7c44-8d5b-000000000010", volumeMl: 10 },
};

function offer(overrides: Partial<OfferView> = {}): OfferView {
  return {
    slug: "tester-trio",
    kind: "discovery-set",
    contentLocale: "uk",
    title: "Тестерне тріо",
    summary: "Три аромати по 7 мл.",
    bodyHtml: "<p>Носіть кожен <strong>кілька днів</strong>.</p>",
    image: null,
    priceNote: "3 × 7 мл — від 499 ₴",
    validUntil: null,
    cta: { to: "/catalog/women", label: "Зібрати тріо" },
    products: [],
    ...overrides,
  };
}

const view = (overrides: Partial<OffersPageView> = {}): OffersPageView => ({
  hero: null,
  perks: [],
  groups: [],
  ...overrides,
});

describe("OfferCard", () => {
  it("shows the title, text, price note and CTA", () => {
    const html = render(createElement(OfferCard, { offer: offer() }));

    expect(html).toMatch(/<h3[^>]*>Тестерне тріо<\/h3>/);
    expect(html).toContain("Три аромати по 7 мл.");
    expect(html).toContain("<strong>кілька днів</strong>");
    expect(html).toContain("3 × 7 мл — від 499 ₴");
    expect(html).toMatch(/<a[^>]*href="\/catalog\/women"[^>]*>Зібрати тріо<\/a>/);
  });

  it("hides the CTA when there's no safe link, and uses a default label when there's no label", () => {
    expect(render(createElement(OfferCard, { offer: offer({ cta: null }) }))).not.toContain(
      'href="/catalog/women"',
    );
    expect(
      render(
        createElement(OfferCard, { offer: offer({ cta: { to: "/catalog/men", label: null } }) }),
      ),
    ).toMatch(/href="\/catalog\/men"[^>]*>Переглянути</);
  });

  it("says until when the offer is valid, with the time when it isn't midnight", () => {
    const untilDay = offer({ validUntil: { date: "8 January 2027", time: null } });
    const untilTime = offer({ validUntil: { date: "27 November 2026", time: "23:59" } });

    expect(render(createElement(OfferCard, { offer: untilDay }), "en")).toContain(
      "Valid until 8 January 2027",
    );
    expect(render(createElement(OfferCard, { offer: untilTime }), "en")).toContain(
      "Valid until 27 November 2026, 23:59",
    );
    expect(render(createElement(OfferCard, { offer: untilTime }))).toContain(
      "Діє до 27 November 2026, 23:59",
    );
  });

  it("lists the offer's products as cards under the offer's heading", () => {
    const html = render(createElement(OfferCard, { offer: offer({ products: [sauvage] }) }), "en");

    expect(html).toContain('aria-label="Scents in this offer"');
    expect(html).toMatch(/<h4[^>]*><a[^>]*href="\/products\/01a1652b[^"]*"[^>]*>Sauvage/);
  });

  it("marks Ukrainian copy shown on the English page with lang=uk", () => {
    expect(render(createElement(OfferCard, { offer: offer() }), "en")).toMatch(/<h3[^>]*lang="uk"/);
    expect(render(createElement(OfferCard, { offer: offer() }))).not.toMatch(/<h3[^>]*lang=/);
  });
});

describe("OffersPage", () => {
  it("puts the main campaign in the hero and the rest in groups by kind", () => {
    const html = render(
      createElement(OffersPage, {
        view: view({
          hero: offer({ slug: "winter", kind: "seasonal", title: "Winter holidays" }),
          perks: [
            offer({
              slug: "delivery",
              kind: "perk",
              title: "Free delivery",
              summary: "With Nova Poshta from 1000 ₴",
              cta: null,
            }),
          ],
          groups: [
            { kind: "discovery-set", offers: [offer({ title: "Tester trio" })] },
            { kind: "gift", offers: [offer({ slug: "gifts", kind: "gift", title: "Gifts" })] },
          ],
        }),
      }),
      "en",
    );

    expect(html).toMatch(/<h1[^>]*>Special offers<\/h1>/);
    expect(html).toMatch(/<section[^>]*class="[^"]*bg-primary[^"]*"[^>]*>[\s\S]*Winter holidays/);
    expect(html).toContain("Free delivery");
    expect(html).toContain("With Nova Poshta from 1000 ₴");
    const positions = [">Discovery sets<", ">Tester trio<", ">Gift ideas<", ">Gifts<"].map(
      (marker) => html.indexOf(marker),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).not.toContain("No offers right now");
  });

  it("shows the empty state, and still the perks, when no campaign is running", () => {
    const html = render(
      createElement(OffersPage, {
        view: view({ perks: [offer({ slug: "delivery", kind: "perk", title: "Free delivery" })] }),
      }),
      "en",
    );

    expect(html).toMatch(/<h1[^>]*>Special offers<\/h1>/);
    expect(html).toContain("No offers right now");
    expect(html).toContain("Free delivery");
    for (const href of ["/catalog/women", "/catalog/men", "/blog"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("renders in Ukrainian by default", () => {
    const html = render(createElement(OffersPage, { view: view() }));

    expect(html).toMatch(/<h1[^>]*>Акції та пропозиції<\/h1>/);
    expect(html).toContain("Зараз немає акцій");
  });
});
