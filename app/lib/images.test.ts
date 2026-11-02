import { describe, expect, it } from "vitest";
import { buildSrcSet, PRODUCT_IMAGE_SIZES, toResponsiveImage } from "./images";

describe("buildSrcSet", () => {
  it("lists the candidates smallest first", () => {
    expect(
      buildSrcSet([
        { url: "https://cms.test/large.jpg", width: 1000 },
        { url: "https://cms.test/thumb.jpg", width: 156 },
        { url: "https://cms.test/small.jpg", width: 500 },
      ]),
    ).toBe(
      "https://cms.test/thumb.jpg 156w, https://cms.test/small.jpg 500w, https://cms.test/large.jpg 1000w",
    );
  });

  it("keeps one URL per width, the last one given", () => {
    expect(
      buildSrcSet([
        { url: "https://cms.test/a.jpg", width: 500 },
        { url: "https://cms.test/b.jpg", width: 500 },
      ]),
    ).toBe("https://cms.test/b.jpg 500w");
  });

  it("skips widths that aren't positive integers", () => {
    expect(
      buildSrcSet([
        { url: "https://cms.test/a.jpg", width: 0 },
        { url: "https://cms.test/b.jpg", width: Number.NaN },
      ]),
    ).toBeNull();
  });

  it("is null without candidates", () => {
    expect(buildSrcSet([])).toBeNull();
  });
});

describe("toResponsiveImage", () => {
  const formats = [
    { url: "https://cms.test/small_p.jpg", width: 400, height: 500 },
    { url: "https://cms.test/thumbnail_p.jpg", width: 125, height: 156 },
  ];

  it("adds the original to the formats", () => {
    expect(toResponsiveImage("https://cms.test/p.jpg", 800, 1000, formats)).toEqual({
      url: "https://cms.test/p.jpg",
      srcSet:
        "https://cms.test/thumbnail_p.jpg 125w, https://cms.test/small_p.jpg 400w, https://cms.test/p.jpg 800w",
      width: 800,
      height: 1000,
    });
  });

  it("is a plain src when no size is known", () => {
    expect(toResponsiveImage("https://cms.test/p.jpg", null, null, null)).toEqual({
      url: "https://cms.test/p.jpg",
      srcSet: null,
      width: null,
      height: null,
    });
  });

  it("is null without a URL", () => {
    expect(toResponsiveImage(null, 800, 1000, formats)).toBeNull();
  });
});

describe("PRODUCT_IMAGE_SIZES", () => {
  it("ends every list with a default size", () => {
    for (const sizes of Object.values(PRODUCT_IMAGE_SIZES)) {
      expect(sizes.split(", ").at(-1)).toMatch(/^\d+(px|vw)$/);
    }
  });
});
