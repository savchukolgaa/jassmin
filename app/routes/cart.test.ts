import { beforeEach, describe, expect, it, vi } from "vitest";

const products = vi.hoisted(() => ({ checkVariantForCart: vi.fn() }));

vi.mock("~/.server/services/products", () => products);

type ActionArgs = Parameters<typeof import("./cart").action>[0];

const PRODUCT_ID = "01a1652b-6e25-7c03-ae47-25b57131fb06";
const VARIANT_ID = "01a1652b-6e25-7d00-8000-000000000050";

function post(fields: Record<string, string>): ActionArgs {
  const request = new Request("http://localhost/cart", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

/** A `data()` result's payload and status. */
function unwrap(result: unknown): { status: number; body: unknown } {
  const { data, init } = result as { data: unknown; init?: { status?: number } };
  return { status: init?.status ?? 200, body: data };
}

const valid = { intent: "add", productId: PRODUCT_ID, variantId: VARIANT_ID };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cart action", () => {
  it("rejects a submission without a valid variant id", async () => {
    const { action } = await import("./cart");

    expect(unwrap(await action(post({ ...valid, variantId: "50" })))).toEqual({
      status: 400,
      body: { ok: false, error: "invalid" },
    });
    expect(products.checkVariantForCart).not.toHaveBeenCalled();
  });

  it("rejects a variant that doesn't belong to the product", async () => {
    products.checkVariantForCart.mockResolvedValueOnce({ ok: false, error: "invalid-variant" });
    const { action } = await import("./cart");

    expect(unwrap(await action(post(valid)))).toEqual({
      status: 400,
      body: { ok: false, error: "invalid-variant" },
    });
    expect(products.checkVariantForCart).toHaveBeenCalledWith(PRODUCT_ID, VARIANT_ID);
  });

  it("rejects a sold-out variant", async () => {
    products.checkVariantForCart.mockResolvedValueOnce({ ok: false, error: "out-of-stock" });
    const { action } = await import("./cart");

    expect(unwrap(await action(post(valid)))).toEqual({
      status: 409,
      body: { ok: false, error: "out-of-stock" },
    });
  });

  it("accepts a variant in stock (stored once the cart exists, #10)", async () => {
    products.checkVariantForCart.mockResolvedValueOnce({ ok: true, variant: { id: 1 } });
    const { action } = await import("./cart");

    expect(unwrap(await action(post(valid)))).toEqual({
      status: 200,
      body: { ok: false, error: "cart-unavailable" },
    });
  });
});
