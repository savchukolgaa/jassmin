import { describe, expect, it } from "vitest";
import { directionsUrl, resolveCtaHref, safeMapEmbedUrl, telHref, toInternalPath } from "./links";

describe("toInternalPath", () => {
  it("keeps app paths, trimmed", () => {
    expect(toInternalPath("/catalog/women")).toBe("/catalog/women");
    expect(toInternalPath(" /products/abc?ref=offers ")).toBe("/products/abc?ref=offers");
  });

  it.each([
    "https://jassmin.ua/offers",
    "javascript:alert(1)",
    "//evil.test/x",
    "/\\evil.test",
    "catalog/women",
    "",
    null,
    undefined,
  ])("rejects %j", (href) => {
    expect(toInternalPath(href)).toBeNull();
  });
});

describe("resolveCtaHref", () => {
  it("keeps app paths as router links", () => {
    expect(resolveCtaHref("/popular")).toEqual({ kind: "internal", to: "/popular" });
    expect(resolveCtaHref(" /catalog/women?sort=newest ")).toEqual({
      kind: "internal",
      to: "/catalog/women?sort=newest",
    });
  });

  it("allows https URLs as external links", () => {
    expect(resolveCtaHref("https://t.me/jassmin")).toEqual({
      kind: "external",
      href: "https://t.me/jassmin",
    });
  });

  it.each([
    "javascript:alert(1)",
    "//evil.test/x",
    "/\\evil.test",
    "http://insecure.test",
    "",
    "popular",
  ])("falls back to /popular for %j", (href) => {
    expect(resolveCtaHref(href)).toEqual({ kind: "internal", to: "/popular" });
  });
});

describe("safeMapEmbedUrl", () => {
  it("accepts Google Maps embed URLs", () => {
    const url = "https://www.google.com/maps?q=Khreshchatyk+1+Kyiv&output=embed";
    expect(safeMapEmbedUrl(url)).toBe(url);
    expect(safeMapEmbedUrl("https://www.google.com/maps/embed?pb=abc")).toBe(
      "https://www.google.com/maps/embed?pb=abc",
    );
  });

  it.each([
    "http://www.google.com/maps?q=x",
    "https://evil.test/maps?q=x",
    "https://www.google.com.evil.test/maps",
    "https://www.google.com/search?q=x",
    "https://www.google.com/mapsevil",
    "javascript:alert(1)",
    "",
  ])("rejects %j", (url) => {
    expect(safeMapEmbedUrl(url)).toBeNull();
  });
});

describe("telHref", () => {
  it("keeps only digits and a leading plus", () => {
    expect(telHref("+380 44 123 45 67")).toBe("tel:+380441234567");
    expect(telHref("(044) 123-45-67")).toBe("tel:0441234567");
    expect(telHref("+38 (0+44)")).toBe("tel:+38044");
  });
});

describe("directionsUrl", () => {
  it("encodes the address as a Google Maps search", () => {
    expect(directionsUrl("вул. Хрещатик, 1, Київ")).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("вул. Хрещатик, 1, Київ").replaceAll("%20", "+")}`,
    );
  });
});
