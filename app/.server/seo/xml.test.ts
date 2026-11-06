import { describe, expect, it } from "vitest";
import { escapeXml, xmlText } from "./xml";

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
});

describe("xmlText", () => {
  it("escapes like escapeXml", () => {
    expect(xmlText("Dolce & Gabbana <Light Blue>")).toBe("Dolce &amp; Gabbana &lt;Light Blue&gt;");
  });

  it("drops control characters XML forbids, but keeps tab, LF and CR", () => {
    expect(xmlText("a\u0000b\u0007c\u000Bd\u001Fe\tf\ng\rh\uFFFEi")).toBe("abcde\tf\ng\rhi");
  });

  it("drops lone surrogates and keeps paired ones (emoji)", () => {
    expect(xmlText("a\uD800b\uDC00c🌸")).toBe("abc🌸");
  });

  it("keeps Ukrainian text and typographic characters", () => {
    expect(xmlText("Квіткові — розпив, 10 мл ₴ ’")).toBe("Квіткові — розпив, 10 мл ₴ ’");
  });
});
