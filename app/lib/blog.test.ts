import { describe, expect, it } from "vitest";
import { blogHref, blogPostHref, isBlogSlug, parseBlogSearch } from "./blog";

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
    expect(blogHref(1)).toBe("/blog");
    expect(blogHref(2)).toBe("/blog?page=2");
  });
});

describe("blogPostHref", () => {
  it("links to the article by slug", () => {
    expect(blogPostHref("how-to-choose-a-perfume")).toBe("/blog/how-to-choose-a-perfume");
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
