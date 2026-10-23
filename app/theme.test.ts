import { readFileSync } from "node:fs";
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
