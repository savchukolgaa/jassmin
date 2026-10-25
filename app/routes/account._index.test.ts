import { redirect } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
const orders = vi.hoisted(() => ({ getAccountOrders: vi.fn() }));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/services/orders", () => orders);

type LoaderArgs = Parameters<typeof import("./account._index").loader>[0];

const load = async () => {
  const { loader } = await import("./account._index");
  const request = new Request("http://localhost/account");
  return loader({ request, params: {}, context: {} } as unknown as LoaderArgs);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("account dashboard loader", () => {
  it("loads the logged-in user's orders", async () => {
    const result = { current: [], previous: [] };
    auth.requireUser.mockResolvedValueOnce({ id: 3, fullName: "Олена Коваль" });
    orders.getAccountOrders.mockResolvedValueOnce(result);

    expect(await load()).toBe(result);
    expect(orders.getAccountOrders).toHaveBeenCalledWith(3);
  });

  it("redirects logged-out visitors to login without loading orders", async () => {
    auth.requireUser.mockRejectedValueOnce(redirect("/login?redirectTo=%2Faccount"));

    await expect(load()).rejects.toMatchObject({ status: 302 });
    expect(orders.getAccountOrders).not.toHaveBeenCalled();
  });
});

describe("account layout", () => {
  it("isn't indexed or cached", async () => {
    const { headers, meta } = await import("./account");
    type MetaArgs = Parameters<typeof meta>[0];
    const matches = [{ id: "root", loaderData: { locale: "en" } }];

    expect(meta({ matches } as unknown as MetaArgs)).toEqual([
      { title: "My account — Jassmin" },
      { name: "robots", content: "noindex" },
    ]);
    expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
  });

  it("greets the user by first name and redirects logged-out visitors", async () => {
    const { loader } = await import("./account");
    type AccountLoaderArgs = Parameters<typeof loader>[0];
    const args = {
      request: new Request("http://localhost/account"),
      params: {},
      context: {},
    } as unknown as AccountLoaderArgs;

    auth.requireUser.mockResolvedValueOnce({ id: 3, fullName: "Олена Коваль", email: "o@e.com" });
    expect(await loader(args)).toEqual({ firstName: "Олена", email: "o@e.com" });

    auth.requireUser.mockRejectedValueOnce(redirect("/login?redirectTo=%2Faccount"));
    await expect(loader(args)).rejects.toMatchObject({ status: 302 });
  });
});
