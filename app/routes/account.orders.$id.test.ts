import { redirect } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
const orders = vi.hoisted(() => ({ getAccountOrder: vi.fn() }));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/services/orders", () => orders);

type LoaderArgs = Parameters<typeof import("./account.orders.$id").loader>[0];

const load = async (id: string) => {
  const { loader } = await import("./account.orders.$id");
  const request = new Request(`http://localhost/account/orders/${id}`);
  return loader({ request, params: { id }, context: {} } as unknown as LoaderArgs);
};

const detail = { id: 42, lines: [] };

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireUser.mockResolvedValue({ id: 3 });
});

describe("account order loader", () => {
  it("shows the user their own order", async () => {
    orders.getAccountOrder.mockResolvedValueOnce(detail);

    expect(await load("42")).toBe(detail);
    expect(orders.getAccountOrder).toHaveBeenCalledWith(3, 42);
  });

  it("answers 404 for an order that isn't the user's", async () => {
    orders.getAccountOrder.mockResolvedValueOnce(undefined);

    await expect(load("42")).rejects.toMatchObject({ init: { status: 404 } });
  });

  it("answers 404 for malformed or out-of-range ids without a lookup", async () => {
    for (const id of ["0", "-1", "abc", "1.5", "2147483648"]) {
      await expect(load(id)).rejects.toMatchObject({ init: { status: 404 } });
    }
    expect(orders.getAccountOrder).not.toHaveBeenCalled();
  });

  it("redirects logged-out visitors to login without a lookup", async () => {
    auth.requireUser.mockRejectedValueOnce(redirect("/login?redirectTo=%2Faccount%2Forders%2F42"));

    await expect(load("42")).rejects.toMatchObject({ status: 302 });
    expect(orders.getAccountOrder).not.toHaveBeenCalled();
  });

  it("isn't indexed and names the order", async () => {
    const { meta } = await import("./account.orders.$id");
    type MetaArgs = Parameters<typeof meta>[0];
    const matches = [{ id: "root", loaderData: { locale: "en" } }];

    expect(meta({ matches, loaderData: detail } as unknown as MetaArgs)).toEqual([
      { title: "Order #42 — Jassmin" },
      { name: "robots", content: "noindex" },
    ]);
  });
});
