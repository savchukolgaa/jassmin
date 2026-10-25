import type Mail from "nodemailer/lib/mailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderConfirmation } from "~/lib/checkout";
import { createTranslator } from "~/lib/i18n";
import type { ClaimedOrderEmail } from "../db/queries/order-emails";
import {
  buildOrderConfirmationEmail,
  deliverOrderEmails,
  describeOrderEmailReport,
  type OrderEmailDeps,
  type OrderEmailEnv,
} from "./order-email";

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
    claim: vi.fn(async ({ orderId, limit }) => {
      const matching = due.filter((e) => orderId === undefined || e.orderId === orderId);
      const batch = matching.slice(0, limit);
      for (const email of batch) due.splice(due.indexOf(email), 1);
      return batch;
    }),
    loadOrder: vi.fn(async (orderId: number) =>
      orderId === codOrder.id ? codOrder : orderId === cardOrder.id ? cardOrder : undefined,
    ),
    markSent: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    ...overrides,
  };
}

const queued = (id: number, orderId: number, attempts = 1): ClaimedOrderEmail => ({
  id,
  orderId,
  type: "confirmation",
  locale: "uk",
  attempts,
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
    expect(deps.claim).toHaveBeenCalledWith({ orderId: cardOrder.id, limit: 50 });
    expect(deps.sendMail).toHaveBeenCalledOnce();
    expect(deps.sendMail.mock.calls[0]?.[0]).toMatchObject({
      to: { address: "olena@example.com" },
      subject: "Order №1043 received — Jassmin",
    });
    expect(deps.markSent).toHaveBeenCalledWith(2);
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
    expect(deps.markFailed).toHaveBeenCalledWith(1, { error: "Order not found", final: true });
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
