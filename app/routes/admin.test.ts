import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.hoisted(() => vi.fn());

vi.mock("~/.server/services/auth", () => ({ requireAdmin }));

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/jassmin");
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
  vi.stubEnv("STRAPI_URL", "http://localhost:1337");
  vi.stubEnv("CMS_HTTP", "");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  requireAdmin.mockReset();
});

const ADMIN = { id: 1, fullName: "Olha", email: "olha@example.com", role: "admin" };

const args = (path: string) =>
  ({
    request: new Request(`http://localhost${path}`),
    params: {},
    context: {},
  }) as const;

// Every admin route module with a loader; `call` runs it as the router would.
const loaders = {
  "routes/admin": async (path: string) => (await import("./admin")).loader(args(path) as never),
  "routes/admin._index": async (path: string) =>
    (await import("./admin._index")).loader(args(path) as never),
  "routes/admin.products": async (path: string) =>
    (await import("./admin.products")).loader(args(path) as never),
  "routes/admin.orders": async (path: string) =>
    (await import("./admin.orders")).loader(args(path) as never),
};

describe("admin loaders", () => {
  it.each(Object.entries(loaders))("%s calls requireAdmin with the request", async (_, call) => {
    requireAdmin.mockResolvedValue(ADMIN);

    await call("/admin/orders").catch(() => undefined);

    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(requireAdmin.mock.calls[0]?.[0]).toBeInstanceOf(Request);
  });

  it.each(Object.entries(loaders))("%s lets a 403 from requireAdmin through", async (_, call) => {
    const forbidden = { type: "DataWithResponseInit", data: null, init: { status: 403 } };
    requireAdmin.mockRejectedValue(forbidden);

    await expect(call("/admin/orders")).rejects.toBe(forbidden);
  });

  it.each(Object.entries(loaders))("%s lets the login redirect through", async (_, call) => {
    const toLogin = new Response(null, {
      status: 302,
      headers: { Location: "/login?redirectTo=%2Fadmin" },
    });
    requireAdmin.mockRejectedValue(toLogin);

    await expect(call("/admin")).rejects.toBe(toLogin);
  });

  it("gives the layout the admin's name and the Strapi admin URL", async () => {
    requireAdmin.mockResolvedValue(ADMIN);

    expect(await loaders["routes/admin"]("/admin/products")).toEqual({
      adminName: "Olha",
      strapiAdminUrl: "http://localhost:1337/admin",
    });
  });

  it("sends /admin to the product list", async () => {
    requireAdmin.mockResolvedValue(ADMIN);

    const response = await loaders["routes/admin._index"]("/admin");

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe("/admin/products");
  });
});
