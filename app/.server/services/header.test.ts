import { describe, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());

vi.mock("./auth", () => ({ getUser }));

describe("getHeaderState", () => {
  it("is logged out with an empty cart without a user", async () => {
    getUser.mockResolvedValueOnce(null);
    const { getHeaderState } = await import("./header");

    expect(await getHeaderState(new Request("http://localhost/"))).toEqual({
      user: null,
      cartCount: 0,
    });
  });

  it("returns the logged-in user's id", async () => {
    getUser.mockResolvedValueOnce({ id: 7, fullName: "Olena", email: "olena@example.com" });
    const { getHeaderState } = await import("./header");
    const request = new Request("http://localhost/");

    const state = await getHeaderState(request);

    expect(state.user).toEqual({ id: 7 });
    expect(getUser).toHaveBeenCalledWith(request);
  });
});
