import { describe, expect, it } from "vitest";
import { pageOf } from "./paths";
import {
  isRetryable,
  PERFUMER_MAX_INPUT_LENGTH,
  PERFUMER_PREFILL_PARAM,
  type PerfumerReply,
  perfumerPrefillSearch,
  replyToHistoryText,
  showPerfumerCorner,
  type ThreadItem,
  toHistory,
} from "./perfumer";
import type { ProductSummary } from "./products";

const product = (title: string, brand: string) => ({ title, brand }) as ProductSummary;

const reply: PerfumerReply = {
  intro: "Ось легкі аромати на літо.",
  picks: [
    { product: product("Acqua Di Gio", "Armani"), reason: "Морські ноти." },
    { product: product("Light Blue", "Dolce & Gabbana"), reason: "Цитрусові." },
  ],
  question: "Вам ближчі тихі аромати?",
};

describe("replyToHistoryText", () => {
  it("lists the intro, the picks' names and the question", () => {
    expect(replyToHistoryText(reply)).toBe(
      "Ось легкі аромати на літо.\n- Acqua Di Gio (Armani)\n- Light Blue (Dolce & Gabbana)\nВам ближчі тихі аромати?",
    );
  });

  it("is cut to the message limit", () => {
    const long = replyToHistoryText({ intro: "а".repeat(700), picks: [] });
    expect(long).toHaveLength(PERFUMER_MAX_INPUT_LENGTH);
  });
});

describe("toHistory", () => {
  it("keeps the customer's messages and the replies, skipping errors and cancelled turns", () => {
    const items: ThreadItem[] = [
      { id: "1", role: "user", text: "Щось свіже" },
      { id: "2", role: "perfumer", reply: { intro: "Ось.", picks: [] } },
      { id: "3", role: "user", text: "Дешевше" },
      { id: "4", role: "error", error: "timeout", retryText: "Дешевше" },
      { id: "5", role: "cancelled" },
      { id: "6", role: "user", text: "До 400 ₴" },
    ];
    expect(toHistory(items)).toEqual([
      { role: "user", content: "Щось свіже" },
      { role: "assistant", content: "Ось." },
      { role: "user", content: "Дешевше" },
      { role: "user", content: "До 400 ₴" },
    ]);
  });

  it("sends only the last 10 messages", () => {
    const items: ThreadItem[] = Array.from({ length: 14 }, (_, n) => ({
      id: String(n),
      role: "user",
      text: `m${n}`,
    }));
    const history = toHistory(items);
    expect(history).toHaveLength(10);
    expect(history[0]?.content).toBe("m4");
    expect(history.at(-1)?.content).toBe("m13");
  });
});

describe("isRetryable", () => {
  it("offers a retry for unavailable and timeout only", () => {
    expect(isRetryable("unavailable")).toBe(true);
    expect(isRetryable("timeout")).toBe(true);
    expect(isRetryable("rateLimited")).toBe(false);
    expect(isRetryable("tooLong")).toBe(false);
  });
});

describe("showPerfumerCorner (#165)", () => {
  it.each(["/parfumer", "/en/perfumer", "/koshyk", "/en/cart", "/oformlennia", "/en/checkout"])(
    "hides the corner button on %s",
    (path) => {
      expect(pageOf(path)).not.toBeNull();
      expect(showPerfumerCorner(pageOf(path))).toBe(false);
    },
  );

  it.each(["/", "/en", "/katalog/zhinochi", "/en/catalog/men", "/aktsii"])(
    "shows it on %s",
    (path) => {
      expect(showPerfumerCorner(pageOf(path))).toBe(true);
    },
  );

  it("hides it on the order, payment and gift card result pages", () => {
    for (const page of ["checkoutSuccess", "checkoutPay", "giftCardSuccess"] as const) {
      expect(showPerfumerCorner(page)).toBe(false);
    }
  });

  it("shows it for a URL outside the path table", () => {
    expect(showPerfumerCorner(null)).toBe(true);
  });
});

describe("perfumerPrefillSearch (#165)", () => {
  it("puts the trimmed message in `q`, encoded", () => {
    const search = perfumerPrefillSearch("  Схоже на Light Blue від Dolce & Gabbana ");
    expect(search.get(PERFUMER_PREFILL_PARAM)).toBe("Схоже на Light Blue від Dolce & Gabbana");
    expect(search.toString()).toContain("%26");
  });
});
