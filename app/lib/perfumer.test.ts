import { describe, expect, it } from "vitest";
import {
  isPerfumerEvent,
  isRetryable,
  PERFUMER_MAX_INPUT_LENGTH,
  type PerfumerReply,
  replyToHistoryText,
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
