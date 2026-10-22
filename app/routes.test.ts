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
      "/login",
      "/register",
      "/cart",
      "/checkout",
      "/account",
    ]);
  });

  it("keeps the admin area outside the shop layout", () => {
    expect(routes.find((entry) => entry.path === "admin/*")?.file).toBe("routes/admin.tsx");
  });
});
