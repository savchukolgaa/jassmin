import { describe, expect, it } from "vitest";
import { productImage } from "./products";

describe("productImage", () => {
  it("serves stored Strapi uploads from the shop's origin, older absolute URLs too (#176)", () => {
    expect(
      productImage({
        imageUrl: "http://localhost:1337/uploads/coco_3f2a.jpg",
        imageWidth: 800,
        imageHeight: 1000,
        imageFormats: [
          { url: "http://localhost:1337/uploads/small_coco_3f2a.jpg", width: 400, height: 500 },
        ],
      }),
    ).toEqual({
      url: "/uploads/coco_3f2a.jpg",
      srcSet: "/uploads/small_coco_3f2a.jpg 400w, /uploads/coco_3f2a.jpg 800w",
      width: 800,
      height: 1000,
    });
  });

  it("keeps same-origin paths and has no image without a URL", () => {
    expect(
      productImage({
        imageUrl: "/uploads/a.jpg",
        imageWidth: null,
        imageHeight: null,
        imageFormats: null,
      }),
    ).toEqual({ url: "/uploads/a.jpg", srcSet: null, width: null, height: null });
    expect(
      productImage({ imageUrl: null, imageWidth: null, imageHeight: null, imageFormats: null }),
    ).toBeNull();
  });
});
