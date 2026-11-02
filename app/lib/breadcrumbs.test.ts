import { describe, expect, it } from "vitest";
import { blogPostBreadcrumbs, catalogBreadcrumbs, productBreadcrumbs } from "./breadcrumbs";
import { createTranslator } from "./i18n/dictionaries";

const t = createTranslator("en");

describe("breadcrumb trails", () => {
  it("leads from home to the catalog", () => {
    expect(catalogBreadcrumbs(t, "men")).toEqual([
      { name: "Home", to: "/en" },
      { name: t.t("catalog.title.men"), to: "/en/catalog/men" },
    ]);
  });

  it("ends a product's trail at its slug URL", () => {
    const trail = productBreadcrumbs(t, "women", {
      id: "01a1652b-6e25-7c03-ae47-25b57131fb06",
      slug: "coco-mademoiselle",
      title: "Coco Mademoiselle",
    });

    expect(trail.map((crumb) => crumb.to)).toEqual([
      "/en",
      "/en/catalog/women",
      "/en/perfumes/coco-mademoiselle",
    ]);
    expect(trail[2]?.name).toBe("Coco Mademoiselle");
  });

  it("goes through the blog to the post", () => {
    expect(blogPostBreadcrumbs(t, { slug: "how-to-choose", title: "How to choose" })).toEqual([
      { name: "Home", to: "/en" },
      { name: "Blog", to: "/en/blog" },
      { name: "How to choose", to: "/en/blog/how-to-choose" },
    ]);
  });

  it("uses the Ukrainian paths in Ukrainian", () => {
    const uk = createTranslator("uk");
    expect(catalogBreadcrumbs(uk, "women").map((crumb) => crumb.to)).toEqual([
      "/",
      "/katalog/zhinochi",
    ]);
  });
});
