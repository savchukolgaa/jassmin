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
      "/en",
      "/katalog/:gender",
      "/en/catalog/:gender",
      "/parfumy/:handle",
      "/en/perfumes/:handle",
      "/blog",
      "/en/blog",
      "/blog/:slug",
      "/en/blog/:slug",
      "/aktsii",
      "/en/offers",
      "/populiarni",
      "/en/popular",
      "/vkhid",
      "/en/login",
      "/reiestratsiia",
      "/en/register",
      "/zabuly-parol",
      "/en/forgot-password",
      "/novyi-parol/:token",
      "/en/reset-password/:token",
      "/pidtverdzhennia/:token",
      "/en/verify-email/:token",
      "/vidpysatysia/:token",
      "/en/unsubscribe/:token",
      "/koshyk",
      "/en/cart",
      "/oformlennia",
      "/en/checkout",
      "/oformlennia/uspikh/:orderId",
      "/en/checkout/success/:orderId",
      "/oformlennia/oplata/:orderId",
      "/en/checkout/pay/:orderId",
      "/kabinet",
      "/en/account",
      "/konfidentsiinist",
      "/en/privacy",
      "/podarunkovi-kartky",
      "/en/gift-cards",
      "/podarunkovi-kartky/uspikh/:giftCardId",
      "/en/gift-cards/success/:giftCardId",
    ]);
  });

  it("registers each page once per locale, sharing the route module (#84)", () => {
    const shop = routes.find((entry) => entry.file === "routes/_shop.tsx");
    const catalog = (shop?.children ?? []).filter((entry) => entry.file === "routes/catalog.tsx");
    expect(catalog.map((entry) => entry.id)).toEqual(["catalog.uk", "catalog.en"]);
    const account = (shop?.children ?? []).find((entry) => entry.id === "account.en");
    expect(paths(account?.children ?? [])).toEqual(["/", "/orders/:id", "/profile"]);
    const ukAccount = (shop?.children ?? []).find((entry) => entry.id === "account.uk");
    expect(paths(ukAccount?.children ?? [])).toEqual(["/", "/zamovlennia/:id", "/profil"]);
  });

  it("ends with a catch-all for old paths and 404s", () => {
    expect(routes.at(-1)).toMatchObject({ path: "*", file: "routes/redirects.ts" });
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

  it("keeps the Strapi sync endpoints outside the shop layout", () => {
    expect(routes.find((entry) => entry.path === "cms/products")?.file).toBe(
      "routes/cms.products.ts",
    );
    expect(routes.find((entry) => entry.path === "cms/orders/:id")?.file).toBe(
      "routes/cms.orders.$id.ts",
    );
  });

  it("has no in-app admin area: products and orders are managed in Strapi (#40)", () => {
    expect(routes.find((entry) => entry.path === "admin")).toBeUndefined();
  });
});
