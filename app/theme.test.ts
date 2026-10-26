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
    expect(css).toMatch(/--font-sans:\s*"Manrope", ui-sans-serif, system-ui, sans-serif/);
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
