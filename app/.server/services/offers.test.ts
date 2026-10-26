import { describe, expect, it } from "vitest";
import type { Offer, OfferKind } from "~/lib/cms";
import { hasNoOffers } from "~/lib/offers";
import type { ProductSummary } from "~/lib/products";
import { buildOffersPageView, offerProductIds } from "./offers";

const COCO = "01a1652b-6e25-7c03-ae47-25b57131fb06";
const SAUVAGE = "01a1652b-6e25-7c44-8d5b-bce46a20ad83";
const MISSING = "01a1652b-6e25-7fff-8000-000000000000";

function offer(slug: string, kind: OfferKind, overrides: Partial<Offer> = {}): Offer {
  return {
    locale: "uk",
    documentId: `doc-${slug}`,
    slug,
    kind,
    title: slug,
    summary: null,
    body: null,
    image: null,
    startsAt: null,
    endsAt: null,
    priceNote: null,
    productIds: [],
    ctaLabel: null,
    ctaUrl: null,
    sortOrder: 0,
    ...overrides,
  };
}

function product(id: string, title: string): ProductSummary {
  return {
    id,
    title,
    brand: "Brand",
    gender: "women",
    packSize: 1,
    imageUrl: null,
    minPrice: "990.00",
    hasPriceRange: false,
    volumes: [7],
    inStock: true,
    defaultVariant: { id: `${id}-v`, volumeMl: 7 },
    fragranceFamily: null,
  };
}

const PRODUCTS = new Map([
  [COCO, product(COCO, "Coco")],
  [SAUVAGE, product(SAUVAGE, "Sauvage")],
]);

describe("buildOffersPageView", () => {
  it("makes the first non-perk offer the hero, whatever its kind", () => {
    const view = buildOffersPageView(
      [
        offer("delivery", "perk"),
        offer("trio", "discovery-set"),
        offer("winter", "seasonal"),
        offer("gifts", "gift"),
      ],
      PRODUCTS,
    );

    expect(view.hero?.slug).toBe("trio");
    expect(view.perks.map((p) => p.slug)).toEqual(["delivery"]);
    expect(view.groups).toEqual([
      { kind: "seasonal", offers: [expect.objectContaining({ slug: "winter" })] },
      { kind: "gift", offers: [expect.objectContaining({ slug: "gifts" })] },
    ]);
  });

  it("groups cards in the fixed kind order, keeping editor order within a group", () => {
    const view = buildOffersPageView(
      [
        offer("hero", "featured"),
        offer("last", "last-units"),
        offer("gift-b", "gift"),
        offer("bundle", "bundle"),
        offer("gift-a", "gift"),
        offer("trio", "discovery-set"),
      ],
      PRODUCTS,
    );

    expect(view.groups.map((g) => [g.kind, g.offers.map((o) => o.slug)])).toEqual([
      ["discovery-set", ["trio"]],
      ["gift", ["gift-b", "gift-a"]],
      ["bundle", ["bundle"]],
      ["last-units", ["last"]],
    ]);
  });

  it("resolves products in the editor's order and skips missing ones", () => {
    const view = buildOffersPageView(
      [offer("gifts", "gift", { productIds: [SAUVAGE, MISSING, COCO] })],
      PRODUCTS,
    );

    expect(view.hero?.products.map((p) => p.title)).toEqual(["Sauvage", "Coco"]);
  });

  it("links only to app paths, with the editor's label or none", () => {
    const view = buildOffersPageView(
      [
        offer("ok", "gift", { ctaUrl: "/catalog/men", ctaLabel: "For him" }),
        offer("no-label", "gift", { ctaUrl: "/catalog/women" }),
        offer("external", "gift", { ctaUrl: "https://evil.test", ctaLabel: "Click" }),
        offer("script", "gift", { ctaUrl: "javascript:alert(1)", ctaLabel: "Click" }),
      ],
      PRODUCTS,
    );
    const offers = [view.hero, ...(view.groups[0]?.offers ?? [])];

    expect(offers.map((o) => o?.cta)).toEqual([
      { to: "/catalog/men", label: "For him" },
      { to: "/catalog/women", label: null },
      null,
      null,
    ]);
  });

  it("renders the Markdown body to sanitized HTML", () => {
    const view = buildOffersPageView(
      [offer("trio", "discovery-set", { body: "**Три** аромати <script>alert(1)</script>" })],
      PRODUCTS,
    );

    expect(view.hero?.bodyHtml).toContain("<strong>Три</strong>");
    expect(view.hero?.bodyHtml).not.toContain("<script");
  });

  it("shows the last day for an offer that ends at Kyiv midnight", () => {
    // 9 January 00:00 in Kyiv (UTC+2): valid through 8 January.
    const view = buildOffersPageView(
      [offer("winter", "seasonal", { endsAt: "2027-01-08T22:00:00.000Z" })],
      PRODUCTS,
      "en",
    );

    expect(view.hero?.validUntil).toEqual({ date: "8 January 2027", time: null });
  });

  it("shows the date and time in shop time for an offer that ends during the day", () => {
    // 27 November 21:59 UTC is 23:59 in Kyiv.
    const view = buildOffersPageView(
      [offer("black-friday", "seasonal", { endsAt: "2026-11-27T21:59:00.000Z" })],
      PRODUCTS,
      "uk",
    );

    expect(view.hero?.validUntil?.time).toBe("23:59");
    expect(view.hero?.validUntil?.date.replace(/\s/gu, " ")).toBe("27 листопада 2026 р.");
  });

  it("has no end date for an offer that doesn't end", () => {
    expect(buildOffersPageView([offer("trio", "gift")], PRODUCTS).hero?.validUntil).toBeNull();
  });

  it("is empty with only perks, or nothing at all", () => {
    const onlyPerks = buildOffersPageView([offer("delivery", "perk")], PRODUCTS);
    const nothing = buildOffersPageView([], PRODUCTS);

    expect(onlyPerks).toMatchObject({ hero: null, groups: [] });
    expect(onlyPerks.perks).toHaveLength(1);
    expect(hasNoOffers(onlyPerks)).toBe(true);
    expect(nothing).toEqual({ hero: null, perks: [], groups: [] });
    expect(hasNoOffers(buildOffersPageView([offer("trio", "gift")], PRODUCTS))).toBe(false);
  });

  it("keeps the content locale of each offer", () => {
    const view = buildOffersPageView([offer("gifts", "gift", { locale: "uk" })], PRODUCTS, "en");

    expect(view.hero?.contentLocale).toBe("uk");
  });
});

describe("offerProductIds", () => {
  it("lists every linked product once", () => {
    expect(
      offerProductIds([
        offer("a", "gift", { productIds: [COCO, SAUVAGE] }),
        offer("b", "gift", { productIds: [SAUVAGE, MISSING] }),
      ]),
    ).toEqual([COCO, SAUVAGE, MISSING]);
  });
});
