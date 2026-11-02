import { describe, expect, it } from "vitest";
import { blogHref, blogPostHref, blogResponseHeaders, isBlogSlug } from "./blog";
import { parseBlogSearch } from "./blog.schema";

describe("blogResponseHeaders", () => {
  it("forwards the loader's cache headers", () => {
    const headers = blogResponseHeaders(
      new Headers({ "Cache-Control": "public, max-age=60", Vary: "Cookie, Accept-Language" }),
    );
    expect(headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(headers.get("Vary")).toBe("Cookie, Accept-Language");
  });

  it("stores nothing when the loader threw", () => {
    expect(blogResponseHeaders(new Headers()).get("Cache-Control")).toBe("no-store");
  });
});

describe("parseBlogSearch", () => {
  const parse = (query: string) => parseBlogSearch(new URLSearchParams(query));

  it("reads the page number", () => {
    expect(parse("page=3")).toEqual({ page: 3 });
  });

  it("falls back to page 1 for missing or bad values", () => {
    expect(parse("")).toEqual({ page: 1 });
    expect(parse("page=abc")).toEqual({ page: 1 });
    expect(parse("page=0")).toEqual({ page: 1 });
    expect(parse("page=-2")).toEqual({ page: 1 });
    expect(parse("page=1.5")).toEqual({ page: 1 });
    expect(parse("page=99999")).toEqual({ page: 1 });
  });
});

describe("blogHref", () => {
  it("omits the page param on the first page", () => {
    expect(blogHref("uk", 1)).toBe("/blog");
    expect(blogHref("en", 1)).toBe("/en/blog");
    expect(blogHref("uk", 2)).toBe("/blog?page=2");
    expect(blogHref("en", 3)).toBe("/en/blog?page=3");
  });
});

describe("blogPostHref", () => {
  it("links to the article by slug", () => {
    expect(blogPostHref("uk", "how-to-choose-a-perfume")).toBe("/blog/how-to-choose-a-perfume");
    expect(blogPostHref("en", "how-to-pick")).toBe("/en/blog/how-to-pick");
  });
});

describe("isBlogSlug", () => {
  it("accepts Strapi UID characters", () => {
    expect(isBlogSlug("how-to-choose-a-perfume")).toBe(true);
    expect(isBlogSlug("Notes_2026.v2~a")).toBe(true);
  });

  it("rejects empty, too long or unusual slugs", () => {
    expect(isBlogSlug(undefined)).toBe(false);
    expect(isBlogSlug("")).toBe(false);
    expect(isBlogSlug("a".repeat(201))).toBe(false);
    expect(isBlogSlug("<script>")).toBe(false);
    expect(isBlogSlug("парфуми")).toBe(false);
    expect(isBlogSlug("a b")).toBe(false);
  });
});
