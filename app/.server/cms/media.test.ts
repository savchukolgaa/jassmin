import { describe, expect, it } from "vitest";
import { strapiMediaUrl, toMediaPath } from "./media";

describe("toMediaPath", () => {
  it("keeps Strapi's relative upload URLs", () => {
    expect(toMediaPath("/uploads/small_photo_3f2a.jpg")).toBe("/uploads/small_photo_3f2a.jpg");
  });

  it("drops the origin of absolute upload URLs stored before the proxy", () => {
    expect(toMediaPath("http://localhost:1337/uploads/photo_3f2a.jpg")).toBe(
      "/uploads/photo_3f2a.jpg",
    );
    expect(toMediaPath("http://cms:1337/uploads/photo.webp?v=2")).toBe("/uploads/photo.webp?v=2");
  });

  it("leaves other URLs alone", () => {
    expect(toMediaPath("https://images.example.com/photo.jpg")).toBe(
      "https://images.example.com/photo.jpg",
    );
    expect(toMediaPath("/images/bottle.webp")).toBe("/images/bottle.webp");
    expect(toMediaPath("https://example.com/uploadsx/a.jpg")).toBe(
      "https://example.com/uploadsx/a.jpg",
    );
  });
});

describe("strapiMediaUrl", () => {
  it("serves Strapi's uploads from the shop's origin", () => {
    expect(strapiMediaUrl("/uploads/a.jpg", "http://cms:1337")).toBe("/uploads/a.jpg");
    expect(strapiMediaUrl("http://cms:1337/uploads/a.jpg", "http://cms:1337")).toBe(
      "/uploads/a.jpg",
    );
  });

  it("resolves other URLs against Strapi, keeping a path prefix", () => {
    expect(strapiMediaUrl("/files/a.pdf", "http://cms:1337")).toBe("http://cms:1337/files/a.pdf");
    expect(strapiMediaUrl("files/a.pdf", "https://example.com/cms")).toBe(
      "https://example.com/cms/files/a.pdf",
    );
    expect(strapiMediaUrl("https://cdn.example/a.jpg", "http://cms:1337")).toBe(
      "https://cdn.example/a.jpg",
    );
  });
});
