import { beforeEach, describe, expect, it, vi } from "vitest";

const products = vi.hoisted(() => ({ checkVariantForCart: vi.fn() }));
const cart = vi.hoisted(() => ({
  addItem: vi.fn(),
  getCartOwner: vi.fn(),
  getCartView: vi.fn(),
  removeItem: vi.fn(),
  updateQuantity: vi.fn(),
  applyPromoCode: vi.fn(),
  removePromoCode: vi.fn(),
}));
const analytics = vi.hoisted(() => ({ ensureVisitor: vi.fn(), trackEvent: vi.fn() }));

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
const variant = { id: 1, productId: 2, volumeMl: 50, stockQuantity: 5 };
const context = {};

function post(fields: Record<string, string>, ip?: string): ActionArgs {
  const request = new Request("http://localhost/cart", {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: ip ? { "X-Forwarded-For": ip } : {},
  });
  return { request, params: {}, context } as unknown as ActionArgs;
}

/** A `data()` result's payload and status. */
function unwrap(result: unknown): { status: number; body: unknown } {
  const { data, init } = result as { data: unknown; init?: { status?: number } };
  return { status: init?.status ?? 200, body: data };
}

/** A successful change of `quantityDelta` units of the 50 ml variant. */
function changed(quantityDelta: number) {
  return { ok: true, change: { productId: 2, volumeMl: 50, quantityDelta } };
}

/** The event the action recorded, as `[type, options]`. */
function trackedEvents() {
  return analytics.trackEvent.mock.calls.map(([args, type, options]) => {
    expect(args).toMatchObject({ context });
    return [type, options];
  });
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
    expect(analytics.ensureVisitor).not.toHaveBeenCalled();
    expect(cart.addItem).not.toHaveBeenCalled();
    expect(cart.updateQuantity).not.toHaveBeenCalled();
    expect(cart.removeItem).not.toHaveBeenCalled();
    expect(analytics.trackEvent).not.toHaveBeenCalled();
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
      expect(analytics.ensureVisitor).not.toHaveBeenCalled();
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

    it("adds the variant to the visitor's cart and records add_to_cart", async () => {
      products.checkVariantForCart.mockResolvedValueOnce({ ok: true, variant });
      analytics.ensureVisitor.mockResolvedValueOnce({
        anonymousId: ANONYMOUS_ID,
        sessionId: SESSION_ID,
        headers: new Headers(),
      });
      cart.addItem.mockResolvedValueOnce(changed(2));
      cart.getCartOwner.mockResolvedValueOnce({ userId: 7 });
      const { action } = await import("./cart");

      const result = unwrap(await action(post({ ...add, quantity: "2" })));

      expect(result).toMatchObject({ status: 200, body: { ok: true, intent: "add" } });
      expect(analytics.ensureVisitor).toHaveBeenCalledWith(expect.objectContaining({ context }));
      expect(cart.addItem).toHaveBeenCalledWith(
        { userId: 7, anonymousId: ANONYMOUS_ID, sessionId: SESSION_ID },
        variant,
        2,
      );
      expect(trackedEvents()).toEqual([
        [
          "add_to_cart",
          { productId: 2, properties: { variantId: VARIANT_ID, volumeMl: 50, quantity: 2 } },
        ],
      ]);
    });

    it("returns the stock left when the line would exceed it, without an event", async () => {
      products.checkVariantForCart.mockResolvedValueOnce({ ok: true, variant });
      analytics.ensureVisitor.mockResolvedValueOnce({ ...owner, headers: new Headers() });
      cart.addItem.mockResolvedValueOnce({ ok: false, error: "exceeds-stock", available: 5 });
      const { action } = await import("./cart");

      expect(unwrap(await action(post(add)))).toMatchObject({
        status: 409,
        body: { ok: false, error: "exceeds-stock", available: 5 },
      });
      expect(analytics.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    const update = { intent: "update", variantId: VARIANT_ID, quantity: "3" };

    it("sets the line's quantity without creating a visitor session", async () => {
      cart.updateQuantity.mockResolvedValueOnce(changed(1));
      const { action } = await import("./cart");

      expect(unwrap(await action(post(update)))).toMatchObject({
        status: 200,
        body: { ok: true, intent: "update" },
      });
      expect(cart.updateQuantity).toHaveBeenCalledWith(owner, VARIANT_ID, 3);
      expect(analytics.ensureVisitor).not.toHaveBeenCalled();
    });

    it("records the stepper's change as add_to_cart or remove_from_cart", async () => {
      cart.updateQuantity
        .mockResolvedValueOnce(changed(1))
        .mockResolvedValueOnce(changed(-2))
        .mockResolvedValueOnce(changed(0));
      const { action } = await import("./cart");

      await action(post(update));
      await action(post(update));
      await action(post(update));

      const properties = { variantId: VARIANT_ID, volumeMl: 50, source: "stepper" };
      expect(trackedEvents()).toEqual([
        ["add_to_cart", { productId: 2, properties: { ...properties, quantity: 1 } }],
        ["remove_from_cart", { productId: 2, properties: { ...properties, quantity: 2 } }],
      ]);
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
      expect(analytics.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    const remove = { intent: "remove", variantId: VARIANT_ID };

    it("removes the line and records remove_from_cart", async () => {
      cart.removeItem.mockResolvedValueOnce(changed(-3));
      const { action } = await import("./cart");

      expect(unwrap(await action(post(remove)))).toMatchObject({
        status: 200,
        body: { ok: true, intent: "remove" },
      });
      expect(cart.removeItem).toHaveBeenCalledWith(owner, VARIANT_ID);
      expect(trackedEvents()).toEqual([
        [
          "remove_from_cart",
          { productId: 2, properties: { variantId: VARIANT_ID, volumeMl: 50, quantity: 3 } },
        ],
      ]);
    });

    it("returns not-in-cart for a line that's already gone", async () => {
      cart.removeItem.mockResolvedValueOnce({ ok: false, error: "not-in-cart" });
      const { action } = await import("./cart");

      expect(unwrap(await action(post(remove)))).toMatchObject({
        status: 404,
        body: { ok: false, error: "not-in-cart" },
      });
      expect(analytics.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("promo codes (#59)", () => {
    // The limiter is shared by the whole process, so each test posts from its own address.
    let ipCounter = 0;
    const nextIp = () => `203.0.113.${++ipCounter}`;

    it("applies a normalised code", async () => {
      cart.applyPromoCode.mockResolvedValueOnce({ ok: true, status: "applied" });
      const { action } = await import("./cart");

      expect(
        unwrap(await action(post({ intent: "apply-promo", code: " jassmin10 " }, nextIp()))),
      ).toEqual({ status: 200, body: { ok: true, intent: "apply-promo" } });
      expect(cart.applyPromoCode).toHaveBeenCalledWith(owner, "JASSMIN10");
    });

    it("answers a malformed code as an unknown one, without a lookup", async () => {
      const { action } = await import("./cart");

      for (const code of ["", "no spaces", "x".repeat(41)]) {
        expect(unwrap(await action(post({ intent: "apply-promo", code }, nextIp())))).toEqual({
          status: 400,
          body: { ok: false, error: "promo-invalid" },
        });
      }
      expect(cart.applyPromoCode).not.toHaveBeenCalled();
    });

    it("returns the refusal with its status", async () => {
      const { action } = await import("./cart");
      for (const [error, status] of [
        ["promo-invalid", 400],
        ["promo-expired", 409],
        ["promo-used-up", 409],
        ["promo-not-applicable", 409],
      ] as const) {
        cart.applyPromoCode.mockResolvedValueOnce({ ok: false, error });
        expect(unwrap(await action(post({ intent: "apply-promo", code: "X1" }, nextIp())))).toEqual(
          { status, body: { ok: false, error } },
        );
      }
    });

    it("stops checking codes after 10 refusals from one client", async () => {
      cart.applyPromoCode.mockResolvedValue({ ok: false, error: "promo-invalid" });
      const { action } = await import("./cart");
      const ip = nextIp();

      for (let i = 0; i < 10; i++) {
        await action(post({ intent: "apply-promo", code: `GUESS${i}` }, ip));
      }
      expect(unwrap(await action(post({ intent: "apply-promo", code: "GUESS10" }, ip)))).toEqual({
        status: 429,
        body: { ok: false, error: "promo-rate-limited" },
      });
      expect(cart.applyPromoCode).toHaveBeenCalledTimes(10);
      // Another client isn't affected.
      await action(post({ intent: "apply-promo", code: "MINE" }, nextIp()));
      expect(cart.applyPromoCode).toHaveBeenCalledTimes(11);
      cart.applyPromoCode.mockReset();
    });

    it("removes the code", async () => {
      const { action } = await import("./cart");

      expect(unwrap(await action(post({ intent: "remove-promo" })))).toEqual({
        status: 200,
        body: { ok: true, intent: "remove-promo" },
      });
      expect(cart.removePromoCode).toHaveBeenCalledWith(owner);
    });
  });
});
