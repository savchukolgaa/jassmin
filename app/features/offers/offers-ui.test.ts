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
  slug: "sauvage-eau-de-toilette",
  title: "Sauvage Eau de Toilette",
  brand: "Dior",
  gender: "men",
  packSize: 1,
  image: null,
  variants: [
    { id: "01a1652b-6e25-7c44-8d5b-000000000010", volumeMl: 10, price: "790.00", inStock: true },
    { id: "01a1652b-6e25-7c44-8d5b-000000000050", volumeMl: 50, price: "3290.00", inStock: true },
    { id: "01a1652b-6e25-7c44-8d5b-000000000100", volumeMl: 100, price: "5190.00", inStock: true },
  ],
  minPrice: "790.00",
  hasPriceRange: true,
  volumes: [10, 50, 100],
  inStock: true,
  defaultVariant: { id: "01a1652b-6e25-7c44-8d5b-000000000010", volumeMl: 10 },
  fragranceFamily: null,
};

function offer(overrides: Partial<OfferView> = {}): OfferView {
  return {
    slug: "tester-trio",
    kind: "discovery-set",
    contentLocale: "uk",
    title: "Тестерне тріо",
    summary: "Три аромати по 10 мл.",
    bodyHtml: "<p>Носіть кожен <strong>кілька днів</strong>.</p>",
    image: null,
    priceNote: "3 × 10 мл — 499 ₴",
    validUntil: null,
    cta: { to: "/en/catalog/women", label: "Зібрати тріо" },
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
    expect(html).toContain("Три аромати по 10 мл.");
    expect(html).toContain("<strong>кілька днів</strong>");
    expect(html).toContain("3 × 10 мл — 499 ₴");
    expect(html).toMatch(/<a[^>]*href="\/en\/catalog\/women"[^>]*>Зібрати тріо<\/a>/);
  });

  it("hides the CTA when there's no safe link, and uses a default label when there's no label", () => {
    expect(render(createElement(OfferCard, { offer: offer({ cta: null }) }))).not.toContain(
      'href="/en/catalog/women"',
    );
    expect(
      render(
        createElement(OfferCard, { offer: offer({ cta: { to: "/en/catalog/men", label: null } }) }),
      ),
    ).toMatch(/href="\/en\/catalog\/men"[^>]*>Переглянути</);
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
    expect(html).toMatch(
      /<h4[^>]*><a[^>]*href="\/en\/perfumes\/sauvage-eau-de-toilette"[^>]*>Sauvage/,
    );
  });

  it("describes the offer photo with its title when Strapi's alt is blank (#88)", () => {
    const image = {
      url: "http://cms.test/uploads/o.jpg",
      alt: "",
      width: 1,
      height: 1,
      srcSet: null,
    };
    const html = render(createElement(OfferCard, { offer: offer({ image }) }), "en");

    expect(html).toContain('alt="Offer: Тестерне тріо"');
    expect(html).toContain('loading="lazy"');
    const own = offer({ image: { ...image, alt: "Три тестери" } });
    expect(render(createElement(OfferCard, { offer: own }))).toContain('alt="Три тестери"');
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
              summary: "With Nova Poshta from 1500 ₴",
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
    expect(html).toContain("With Nova Poshta from 1500 ₴");
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
    for (const href of ["/en/catalog/women", "/en/catalog/men", "/en/blog"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("shows the couple offer in the bundles group in both languages (#124)", () => {
    const couple = (locale: "uk" | "en") =>
      offer({
        slug: "couple-offer",
        kind: "bundle",
        contentLocale: locale,
        title: locale === "uk" ? "Пропозиція для двох" : "Couple offer",
        summary: null,
        bodyHtml: null,
        priceNote: locale === "uk" ? "−15% на другий флакон" : "−15% on the second bottle",
        cta: {
          to: `/${locale}/catalog/women`,
          label: locale === "uk" ? "Обрати пару" : "Choose a pair",
        },
      });
    const page = (locale: "uk" | "en") =>
      render(
        createElement(OffersPage, {
          view: view({
            hero: offer({ slug: "winter", kind: "seasonal", title: "Winter holidays" }),
            groups: [{ kind: "bundle", offers: [couple(locale)] }],
          }),
        }),
        locale,
      );

    const uk = page("uk");
    expect(uk).toContain(">Набори<");
    expect(uk).toMatch(/<h3[^>]*>Пропозиція для двох<\/h3>/);
    expect(uk).toContain("−15% на другий флакон");
    expect(uk).toMatch(/<a[^>]*href="\/uk\/catalog\/women"[^>]*>Обрати пару<\/a>/);

    const en = page("en");
    expect(en).toContain(">Bundles<");
    expect(en).toMatch(/<h3[^>]*>Couple offer<\/h3>/);
    expect(en).toContain("−15% on the second bottle");
    expect(en).toMatch(/<a[^>]*href="\/en\/catalog\/women"[^>]*>Choose a pair<\/a>/);
  });

  it("shows the gift card offer next to the couple offer in both languages (#126)", () => {
    const giftCards = (locale: "uk" | "en") =>
      offer({
        slug: "gift-cards",
        kind: "gift",
        contentLocale: locale,
        title:
          locale === "uk"
            ? "Подарункові картки на 500, 1000 і 2000 ₴"
            : "Gift cards of 500, 1000 and 2000 ₴",
        summary: null,
        bodyHtml: null,
        priceNote: "500 · 1000 · 2000 ₴",
        cta: {
          to: locale === "uk" ? "/podarunkovi-kartky" : "/en/gift-cards",
          label: locale === "uk" ? "Обрати картку" : "Choose a card",
        },
      });
    const couple = (locale: "uk" | "en") =>
      offer({
        slug: "couple-offer",
        kind: "bundle",
        contentLocale: locale,
        title: locale === "uk" ? "Пропозиція для двох" : "Couple offer",
        summary: null,
        bodyHtml: null,
        cta: null,
      });
    const page = (locale: "uk" | "en") =>
      render(
        createElement(OffersPage, {
          view: view({
            hero: offer({ slug: "winter", kind: "seasonal", title: "Winter holidays" }),
            groups: [
              { kind: "gift", offers: [giftCards(locale)] },
              { kind: "bundle", offers: [couple(locale)] },
            ],
          }),
        }),
        locale,
      );

    const uk = page("uk");
    expect(uk).toContain(">Ідеї подарунків<");
    expect(uk).toMatch(/<h3[^>]*>Подарункові картки на 500, 1000 і 2000 ₴<\/h3>/);
    expect(uk).toContain("500 · 1000 · 2000 ₴");
    expect(uk).toMatch(/<a[^>]*href="\/podarunkovi-kartky"[^>]*>Обрати картку<\/a>/);
    expect(uk).toMatch(/<h3[^>]*>Пропозиція для двох<\/h3>/);
    expect(uk).not.toContain("Подарунки за бюджетом");

    const en = page("en");
    expect(en).toContain(">Gift ideas<");
    expect(en).toMatch(/<h3[^>]*>Gift cards of 500, 1000 and 2000 ₴<\/h3>/);
    expect(en).toContain("500 · 1000 · 2000 ₴");
    expect(en).toMatch(/<a[^>]*href="\/en\/gift-cards"[^>]*>Choose a card<\/a>/);
    expect(en).toMatch(/<h3[^>]*>Couple offer<\/h3>/);
    expect(en).not.toContain("Gifts by budget");
  });

  it("renders in Ukrainian by default", () => {
    const html = render(createElement(OffersPage, { view: view() }));

    expect(html).toMatch(/<h1[^>]*>Акції та пропозиції<\/h1>/);
    expect(html).toContain("Зараз немає акцій");
  });
});
