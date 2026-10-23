import { describe, expect, it } from "vitest";
import { renderArticleMarkdown, renderMarkdown, toPlainText } from "./markdown";

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

describe("renderArticleMarkdown", () => {
  const render = (markdown: string) =>
    renderArticleMarkdown(markdown, { mediaBaseUrl: "http://cms.test:1337" });

  it("keeps h2 headings and turns h1 into h2", () => {
    expect(render("## Notes")).toBe("<h2>Notes</h2>\n");
    expect(render("# Title")).toBe("<h2>Title</h2>\n");
  });

  it("resolves Strapi upload paths against the CMS origin and lazy-loads images", () => {
    const html = render("![Bottles](/uploads/bottles.jpg)");
    expect(html).toBe(
      '<p><img src="http://cms.test:1337/uploads/bottles.jpg" alt="Bottles" loading="lazy" decoding="async" /></p>\n',
    );
  });

  it("keeps absolute https images", () => {
    expect(render("![x](https://cdn.test/x.png)")).toContain('src="https://cdn.test/x.png"');
  });

  it("drops images with javascript: or data: sources and event handlers", () => {
    const html = render(
      '![a](javascript:alert(1)) <img src="data:image/png;base64,AAAA"> <img src="/uploads/ok.jpg" onerror="alert(1)">',
    );
    expect(html).not.toMatch(/javascript:|data:|onerror/);
    expect(html.match(/<img/g)).toHaveLength(1);
  });

  it("strips scripts, iframes and style attributes", () => {
    const html = render(
      '<script>alert(1)</script><iframe src="https://evil.test"></iframe><p style="color:red">Hi</p>',
    );
    expect(html).not.toMatch(/script|iframe|style/);
    expect(html).toContain("Hi");
  });

  it("escapes HTML inside code blocks", () => {
    const html = render("```\n<script>alert(1)</script>\n```");
    expect(html).toBe("<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;\n</code></pre>\n");
  });

  it("keeps rules, strikethrough and safe links", () => {
    expect(render("a\n\n---\n\n~~old~~ [shop](/catalog/women)")).toBe(
      '<p>a</p>\n<hr />\n<p><del>old</del> <a href="/catalog/women">shop</a></p>\n',
    );
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
