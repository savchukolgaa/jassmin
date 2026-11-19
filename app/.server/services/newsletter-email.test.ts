import { describe, expect, it } from "vitest";
import { createTranslator } from "~/lib/i18n";
import { htmlSection, htmlWords, words } from "../email/test-helpers";
import { buildNewsletterEmail, type NewsletterEmailInput } from "./newsletter-email";
import type { OrderEmailEnv } from "./order-email";

const env: OrderEmailEnv = {
  CONTACT_INBOX: "hello@jassmin.ua",
  CONTACT_FROM: "Jassmin website <no-reply@jassmin.ua>",
  ORDER_FROM: "Jassmin <orders@jassmin.ua>",
  PUBLIC_SITE_URL: "https://jassmin.ua",
};

const site = "https://jassmin.ua";
const utm = "utm_source=newsletter&utm_medium=email&utm_campaign=autumn-news";
const unsubscribe = "https://jassmin.ua/vidpysatysia/7.sig";

const input: NewsletterEmailInput = {
  slug: "autumn-news",
  text: {
    subject: "Осінні новинки",
    preheader: "Нові аромати вже тут",
    body: "### Новинки\n\nДивіться **нові** аромати в [каталозі](/catalog/women) і на [Instagram](https://instagram.com/jassmin). <script>x</script>",
  },
  products: [
    {
      publicId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
      slug: "coco",
      title: "Coco",
      brand: "Chanel",
      imageUrl: "/uploads/coco.jpg",
      minPrice: "450.00",
      hasPriceRange: true,
    },
    {
      publicId: "01a1652b-6e25-7c03-ae47-25b57131fb07",
      slug: null,
      title: "Sauvage",
      brand: "Dior",
      imageUrl: null,
      minPrice: "900.00",
      hasPriceRange: false,
    },
  ],
  recipient: { fullName: "Олена", email: "olena@example.com" },
  unsubscribeUrl: unsubscribe,
};

/** The text part's body, without the URLs it writes out (the HTML hides them in links). */
function textWords(text: string): string[] {
  return words(
    (text.split("\n-- \n")[0] ?? "")
      .replace(/ \(https?:\/\/[^)]+\)/g, "")
      .replace(/^https?:\/\/\S+$/gm, ""),
  );
}

describe("buildNewsletterEmail", () => {
  it("renders staff's text, the product cards and the shop button, with UTM on shop links", () => {
    const message = buildNewsletterEmail(input, createTranslator("uk"), env, site);
    const html = String(message.html);
    const text = String(message.text);
    const content = htmlSection(html, "content");

    expect(message.subject).toBe("Осінні новинки");
    expect(message.from).toBe("Jassmin <orders@jassmin.ua>");
    expect(message.to).toEqual({ name: "Олена", address: "olena@example.com" });
    expect(html).toContain("Нові аромати вже тут");
    expect(content).toContain("Вітаємо, Олена!");
    expect(content).toContain(">Новинки</h2>");
    expect(content).toContain(`href="${site}/catalog/women?${utm.replaceAll("&", "&amp;")}"`);
    // Other sites are left alone.
    expect(content).toContain('href="https://instagram.com/jassmin"');
    expect(content).not.toContain("<script");
    expect(text).toContain(`${site}/parfumy/coco?${utm}`);
    // A product without a slug links by its public id; a photo-less one gets the shop's bottle.
    expect(text).toContain(`${site}/parfumy/01a1652b-6e25-7c03-ae47-25b57131fb07?${utm}`);
    expect(content).toContain(`src="${site}/uploads/coco.jpg"`);
    expect(content).toContain(`src="${site}/email/shop-bottle.jpg"`);
    expect(text).toMatch(/Chanel Coco\nвід 450\s₴/);
    expect(text).toMatch(/Dior Sauvage\n900\s₴/);
    expect(text).toContain(`До магазину:\n${site}/?${utm}`);
    // Joined, since a link's closing tag splits "Instagram." into two HTML words.
    const joined = (list: string[]) => list.filter((w) => !w.startsWith("http")).join("");
    expect(joined(htmlWords(content))).toBe(joined(textWords(text)));
  });

  it("carries the unsubscribe link and the one-click headers, without UTM tags", () => {
    const message = buildNewsletterEmail(input, createTranslator("uk"), env, site);
    expect(message.headers).toEqual({
      "List-Unsubscribe": `<${unsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(htmlSection(String(message.html), "footer")).toContain(`href="${unsubscribe}"`);
    expect(String(message.text)).toContain(`: ${unsubscribe}`);
  });

  it("is in English for an English delivery", () => {
    const message = buildNewsletterEmail(
      { ...input, text: { subject: "Autumn", preheader: null, body: "Hello" } },
      createTranslator("en"),
      env,
      site,
    );
    expect(String(message.text)).toContain("Hello, Олена!");
    expect(String(message.text)).toMatch(/Chanel Coco\nfrom ₴?450/);
    expect(String(message.text)).toContain(`${site}/en/perfumes/coco?${utm}`);
  });

  it("marks a test send and leaves out the cards without products or the link without a user", () => {
    const message = buildNewsletterEmail(
      { ...input, products: [], unsubscribeUrl: null, test: true },
      createTranslator("uk"),
      env,
      site,
    );
    expect(message.subject).toBe("[Тест] Осінні новинки");
    expect(String(message.text)).toMatch(/^Це тестовий лист/);
    expect(message.headers).toBeUndefined();
    expect(String(message.html)).not.toContain("<img");
    expect(String(message.text)).not.toContain("Обрані аромати");
  });
});
