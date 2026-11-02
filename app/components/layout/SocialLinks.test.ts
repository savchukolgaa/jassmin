import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SocialLink } from "~/lib/cms";
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
  });

  it("uses the focus ring that contrasts with each surface", () => {
    expect(render(LINKS, "onPrimary")).toContain("focus-visible:outline-white");
    expect(render(LINKS, "onLight")).toContain("focus-visible:outline-primary ");
    expect(render(LINKS, "onInk")).toContain("focus-visible:outline-primary-light");
  });
});
