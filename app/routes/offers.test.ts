import { afterEach, describe, expect, it, vi } from "vitest";
import { CmsError } from "~/.server/cms/errors";
import type { Offer, OfferKind } from "~/lib/cms";
import type { ProductSummary } from "~/lib/products";

const content = vi.hoisted(() => ({ listActiveOffers: vi.fn() }));
vi.mock("~/.server/cms/content", () => content);

const products = vi.hoisted(() => ({ getProductSummaries: vi.fn() }));
vi.mock("~/.server/services/products", () => products);

const { headers, loader, meta } = await import("./offers");

type LoaderArgs = Parameters<typeof loader>[0];
type MetaArgs = Parameters<typeof meta>[0];
type HeadersArgs = Parameters<typeof headers>[0];

// `meta` reads the locale from the root match; the assertions are in English.
const EN = [{ id: "root", loaderData: { locale: "en" } }];

const COCO = "01a1652b-6e25-7c03-ae47-25b57131fb06";
const SAUVAGE = "01a1652b-6e25-7c44-8d5b-bce46a20ad83";
const MISSING = "01a1652b-6e25-7fff-8000-000000000000";

function offer(slug: string, kind: OfferKind, productIds: string[] = []): Offer {
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
    productIds,
    ctaLabel: null,
    ctaUrl: "/catalog/women",
    sortOrder: 0,
  };
}

function product(id: string): ProductSummary {
  return {
    id,
    slug: null,
    title: id,
    brand: "Brand",
    gender: "women",
    packSize: 1,
    imageUrl: null,
    variants: [{ id: `${id}-v`, volumeMl: 5, price: "990.00", inStock: true }],
    minPrice: "990.00",
    hasPriceRange: false,
    volumes: [5],
    inStock: true,
    defaultVariant: { id: `${id}-v`, volumeMl: 5 },
    fragranceFamily: null,
  };
}

function load(url = "http://localhost/offers", init?: RequestInit) {
  return loader({ request: new Request(url, init), params: {} } as unknown as LoaderArgs);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("offers loader", () => {
  it("asks for the offers in the visitor's locale", async () => {
    content.listActiveOffers.mockResolvedValue([]);
    products.getProductSummaries.mockResolvedValue(new Map());

    await load("http://localhost/offers", { headers: { "Accept-Language": "en-US,en;q=0.9" } });

    expect(content.listActiveOffers).toHaveBeenCalledExactlyOnceWith("en");
  });

  it("resolves every offer's products in one lookup and drops the missing ones", async () => {
    content.listActiveOffers.mockResolvedValue([
      offer("winter", "seasonal", [SAUVAGE, MISSING]),
      offer("delivery", "perk"),
      offer("trio", "discovery-set", [COCO, SAUVAGE]),
    ]);
    products.getProductSummaries.mockResolvedValue(
      new Map([
        [COCO, product(COCO)],
        [SAUVAGE, product(SAUVAGE)],
      ]),
    );

    const result = await load();

    expect(products.getProductSummaries).toHaveBeenCalledExactlyOnceWith([SAUVAGE, MISSING, COCO]);
    expect(result.data.hero?.slug).toBe("winter");
    expect(result.data.hero?.products.map((p) => p.id)).toEqual([SAUVAGE]);
    expect(result.data.perks.map((p) => p.slug)).toEqual(["delivery"]);
    expect(result.data.groups).toEqual([
      {
        kind: "discovery-set",
        offers: [
          expect.objectContaining({ slug: "trio", products: [product(COCO), product(SAUVAGE)] }),
        ],
      },
    ]);
    expect(result.data.canonicalUrl).toBe("http://localhost/offers");
  });

  it("returns an empty page when no offer is active", async () => {
    content.listActiveOffers.mockResolvedValue([]);
    products.getProductSummaries.mockResolvedValue(new Map());

    const result = await load();

    expect(result.data).toMatchObject({ hero: null, perks: [], groups: [] });
  });

  it("turns a CMS outage into a 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    content.listActiveOffers.mockRejectedValue(new CmsError("unreachable", "Strapi is down"));

    await expect(load()).rejects.toMatchObject({ init: { status: 503 } });
    expect(products.getProductSummaries).not.toHaveBeenCalled();
  });

  it("lets shared caches store the page only for visitors without a session", async () => {
    content.listActiveOffers.mockResolvedValue([]);
    products.getProductSummaries.mockResolvedValue(new Map());

    const anonymous = await load();
    const withSession = await load("http://localhost/offers", {
      headers: { Cookie: "__jassmin_session=abc" },
    });

    const anonymousHeaders = new Headers(anonymous.init?.headers);
    expect(anonymousHeaders.get("Cache-Control")).toMatch(/^public, max-age=60/);
    expect(anonymousHeaders.get("Vary")).toBe("Cookie, Accept-Language");
    expect(new Headers(withSession.init?.headers).get("Cache-Control")).toBe("private, no-cache");
  });
});

describe("offers headers", () => {
  it("doesn't cache error responses", () => {
    const result = headers({ loaderHeaders: new Headers() } as unknown as HeadersArgs);
    expect(new Headers(result).get("Cache-Control")).toBe("no-store");
  });
});

describe("offers meta", () => {
  it("has a title and description, with or without loader data", () => {
    const tags = meta({ loaderData: undefined, matches: EN } as unknown as MetaArgs);

    expect(tags).toContainEqual({ title: "Special offers — Jassmin" });
    expect(tags).toContainEqual({
      name: "description",
      content: "Tester sets, seasonal picks, gift ideas and last bottles at Jassmin.",
    });
  });

  it("sets the canonical URL and the hero's image", () => {
    const tags = meta({
      matches: EN,
      loaderData: {
        hero: { image: { url: "http://cms.test/uploads/hero.jpg" } },
        perks: [],
        groups: [],
        canonicalUrl: "http://x/offers",
      },
    } as unknown as MetaArgs);

    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "http://x/offers" });
    expect(tags).toContainEqual({
      property: "og:image",
      content: "http://cms.test/uploads/hero.jpg",
    });
  });
});
