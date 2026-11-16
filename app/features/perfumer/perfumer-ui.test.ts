import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";
import type { PerfumerErrorKey, ThreadItem } from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import { MessageThread, type MessageThreadProps } from "./MessageThread";
import { PerfumerInput } from "./PerfumerInput";

// The chat's turns rendered to HTML (#163), in Ukrainian and English: intro, cards with reasons,
// the question, errors and the disclaimer.

const product: ProductSummary = {
  id: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  slug: "acqua-di-gio",
  title: "Acqua Di Gio",
  brand: "Armani",
  gender: "men",
  packSize: 1,
  image: null,
  variants: [
    { id: "v5", volumeMl: 5, price: "290.00", inStock: true },
    { id: "v30", volumeMl: 30, price: "1450.00", inStock: true },
  ],
  minPrice: "290.00",
  hasPriceRange: true,
  volumes: [5, 30],
  inStock: true,
  defaultVariant: { id: "v5", volumeMl: 5 },
  fragranceFamily: "водяні",
};

const conversation: ThreadItem[] = [
  { id: "1", role: "user", text: "Щось морське\nдо 500 ₴" },
  {
    id: "2",
    role: "perfumer",
    reply: {
      intro: "Ось свіжі <b>морські</b> аромати.",
      picks: [{ product, reason: "Морські ноти й мʼята." }],
      question: "Для кого аромат?",
    },
  },
];

function render(element: ReturnType<typeof createElement>, locale: Locale = "uk") {
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: ["/parfumer"] });
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale }, createElement(RouterProvider, { router })),
  );
}

function thread(props: Partial<MessageThreadProps> = {}, locale: Locale = "uk") {
  return render(
    createElement(MessageThread, {
      items: conversation,
      pending: null,
      onCancel: () => {},
      onRetry: () => {},
      ...props,
    }),
    locale,
  );
}

const errorItem = (error: PerfumerErrorKey): ThreadItem => ({
  id: "e",
  role: "error",
  error,
  retryText: "Щось морське",
});

describe("MessageThread", () => {
  it("announces new turns politely and labels the conversation", () => {
    expect(thread()).toMatch(
      /^<ol aria-live="polite" aria-relevant="additions" aria-label="Розмова з AI-парфумером"/,
    );
  });

  it("shows the customer's message and the perfumer's intro as plain text", () => {
    const html = thread();
    expect(html).toContain('<span class="sr-only">Ви:</span>');
    expect(html).toContain("Щось морське\nдо 500 ₴");
    // The model's text is never HTML.
    expect(html).toContain("Ось свіжі &lt;b&gt;морські&lt;/b&gt; аромати.");
    expect(html).not.toContain("<b>");
  });

  it("shows each pick as a card linking to the product, with its reason and no cart button", () => {
    const html = thread();
    expect(html).toContain('aria-label="Рекомендовані аромати"');
    expect(html).toMatch(/<h3[^>]*><a[^>]*href="\/parfumy\/acqua-di-gio"[^>]*>Acqua Di Gio<\/a>/);
    expect(html).toContain("Чому вам пасує");
    expect(html).toContain("Морські ноти й мʼята.");
    expect(html).toContain("від 290");
    expect(html).not.toMatch(/<button/);
  });

  it("shows the perfumer's question", () => {
    const html = thread();
    expect(html).toContain("Уточнення");
    expect(html).toContain("Для кого аромат?");
  });

  it("renders in English", () => {
    const html = thread({}, "en");
    expect(html).toContain('aria-label="Conversation with the AI perfumer"');
    expect(html).toContain("You:");
    expect(html).toContain("Why it suits you");
    expect(html).toContain("A question");
    expect(html).toMatch(/href="\/en\/perfumes\/acqua-di-gio"/);
  });

  it.each([
    ["unavailable", "Парфумер зараз недоступний. Спробуйте ще раз за хвилину.", true],
    ["timeout", "Парфумер думав надто довго й не встиг відповісти.", true],
    ["rateLimited", "Ви надіслали багато повідомлень поспіль.", false],
    ["tooLong", "Повідомлення задовге: скоротіть його до 500 символів.", false],
  ] as const)("explains the %s error, with a retry only where it helps", (error, text, retry) => {
    const html = thread({ items: [...conversation, errorItem(error)] });
    expect(html).toContain(text);
    expect(html.includes("Спробувати ще раз")).toBe(retry);
  });

  it("explains errors in English", () => {
    const html = thread({ items: [errorItem("rateLimited")] }, "en");
    expect(html).toContain("You&#x27;ve sent a lot of messages in a row.");
  });

  it("offers no retry for an older error or while a reply is awaited", () => {
    const older = thread({ items: [errorItem("timeout"), conversation[0] as ThreadItem] });
    expect(older).not.toContain("Спробувати ще раз");
    const waiting = thread({
      items: [errorItem("timeout")],
      pending: { id: "p", text: "Щось морське", steps: [], intro: "" },
    });
    expect(waiting).not.toContain("Спробувати ще раз");
  });

  it("notes a cancelled request", () => {
    expect(thread({ items: [{ id: "c", role: "cancelled" }] })).toContain(
      "Запит скасовано. Напишіть ще раз, коли будете готові.",
    );
  });

  it("shows the thinking state while a reply is awaited, without a cancel button at first", () => {
    const html = thread({ pending: { id: "p", text: "Щось морське", steps: [], intro: "" } });
    expect(html).toContain('role="status"');
    expect(html).toContain("Парфумер підбирає аромати…");
    expect(html).toContain("Шукаю в каталозі · зазвичай до хвилини");
    expect(html).not.toContain("Скасувати");
  });
});

describe("PerfumerInput", () => {
  const input = (value: string, locale: Locale = "uk") =>
    render(
      createElement(PerfumerInput, {
        value,
        onChange: () => {},
        onSend: () => {},
        disabled: false,
        inputRef: { current: null },
        sticky: true,
      }),
      locale,
    );

  it("labels the field and links the disclaimer to the contacts", () => {
    const html = input("");
    expect(html).toContain(
      '<label for="perfumer-input" class="sr-only">Повідомлення AI-парфумеру</label>',
    );
    expect(html).toContain('aria-describedby="perfumer-counter perfumer-note"');
    expect(html).toContain("AI-парфумер — це штучний інтелект, він може помилятися.");
    expect(html).toMatch(/<a[^>]*href="\/#contacts"[^>]*>напишіть нам<\/a>/);
    expect(input("", "en")).toMatch(/<a[^>]*href="\/en#contacts"[^>]*>contact us<\/a>/);
  });

  it("can't send an empty message", () => {
    expect(input("   ")).toMatch(/<button type="submit" disabled=""[^>]*aria-label="Надіслати"/);
  });

  it("shows the counter from 400 characters", () => {
    expect(input("а".repeat(399))).not.toContain("399 / 500");
    expect(input("а".repeat(400))).toContain("400 / 500");
  });

  it("refuses more than 500 characters with an alert", () => {
    const html = input("а".repeat(501));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Повідомлення задовге");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/<button type="submit" disabled=""/);
  });
});

describe("the streamed reply (#164)", () => {
  const pending = { id: "p", text: "Щось морське", steps: [], intro: "" };

  it("shows each catalog search as a sentence instead of the rotating hint", () => {
    const html = thread({
      pending: {
        ...pending,
        steps: [
          { tool: "search", families: ["водяні"], gender: "men", maxPriceUah: 600, found: 4 },
          { tool: "similar", title: "La Vie Est Belle", found: 0 },
        ],
      },
    });
    expect(html).toMatch(/Шукаю в каталозі: водяні, для нього, до 600\s₴/);
    expect(html).toContain("знайдено 4 аромати");
    expect(html).toContain("Шукаю схожі на «La Vie Est Belle»");
    expect(html).toContain("нічого не знайдено");
    expect(html).not.toContain("Шукаю в каталозі ·");
  });

  it("names the steps in English", () => {
    const html = thread(
      {
        pending: {
          ...pending,
          steps: [
            { tool: "search", families: [], found: 1 },
            { tool: "similar", found: 3 },
          ],
        },
      },
      "en",
    );
    expect(html).toContain("Searching the catalog");
    expect(html).toContain("found 1 perfume");
    expect(html).toContain("Looking for similar perfumes");
    expect(html).toContain("found 3 perfumes");
  });

  it("says the perfumer is writing while the intro streams, with cancel still possible", () => {
    const html = thread({ pending: { ...pending, intro: "Ось свіжі аромати." } });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Парфумер пише відповідь…");
    expect(html).not.toContain("Парфумер підбирає аромати…");
  });

  it("shows the cards once they arrive, without the thinking bubble", () => {
    const html = thread({
      pending: {
        ...pending,
        intro: "Ось свіжі аромати.",
        picks: [{ product, reason: "Морські ноти й мʼята." }],
      },
    });
    expect(html).toContain("Acqua Di Gio");
    expect(html).toContain("Морські ноти й мʼята.");
    expect(html).not.toContain('role="status"');
  });
});
