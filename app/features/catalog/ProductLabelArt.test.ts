import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LABEL_PALETTES, type ProductLabel } from "~/lib/label-art";
import { ProductLabelArt, type ProductLabelArtProps } from "./ProductLabelArt";

const LABEL: ProductLabel = {
  id: "0193a1b2-7c1e-7a2b-9f00-000000000001",
  brand: "Chanel",
  title: "Coco Mademoiselle",
  family: "квіткові",
};

const render = (props: Partial<ProductLabelArtProps> = {}) =>
  renderToStaticMarkup(createElement(ProductLabelArt, { label: LABEL, ...props }));

describe("ProductLabelArt (#99)", () => {
  it("draws a 4:5 card in the family's colours", () => {
    const html = render();

    expect(html).toContain('viewBox="0 0 400 500"');
    expect(html).toContain(`fill="${LABEL_PALETTES.floral.bg}"`);
    expect(html).toContain(`fill="${LABEL_PALETTES.floral.accent}"`);
    expect(html).toContain(`fill="${LABEL_PALETTES.floral.ink}"`);
  });

  it("is neutral without a family", () => {
    expect(render({ label: { ...LABEL, family: null } })).toContain(
      `fill="${LABEL_PALETTES.neutral.bg}"`,
    );
  });

  it("prints the brand, the name and the wordmark", () => {
    const html = render();

    expect(html).toContain(">CHANEL</text>");
    expect(html).toContain("Coco");
    expect(html).toContain("Mademoiselle");
    expect(html).toContain("jassmin.");
  });

  it("prints Cyrillic names", () => {
    const html = render({ label: { ...LABEL, brand: "Жасмін", title: "Квітковий сад" } });

    expect(html).toContain(">ЖАСМІН</text>");
    expect(html).toContain("Квітковий");
  });

  it("puts a long brand on two lines instead of cutting it", () => {
    const html = render({ label: { ...LABEL, brand: "Maison Francis Kurkdjian" } });

    expect(html).toContain("MAISON FRANCIS");
    expect(html).toContain("KURKDJIAN");
    expect(html).not.toContain("…");
  });

  it("escapes the text", () => {
    expect(render({ label: { ...LABEL, title: "<b>Bold</b>" } })).not.toContain("<b>");
  });

  it("has no text when minimal", () => {
    const html = render({ detail: "minimal" });

    expect(html).not.toContain("<text");
    expect(html).toContain(`fill="${LABEL_PALETTES.floral.bg}"`);
  });

  it("is the same markup for the same product, and differs between products", () => {
    expect(render()).toBe(render());
    const shapes = new Set(
      Array.from({ length: 24 }, (_, i) =>
        render({
          label: { ...LABEL, id: `${LABEL.id.slice(0, -2)}${i.toString().padStart(2, "0")}` },
        }),
      ),
    );
    expect(shapes.size).toBeGreaterThan(1);
  });

  it("is decorative and loads nothing", () => {
    const html = render();

    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/href|url\(|<image|<img/);
  });

  it("stays small enough to inline 24 times on a page", () => {
    expect(render().length).toBeLessThan(1600);
  });
});
