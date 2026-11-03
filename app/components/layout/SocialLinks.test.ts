import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SOCIAL_LABELS, type SocialLink } from "~/lib/cms";
import { I18nProvider, type Locale } from "~/lib/i18n";
import { SocialLinks, type SocialTone } from "./SocialLinks";

const LINKS: SocialLink[] = [
  { platform: "instagram", url: "https://www.instagram.com/jassminperfume" },
  { platform: "telegram", url: "https://t.me/jassmin" },
];

function render(links: readonly SocialLink[], tone: SocialTone = "onPrimary", locale?: Locale) {
  const element = createElement(SocialLinks, { links, tone });
  return renderToStaticMarkup(locale ? createElement(I18nProvider, { locale }, element) : element);
}

function renderLabelled(links: readonly SocialLink[], locale?: Locale) {
  const element = createElement(SocialLinks, { links, tone: "onInk", variant: "labelled" });
  return renderToStaticMarkup(locale ? createElement(I18nProvider, { locale }, element) : element);
}

describe("SocialLinks", () => {
  it("renders nothing without links", () => {
    expect(render([])).toBe("");
    expect(render([{ platform: "instagram", url: "" }])).toBe("");
  });

  it("renders the given links in order with English accessible names", () => {
    const html = render(LINKS, "onPrimary", "en");

    expect(html).toContain('aria-label="Social media"');
    const instagram = html.indexOf('aria-label="Jassmin on Instagram"');
    const telegram = html.indexOf('aria-label="Jassmin on Telegram"');
    expect(instagram).toBeGreaterThan(-1);
    expect(telegram).toBeGreaterThan(instagram);
    expect(html).toContain('href="https://www.instagram.com/jassminperfume"');
    expect(html).toContain('href="https://t.me/jassmin"');
  });

  it("names the links in Ukrainian by default", () => {
    const html = render(LINKS);

    expect(html).toContain('aria-label="Соціальні мережі"');
    expect(html).toContain('aria-label="Jassmin у Instagram"');
    expect(html).toContain('aria-label="Jassmin у Telegram"');
  });

  it("opens each profile in a new tab with a 44px target and a decorative icon", () => {
    const html = render(LINKS);
    const anchors = html.match(/<a [^>]*>/g) ?? [];

    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener noreferrer"');
      expect(anchor).toContain("size-11");
    }
    expect(html.match(/<svg [^>]*aria-hidden="true"/g)).toHaveLength(2);
    // The default variant stays icon-only (#111).
    expect(html).not.toContain("<span>");
    expect(html.match(/<svg [^>]*size-6/g)).toHaveLength(2);
  });

  it("uses the focus ring that contrasts with each surface", () => {
    expect(render(LINKS, "onPrimary")).toContain("focus-visible:outline-white");
    expect(render(LINKS, "onLight")).toContain("focus-visible:outline-primary ");
    expect(render(LINKS, "onInk")).toContain("focus-visible:outline-primary-light");
  });

  describe("labelled variant (#111)", () => {
    it("shows each platform name after a bigger icon", () => {
      const html = renderLabelled(LINKS);

      for (const label of ["Instagram", "Telegram"]) {
        expect(html).toMatch(
          new RegExp(`<a [^>]*><svg [^>]*size-8[^>]*>.*?</svg><span>${label}</span></a>`),
        );
      }
    });

    it.each<Locale>(["en", "uk"])(
      "includes the visible label in the accessible name in %s (WCAG 2.5.3)",
      (locale) => {
        const anchors = renderLabelled(LINKS, locale).match(/<a [^>]*>.*?<\/a>/g) ?? [];

        expect(anchors).toHaveLength(LINKS.length);
        LINKS.forEach(({ platform }, index) => {
          const anchor = anchors[index] ?? "";
          const visible = anchor.match(/<span>([^<]*)<\/span>/)?.[1];
          const name = anchor.match(/aria-label="([^"]*)"/)?.[1];
          expect(visible).toBe(SOCIAL_LABELS[platform]);
          expect(name).toContain(visible);
        });
      },
    );

    it("opens each profile in a new tab in a 44px pill with the onInk focus ring", () => {
      const anchors = renderLabelled(LINKS).match(/<a [^>]*>/g) ?? [];

      expect(anchors).toHaveLength(2);
      for (const anchor of anchors) {
        expect(anchor).toContain('target="_blank"');
        expect(anchor).toContain('rel="noopener noreferrer"');
        expect(anchor).toContain("min-h-11");
        expect(anchor).toContain("rounded-pill");
        expect(anchor).toContain("focus-visible:outline-primary-light");
      }
    });
  });
});
