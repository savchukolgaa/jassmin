import type Mail from "nodemailer/lib/mailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderConfirmation } from "~/lib/checkout";
import type { GiftCard } from "~/lib/commerce";
import { createTranslator } from "~/lib/i18n";
import type { ClaimedOrderEmail } from "../db/queries/order-emails";
import { htmlSection, words } from "../email/test-helpers";
import {
  buildGiftCardEmail,
  buildGiftCardRecipientEmail,
  buildOrderConfirmationEmail,
  deliverOrderEmails,
  describeOrderEmailReport,
  type OrderEmailDeps,
  type OrderEmailEnv,
} from "./order-email";

/** `Intl` puts (narrow) no-break spaces in prices; compare them as plain spaces. */
const normalize = (text: string) => text.replace(/[  ]/gu, " ");

/** The text part without the layout's footer (after `-- `). */
const bodyOf = (email: Mail.Options) => normalize(String(email.text)).split("\n\n-- \n")[0];

const env: OrderEmailEnv = {
  ORDER_FROM: undefined,
  CONTACT_FROM: "Jassmin website <no-reply@example.com>",
  CONTACT_INBOX: "shop@example.com",
  PUBLIC_SITE_URL: "https://jassmin.ua",
};

const codOrder: OrderConfirmation = {
  id: 1042,
  // 23:30 in Kyiv on 21 October; the email shows Kyiv's date.
  createdAt: new Date("2026-10-21T20:30:00.000Z"),
  fullName: "Олена Коваль",
  email: "olena@example.com",
  phone: "+380671234567",
  shippingAddress: "Київ, Відділення №12",
  paymentMethod: "cod",
  freeShipping: false,
  subtotal: "900.00",
  discountAmount: "0.00",
  discount: null,
  shippingAmount: "0.00",
  giftCardAmount: "0.00",
  totalAmount: "900.00",
  lines: [
    {
      key: "1",
      title: "Coco Mademoiselle",
      brand: "Chanel",
      volumeMl: 5,
      packSize: 1,
      quantity: 2,
      unitPrice: "450.00",
      lineTotal: "900.00",
    },
  ],
};

const cardOrder: OrderConfirmation = {
  ...codOrder,
  id: 1043,
  fullName: "Olena Koval",
  paymentMethod: "card",
  freeShipping: true,
  subtotal: "6430.00",
  totalAmount: "6430.00",
  lines: [
    {
      key: "2",
      title: "Coco Mademoiselle",
      brand: "Chanel",
      volumeMl: 30,
      packSize: 1,
      quantity: 1,
      unitPrice: "4450.00",
      lineTotal: "4450.00",
    },
    {
      key: "3",
      title: "Discovery set",
      brand: null,
      volumeMl: 10,
      packSize: 3,
      quantity: 2,
      unitPrice: "990.00",
      lineTotal: "1980.00",
    },
  ],
};

describe("buildOrderConfirmationEmail", () => {
  it("writes a Ukrainian cash-on-delivery order below the free-shipping threshold", () => {
    const email = buildOrderConfirmationEmail(codOrder, createTranslator("uk"), env);

    expect(email).toMatchObject({
      from: "Jassmin website <no-reply@example.com>",
      to: { name: "Олена Коваль", address: "olena@example.com" },
      replyTo: "shop@example.com",
      subject: "Замовлення №1042 прийнято — Jassmin",
    });
    expect(bodyOf(email)).toBe(
      [
        "Вітаємо, Олена Коваль!",
        "",
        "Дякуємо за замовлення в Jassmin. Ваше замовлення №1042 від 21 жовтня 2026 р. прийнято. Ми зв’яжемося з вами за номером +380671234567, щоб його підтвердити.",
        "",
        "Ваше замовлення",
        "• Chanel Coco Mademoiselle, 5 мл, 2 × 450 ₴ = 900 ₴",
        "",
        "Сума: 900 ₴",
        "Доставка: За тарифами Нової Пошти при отриманні",
        "До сплати: 900 ₴",
        "",
        "Оплата",
        "Накладений платіж",
        "Оплата при отриманні у відділенні Нової Пошти.",
        "",
        "Доставка",
        "Нова Пошта",
        "Олена Коваль, +380671234567",
        "Київ, Відділення №12",
        "",
        "Маєте запитання? Відповідайте на цей лист або пишіть на shop@example.com.",
        "",
        "Команда Jassmin",
      ].join("\n"),
    );
  });

  it("writes an English card order with free delivery and a pack size", () => {
    const email = buildOrderConfirmationEmail(cardOrder, createTranslator("en"), env);

    expect(email.subject).toBe("Order №1043 received — Jassmin");
    expect(bodyOf(email)).toBe(
      [
        "Hello Olena Koval,",
        "",
        "Thank you for shopping at Jassmin. We've received your order №1043 of 21 October 2026. We'll call you on +380671234567 to confirm it.",
        "",
        "Your order",
        "• Chanel Coco Mademoiselle, 30 ml, 1 × ₴4,450 = ₴4,450",
        "• Discovery set, 3 × 10 ml, 2 × ₴990 = ₴1,980",
        "",
        "Subtotal: ₴6,430",
        "Delivery: Free",
        "Total: ₴6,430",
        "",
        "Payment",
        "By card",
        "Pay online by card right after placing your order.",
        "",
        "Delivery",
        "Nova Poshta",
        "Olena Koval, +380671234567",
        "Київ, Відділення №12",
        "",
        "Any questions? Reply to this email or write to shop@example.com.",
        "",
        "The Jassmin team",
      ].join("\n"),
    );
  });

  it("shows the discount line in both languages (#59)", () => {
    const trio: OrderConfirmation = {
      ...codOrder,
      subtotal: "2370.00",
      discountAmount: "1871.00",
      discount: { amount: "1871.00", code: null, kind: "fixed_price_set" },
      totalAmount: "499.00",
    };
    const withCode: OrderConfirmation = {
      ...cardOrder,
      discountAmount: "643.00",
      discount: { amount: "643.00", code: "JASSMIN10", kind: "percent" },
      totalAmount: "5787.00",
    };

    expect(
      normalize(String(buildOrderConfirmationEmail(trio, createTranslator("uk"), env).text)),
    ).toContain(["Сума: 2 370 ₴", "Тестерне тріо 3 × 10 мл: −1 871 ₴", "Доставка:"].join("\n"));
    expect(
      normalize(String(buildOrderConfirmationEmail(withCode, createTranslator("en"), env).text)),
    ).toContain(
      [
        "Subtotal: ₴6,430",
        "Discount (promo code JASSMIN10): −₴643",
        "Delivery: Free",
        "Total: ₴5,787",
      ].join("\n"),
    );
  });

  it("shows the couple-offer line in both languages (#124)", () => {
    const couple: OrderConfirmation = {
      ...codOrder,
      subtotal: "3000.00",
      discountAmount: "225.00",
      discount: { amount: "225.00", code: null, kind: "percent_every_nth" },
      totalAmount: "2775.00",
    };
    const text = (locale: "uk" | "en") =>
      normalize(String(buildOrderConfirmationEmail(couple, createTranslator(locale), env).text));

    expect(text("uk")).toContain("Пропозиція для двох: −15% на другий флакон: −225 ₴");
    expect(text("en")).toContain("Couple offer: −15% on the second bottle: −₴225");
  });

  it("names deleted products and leaves out unknown sizes", () => {
    const email = buildOrderConfirmationEmail(
      {
        ...codOrder,
        lines: [{ ...codOrder.lines[0], key: "4", title: null, brand: null, volumeMl: null }],
      } as OrderConfirmation,
      createTranslator("uk"),
      env,
    );

    expect(normalize(String(email.text))).toContain(
      "• Цей парфум більше не продається, 2 × 450 ₴ = 900 ₴",
    );
  });

  it("keeps line breaks in the name out of the headers and sends from ORDER_FROM", () => {
    const email = buildOrderConfirmationEmail(
      { ...codOrder, fullName: "Olena\r\nBcc: spam@example.com" },
      createTranslator("en"),
      { ...env, ORDER_FROM: "Jassmin <orders@example.com>" },
    );

    expect(email.from).toBe("Jassmin <orders@example.com>");
    expect(email.to).toEqual({ name: "Olena Bcc: spam@example.com", address: "olena@example.com" });
    expect(email.subject).toBe("Order №1042 received — Jassmin");
  });
});

/** An in-memory queue: due rows are claimed once per call, like the real lease. */
function fakeDeps(
  emails: ClaimedOrderEmail[],
  overrides: Partial<OrderEmailDeps> = {},
): OrderEmailDeps & { sendMail: ReturnType<typeof vi.fn> } {
  const due = [...emails];
  const sendMail = vi.fn(async (_options: Mail.Options) => ({}));
  return {
    sendMail,
    mailer: { sendMail },
    env,
    claim: vi.fn(async ({ orderId, giftCardId, limit }) => {
      const matching = due.filter(
        (e) =>
          (orderId === undefined || e.orderId === orderId) &&
          (giftCardId === undefined || e.giftCardId === giftCardId),
      );
      const batch = matching.slice(0, limit);
      for (const email of batch) due.splice(due.indexOf(email), 1);
      return batch;
    }),
    loadOrder: vi.fn(async (orderId: number) =>
      orderId === codOrder.id ? codOrder : orderId === cardOrder.id ? cardOrder : undefined,
    ),
    loadGiftCard: vi.fn(async (giftCardId: number) =>
      giftCardId === giftCard.id ? giftCard : undefined,
    ),
    markSent: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    ...overrides,
  };
}

const queued = (id: number, orderId: number, attempts = 1): ClaimedOrderEmail => ({
  id,
  orderId,
  giftCardId: null,
  type: "confirmation",
  locale: "uk",
  attempts,
});

const giftCard: GiftCard = {
  id: 77,
  code: "ABCD2345EFGH6789",
  initialAmount: "1000.00",
  balance: "1000.00",
  currency: "UAH",
  status: "active",
  buyerUserId: null,
  buyerEmail: "buyer@example.com",
  recipientEmail: "friend@example.com",
  locale: "uk",
  paymentId: 5,
  activatedAt: new Date("2026-11-05T10:00:00Z"),
  // Kyiv's date: 5 November 2027.
  expiresAt: new Date("2027-11-05T10:00:00Z"),
  createdAt: new Date("2026-11-05T09:58:00Z"),
  updatedAt: new Date("2026-11-05T10:00:00Z"),
};

describe("gift card emails (#125)", () => {
  it("shows what a gift card paid in the order confirmation, in both languages", () => {
    const order = {
      ...codOrder,
      paymentMethod: "gift_card" as const,
      giftCardAmount: "900.00",
      totalAmount: "0.00",
    };
    const uk = normalize(
      String(buildOrderConfirmationEmail(order, createTranslator("uk"), env).text),
    );
    expect(uk).toContain("Подарункова картка: −900 ₴\nДо сплати: 0 ₴");
    expect(uk).toContain(
      "Подарунковою карткою\nЗамовлення повністю оплачено подарунковою карткою.",
    );
    const en = normalize(
      String(buildOrderConfirmationEmail(order, createTranslator("en"), env).text),
    );
    expect(en).toContain("Gift card: −₴900");
    expect(en).toContain("The order is paid in full with a gift card.");
  });

  it("has no gift card line without one", () => {
    expect(
      String(buildOrderConfirmationEmail(codOrder, createTranslator("uk"), env).text),
    ).not.toContain("Подарункова картка");
  });

  it("sends the buyer the code, the expiry and how to use it, in Ukrainian", () => {
    const email = buildGiftCardEmail(giftCard, createTranslator("uk"), env);
    expect(email.to).toBe("buyer@example.com");
    expect(email.from).toBe(env.CONTACT_FROM);
    expect(email.replyTo).toBe("shop@example.com");
    expect(normalize(String(email.subject))).toBe("Ваша подарункова картка Jassmin на 1 000 ₴");
    const text = normalize(String(email.text));
    expect(text).toContain("Ваша подарункова картка Jassmin на 1 000 ₴ оплачена");
    expect(text).toContain("Ми також надіслали код на friend@example.com.");
    expect(text).toContain("Код картки: ABCD-2345-EFGH-6789");
    expect(text).toContain("Картка діє до 5 листопада 2027 р.");
    expect(text).toContain("введіть код під час оформлення замовлення");
    expect(text).toContain("shop@example.com");
  });

  it("leaves out the recipient line without a recipient, in English", () => {
    const email = buildGiftCardEmail(
      { ...giftCard, recipientEmail: null },
      createTranslator("en"),
      env,
    );
    const text = normalize(String(email.text));
    expect(normalize(String(email.subject))).toBe("Your Jassmin gift card of ₴1,000");
    expect(text).toContain("Card code: ABCD-2345-EFGH-6789");
    expect(text).not.toContain("We've also sent the code");
  });

  it("sends the recipient the code without the buyer's address", () => {
    const uk = buildGiftCardRecipientEmail(giftCard, createTranslator("uk"), env);
    expect(uk.to).toBe("friend@example.com");
    expect(normalize(String(uk.subject))).toBe("Вам подарували картку Jassmin на 1 000 ₴");
    expect(String(uk.text)).toContain("Код картки: ABCD-2345-EFGH-6789");
    expect(String(uk.text)).not.toContain("buyer@example.com");

    const en = buildGiftCardRecipientEmail(giftCard, createTranslator("en"), env);
    expect(normalize(String(en.subject))).toBe("You've been given a Jassmin gift card of ₴1,000");
    expect(String(en.text)).toContain("Card code: ABCD-2345-EFGH-6789");
  });

  it("keeps line breaks in the addresses out of the headers", () => {
    const sneaky = { ...giftCard, buyerEmail: "a@example.com\nBcc: x@example.com" };
    expect(buildGiftCardEmail(sneaky, createTranslator("uk"), env).to).toBe(
      "a@example.com Bcc: x@example.com",
    );
  });
});

describe("order emails in the shared layout (#134)", () => {
  const builders = {
    confirmation: (locale: "uk" | "en") =>
      buildOrderConfirmationEmail(codOrder, createTranslator(locale), env),
    giftCard: (locale: "uk" | "en") => buildGiftCardEmail(giftCard, createTranslator(locale), env),
    giftCardRecipient: (locale: "uk" | "en") =>
      buildGiftCardRecipientEmail(giftCard, createTranslator(locale), env),
  };

  for (const [name, build] of Object.entries(builders)) {
    for (const locale of ["uk", "en"] as const) {
      it(`renders the ${name} email as HTML and text in ${locale}`, () => {
        const email = build(locale);
        const html = String(email.html);
        expect(html).toContain(`<html lang="${locale}">`);
        expect(words(htmlSection(html, "content"))).toEqual(words(bodyOf(email) ?? ""));
        expect(htmlSection(html, "footer")).toContain('href="mailto:shop@example.com"');
        expect(String(email.text)).toContain(
          "\n-- \nJassmin · shop@example.com · https://jassmin.ua",
        );
        expect(email.replyTo).toBe("shop@example.com");
        expect(email.messageId).toMatch(/^<[0-9a-f-]{36}@example\.com>$/);
      });
    }
  }

  it("shows the gift card code in its own box", () => {
    const html = String(buildGiftCardEmail(giftCard, createTranslator("uk"), env).html);
    expect(html).toMatch(/Courier New[^>]*>ABCD-2345-EFGH-6789</);
  });

  it("escapes the shopper's name and address in the HTML", () => {
    const html = String(
      buildOrderConfirmationEmail(
        { ...codOrder, fullName: "<b>Olena</b>", shippingAddress: "Kyiv & <i>1</i>" },
        createTranslator("en"),
        env,
      ).html,
    );
    expect(html).not.toContain("<b>Olena");
    expect(html).toContain("Hello &lt;b&gt;Olena&lt;/b&gt;,");
    expect(html).toContain("Kyiv &amp; &lt;i&gt;1&lt;/i&gt;");
  });
});

describe("deliverOrderEmails", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the order's email right after checkout and marks it sent", async () => {
    const deps = fakeDeps([queued(1, codOrder.id), { ...queued(2, cardOrder.id), locale: "en" }]);

    const report = await deliverOrderEmails({ orderId: cardOrder.id }, deps);

    expect(report).toEqual({ sent: 1, retrying: 0, gaveUp: 0, skipped: false });
    expect(deps.claim).toHaveBeenCalledWith({
      orderId: cardOrder.id,
      giftCardId: undefined,
      limit: 50,
    });
    expect(deps.sendMail).toHaveBeenCalledOnce();
    expect(deps.sendMail.mock.calls[0]?.[0]).toMatchObject({
      to: { address: "olena@example.com" },
      subject: "Order №1043 received — Jassmin",
    });
    expect(deps.markSent).toHaveBeenCalledWith(2);
  });

  it("sends a paid gift card's emails right after its payment (#125)", async () => {
    const card = (id: number, type: "gift_card" | "gift_card_recipient"): ClaimedOrderEmail => ({
      id,
      orderId: null,
      giftCardId: giftCard.id,
      type,
      locale: "en",
      attempts: 1,
    });
    const deps = fakeDeps([
      queued(1, codOrder.id),
      card(2, "gift_card"),
      card(3, "gift_card_recipient"),
    ]);

    const report = await deliverOrderEmails({ giftCardId: giftCard.id }, deps);

    expect(report).toEqual({ sent: 2, retrying: 0, gaveUp: 0, skipped: false });
    expect(deps.sendMail.mock.calls.map((call) => call[0]?.to)).toEqual([
      "buyer@example.com",
      "friend@example.com",
    ]);
    expect(deps.markSent).toHaveBeenCalledWith(2);
    expect(deps.markSent).toHaveBeenCalledWith(3);
  });

  it("gives up on a gift card email whose card is gone, and retries a failed one", async () => {
    const gone: ClaimedOrderEmail = {
      id: 1,
      orderId: null,
      giftCardId: 999,
      type: "gift_card",
      locale: "uk",
      attempts: 1,
    };
    const failing: ClaimedOrderEmail = { ...gone, id: 2, giftCardId: giftCard.id };
    const deps = fakeDeps([gone, failing]);
    deps.sendMail.mockRejectedValueOnce(new Error("SMTP down"));

    expect(await deliverOrderEmails({}, deps)).toMatchObject({ sent: 0, retrying: 1, gaveUp: 1 });
    expect(deps.markFailed).toHaveBeenCalledWith(2, { error: "SMTP down", final: false });
  });

  it("works through every due email in batches", async () => {
    const deps = fakeDeps([
      queued(1, codOrder.id),
      queued(2, cardOrder.id),
      queued(3, codOrder.id),
    ]);

    const report = await deliverOrderEmails({ limit: 2 }, deps);

    expect(report.sent).toBe(3);
    expect(deps.claim).toHaveBeenCalledTimes(2);
    expect(deps.markSent).toHaveBeenCalledTimes(3);
  });

  it("keeps a failed email for a retry until its last attempt", async () => {
    const sendMail = vi.fn(async () => {
      throw new Error("Connection refused");
    });
    const deps = fakeDeps([queued(1, codOrder.id, 1), queued(2, cardOrder.id, 8)], {
      mailer: { sendMail },
    });

    const report = await deliverOrderEmails({}, deps);

    expect(report).toEqual({ sent: 0, retrying: 1, gaveUp: 1, skipped: false });
    expect(deps.markFailed).toHaveBeenCalledWith(1, { error: "Connection refused", final: false });
    expect(deps.markFailed).toHaveBeenCalledWith(2, { error: "Connection refused", final: true });
    expect(deps.markSent).not.toHaveBeenCalled();
  });

  it("gives up on an email whose order is gone", async () => {
    const deps = fakeDeps([queued(1, 999)]);

    expect(await deliverOrderEmails({}, deps)).toMatchObject({ sent: 0, gaveUp: 1 });
    expect(deps.markFailed).toHaveBeenCalledWith(1, {
      error: "Order or gift card not found",
      final: true,
    });
    expect(deps.sendMail).not.toHaveBeenCalled();
  });

  it("leaves everything queued without SMTP_URL", async () => {
    const deps = fakeDeps([queued(1, codOrder.id)], { mailer: null });

    expect(await deliverOrderEmails({ orderId: codOrder.id }, deps)).toEqual({
      sent: 0,
      retrying: 0,
      gaveUp: 0,
      skipped: true,
    });
    expect(deps.claim).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      "[order-email] SMTP_URL is not set; order 1042's confirmation stays queued",
    );
  });

  it("never rejects, even when the queue itself fails", async () => {
    const deps = fakeDeps([], {
      claim: vi.fn(async () => {
        throw new Error("database is down");
      }),
    });
    await expect(deliverOrderEmails({ orderId: 1 }, deps)).resolves.toMatchObject({ sent: 0 });
    await expect(
      deliverOrderEmails({ orderId: 1 }, () => {
        throw new Error("Invalid environment variables");
      }),
    ).resolves.toMatchObject({ sent: 0 });

    const failingMarks = fakeDeps([queued(1, codOrder.id)], {
      markSent: vi.fn(async () => {
        throw new Error("lost connection");
      }),
    });
    await expect(deliverOrderEmails({}, failingMarks)).resolves.toMatchObject({ sent: 1 });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("describeOrderEmailReport", () => {
  it("summarises a run of the retry job", () => {
    expect(describeOrderEmailReport({ sent: 3, retrying: 1, gaveUp: 0, skipped: false })).toBe(
      "Order emails: 3 sent, 1 to retry, 0 given up.",
    );
    expect(describeOrderEmailReport({ sent: 0, retrying: 0, gaveUp: 0, skipped: true })).toBe(
      "SMTP_URL is not set, so no order emails were sent; they stay queued.",
    );
  });
});
