import type { RouteConfigEntry } from "@react-router/dev/routes";
import { describe, expect, it } from "vitest";
import routes from "./routes";

const paths = (entries: RouteConfigEntry[]): string[] =>
  entries.map((entry) => (entry.index ? "/" : `/${entry.path ?? ""}`));

describe("route config", () => {
  it("nests every public page under the shop layout", () => {
    const shop = routes.find((entry) => entry.file === "routes/_shop.tsx");

    expect(shop?.path).toBeUndefined();
    expect(paths(shop?.children ?? [])).toEqual([
      "/",
      "/catalog/:gender",
      "/products/:id",
      "/blog",
      "/blog/:slug",
      "/offers",
      "/login",
      "/register",
      "/cart",
      "/checkout",
      "/checkout/success/:orderId",
      "/checkout/pay/:orderId",
      "/account",
      "/privacy",
    ]);
  });

  it("keeps the POST-only logout route outside the shop layout", () => {
    expect(routes.find((entry) => entry.path === "logout")?.file).toBe("routes/logout.ts");
  });

  it("keeps the POST-only locale route outside the shop layout", () => {
    expect(routes.find((entry) => entry.path === "locale")?.file).toBe("routes/locale.ts");
  });

  it("keeps the POST-only consent route outside the shop layout", () => {
    expect(routes.find((entry) => entry.path === "consent")?.file).toBe("routes/consent.ts");
  });

  it("keeps the client events endpoint outside the shop layout", () => {
    expect(routes.find((entry) => entry.path === "api/events")?.file).toBe("routes/api.events.ts");
  });

  it("keeps the payment callback and simulator outside the shop layout", () => {
    expect(routes.find((entry) => entry.path === "payments/callback")?.file).toBe(
      "routes/payments.callback.ts",
    );
    expect(routes.find((entry) => entry.path === "payments/simulator")?.file).toBe(
      "routes/payments.simulator.tsx",
    );
  });

  it("nests the admin pages under their own layout, outside the shop layout", () => {
    const admin = routes.find((entry) => entry.path === "admin");

    expect(admin?.file).toBe("routes/admin.tsx");
    expect(paths(admin?.children ?? [])).toEqual(["/", "/products", "/orders"]);
  });
});
