import { describe, expect, it, vi } from "vitest";
import {
  backfillProductImages,
  type StrapiProductPage,
  toProductImageWrite,
} from "./product-image-backfill";

const media = {
  url: "/uploads/p.jpg",
  width: 800,
  height: 1000,
  formats: { small: { url: "/uploads/small_p.jpg", width: 400, height: 500 } },
};

describe("toProductImageWrite", () => {
  it("resolves the URLs against Strapi's origin and keeps the sizes", () => {
    expect(toProductImageWrite(media, "http://cms.test")).toEqual({
      imageUrl: "http://cms.test/uploads/p.jpg",
      imageWidth: 800,
      imageHeight: 1000,
      imageFormats: [{ url: "http://cms.test/uploads/small_p.jpg", width: 400, height: 500 }],
    });
  });

  it("stores no formats when Strapi made none, and nothing without an image", () => {
    expect(
      toProductImageWrite({ url: "https://cdn.test/p.jpg", formats: null }, "http://cms.test/"),
    ).toEqual({
      imageUrl: "https://cdn.test/p.jpg",
      imageWidth: null,
      imageHeight: null,
      imageFormats: [],
    });
    expect(toProductImageWrite(null, "http://cms.test")).toEqual({
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      imageFormats: null,
    });
  });
});

describe("backfillProductImages", () => {
  it("walks every page and counts updated and skipped products", async () => {
    const pages: StrapiProductPage[] = [
      {
        data: [
          { publicId: "a", image: media },
          { publicId: null, image: media },
        ],
        meta: { pagination: { page: 1, pageCount: 2 } },
      },
      {
        data: [
          { publicId: "b", image: null },
          { publicId: "gone", image: media },
        ],
        meta: { pagination: { page: 2, pageCount: 2 } },
      },
    ];
    const update = vi.fn(async (publicId: string) => publicId !== "gone");
    const fetchPage = vi.fn(async (page: number) => {
      const found = pages[page - 1];
      if (!found) throw new Error(`no page ${page}`);
      return found;
    });

    const report = await backfillProductImages({
      strapiUrl: "http://cms.test",
      fetchPage,
      update,
    });

    expect(report).toEqual({ updated: 2, skipped: 2 });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith("a", expect.objectContaining({ imageWidth: 800 }));
    expect(update).toHaveBeenCalledWith("b", expect.objectContaining({ imageUrl: null }));
  });
});
