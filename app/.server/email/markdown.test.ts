import { describe, expect, it } from "vitest";
import { markdownToEmailBlocks } from "./markdown";

describe("markdownToEmailBlocks", () => {
  it("turns paragraphs, headings and lists into blocks, keeping bold, italic and links", () => {
    const blocks = markdownToEmailBlocks(
      [
        "### Новинки осені",
        "",
        "Привіт, **друзі** & _гості_! Дивіться [каталог](/catalog/women).",
        "Другий рядок.",
        "",
        "- перший **хіт**",
        "- другий",
        "",
        "1. раз",
        "2. два",
      ].join("\n"),
      (href) => `https://jassmin.ua${href}`,
    );
    expect(blocks).toEqual([
      { type: "heading", text: "Новинки осені" },
      {
        type: "rich",
        runs: [
          { text: "Привіт, " },
          { text: "друзі", strong: true },
          { text: " & " },
          { text: "гості", em: true },
          { text: "! Дивіться " },
          { text: "каталог", href: "https://jassmin.ua/catalog/women" },
          { text: ". Другий рядок." },
        ],
      },
      {
        type: "list",
        ordered: false,
        items: [[{ text: "перший " }, { text: "хіт", strong: true }], [{ text: "другий" }]],
      },
      { type: "list", ordered: true, items: [[{ text: "раз" }], [{ text: "два" }]] },
    ]);
  });

  it("keeps nested emphasis and links with formatting", () => {
    expect(markdownToEmailBlocks("**жирний _і курсив_** [**тут**](https://x.ua)")).toEqual([
      {
        type: "rich",
        runs: [
          { text: "жирний ", strong: true },
          { text: "і курсив", strong: true, em: true },
          { text: " " },
          { text: "тут", strong: true, href: "https://x.ua" },
        ],
      },
    ]);
  });

  it("drops images, raw HTML, code blocks and rules, and keeps escaped characters as text", () => {
    const blocks = markdownToEmailBlocks(
      [
        "![фото](https://x.ua/a.png) <b>жирно</b> \\*не курсив\\* `код`",
        "",
        "<div>блок</div>",
        "",
        "```",
        "code",
        "```",
        "",
        "---",
        "",
        "> цитата",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      { type: "rich", runs: [{ text: "жирно *не курсив* код" }] },
      { type: "rich", runs: [{ text: "цитата" }] },
    ]);
  });

  it("is empty for an empty or whitespace-only body", () => {
    expect(markdownToEmailBlocks("")).toEqual([]);
    expect(markdownToEmailBlocks("  \n\n ")).toEqual([]);
  });
});
