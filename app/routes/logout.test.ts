import { describe, expect, it, vi } from "vitest";

const logout = vi.hoisted(() =>
  vi.fn(async () => new Response(null, { status: 302, headers: { Location: "/" } })),
);

vi.mock("~/.server/session", () => ({ logout }));

describe("logout route", () => {
  it("logs out on POST", async () => {
    const { action } = await import("./logout");
    const request = new Request("http://localhost/logout", { method: "POST" });

    const response = await action({ request, params: {}, context: {} } as unknown as Parameters<
      typeof action
    >[0]);

    expect(logout).toHaveBeenCalledWith(request);
    expect(response.headers.get("Location")).toBe("/");
  });

  it("only redirects home on GET", async () => {
    logout.mockClear();
    const { loader } = await import("./logout");

    const response = loader();

    expect(response.headers.get("Location")).toBe("/");
    expect(logout).not.toHaveBeenCalled();
  });
});
