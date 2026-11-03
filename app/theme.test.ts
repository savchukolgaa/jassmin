import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");

/** `--color-<name>: #rrggbb` tokens from the `@theme` block. */
const colors = new Map(
  [...css.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(
    ([, name = "", hex = ""]) => [name, hex.toLowerCase()] as const,
  ),
);

function color(name: string): string {
  if (name === "white") return "#ffffff";
  const hex = colors.get(name);
  if (!hex) throw new Error(`Missing token --color-${name}`);
  return hex;
}

// WCAG 2.x relative luminance and contrast ratio.
function relativeLuminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  );
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe("theme tokens", () => {
  it("uses the C+ deep pink as the primary colour", () => {
    expect(color("primary")).toBe("#c22f4b");
    expect(color("primary-dark")).toBe("#a8233d");
    expect(color("primary-light")).toBe("#ff8fa1");
  });

  it("keeps the legacy brand pink only as its own token", () => {
    const lines = css.split("\n").filter((line) => /#ff5c77|255 92 119/i.test(line));
    expect(lines).toEqual(["  --color-brand-legacy: #ff5c77;"]);
  });

  it("puts Manrope first in the sans stack and keeps the system fallback", () => {
    expect(css).toMatch(
      /--font-sans:\s*"Manrope Variable", "Manrope Fallback", ui-sans-serif, system-ui, sans-serif/,
    );
  });

  it("sets Playfair Display as the serif with a Georgia fallback", () => {
    expect(css).toContain(
      '--font-serif: "Playfair Display Variable", "Playfair Display Fallback", Georgia, serif;',
    );
  });

  it("sizes the local fallbacks like the web fonts, so a late font doesn't shift the page (#88)", () => {
    for (const [family, local] of [
      ["Manrope Fallback", "Arial"],
      ["Playfair Display Fallback", "Georgia"],
    ]) {
      const face = css.match(new RegExp(`@font-face {[^}]*"${family}"[^}]*}`))?.[0] ?? "";
      expect(face).toContain(`src: local("${local}")`);
      expect(face).toMatch(/size-adjust: \d+\.\d+%/);
      expect(face).toMatch(/ascent-override: \d+\.\d+%/);
      expect(face).toMatch(/descent-override: \d+\.\d+%/);
    }
  });

  it("sets h1 to h3 in the serif from the base layer", () => {
    expect(css).toMatch(
      /@layer base \{[^}]*h1,\s*h2,\s*h3 \{\s*font-family: var\(--font-serif\);\s*\}/,
    );
  });

  it("self-hosts Manrope and Playfair Display with font-display swap (#88)", () => {
    expect(css).toContain('@import "@fontsource-variable/manrope/wght.css";');
    expect(css).toContain('@import "@fontsource-variable/playfair-display/wght.css";');
    for (const pkg of ["manrope", "playfair-display"]) {
      const fontCss = readFileSync(
        new URL(`../node_modules/@fontsource-variable/${pkg}/wght.css`, import.meta.url),
        "utf8",
      );
      const faces = fontCss.match(/@font-face/g) ?? [];
      expect(fontCss.match(/font-display: swap/g)).toHaveLength(faces.length);
      expect(fontCss).toMatch(/-cyrillic-wght-normal\.woff2/);
      expect(fontCss).toMatch(/-latin-wght-normal\.woff2/);
    }
  });

  it("preloads the Cyrillic fonts and no longer calls Google Fonts", () => {
    const root = readFileSync(new URL("./root.tsx", import.meta.url), "utf8");
    expect(root).not.toContain("fonts.googleapis.com");
    expect(root).toContain("manrope-cyrillic-wght-normal.woff2?url");
    expect(root).toContain("playfair-display-cyrillic-wght-normal.woff2?url");
    expect(root).toContain('rel: "preload"');
  });
});

describe("contrast (WCAG AA)", () => {
  // Normal-size text needs 4.5:1.
  it.each([
    ["white", "primary"],
    ["white", "primary-dark"],
    ["primary", "white"],
    ["primary-dark", "white"],
    ["primary-light", "ink"],
    ["white", "ink"],
    ["on-dark-muted", "ink"],
    ["muted", "white"],
    ["muted", "blush"],
    ["body", "white"],
    ["ink", "card"],
    ["success", "success-bg"],
    ["ink", "white"],
    ["primary", "blush"],
    ["primary-dark", "blush"],
  ])("%s text on %s is at least 4.5:1", (foreground, background) => {
    expect(contrastRatio(color(foreground), color(background))).toBeGreaterThanOrEqual(4.5);
  });

  // Icons and focus rings need 3:1 against the surface they sit on.
  it.each([
    ["white", "primary"],
    ["primary-light", "ink"],
    ["primary", "white"],
  ])("a %s focus ring or icon on %s is at least 3:1", (foreground, background) => {
    expect(contrastRatio(color(foreground), color(background))).toBeGreaterThanOrEqual(3);
  });

  // The white header (#72) and its dropdown and mobile menu, so a palette change that breaks it
  // fails here: links, the current section, hovers on `blush`, the cart pill and profile circle.
  describe("white header", () => {
    it.each([
      ["ink", "white"],
      ["primary-dark", "white"],
      ["primary-dark", "blush"],
      ["white", "primary"],
      ["white", "primary-dark"],
    ])("%s text on %s is at least 4.5:1", (foreground, background) => {
      expect(contrastRatio(color(foreground), color(background))).toBeGreaterThanOrEqual(4.5);
    });

    it.each([
      ["primary", "white"],
      ["primary", "blush"],
    ])("a %s focus ring or wordmark dot on %s is at least 3:1", (foreground, background) => {
      expect(contrastRatio(color(foreground), color(background))).toBeGreaterThanOrEqual(3);
    });
  });

  it("keeps primary-light focus rings off light surfaces, where they drop below 3:1", () => {
    expect(contrastRatio(color("primary-light"), color("white"))).toBeLessThan(3);

    // Only these sit on `ink`; form fields and payment options are white (#73). `SocialLinks` uses
    // the ring only for its `onInk` tone, which the contacts section passes (#101).
    const onInk = ["ContactsSection.tsx", "TrioBuilder.tsx", "SocialLinks.tsx"];
    const appDir = new URL(".", import.meta.url);
    const offenders = readdirSync(appDir, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx") && !onInk.some((name) => file.endsWith(name)))
      .filter((file) =>
        readFileSync(new URL(file.replaceAll("\\", "/"), appDir), "utf8").includes(
          "outline-primary-light",
        ),
      );
    expect(offenders).toEqual([]);
  });
});

describe("motion", () => {
  it.each(["fade-up", "pop", "spin-in", "marquee", "toast"])(
    "defines the %s keyframes and animate utility",
    (name) => {
      expect(css).toContain(`@keyframes ${name} {`);
      expect(css).toMatch(new RegExp(`--animate-${name}: ${name} `));
    },
  );

  it("adds delay steps and the card lift utility", () => {
    expect(css).toContain("@utility anim-delay-* {");
    expect(css).toContain("@utility lift {");
  });

  it.each(["rise", "float", "slot-pop"])("defines the home %s animation", (name) => {
    expect(css).toContain(`@keyframes ${name} {`);
    expect(css).toMatch(new RegExp(`--animate-${name}: ${name} `));
  });

  it("spins the badge in, then wobbles it forever", () => {
    expect(css).toContain("@keyframes badge-in {");
    expect(css).toContain("@keyframes wobble {");
    expect(css).toMatch(/--animate-badge:\s*badge-in [^;]*, wobble [^;]*infinite;/);
  });

  it("scrolls the marquee in 26s and pauses it on hover", () => {
    expect(css).toContain("--animate-marquee: marquee 26s linear infinite;");
    expect(css).toMatch(/@utility marquee-pause \{\s*&:hover \{\s*animation-play-state: paused;/);
  });

  it.each(["card-tilt", "tile-arrow", "quick-add", "chip-hover", "step-hover"])(
    "moves %s on hover only when motion is allowed",
    (name) => {
      const body = css.split(`@utility ${name} {`)[1]?.split("\n}\n")[0] ?? "";
      expect(body).toContain("@media (prefers-reduced-motion: no-preference) {");
      expect(body.split("@media (prefers-reduced-motion: no-preference)")[0]).not.toContain(
        ":hover",
      );
    },
  );

  it("only enables scroll reveal where animation-timeline is supported", () => {
    expect(css).toMatch(/@supports \(animation-timeline: view\(\)\) \{\s*\.reveal \{/);
    expect(css.match(/\.reveal/g)).toHaveLength(1);
  });

  it("turns off all animation and transitions under reduced motion", () => {
    const blocks = css.split("@media (prefers-reduced-motion: reduce)");
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toContain("animation: none !important;");
    expect(blocks[1]).toContain("transition: none !important;");
  });
});

describe("light-only theme", () => {
  /** A Tailwind `dark:` variant, but not the `primary-dark` token or the `dark` button key. */
  const darkVariant = /(?<![\w-])dark:(?=[\w[!-])/;

  it("matches dark: variants and nothing else", () => {
    // Built at runtime so Tailwind's source scan doesn't emit these classes into the CSS.
    const dark = "dark";
    expect(darkVariant.test(`${dark}:bg-gray-950`)).toBe(true);
    expect(darkVariant.test(`md:${dark}:text-white`)).toBe(true);
    expect(darkVariant.test("--color-primary-dark: #a8233d;")).toBe(false);
    expect(darkVariant.test('dark: "bg-ink text-white"')).toBe(false);
  });

  it("has no dark-mode rule in app.css", () => {
    expect(css).not.toContain("prefers-color-scheme: dark");
    expect(css).not.toContain("color-scheme: dark");
    expect(css).not.toMatch(darkVariant);
  });

  it("forces color-scheme: light on html", () => {
    expect(css).toMatch(/^html \{\s*color-scheme: light;/m);
  });

  it("sets the color-scheme meta tag in the root layout", () => {
    const root = readFileSync(new URL("./root.tsx", import.meta.url), "utf8");
    expect(root).toContain('<meta name="color-scheme" content="light" />');
  });

  it("uses no dark: variants anywhere in app/", () => {
    const appDir = new URL(".", import.meta.url);
    const offenders = readdirSync(appDir, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(tsx?|css)$/.test(file) && !file.endsWith(".test.ts"))
      .filter((file) =>
        darkVariant.test(readFileSync(new URL(file.replaceAll("\\", "/"), appDir), "utf8")),
      );
    expect(offenders).toEqual([]);
  });
});
