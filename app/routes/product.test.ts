import type { ShouldRevalidateFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const products = vi.hoisted(() => ({ resolveProductHandle: vi.fn() }));
const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("~/.server/services/products", () => products);
vi.mock("~/.server/analytics", () => analytics);

const { loader, shouldRevalidate } = await import("./product");

type LoaderArgs = Parameters<typeof loader>[0];

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
    products.resolveProductHandle.mockResolvedValueOnce({ kind: "product", id: 42, product });

    expect(await load(SLUG)).toEqual({ product });
    expect(products.resolveProductHandle).toHaveBeenCalledWith(SLUG);
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
      location: `/products/${SLUG}?ref=offers&utm_source=x`,
    });
    expect(await redirected(load("coco-old"))).toEqual({
      status: 301,
      location: `/products/${SLUG}`,
    });
    expect(analytics.trackEvent).not.toHaveBeenCalled();
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
