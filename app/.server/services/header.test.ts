import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
const getCartCount = vi.hoisted(() => vi.fn());
const readVisitor = vi.hoisted(() => vi.fn());

vi.mock("./auth", () => ({ getUser }));
vi.mock("./cart", () => ({ getCartCount }));
vi.mock("../analytics", () => ({ readVisitor }));

const ANONYMOUS_ID = "0b6f1b8e-3f7e-4a52-9a43-3c1f7f1f2c11";

beforeEach(() => {
  vi.clearAllMocks();
  readVisitor.mockResolvedValue({});
  getCartCount.mockResolvedValue(0);
});

describe("getHeaderState", () => {
  it("is logged out with an empty cart without a user", async () => {
    getUser.mockResolvedValueOnce(null);
    const { getHeaderState } = await import("./header");

    expect(await getHeaderState(new Request("http://localhost/"))).toEqual({
      user: null,
      cartCount: 0,
    });
  });

  it("returns the logged-in user's id and their cart count", async () => {
    getUser.mockResolvedValueOnce({ id: 7, fullName: "Olena", email: "olena@example.com" });
    getCartCount.mockResolvedValueOnce(4);
    const { getHeaderState } = await import("./header");
    const request = new Request("http://localhost/");

    const state = await getHeaderState(request);

    expect(state).toEqual({ user: { id: 7 }, cartCount: 4 });
    expect(getUser).toHaveBeenCalledWith(request);
    expect(getCartCount).toHaveBeenCalledWith({ userId: 7 });
  });

  it("counts a guest's cart by their visitor id", async () => {
    getUser.mockResolvedValueOnce(null);
    readVisitor.mockResolvedValueOnce({ anonymousId: ANONYMOUS_ID });
    getCartCount.mockResolvedValueOnce(2);
    const { getHeaderState } = await import("./header");

    const state = await getHeaderState(new Request("http://localhost/"));

    expect(state).toEqual({ user: null, cartCount: 2 });
    expect(getCartCount).toHaveBeenCalledWith({ userId: null, anonymousId: ANONYMOUS_ID });
  });
});
