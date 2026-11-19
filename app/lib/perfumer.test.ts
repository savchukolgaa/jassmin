import { describe, expect, it } from "vitest";
import { pageOf } from "./paths";
import {
  isPerfumerEvent,
  isRetryable,
  PERFUMER_MAX_INPUT_LENGTH,
  PERFUMER_PREFILL_PARAM,
  type PerfumerReply,
  perfumerPrefillSearch,
  replyToHistoryText,
  showPerfumerCorner,
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

describe("isPerfumerEvent (#164)", () => {
  const card = {
    product: { id: "a1", title: "Acqua Di Gio", variants: [] },
    reason: "Морські ноти.",
  };

  it.each([
    { type: "step", step: { tool: "search", families: ["водяні"], maxPriceUah: 600, found: 3 } },
    { type: "step", step: { tool: "search", gender: "men", families: [], found: 0 } },
    { type: "step", step: { tool: "similar", title: "La Vie Est Belle", found: 6 } },
    { type: "step", step: { tool: "similar", found: 0 } },
    { type: "intro", text: "Ось свіжі аромати." },
    { type: "picks", picks: [card] },
    { type: "picks", picks: [] },
    { type: "question", text: "Для кого?" },
    { type: "error", error: "timeout" },
    { type: "done" },
  ])("accepts $type", (event) => {
    expect(isPerfumerEvent(event)).toBe(true);
  });

  it.each([
    null,
    "done",
    [],
    { type: "unknown" },
    { type: "step", step: { tool: "search", families: "водяні", found: 1 } },
    { type: "step", step: { tool: "search", gender: "kids", families: [], found: 1 } },
    { type: "step", step: { tool: "similar", title: 5, found: 1 } },
    { type: "step", step: { tool: "similar" } },
    { type: "intro", text: 1 },
    { type: "picks", picks: [{ reason: "x" }] },
    { type: "picks", picks: [{ ...card, product: { id: "a1" } }] },
    { type: "error", error: "boom" },
  ])("rejects %j", (event) => {
    expect(isPerfumerEvent(event)).toBe(false);
  });
});
