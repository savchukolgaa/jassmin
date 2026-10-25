import { describe, expect, it } from "vitest";
import type { OrderConfirmation } from "~/lib/checkout";
import { createTranslator } from "~/lib/i18n";
import { buildOrderConfirmationEmail, type OrderEmailEnv } from "./order-email";

/** `Intl` puts (narrow) no-break spaces in prices; compare them as plain spaces. */
const normalize = (text: string) => text.replace(/[  ]/gu, " ");

const env: OrderEmailEnv = {
  ORDER_FROM: undefined,
  CONTACT_FROM: "Jassmin website <no-reply@example.com>",
  CONTACT_INBOX: "shop@example.com",
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
  shippingAmount: "0.00",
  totalAmount: "900.00",
  lines: [
    {
      key: "1",
      title: "Coco Mademoiselle",
      brand: "Chanel",
      volumeMl: 7,
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
    expect(normalize(String(email.text))).toBe(
      [
        "Вітаємо, Олена Коваль!",
        "",
        "Дякуємо за замовлення в Jassmin. Ваше замовлення №1042 від 21 жовтня 2026 р. прийнято. Ми зв’яжемося з вами за номером +380671234567, щоб його підтвердити.",
        "",
        "Ваше замовлення",
        "• Chanel Coco Mademoiselle, 7 мл, 2 × 450 ₴ = 900 ₴",
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
    expect(normalize(String(email.text))).toBe(
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
        "We'll send you the payment details once we've confirmed your order.",
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
