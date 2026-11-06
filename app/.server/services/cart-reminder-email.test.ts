import { describe, expect, it } from "vitest";
import { createTranslator } from "~/lib/i18n";
import { formatPrice } from "~/lib/money";
import type { CartReminder } from "../db/queries/cart-reminders";
import { htmlSection, htmlWords, words } from "../email/test-helpers";
import { verifyUnsubscribeToken } from "../unsubscribe-token";
import {
  buildCartReminderEmail,
  cartReminderUrl,
  listUnsubscribeHeaders,
  unsubscribeUrl,
} from "./cart-reminder-email";
import type { OrderEmailEnv } from "./order-email";

const env: OrderEmailEnv = {
  CONTACT_INBOX: "hello@jassmin.ua",
  CONTACT_FROM: "Jassmin website <no-reply@jassmin.ua>",
  ORDER_FROM: "Jassmin <orders@jassmin.ua>",
  PUBLIC_SITE_URL: "https://jassmin.ua",
};

const links = { siteUrl: "https://jassmin.ua", unsubscribeSecret: "s".repeat(32) };

const line = (title: string, imageUrl: string | null = null, quantity = 1) => ({
  title,
  brand: "Chanel",
  imageUrl,
  volumeMl: 10,
  packSize: 1,
  quantity,
});

const reminder: CartReminder = {
  cartId: 3,
  userId: 42,
  fullName: "Олена\r\nBcc: x@evil.test",
  email: "olena@example.com",
  marketingOptIn: true,
  suppressed: false,
  orderedSince: false,
  lines: [line("Coco", "https://cms.jassmin.ua/coco.jpg", 2), line("Chance"), line("No 5")],
  availableLineCount: 5,
  subtotal: "2350.00",
};

function build(locale: "uk" | "en" = "uk", value: CartReminder = reminder) {
  return buildCartReminderEmail(value, createTranslator(locale), env, links);
}

describe("cart reminder links", () => {
  it("links the cart in each language with restore=1 and the abandoned_cart UTM tags", () => {
    expect(cartReminderUrl("https://jassmin.ua", "uk")).toBe(
      "https://jassmin.ua/koshyk?restore=1&utm_source=email&utm_medium=email&utm_campaign=abandoned_cart",
    );
    expect(cartReminderUrl("https://jassmin.ua", "en")).toBe(
      "https://jassmin.ua/en/cart?restore=1&utm_source=email&utm_medium=email&utm_campaign=abandoned_cart",
    );
  });

  it("builds the unsubscribe page and the one-click headers", () => {
    const url = unsubscribeUrl("https://jassmin.ua", "en", "42.abc");
    expect(url).toBe("https://jassmin.ua/en/unsubscribe/42.abc");
    expect(unsubscribeUrl("https://jassmin.ua", "uk", "42.abc")).toBe(
      "https://jassmin.ua/vidpysatysia/42.abc",
    );
    expect(listUnsubscribeHeaders(url)).toEqual({
      "List-Unsubscribe": "<https://jassmin.ua/en/unsubscribe/42.abc>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

describe("buildCartReminderEmail", () => {
  it("lists up to 3 lines with photos, the rest as a count, the total and the button", () => {
    const email = build();
    const content = htmlSection(String(email.html), "content");
    const text = String(email.text);

    expect(email.subject).toBe("Ваші парфуми чекають у кошику — Jassmin");
    expect(email.from).toBe("Jassmin <orders@jassmin.ua>");
    expect(email.to).toEqual({ name: "Олена Bcc: x@evil.test", address: "olena@example.com" });
    expect(text).toContain("Chanel Coco\n10 мл × 2");
    expect(text).toContain("Chanel No 5\n10 мл × 1");
    expect(text).toContain("І ще 2 аромати в кошику.");
    expect(text).toContain(`Разом за сьогоднішніми цінами: ${formatPrice("2350.00")}`);
    expect(text).toContain(
      "Повернутися до кошика:\nhttps://jassmin.ua/koshyk?restore=1&utm_source=email&utm_medium=email&utm_campaign=abandoned_cart",
    );
    // Its own photo, else the shop's bottle.
    expect(content).toContain('src="https://cms.jassmin.ua/coco.jpg"');
    expect(content.match(/src="https:\/\/jassmin\.ua\/email\/shop-bottle\.jpg"/g)).toHaveLength(2);
    // No discount in the email.
    expect(text).not.toMatch(/знижк|промокод/i);
    expect(htmlWords(content)).toEqual(words(text.split("\n\n-- \n")[0] ?? ""));
  });

  it("is in English when queued in English", () => {
    const text = String(build("en").text);
    expect(text).toContain("Hello, Олена Bcc: x@evil.test!");
    expect(text).toContain("And 2 more fragrances in your cart.");
    expect(text).toContain("Back to your cart:\nhttps://jassmin.ua/en/cart?restore=1");
    expect(text).toContain(
      "Unsubscribe from news and offers: https://jassmin.ua/en/unsubscribe/42.",
    );
  });

  it("leaves the count out when every line is shown", () => {
    const text = String(build("en", { ...reminder, availableLineCount: 3 }).text);
    expect(text).not.toContain("more fragrance");
  });

  it("gives a one-click unsubscribe for the user, the same on every build", () => {
    const first = build();
    const headers = first.headers as Record<string, string>;
    const match = /^<https:\/\/jassmin\.ua\/vidpysatysia\/([^>]+)>$/.exec(
      headers["List-Unsubscribe"] ?? "",
    );
    expect(match?.[1]).toBeDefined();
    expect(verifyUnsubscribeToken(match?.[1] ?? "", links.unsubscribeSecret)).toBe(42);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect((build().headers as Record<string, string>)["List-Unsubscribe"]).toBe(
      headers["List-Unsubscribe"],
    );
    expect(htmlSection(String(first.html), "footer")).toContain(
      `href="https://jassmin.ua/vidpysatysia/${match?.[1]}"`,
    );
  });
});
