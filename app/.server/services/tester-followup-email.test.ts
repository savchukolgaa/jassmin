import { describe, expect, it } from "vitest";
import { createTranslator } from "~/lib/i18n";
import { formatPrice } from "~/lib/money";
import type { TesterFollowup, TesterFollowupProduct } from "../db/queries/tester-followups";
import { htmlSection, htmlWords, words } from "../email/test-helpers";
import { verifyUnsubscribeToken } from "../unsubscribe-token";
import type { OrderEmailEnv } from "./order-email";
import {
  buildTesterFollowupEmail,
  type TesterFollowupOffer,
  testerFollowupUrl,
} from "./tester-followup-email";

const env: OrderEmailEnv = {
  CONTACT_INBOX: "hello@jassmin.ua",
  CONTACT_FROM: "Jassmin website <no-reply@jassmin.ua>",
  ORDER_FROM: "Jassmin <orders@jassmin.ua>",
  PUBLIC_SITE_URL: "https://jassmin.ua",
};

const links = { siteUrl: "https://jassmin.ua", unsubscribeSecret: "s".repeat(32) };

const product = (
  title: string,
  slug: string | null,
  imageUrl: string | null = null,
): TesterFollowupProduct => ({
  publicId: `0190a000-0000-7000-8000-00000000000${title.length % 10}`,
  slug,
  title,
  brand: "Chanel",
  imageUrl,
  fromPrice: "1350.00",
});

const followup: TesterFollowup = {
  orderId: 7,
  userId: 42,
  fullName: "Олена\r\nBcc: x@evil.test",
  email: "olena@example.com",
  marketingOptIn: true,
  emailVerified: true,
  orderStatus: "completed",
  returned: false,
  boughtBottleSince: false,
  discount: {
    code: "TRY-7KQ2M9XD",
    percent: "10.00",
    endsAt: new Date("2026-12-25T10:00:00Z"),
    active: true,
    usedUp: false,
  },
  products: [product("Coco", "coco", "https://cms.jassmin.ua/coco.jpg"), product("Chance", null)],
};

const offer: TesterFollowupOffer = {
  code: "TRY-7KQ2M9XD",
  percent: "10.00",
  endsAt: new Date("2026-12-25T10:00:00Z"),
};

function build(locale: "uk" | "en" = "uk", value: TesterFollowup = followup) {
  return buildTesterFollowupEmail(value, offer, createTranslator(locale), env, links);
}

describe("testerFollowupUrl", () => {
  it("links the product page with the code and the tester_followup UTM tags", () => {
    expect(
      testerFollowupUrl("https://jassmin.ua", "en", { publicId: "x", slug: "coco" }, "TRY-1"),
    ).toBe(
      "https://jassmin.ua/en/perfumes/coco?code=TRY-1&utm_source=email&utm_medium=email&utm_campaign=tester_followup",
    );
  });
});

describe("buildTesterFollowupEmail", () => {
  it("asks which one they liked, shows a card per perfume and the code with its last day", () => {
    const email = build();
    const content = htmlSection(String(email.html), "content");
    const text = String(email.text);
    const coco = testerFollowupUrl(
      "https://jassmin.ua",
      "uk",
      followup.products[0] ?? product("", ""),
      "TRY-7KQ2M9XD",
    );

    expect(email.subject).toBe("Який аромат вам сподобався? — Jassmin");
    expect(email.from).toBe("Jassmin <orders@jassmin.ua>");
    expect(email.to).toEqual({ name: "Олена Bcc: x@evil.test", address: "olena@example.com" });
    expect(text).toContain("Ви пробували");
    expect(text).toContain(`Chanel Coco\nфлакон від ${formatPrice("1350.00")}`);
    expect(text).toContain("Chanel Chance");
    expect(text).toContain("10% знижки на повний флакон (30, 50 або 100 мл)");
    expect(text).toContain("TRY-7KQ2M9XD");
    // Valid until 10:00 UTC on 25 December: the last whole day is the 24th.
    expect(text).toMatch(/Діє до 24 грудня 2026 р\. включно/);
    expect(text).toContain(`Обрати флакон:\n${coco}`);
    expect(content).toContain(`href="${coco.replaceAll("&", "&amp;")}"`);
    // A product without a slug links by its public id.
    expect(text).toContain(`/parfumy/${followup.products[1]?.publicId}?code=TRY-7KQ2M9XD`);
    expect(content).toContain('src="https://cms.jassmin.ua/coco.jpg"');
    expect(content).toContain('src="https://jassmin.ua/email/shop-bottle.jpg"');
    // The text part writes the cards' links out; the HTML makes their photos and names links.
    const notLink = (word: string) => !word.startsWith("https://jassmin.ua/parfumy/");
    expect(htmlWords(content).filter(notLink)).toEqual(
      words(text.split("\n\n-- \n")[0] ?? "").filter(notLink),
    );
  });

  it("is in English when queued in English", () => {
    const email = build("en");
    const text = String(email.text);
    expect(email.subject).toBe("Which one did you like? — Jassmin");
    expect(text).toContain("Hello, Олена Bcc: x@evil.test!");
    expect(text).toContain("10% off a full bottle (30, 50 or 100 ml)");
    expect(text).toContain("Valid until 24 December 2026 inclusive, for one order.");
    expect(text).toContain(
      "Choose a bottle:\nhttps://jassmin.ua/en/perfumes/coco?code=TRY-7KQ2M9XD",
    );
    expect(text).toContain(
      "Unsubscribe from news and offers: https://jassmin.ua/en/unsubscribe/42.",
    );
  });

  it("shows a fractional percent as it is", () => {
    const email = buildTesterFollowupEmail(
      followup,
      { ...offer, percent: "12.50" },
      createTranslator("en"),
      env,
      links,
    );
    expect(String(email.text)).toContain("12.5% off a full bottle");
  });

  it("gives a one-click unsubscribe for the customer", () => {
    const email = build();
    const headers = email.headers as Record<string, string>;
    const match = /^<https:\/\/jassmin\.ua\/vidpysatysia\/([^>]+)>$/.exec(
      headers["List-Unsubscribe"] ?? "",
    );
    expect(verifyUnsubscribeToken(match?.[1] ?? "", links.unsubscribeSecret)).toBe(42);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(htmlSection(String(email.html), "footer")).toContain(
      `href="https://jassmin.ua/vidpysatysia/${match?.[1]}"`,
    );
  });
});
