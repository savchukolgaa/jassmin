import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PRODUCT_IMAGE_SIZES, type ResponsiveImage } from "~/lib/images";
import { ProductImage, type ProductImageProps } from "./ProductImage";

const IMAGE: ResponsiveImage = {
  url: "https://cms.test/uploads/p.jpg",
  srcSet: "https://cms.test/uploads/small_p.jpg 400w, https://cms.test/uploads/p.jpg 800w",
  width: 800,
  height: 1000,
};

const render = (props: Partial<ProductImageProps> = {}) =>
  renderToStaticMarkup(
    createElement(ProductImage, {
      image: IMAGE,
      brand: "Chanel",
      alt: "Chanel Coco",
      layout: "card",
      ...props,
    }),
  );

describe("ProductImage (#88)", () => {
  it("loads a fitting size lazily, with its dimensions so the page doesn't shift", () => {
    const html = render();

    expect(html).toContain(`srcSet="${IMAGE.srcSet}"`);
    expect(html).toContain(`sizes="${PRODUCT_IMAGE_SIZES.card}"`);
    expect(html).toContain('width="800"');
    expect(html).toContain('height="1000"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).not.toContain("fetchPriority");
    expect(html).toContain('alt="Chanel Coco"');
  });

  it("loads the page's main photo first", () => {
    const html = render({ priority: true, layout: "page" });

    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchPriority="high"');
    expect(html).toContain(`sizes="${PRODUCT_IMAGE_SIZES.page}"`);
  });

  it("is a plain src without known sizes", () => {
    const html = render({ image: { ...IMAGE, srcSet: null, width: null, height: null } });

    expect(html).toContain(`src="${IMAGE.url}"`);
    expect(html).not.toContain("srcSet");
    expect(html).not.toContain("sizes");
    expect(html).not.toContain("width=");
  });

  it("keeps an empty alt for a decorative duplicate", () => {
    expect(render({ alt: "" })).toContain('alt=""');
  });

  it("labels the placeholder like the photo, or hides it when decorative", () => {
    expect(render({ image: null })).toContain('role="img" aria-label="Chanel Coco"');
    const hidden = render({ image: null, alt: "" });
    expect(hidden).toContain('aria-hidden="true"');
    expect(hidden).not.toContain('role="img"');
  });
});
