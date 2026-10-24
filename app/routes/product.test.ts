import type { ShouldRevalidateFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const products = vi.hoisted(() => ({ getProductWithId: vi.fn() }));
const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("~/.server/services/products", () => products);
vi.mock("~/.server/analytics", () => analytics);

const { loader, shouldRevalidate } = await import("./product");

type LoaderArgs = Parameters<typeof loader>[0];

const PUBLIC_ID = "01a1652b-6e25-7c03-ae47-25b57131fb06";
const context = {};

function load(id: string) {
  const request = new Request(`http://localhost/products/${id}`);
  return loader({ request, params: { id }, context } as unknown as LoaderArgs);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("product loader", () => {
  it("returns the product without its serial id and records product_view", async () => {
    const product = { id: PUBLIC_ID, title: "Coco" };
    products.getProductWithId.mockResolvedValueOnce({ id: 42, product });

    expect(await load(PUBLIC_ID)).toEqual({ product });
    expect(analytics.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context }),
      "product_view",
      { productId: 42, properties: { publicId: PUBLIC_ID } },
    );
  });

  it("is a 404 without an event for an unknown or malformed id", async () => {
    products.getProductWithId.mockResolvedValueOnce(null);

    await expect(load(PUBLIC_ID)).rejects.toMatchObject({ init: { status: 404 } });
    await expect(load("abc")).rejects.toMatchObject({ init: { status: 404 } });
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
