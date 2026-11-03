import type { ShouldRevalidateFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductDetail } from "~/lib/products";

const products = vi.hoisted(() => ({ resolveProductHandle: vi.fn(), getSimilarProducts: vi.fn() }));
const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("~/.server/services/products", () => products);
vi.mock("~/.server/analytics", () => analytics);

const { loader, meta, shouldRevalidate } = await import("./product");

type LoaderArgs = Parameters<typeof loader>[0];
type MetaArgs = Parameters<typeof meta>[0];

const PUBLIC_ID = "01a1652b-6e25-7c03-ae47-25b57131fb06";
const SLUG = "coco-mademoiselle";
const context = {};

function load(handle: string, search = "") {
  const request = new Request(`http://localhost/products/${handle}${search}`);
  return loader({ request, params: { handle }, context } as unknown as LoaderArgs);
}

/** The thrown 301 response's status and target. */
async function redirected(promise: Promise<unknown>) {
  const response = await promise.then(
    () => {
      throw new Error("expected a redirect");
    },
    (thrown: unknown) => thrown,
  );
  if (!(response instanceof Response)) throw new Error("expected a Response");
  return { status: response.status, location: response.headers.get("Location") };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("product loader", () => {
  it("renders the product by slug without its serial id and records product_view", async () => {
    const product = { id: PUBLIC_ID, slug: SLUG, title: "Coco" };
    products.resolveProductHandle.mockResolvedValueOnce({
      kind: "product",
      id: 42,
      product,
      available: true,
    });

    expect(await load(SLUG)).toEqual({ product, available: true, similar: [] });
    expect(products.getSimilarProducts).not.toHaveBeenCalled();
    expect(products.resolveProductHandle).toHaveBeenCalledWith(SLUG, "uk");
    expect(analytics.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context }),
      "product_view",
      { productId: 42, properties: { publicId: PUBLIC_ID } },
    );
  });

  it("answers 301 to the slug URL for an old link, keeping the query, without an event", async () => {
    products.resolveProductHandle.mockResolvedValue({
      kind: "redirect",
      publicId: PUBLIC_ID,
      slug: SLUG,
    });

    expect(await redirected(load(PUBLIC_ID, "?ref=offers&utm_source=x"))).toEqual({
      status: 301,
      location: `/parfumy/${SLUG}?ref=offers&utm_source=x`,
    });
    expect(await redirected(load("coco-old"))).toEqual({
      status: 301,
      location: `/parfumy/${SLUG}`,
    });
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });

  it("keeps an archived product's page (200) with similar perfumes (#88)", async () => {
    const product = { id: PUBLIC_ID, slug: SLUG, title: "Coco", gender: "women" };
    const similar = [{ id: "other" }];
    products.resolveProductHandle.mockResolvedValueOnce({
      kind: "product",
      id: 42,
      product,
      available: false,
    });
    products.getSimilarProducts.mockResolvedValueOnce(similar);

    expect(await load(SLUG)).toEqual({ product, available: false, similar });
    expect(products.getSimilarProducts).toHaveBeenCalledWith(42, product);
  });

  it("asks for the description in the URL's language (#100)", async () => {
    products.resolveProductHandle.mockResolvedValueOnce(null);
    await expect(load("x")).rejects.toMatchObject({ init: { status: 404 } });
    expect(products.resolveProductHandle).toHaveBeenLastCalledWith("x", "uk");

    products.resolveProductHandle.mockResolvedValueOnce(null);
    const request = new Request(`http://localhost/en/perfumes/${SLUG}`);
    await expect(
      loader({ request, params: { handle: SLUG }, context } as unknown as LoaderArgs),
    ).rejects.toMatchObject({ init: { status: 404 } });
    expect(products.resolveProductHandle).toHaveBeenLastCalledWith(SLUG, "en");
  });

  it("is a 404 without an event for an unknown handle", async () => {
    products.resolveProductHandle.mockResolvedValueOnce(null);

    await expect(load("nope")).rejects.toMatchObject({ init: { status: 404 } });
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });
});

describe("product shouldRevalidate", () => {
  const args = (overrides: Partial<ShouldRevalidateFunctionArgs>) =>
    ({ defaultShouldRevalidate: true, ...overrides }) as ShouldRevalidateFunctionArgs;

  it("doesn't reload (and re-record the view) after adding to the cart", () => {
    expect(shouldRevalidate(args({ formMethod: "POST", formAction: "/cart" }))).toBe(false);
  });

  it("reloads on navigation", () => {
    expect(shouldRevalidate(args({}))).toBe(true);
  });
});

describe("product meta", () => {
  const matches = [
    { id: "root", loaderData: { locale: "uk", site: { url: "https://jassmin.ua" } } },
  ];
  const location = { pathname: "/products/coco-mademoiselle", search: "?utm_source=telegram" };
  const variant = (price: string, inStock = true) => ({
    id: `v-${price}`,
    volumeMl: 50,
    price,
    stockQuantity: inStock ? 5 : 0,
    trackStock: true,
    inStock,
  });
  const product: ProductDetail = {
    id: PUBLIC_ID,
    slug: "coco-mademoiselle",
    title: "Coco Mademoiselle",
    brand: "Chanel",
    gender: "women",
    packSize: 1,
    image: { url: "/images/coco.jpg", srcSet: null, width: 800, height: 1000 },
    description: "Свіжий східний аромат.",
    descriptionLocale: "uk",
    fragranceFamilies: [],
    notes: [],
    storeCode: "3-D",
    variants: [variant("1250.00"), variant("3200.00", false)],
  };
  const run = (overrides: Partial<ProductDetail> = {}, available = true) =>
    meta({
      matches,
      location,
      loaderData: { product: { ...product, ...overrides }, available, similar: [] },
    } as unknown as MetaArgs);
  const content = (tags: ReturnType<typeof run>, property: string) => {
    const tag = tags.find((tag) => "property" in tag && tag.property === property);
    return tag && "content" in tag ? tag.content : undefined;
  };

  it("shows the name, image and price in link previews", () => {
    const tags = run();

    expect(tags).toContainEqual({ title: "Coco Mademoiselle — Chanel — Jassmin" });
    expect(content(tags, "og:type")).toBe("product");
    expect(content(tags, "og:title")).toBe("Coco Mademoiselle — Chanel — Jassmin");
    expect(content(tags, "og:image")).toBe("https://jassmin.ua/images/coco.jpg");
    expect(content(tags, "og:image:alt")).toBe("Coco Mademoiselle — Chanel");
    expect(String(content(tags, "og:description")).replace(/\s/gu, " ")).toBe(
      "Chanel Coco Mademoiselle — від 1 250 ₴. Свіжий східний аромат.",
    );
    expect(content(tags, "product:price:amount")).toBe("1250.00");
    expect(content(tags, "product:price:currency")).toBe("UAH");
    expect(content(tags, "product:availability")).toBe("in stock");
    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://jassmin.ua/products/coco-mademoiselle",
    });
  });

  it("shows a single price without 'from', and the default image without its own", () => {
    const tags = run({ variants: [variant("990.00", false)], image: null, description: null });

    expect(String(content(tags, "og:description")).replace(/\s/gu, " ")).toBe(
      "Chanel Coco Mademoiselle — 990 ₴. Купуйте в магазині парфумів Jassmin.",
    );
    expect(content(tags, "og:image")).toBe("https://jassmin.ua/og-default.jpg");
    expect(content(tags, "product:availability")).toBe("out of stock");
  });

  it("describes the English page with the English description (#100)", () => {
    const tags = meta({
      matches: [{ id: "root", loaderData: { locale: "en", site: { url: "https://jassmin.ua" } } }],
      location: { pathname: "/en/perfumes/coco-mademoiselle", search: "" },
      loaderData: {
        product: { ...product, description: "A fresh oriental scent.", descriptionLocale: "en" },
        available: true,
        similar: [],
      },
    } as unknown as MetaArgs);

    expect(String(content(tags, "og:description"))).toMatch(/A fresh oriental scent\.$/);
    const description = tags.find((tag) => "name" in tag && tag.name === "description");
    expect(description && "content" in description ? description.content : "").toMatch(
      /A fresh oriental scent\.$/,
    );
  });

  it("has no price tags without sizes", () => {
    const tags = run({ variants: [] });

    expect(content(tags, "product:price:amount")).toBeUndefined();
  });

  it("keeps a missing product out of the index", () => {
    const error = { status: 404, statusText: "", internal: false, data: null };
    expect(meta({ matches, location, error } as unknown as MetaArgs)).toEqual([
      { title: "Сторінку не знайдено — Jassmin" },
      { name: "robots", content: "noindex, follow" },
    ]);
  });

  it("keeps an archived product's page out of the index, without a canonical URL (#88)", () => {
    const tags = run({}, false);

    expect(tags).toContainEqual({ name: "robots", content: "noindex, follow" });
    expect(tags.some((tag) => "rel" in tag && tag.rel === "canonical")).toBe(false);
    expect(run()).not.toContainEqual({ name: "robots", content: "noindex, follow" });
  });
});
