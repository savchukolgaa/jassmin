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
      label: {
        id: "0193a1b2-7c1e-7a2b-9f00-000000000001",
        brand: "Chanel",
        title: "Coco",
        family: "квіткові",
      },
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

  it("shows the photo, not the label card, when there is one", () => {
    const html = render();

    expect(html).toContain("<img");
    expect(html).not.toContain("<svg");
  });

  it("draws the label card without a photo (#99)", () => {
    const html = render({ image: null });

    expect(html).toContain("<svg");
    expect(html).not.toContain("<img");
    expect(html).toContain(">CHANEL</text>");
    expect(html).toContain(">Coco</text>");
    expect(html).toContain("aspect-[4/5]");
    expect(html).toContain("rounded-card");
  });

  it("leaves the text off a minimal label card", () => {
    const html = render({ image: null, labelDetail: "minimal" });

    expect(html).toContain("<svg");
    expect(html).not.toContain("<text");
  });

  it("labels the placeholder like the photo, or hides it when decorative", () => {
    expect(render({ image: null })).toContain('role="img" aria-label="Chanel Coco"');
    const hidden = render({ image: null, alt: "" });
    expect(hidden).toContain('aria-hidden="true"');
    expect(hidden).not.toContain('role="img"');
  });
});
