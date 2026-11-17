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
  meetsExpectation,
  percentile,
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
