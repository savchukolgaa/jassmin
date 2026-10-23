import { beforeEach, describe, expect, it, vi } from "vitest";

const products = vi.hoisted(() => ({ checkVariantForCart: vi.fn() }));
const cart = vi.hoisted(() => ({
  addItem: vi.fn(),
  getCartOwner: vi.fn(),
  getCartView: vi.fn(),
  removeItem: vi.fn(),
  updateQuantity: vi.fn(),
}));
const analytics = vi.hoisted(() => ({ getVisitor: vi.fn() }));

vi.mock("~/.server/services/products", () => products);
vi.mock("~/.server/services/cart", () => cart);
vi.mock("~/.server/analytics", () => analytics);

type ActionArgs = Parameters<typeof import("./cart").action>[0];
type LoaderArgs = Parameters<typeof import("./cart").loader>[0];

const PRODUCT_ID = "01a1652b-6e25-7c03-ae47-25b57131fb06";
const VARIANT_ID = "01a1652b-6e25-7d00-8000-000000000050";
const ANONYMOUS_ID = "0b6f1b8e-3f7e-4a52-9a43-3c1f7f1f2c11";
const SESSION_ID = "01a1652b-6e25-7e00-8000-000000000001";

const owner = { userId: null, anonymousId: ANONYMOUS_ID, sessionId: SESSION_ID };
const variant = { id: 1, productId: 2, stockQuantity: 5 };

function post(fields: Record<string, string>): ActionArgs {
  const request = new Request("http://localhost/cart", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

/** A `data()` result's payload, status and headers. */
function unwrap(result: unknown): { status: number; body: unknown; headers: Headers } {
  const { data, init } = result as {
    data: unknown;
    init?: { status?: number; headers?: HeadersInit };
  };
  return { status: init?.status ?? 200, body: data, headers: new Headers(init?.headers) };
}

const add = { intent: "add", productId: PRODUCT_ID, variantId: VARIANT_ID };

beforeEach(() => {
  vi.clearAllMocks();
  cart.getCartOwner.mockResolvedValue(owner);
});

describe("cart loader", () => {
  it("returns the visitor's cart", async () => {
    const view = { lines: [], itemCount: 0, subtotal: "0.00" };
    cart.getCartView.mockResolvedValueOnce(view);
    const { loader } = await import("./cart");
    const request = new Request("http://localhost/cart");

    expect(await loader({ request, params: {}, context: {} } as unknown as LoaderArgs)).toBe(view);
    expect(cart.getCartOwner).toHaveBeenCalledWith(request);
    expect(cart.getCartView).toHaveBeenCalledWith(owner);
  });
});

describe("cart action", () => {
  it("rejects invalid submissions without touching the cart", async () => {
    const { action } = await import("./cart");
    const invalid: Record<string, string>[] = [
      { ...add, variantId: "50" },
      { intent: "update", variantId: VARIANT_ID, quantity: "0" },
      { intent: "remove" },
      { intent: "clear" },
    ];

    for (const fields of invalid) {
      expect(unwrap(await action(post(fields)))).toMatchObject({
        status: 400,
        body: { ok: false, error: "invalid" },
      });
    }
    expect(products.checkVariantForCart).not.toHaveBeenCalled();
    expect(analytics.getVisitor).not.toHaveBeenCalled();
    expect(cart.addItem).not.toHaveBeenCalled();
    expect(cart.updateQuantity).not.toHaveBeenCalled();
    expect(cart.removeItem).not.toHaveBeenCalled();
  });

  describe("add", () => {
    it("rejects a variant that doesn't belong to the product", async () => {
      products.checkVariantForCart.mockResolvedValueOnce({ ok: false, error: "invalid-variant" });
      const { action } = await import("./cart");

      expect(unwrap(await action(post(add)))).toMatchObject({
        status: 400,
        body: { ok: false, error: "invalid-variant" },
      });
      expect(products.checkVariantForCart).toHaveBeenCalledWith(PRODUCT_ID, VARIANT_ID);
      expect(analytics.getVisitor).not.toHaveBeenCalled();
    });

    it("rejects a sold-out variant", async () => {
      products.checkVariantForCart.mockResolvedValueOnce({ ok: false, error: "out-of-stock" });
      const { action } = await import("./cart");

      expect(unwrap(await action(post(add)))).toMatchObject({
        status: 409,
        body: { ok: false, error: "out-of-stock" },
      });
      expect(cart.addItem).not.toHaveBeenCalled();
    });

    it("adds the variant to the visitor's cart and sets the visitor cookies", async () => {
      products.checkVariantForCart.mockResolvedValueOnce({ ok: true, variant });
      const headers = new Headers([["Set-Cookie", "anonymous_id=abc; Path=/; HttpOnly"]]);
      analytics.getVisitor.mockResolvedValueOnce({
        anonymousId: ANONYMOUS_ID,
        sessionId: SESSION_ID,
        headers,
      });
      cart.addItem.mockResolvedValueOnce({ ok: true });
      cart.getCartOwner.mockResolvedValueOnce({ userId: 7 });
      const { action } = await import("./cart");

      const result = unwrap(await action(post({ ...add, quantity: "2" })));

      expect(result).toMatchObject({ status: 200, body: { ok: true, intent: "add" } });
      expect(result.headers.get("Set-Cookie")).toMatch(/^anonymous_id=abc/);
      expect(cart.addItem).toHaveBeenCalledWith(
        { userId: 7, anonymousId: ANONYMOUS_ID, sessionId: SESSION_ID },
        variant,
        2,
      );
    });

    it("returns the stock left when the line would exceed it", async () => {
      products.checkVariantForCart.mockResolvedValueOnce({ ok: true, variant });
      analytics.getVisitor.mockResolvedValueOnce({ ...owner, headers: new Headers() });
      cart.addItem.mockResolvedValueOnce({ ok: false, error: "exceeds-stock", available: 5 });
      const { action } = await import("./cart");

      expect(unwrap(await action(post(add)))).toMatchObject({
        status: 409,
        body: { ok: false, error: "exceeds-stock", available: 5 },
      });
    });
  });

  describe("update", () => {
    const update = { intent: "update", variantId: VARIANT_ID, quantity: "3" };

    it("sets the line's quantity without creating a visitor session", async () => {
      cart.updateQuantity.mockResolvedValueOnce({ ok: true });
      const { action } = await import("./cart");

      expect(unwrap(await action(post(update)))).toMatchObject({
        status: 200,
        body: { ok: true, intent: "update" },
      });
      expect(cart.updateQuantity).toHaveBeenCalledWith(owner, VARIANT_ID, 3);
      expect(analytics.getVisitor).not.toHaveBeenCalled();
    });

    it("rejects quantities above stock and lines that aren't in the cart", async () => {
      cart.updateQuantity
        .mockResolvedValueOnce({ ok: false, error: "exceeds-stock", available: 2 })
        .mockResolvedValueOnce({ ok: false, error: "not-in-cart" });
      const { action } = await import("./cart");

      expect(unwrap(await action(post(update)))).toMatchObject({
        status: 409,
        body: { ok: false, error: "exceeds-stock", available: 2 },
      });
      expect(unwrap(await action(post(update)))).toMatchObject({
        status: 404,
        body: { ok: false, error: "not-in-cart" },
      });
    });
  });

  describe("remove", () => {
    const remove = { intent: "remove", variantId: VARIANT_ID };

    it("removes the line", async () => {
      cart.removeItem.mockResolvedValueOnce({ ok: true });
      const { action } = await import("./cart");

      expect(unwrap(await action(post(remove)))).toMatchObject({
        status: 200,
        body: { ok: true, intent: "remove" },
      });
      expect(cart.removeItem).toHaveBeenCalledWith(owner, VARIANT_ID);
    });

    it("returns not-in-cart for a line that's already gone", async () => {
      cart.removeItem.mockResolvedValueOnce({ ok: false, error: "not-in-cart" });
      const { action } = await import("./cart");

      expect(unwrap(await action(post(remove)))).toMatchObject({
        status: 404,
        body: { ok: false, error: "not-in-cart" },
      });
    });
  });
});
