import { describe, expect, it, vi } from "vitest";
import { PRIVACY_POLICY_UPDATED_AT } from "~/lib/consent";
import { PAGE_KEYS, PAGES, pathFor } from "~/lib/paths";
import { CmsError } from "../cms/errors";
import type { SitemapProductRow } from "../db/queries/products";
import { getSitemap, SITEMAP_PAGES, type SitemapDeps, sitemapPages } from "./sitemap";

vi.mock("../db", () => ({ db: {} }));

const product = (
  slug: string | null,
  gender: SitemapProductRow["gender"],
  updatedAt: string,
): SitemapProductRow => ({ slug, gender, updatedAt: new Date(updatedAt) });

const PRODUCTS = [
  product("bleu-de-chanel", "men", "2026-10-03T00:00:00.000Z"),
  product("la-vie-est-belle", "women", "2026-10-01T00:00:00.000Z"),
  product("ck-one", "unisex", "2026-10-02T00:00:00.000Z"),
];

const POSTS = [
  {
    documentId: "a",
    slugs: { uk: "yak-obraty", en: "how-to-choose" },
    updatedAt: "2026-10-05T00:00:00.000Z",
  },
  { documentId: "b", slugs: { uk: "tilky-ukrainskoiu" }, updatedAt: "2026-10-04T00:00:00.000Z" },
];

const allPaths = (pages: ReturnType<typeof sitemapPages>) =>
  pages.flatMap((page) => Object.values(page.paths));

describe("SITEMAP_PAGES", () => {
  it("covers exactly the indexable pages of the path table", () => {
    expect([...SITEMAP_PAGES].sort()).toEqual(
      PAGE_KEYS.filter((page) => PAGES[page].indexable).sort(),
    );
  });
});

describe("sitemapPages", () => {
  const pages = sitemapPages({ products: PRODUCTS, posts: POSTS });

  it("lists the fixed pages and both catalogs in both languages", () => {
    expect(pages[0]?.paths).toEqual({ uk: pathFor("uk", "home"), en: pathFor("en", "home") });
    for (const gender of ["women", "men"] as const) {
      expect(pages.map((page) => page.paths)).toContainEqual({
        uk: pathFor("uk", "catalog", { gender }),
        en: pathFor("en", "catalog", { gender }),
      });
    }
    for (const page of ["offers", "popular", "blog", "privacy"] as const) {
      expect(pages.map((p) => p.paths)).toContainEqual({
        uk: pathFor("uk", page),
        en: pathFor("en", page),
      });
    }
  });

  it("lists every product by slug in both languages, with its last edit", () => {
    expect(pages).toContainEqual({
      paths: {
        uk: pathFor("uk", "product", { handle: "bleu-de-chanel" }),
        en: pathFor("en", "product", { handle: "bleu-de-chanel" }),
      },
      lastmod: "2026-10-03T00:00:00.000Z",
    });
    expect(allPaths(pages).filter((path) => path.includes("ck-one"))).toHaveLength(2);
  });

  it("skips a product row without a slug", () => {
    const withoutSlug = sitemapPages({
      products: [product(null, "women", "2026-10-01T00:00:00.000Z")],
      posts: [],
    });
    expect(withoutSlug).toHaveLength(7);
  });

  it("lists each post in the languages it's published in, under its own slug", () => {
    expect(pages).toContainEqual({
      paths: {
        uk: pathFor("uk", "blogPost", { slug: "yak-obraty" }),
        en: pathFor("en", "blogPost", { slug: "how-to-choose" }),
      },
      lastmod: "2026-10-05T00:00:00.000Z",
    });
    expect(pages).toContainEqual({
      paths: { uk: pathFor("uk", "blogPost", { slug: "tilky-ukrainskoiu" }) },
      lastmod: "2026-10-04T00:00:00.000Z",
    });
  });

  it("dates list pages by their newest product or post", () => {
    const lastmodOf = (path: string) => pages.find((page) => page.paths.uk === path)?.lastmod;

    expect(lastmodOf(pathFor("uk", "home"))).toBe("2026-10-03T00:00:00.000Z");
    expect(lastmodOf(pathFor("uk", "catalog", { gender: "women" }))).toBe(
      "2026-10-02T00:00:00.000Z",
    );
    expect(lastmodOf(pathFor("uk", "catalog", { gender: "men" }))).toBe("2026-10-03T00:00:00.000Z");
    expect(lastmodOf(pathFor("uk", "blog"))).toBe("2026-10-05T00:00:00.000Z");
    expect(lastmodOf(pathFor("uk", "privacy"))).toBe(PRIVACY_POLICY_UPDATED_AT);
  });

  it("never lists a private page", () => {
    const privatePrefixes = PAGE_KEYS.filter((page) => !PAGES[page].indexable).flatMap((page) => [
      `/${PAGES[page].uk.split("/")[0]}`,
      `/en/${PAGES[page].en.split("/")[0]}`,
    ]);
    for (const path of allPaths(pages)) {
      for (const prefix of privatePrefixes) {
        expect(path === prefix || path.startsWith(`${prefix}/`), path).toBe(false);
      }
    }
  });

  it("leaves out the posts, and the blog's lastmod, when Strapi was down", () => {
    const withoutCms = sitemapPages({ products: PRODUCTS, posts: null });
    expect(withoutCms).toHaveLength(7 + PRODUCTS.length);
    expect(withoutCms.find((page) => page.paths.uk === pathFor("uk", "blog"))?.lastmod).toBe(
      undefined,
    );
  });
});

describe("getSitemap", () => {
  const deps = (listPosts: SitemapDeps["listPosts"]): SitemapDeps => ({
    listProducts: async () => PRODUCTS,
    listPosts,
  });

  it("returns the complete sitemap XML", async () => {
    const { xml, complete } = await getSitemap(
      "https://jassmin.ua",
      deps(async () => POSTS),
    );

    expect(complete).toBe(true);
    expect(xml).toContain("<loc>https://jassmin.ua/blog/yak-obraty</loc>");
    expect(xml).toContain('hreflang="x-default" href="https://jassmin.ua/"');
  });

  it("still lists the products when Strapi is down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { xml, complete } = await getSitemap(
      "https://jassmin.ua",
      deps(async () => {
        throw new CmsError("unreachable", "fetch failed");
      }),
    );

    expect(complete).toBe(false);
    expect(xml).toContain("bleu-de-chanel");
    expect(xml).not.toContain("yak-obraty");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("rethrows anything that isn't a CMS error", async () => {
    await expect(
      getSitemap(
        "https://jassmin.ua",
        deps(async () => {
          throw new Error("bug");
        }),
      ),
    ).rejects.toThrow("bug");
  });
});
