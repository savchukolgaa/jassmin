import { describe, expect, it } from "vitest";
import blogPostBySlug from "./__fixtures__/blog-post-by-slug.json";
import blogPosts from "./__fixtures__/blog-posts.json";
import blogPostsEmpty from "./__fixtures__/blog-posts-empty.json";
import homePage from "./__fixtures__/home-page.json";
import siteSetting from "./__fixtures__/site-setting.json";
import {
  blogPostEntry,
  blogPostSummaryEntry,
  collectionResponse,
  homePageEntry,
  singleResponse,
  siteSettingEntry,
} from "./schemas";

describe("Strapi response schemas", () => {
  it("parse the recorded Strapi responses", () => {
    expect(singleResponse(homePageEntry).safeParse(homePage).success).toBe(true);
    expect(singleResponse(siteSettingEntry).safeParse(siteSetting).success).toBe(true);
    expect(collectionResponse(blogPostSummaryEntry).safeParse(blogPosts).success).toBe(true);
    expect(collectionResponse(blogPostEntry).safeParse(blogPostBySlug).success).toBe(true);
    expect(collectionResponse(blogPostEntry).safeParse(blogPostsEmpty).success).toBe(true);
  });

  it("strip unknown keys", () => {
    const parsed = singleResponse(siteSettingEntry).parse({
      data: { ...siteSetting.data, addedLater: "ignored" },
    });

    expect(parsed.data).not.toHaveProperty("addedLater");
    expect(parsed.data).not.toHaveProperty("createdAt");
  });

  it("reject a missing required field", () => {
    const { headline: _headline, ...hero } = homePage.data.hero;

    const result = singleResponse(homePageEntry).safeParse({ data: { ...homePage.data, hero } });

    expect(result.success).toBe(false);
  });

  it("reject a wrongly typed field", () => {
    const result = singleResponse(siteSettingEntry).safeParse({
      data: { ...siteSetting.data, phone: 380441234567 },
    });

    expect(result.success).toBe(false);
  });

  it("reject an unknown social platform", () => {
    const result = singleResponse(siteSettingEntry).safeParse({
      data: { ...siteSetting.data, socialLinks: [{ platform: "myspace", url: "https://x" }] },
    });

    expect(result.success).toBe(false);
  });

  it("reject the Strapi v4 `attributes` shape", () => {
    const { documentId, ...attributes } = homePage.data;

    const result = singleResponse(homePageEntry).safeParse({
      data: { id: 1, documentId, attributes },
    });

    expect(result.success).toBe(false);
  });

  it("reject a collection response without pagination meta", () => {
    const result = collectionResponse(blogPostSummaryEntry).safeParse({ data: blogPosts.data });

    expect(result.success).toBe(false);
  });
});
