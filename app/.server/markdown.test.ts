import { describe, expect, it } from "vitest";
import { renderMarkdown, toPlainText } from "./markdown";

describe("renderMarkdown", () => {
  it("renders paragraphs, emphasis and lists", () => {
    const html = renderMarkdown("Hello **world**\n\n- one\n- two");
    expect(html).toBe(
      "<p>Hello <strong>world</strong></p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n",
    );
  });

  it("strips scripts, event handlers and iframes", () => {
    const html = renderMarkdown(
      'Hi <script>alert(1)</script><img src=x onerror="alert(1)"><iframe src="https://evil.test"></iframe>',
    );
    expect(html).not.toMatch(/script|onerror|iframe|<img/);
    expect(html).toContain("Hi");
  });

  it("drops javascript: and protocol-relative links", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("javascript:");
    expect(renderMarkdown('<a href="//evil.test">x</a>')).not.toContain("evil.test");
  });

  it("opens external links in a new tab without an opener", () => {
    expect(renderMarkdown("[shop](https://jassmin.ua)")).toBe(
      '<p><a href="https://jassmin.ua" target="_blank" rel="noopener noreferrer">shop</a></p>\n',
    );
  });

  it("keeps mailto and tel links as they are", () => {
    expect(renderMarkdown("[mail](mailto:hello@jassmin.ua)")).toBe(
      '<p><a href="mailto:hello@jassmin.ua">mail</a></p>\n',
    );
    expect(renderMarkdown("[call](tel:+380441234567)")).toContain('href="tel:+380441234567"');
  });
});

describe("toPlainText", () => {
  it("removes formatting and decodes entities", () => {
    expect(toPlainText("We're **Jassmin** & friends\n\n- one")).toBe("We're Jassmin & friends one");
  });

  it("returns short text unchanged", () => {
    expect(toPlainText("Short story.", 160)).toBe("Short story.");
  });

  it("cuts long text at a word boundary", () => {
    const text = toPlainText("alpha beta gamma delta", 15);
    expect(text).toBe("alpha beta…");
    expect(text.length).toBeLessThanOrEqual(15);
  });
});
