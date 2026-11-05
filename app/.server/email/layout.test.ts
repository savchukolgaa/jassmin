import { describe, expect, it } from "vitest";
import { createTranslator } from "~/lib/i18n";
import {
  composeEmail,
  createMessageId,
  type EmailBlock,
  escapeHtml,
  renderEmail,
  senderDomain,
} from "./layout";
import { htmlSection, htmlWords, words } from "./test-helpers";

const footer = { inbox: "hello@jassmin.ua", siteUrl: "https://jassmin.ua" };

const blocks: EmailBlock[] = [
  { type: "paragraph", text: "Вітаємо, Олена!" },
  { type: "heading", text: "Ваше замовлення" },
  { type: "lines", items: ["• Chanel Coco, 5 мл, 2 × 450 ₴ = 900 ₴", "• Dior Sauvage, 10 мл"] },
  {
    type: "amounts",
    rows: [
      { label: "Сума", value: "900 ₴" },
      { label: "До сплати", value: "900 ₴", strong: true },
    ],
  },
  {
    type: "code",
    label: "Код картки",
    code: "ABCD-EFGH-JKMN-PQRS",
    note: "Картка діє до 1 листопада",
  },
  { type: "paragraph", text: "Перший рядок\nдругий рядок" },
  { type: "signature", text: "Команда Jassmin" },
];

function render(locale: "uk" | "en", body: EmailBlock[] = blocks) {
  return renderEmail(body, { translator: createTranslator(locale), footer, subject: "Тема" });
}

describe("renderEmail", () => {
  it("writes the plain-text body with blank lines between blocks and the footer after `-- `", () => {
    expect(render("uk").text).toBe(
      [
        "Вітаємо, Олена!",
        "",
        "Ваше замовлення",
        "• Chanel Coco, 5 мл, 2 × 450 ₴ = 900 ₴",
        "• Dior Sauvage, 10 мл",
        "",
        "Сума: 900 ₴",
        "До сплати: 900 ₴",
        "",
        "Код картки: ABCD-EFGH-JKMN-PQRS",
        "Картка діє до 1 листопада",
        "",
        "Перший рядок",
        "другий рядок",
        "",
        "Команда Jassmin",
        "",
        "-- ",
        "Jassmin · hello@jassmin.ua · https://jassmin.ua",
        "Цей лист надіслав інтернет-магазин парфумів Jassmin.",
      ].join("\n"),
    );
  });

  it("has the same words in the text part as in the HTML, in the same order", () => {
    for (const locale of ["uk", "en"] as const) {
      const { html, text } = render(locale);
      const [body] = text.split("\n\n-- \n");
      expect(htmlWords(htmlSection(html, "content"))).toEqual(words(body ?? ""));
    }
  });

  it("renders the layout in Ukrainian", () => {
    const { html } = render("uk");
    expect(html).toMatch(/^<!doctype html>\n<html lang="uk">/);
    expect(html).toContain("JASSMIN");
    expect(htmlSection(html, "footer")).toContain(
      "Цей лист надіслав інтернет-магазин парфумів Jassmin.",
    );
  });

  it("renders the layout in English", () => {
    const { html, text } = render("en");
    expect(html).toContain('<html lang="en">');
    expect(htmlSection(html, "footer")).toContain(
      "This email was sent by Jassmin, a perfume shop in Ukraine.",
    );
    expect(text).toContain("This email was sent by Jassmin, a perfume shop in Ukraine.");
  });

  it("uses the C+ colours, light only", () => {
    const { html } = render("uk");
    expect(html).toContain("background:#C22F4B");
    expect(html).toContain("color:#1F1A1C");
    expect(html).toContain('<meta name="color-scheme" content="light">');
  });

  it("links the inbox and the site in the footer, and leaves the site out when unknown", () => {
    const withSite = htmlSection(render("uk").html, "footer");
    expect(withSite).toContain('href="mailto:hello@jassmin.ua"');
    expect(withSite).toContain('<a href="https://jassmin.ua"');

    const { html, text } = renderEmail(blocks, {
      translator: createTranslator("uk"),
      footer: { inbox: "hello@jassmin.ua" },
      subject: "Тема",
    });
    expect(htmlSection(html, "footer")).not.toContain("https://");
    expect(text).toContain("Jassmin · hello@jassmin.ua\n");
  });

  it("escapes user input instead of rendering it as HTML", () => {
    const { html, text } = render("uk", [
      { type: "paragraph", text: `<script>alert("x")</script> & <b>bold</b>` },
      { type: "lines", items: ["<img src=x onerror=alert(1)>"] },
      { type: "amounts", rows: [{ label: "<i>", value: "'1'" }] },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>bold");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;b&gt;");
    expect(html).toContain("&#39;1&#39;");
    // The text part is plain text, so it keeps the characters as typed.
    expect(text).toContain(`<script>alert("x")</script> & <b>bold</b>`);
  });

  it("adds a hidden preheader to the HTML only", () => {
    const { html, text } = renderEmail(blocks, {
      translator: createTranslator("uk"),
      footer,
      subject: "Тема",
      preheader: "Замовлення №1 прийнято",
    });
    expect(html).toContain("display:none");
    expect(html).toContain("Замовлення №1 прийнято");
    expect(text).not.toContain("Замовлення №1 прийнято");
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("senderDomain and createMessageId", () => {
  it("takes the domain of the sender's address", () => {
    expect(senderDomain("Jassmin website <no-reply@jassmin.ua>")).toBe("jassmin.ua");
    expect(senderDomain("orders@Mail.Jassmin.UA")).toBe("mail.jassmin.ua");
    expect(senderDomain({ address: "a@example.com" })).toBe("example.com");
    expect(senderDomain("no address")).toBe("jassmin.ua");
  });

  it("creates a unique Message-ID on that domain", () => {
    const first = createMessageId("Jassmin <no-reply@jassmin.ua>");
    expect(first).toMatch(/^<[0-9a-f-]{36}@jassmin\.ua>$/);
    expect(createMessageId("Jassmin <no-reply@jassmin.ua>")).not.toBe(first);
  });
});

describe("composeEmail", () => {
  it("returns HTML and text parts with Reply-To and a jassmin.ua Message-ID", () => {
    const email = composeEmail({
      from: "Jassmin website <no-reply@jassmin.ua>",
      to: "olena@example.com",
      replyTo: "hello@jassmin.ua",
      subject: "Тема",
      blocks,
      translator: createTranslator("en"),
      footer,
      headers: { "X-Mailin-custom": "order-email:7" },
    });
    expect(email).toMatchObject({
      from: "Jassmin website <no-reply@jassmin.ua>",
      to: "olena@example.com",
      replyTo: "hello@jassmin.ua",
      subject: "Тема",
      headers: { "X-Mailin-custom": "order-email:7" },
    });
    expect(email.messageId).toMatch(/@jassmin\.ua>$/);
    expect(email.html).toContain('<html lang="en">');
    expect(email.text).toContain("Вітаємо, Олена!");
  });
});
