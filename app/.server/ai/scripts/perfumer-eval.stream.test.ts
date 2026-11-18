import { describe, expect, it } from "vitest";
import type { PerfumerEvent, PerfumerPick } from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import type { PerfumerProductRow } from "../../db/queries/perfumer";
import type { ChatFn, ChatResult, ChatStreamFn } from "../client";
import type { PerfumerConfig } from "../config";
import { type PerfumerTrace, replyStream } from "../perfumer";
import type { EvalCase } from "./perfumer-eval.cases";
import {
  collectStreamedReply,
  cyrillicShare,
  describeTokens,
  formatAnswerText,
  isLocalServer,
  meetsExpectation,
  parsePrices,
  percentile,
  summarizeTokens,
} from "./perfumer-eval.stream";

const ocean: PerfumerProductRow = {
  publicId: "00000000-0000-7000-8000-000000000001",
  title: "Ocean One",
  brand: "Brand Ocean",
  gender: "women",
  fragranceFamilies: ["водяні"],
  notes: ["морські ноти"],
  popularRank: 1,
  active: true,
  sizes: [{ ml: 30, price: "450.00" }],
};

function summary(product: PerfumerProductRow): ProductSummary {
  const price = product.sizes[0]?.price ?? "0.00";
  return {
    id: product.publicId,
    slug: null,
    title: product.title,
    brand: product.brand,
    gender: product.gender,
    packSize: 1,
    image: null,
    variants: [{ id: `v-${product.publicId}`, volumeMl: 30, price, inStock: true }],
    minPrice: price,
    hasPriceRange: false,
    volumes: [30],
    inStock: true,
    defaultVariant: { id: `v-${product.publicId}`, volumeMl: 30 },
    fragranceFamily: product.fragranceFamilies[0] ?? null,
  };
}

const pick: PerfumerPick = { product: summary(ocean), reason: "Бриз." };

async function* from(events: PerfumerEvent[]): AsyncGenerator<PerfumerEvent> {
  yield* events;
}

/** A clock that moves one second per reading, starting at 1000 ms after `startedAt` = 0. */
function ticking() {
  let ms = 0;
  return () => {
    ms += 1000;
    return ms;
  };
}

describe("collectStreamedReply (#172)", () => {
  it("times the first step, the first intro and done, and rebuilds the reply", async () => {
    const { reply, timings } = await collectStreamedReply(
      from([
        { type: "step", step: { tool: "search", families: ["водяні"], found: 3 } },
        { type: "step", step: { tool: "similar", title: "Ocean One", found: 2 } },
        { type: "intro", text: "Ось морські аромати." },
        { type: "intro", text: " Вони легкі." },
        { type: "picks", picks: [pick] },
        { type: "question", text: "Для дня чи вечора?" },
        { type: "done" },
      ]),
      0,
      ticking(),
    );

    expect(timings).toEqual({ firstStepMs: 1000, firstIntroMs: 3000, totalMs: 7000 });
    expect(reply).toEqual({
      intro: "Ось морські аромати. Вони легкі.",
      picks: [pick],
      question: "Для дня чи вечора?",
    });
  });

  it("has no first step when no tool ran, and counts from startedAt", async () => {
    const { reply, timings } = await collectStreamedReply(
      from([
        { type: "intro", text: "Я допомагаю лише з парфумами." },
        { type: "picks", picks: [] },
        { type: "done" },
      ]),
      500,
      ticking(),
    );

    expect(timings).toEqual({ firstIntroMs: 500, totalMs: 2500 });
    expect(reply).toEqual({ intro: "Я допомагаю лише з парфумами.", picks: [] });
  });

  it("throws on an error event or a stream that ends before done", async () => {
    await expect(
      collectStreamedReply(from([{ type: "error", error: "unavailable" }]), 0, ticking()),
    ).rejects.toThrow("unavailable");
    await expect(
      collectStreamedReply(from([{ type: "intro", text: "Ось." }]), 0, ticking()),
    ).rejects.toThrow("before done");
  });

  it("collects replyStream's events with a fake model: guarded intro, trace via onTrace", async () => {
    const config: PerfumerConfig = {
      baseUrl: "http://localhost:11434/v1",
      model: "granite4.1:3b",
      apiKey: undefined,
      timeoutMs: 5000,
      keepAlive: undefined,
    };
    const script: ChatResult[] = [
      {
        content: null,
        toolCalls: [{ id: "c1", name: "search_perfumes", arguments: '{"notes":["морські ноти"]}' }],
      },
      { content: null, toolCalls: [] },
      {
        content: JSON.stringify({ picks: [{ id: "p1", reason: "Бриз." }], question: null }),
        toolCalls: [],
      },
    ];
    const chat: ChatFn = async () => {
      const next = script.shift();
      if (!next) throw new Error("The script ran out");
      return next;
    };
    const chatStream: ChatStreamFn = async function* () {
      yield "Ось морські аромати. ";
      yield "Схоже на Aquarius. ";
      yield "Ocean One найсвіжіший.";
    };
    let trace: PerfumerTrace | undefined;

    const { reply, timings } = await collectStreamedReply(
      replyStream("uk", [{ role: "user", content: "Хочу щось морське" }], {
        config,
        chat,
        chatStream,
        loadCatalog: async () => [ocean],
        loadSummaries: async (ids) =>
          new Map(ids.includes(ocean.publicId) ? [[ocean.publicId, summary(ocean)]] : []),
        onTrace: (t) => {
          trace = t;
        },
      }),
      0,
      ticking(),
    );

    expect(reply.intro).toBe("Ось морські аромати. Ocean One найсвіжіший.");
    expect(reply.picks.map((p) => p.product.title)).toEqual(["Ocean One"]);
    expect(timings.firstStepMs).toBe(1000);
    expect(timings.firstIntroMs).toBe(2000);
    expect(trace?.removedSentences).toEqual(["Схоже на Aquarius."]);
    expect(trace?.droppedPickIds).toEqual([]);
  });
});

describe("percentile", () => {
  it("is undefined without values and the value itself for one", () => {
    expect(percentile([], 50)).toBeUndefined();
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 95)).toBe(7);
  });

  it("takes the nearest rank: with 15 values p95 is the slowest", () => {
    const values = [15, 3, 9, 1, 12, 5, 7, 2, 14, 4, 11, 6, 13, 8, 10];
    expect(percentile(values, 50)).toBe(8);
    expect(percentile(values, 95)).toBe(15);
  });
});

describe("eval checks", () => {
  const test: EvalCase = {
    id: "uk-aquatic",
    locale: "uk",
    messages: [],
    picks: "some",
    families: ["водяні"],
    maxPrice: 500,
  };

  it("meetsExpectation checks the count, the families and the budget", () => {
    expect(meetsExpectation(test, [pick], [ocean])).toBe(true);
    expect(meetsExpectation(test, [], [ocean])).toBe(false);
    expect(meetsExpectation({ ...test, maxPrice: 400 }, [pick], [ocean])).toBe(false);
    expect(meetsExpectation({ ...test, families: ["квіткові"] }, [pick], [ocean])).toBe(false);
    expect(meetsExpectation({ ...test, picks: "none" }, [pick], [ocean])).toBe(false);
  });

  it("cyrillicShare is the share of Cyrillic letters", () => {
    expect(cyrillicShare("Ось Ocean")).toBeCloseTo(3 / 8);
    expect(cyrillicShare("123")).toBe(0);
  });
});

describe("eval cost and texts (#167)", () => {
  it("parsePrices reads both prices, or none", () => {
    expect(parsePrices(["qwen", "--price-in", "0.15", "--price-out", "0.6"])).toEqual({
      input: 0.15,
      output: 0.6,
    });
    expect(parsePrices(["qwen", "--stream"])).toBeUndefined();
    expect(() => parsePrices(["--price-in", "0.15"])).toThrow(/both/);
    expect(() => parsePrices(["--price-in", "cheap", "--price-out", "1"])).toThrow(/--price-in/);
    expect(() => parsePrices(["--price-in", "-1", "--price-out", "1"])).toThrow(/--price-in/);
    expect(() => parsePrices(["--price-out"])).toThrow(/--price-out/);
  });

  it("summarizeTokens averages the answers and prices 1000 of them", () => {
    const summary = summarizeTokens(
      [
        { input: 4000, output: 100, unreported: 0 },
        { input: 2000, output: 300, unreported: 1 },
      ],
      { input: 0.5, output: 2 },
    );
    // 3000 in × $0.5/M + 200 out × $2/M = $0.0019 per answer, $1.90 per 1000.
    expect(summary).toEqual({
      answers: 2,
      meanInput: 3000,
      meanOutput: 200,
      unreported: 1,
      costPer1000: expect.closeTo(1.9, 10),
    });
    expect(summarizeTokens([{ input: 1, output: 1, unreported: 0 }])).not.toHaveProperty(
      "costPer1000",
    );
    expect(summarizeTokens([])).toBeUndefined();
  });

  it("describeTokens says what's known, and when it's a lower bound", () => {
    expect(
      describeTokens({
        answers: 15,
        meanInput: 4210.4,
        meanOutput: 180,
        unreported: 0,
        costPer1000: 0.712,
      }),
    ).toBe("tokens per answer 4,210 in / 180 out; ≈ $0.71 per 1000 answers");
    expect(describeTokens({ answers: 15, meanInput: 900, meanOutput: 50, unreported: 2 })).toBe(
      "tokens per answer 900 in / 50 out (at least: 2 calls reported no usage)",
    );
    expect(describeTokens({ answers: 3, meanInput: 0, meanOutput: 0, unreported: 9 })).toBe(
      "tokens unknown (the server reported no usage)",
    );
    expect(describeTokens(undefined)).toBe("tokens unknown (no answer finished)");
  });

  it("formatAnswerText quotes the intro, each reason and the question", () => {
    expect(
      formatAnswerText("qwen3:4b", "uk-aquatic", {
        intro: "Ось морські\nаромати.",
        picks: [pick],
        question: "Для дня?",
      }),
    ).toBe(
      [
        "#### qwen3:4b · uk-aquatic",
        "",
        "> Ось морські аромати.",
        ">",
        "> **Ocean One**: Бриз.",
        ">",
        "> *Для дня?*",
      ].join("\n"),
    );
  });

  it("isLocalServer is true only for this machine", () => {
    expect(isLocalServer("http://localhost:11434/v1")).toBe(true);
    expect(isLocalServer("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalServer("https://openrouter.ai/api/v1")).toBe(false);
    expect(isLocalServer("not a url")).toBe(false);
  });
});
