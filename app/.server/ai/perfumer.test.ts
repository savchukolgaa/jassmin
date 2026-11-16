import { describe, expect, it, vi } from "vitest";
import type { ProductSummary } from "~/lib/products";
import type { PerfumerProductRow } from "../db/queries/perfumer";
import type { ChatFn, ChatRequest, ChatResult } from "./client";
import type { PerfumerConfig } from "./config";
import { AiError, PerfumerDisabledError } from "./errors";
import { MAX_TOOL_ROUNDS, reply, replyWithTrace } from "./perfumer";

const config: PerfumerConfig = {
  baseUrl: "http://localhost:11434/v1",
  model: "granite4.1:3b",
  apiKey: undefined,
  timeoutMs: 5000,
  keepAlive: undefined,
};

function row(n: number, title: string, overrides: Partial<PerfumerProductRow> = {}) {
  return {
    publicId: `00000000-0000-7000-8000-00000000000${n}`,
    title,
    brand: `Brand ${title}`,
    gender: "women",
    fragranceFamilies: ["водяні"],
    notes: ["морські ноти"],
    popularRank: n,
    active: true,
    sizes: [{ ml: 30, price: "900.00" }],
    ...overrides,
  } satisfies PerfumerProductRow;
}

const catalog: PerfumerProductRow[] = [
  row(1, "Ocean One"),
  row(2, "Ocean Two"),
  row(3, "Rose Garden", { fragranceFamilies: ["квіткові"], notes: ["троянда"] }),
];

function summary(product: PerfumerProductRow, inStock = true): ProductSummary {
  return {
    id: product.publicId,
    slug: null,
    title: product.title,
    brand: product.brand,
    gender: product.gender,
    packSize: 1,
    image: null,
    variants: [{ id: `v-${product.publicId}`, volumeMl: 30, price: "900.00", inStock }],
    minPrice: "900.00",
    hasPriceRange: false,
    volumes: [30],
    inStock,
    defaultVariant: { id: `v-${product.publicId}`, volumeMl: 30 },
    fragranceFamily: product.fragranceFamilies[0] ?? null,
  };
}

const toolCall = (name: string, args: unknown, id = "c1"): ChatResult => ({
  content: null,
  toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
});

const final = (answer: unknown): ChatResult => ({
  content: JSON.stringify(answer),
  toolCalls: [],
});

/** A fake model answering with `script`, one result per call. */
function scripted(...script: ChatResult[]) {
  const requests: ChatRequest[] = [];
  const chat = vi.fn<ChatFn>(async (request) => {
    requests.push(structuredClone(request));
    const next = script.shift();
    if (!next) throw new Error("The script ran out");
    return next;
  });
  return { chat, requests };
}

function deps(chat: ChatFn, outOfStock: string[] = []) {
  return {
    config,
    chat,
    loadCatalog: async () => catalog,
    loadSummaries: async (ids: readonly string[]) =>
      new Map(
        catalog
          .filter((p) => ids.includes(p.publicId))
          .map((p) => [p.publicId, summary(p, !outOfStock.includes(p.title))]),
      ),
  };
}

const ask = [{ role: "user" as const, content: "Хочу щось морське" }];

describe("perfumer.reply", () => {
  it("searches the catalog and returns picks loaded from the database", async () => {
    const { chat, requests } = scripted(
      toolCall("search_perfumes", { notes: ["морські ноти"] }),
      { content: null, toolCalls: [] },
      final({
        intro: "Ось свіжі морські аромати.",
        picks: [
          { id: "p1", reason: "Легкий морський бриз." },
          { id: "p2", reason: "Свіжість і цитруси." },
        ],
        question: "Для дня чи вечора?",
      }),
    );

    const result = await reply("uk", ask, deps(chat));

    expect(result.intro).toBe("Ось свіжі морські аромати.");
    expect(result.picks.map((p) => [p.product.title, p.reason])).toEqual([
      ["Ocean One", "Легкий морський бриз."],
      ["Ocean Two", "Свіжість і цитруси."],
    ]);
    expect(result.question).toBe("Для дня чи вечора?");
    // The tool result went back to the model with aliases, never public ids.
    const toolMessage = requests[1]?.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain('"id":"p1"');
    expect(toolMessage?.content).not.toContain(catalog[0]?.publicId);
    // The final call asks for JSON and offers no tools.
    expect(requests.at(-1)?.responseFormat?.name).toBe("perfumer_answer");
    expect(requests.at(-1)?.tools).toBeUndefined();
    // The Ukrainian system prompt.
    expect(requests[0]?.messages[0]?.content).toContain("JASSMIN");
    expect(requests[0]?.messages[0]?.content).toContain("українською");
  });

  it("uses the English prompt for en", async () => {
    const { chat, requests } = scripted(
      { content: "Hi", toolCalls: [] },
      final({ intro: "Hello." }),
    );
    await reply("en", [{ role: "user", content: "hi" }], deps(chat));
    expect(requests[0]?.messages[0]?.content).toContain("Answer in English");
  });

  it("stops calling tools after 3 rounds and then asks for the final answer", async () => {
    const { chat, requests } = scripted(
      toolCall("search_perfumes", { families: ["водяні"] }, "a"),
      toolCall("search_perfumes", { families: ["квіткові"] }, "b"),
      toolCall("search_perfumes", { notes: ["троянда"] }, "c"),
      final({ intro: "Ось.", picks: [{ id: "p1", reason: "Морський." }] }),
    );

    const { reply: result, trace } = await replyWithTrace("uk", ask, deps(chat));

    expect(chat).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
    expect(trace.rounds).toBe(3);
    expect(trace.toolCalls).toHaveLength(3);
    expect(requests.at(-1)?.tools).toBeUndefined();
    expect(result.picks).toHaveLength(1);
  });

  it("drops invented ids, duplicates and products no longer in stock", async () => {
    const { chat } = scripted(
      toolCall("search_perfumes", { families: ["водяні"] }),
      { content: null, toolCalls: [] },
      final({
        intro: "Ось.",
        picks: [
          { id: "p7", reason: "Вигаданий." },
          { id: "p1", reason: "Перший." },
          { id: "p1", reason: "Знову." },
          { id: "p2", reason: "Немає в наявності." },
          { id: catalog[2]?.publicId, reason: "Не з інструментів." },
        ],
      }),
    );

    const { reply: result, trace } = await replyWithTrace("uk", ask, deps(chat, ["Ocean Two"]));

    expect(result.picks.map((p) => p.product.title)).toEqual(["Ocean One"]);
    expect(trace.droppedPickIds).toEqual(["p7", "p2", catalog[2]?.publicId]);
  });

  it("removes invented and unpicked names from the text, with fallbacks for emptied fields", async () => {
    const { chat } = scripted(
      toolCall("search_perfumes", { families: ["водяні"] }),
      { content: null, toolCalls: [] },
      final({
        intro: "Aquarius — чудовий вибір. Також є Rose Garden.",
        picks: [{ id: "p1", reason: "Схожий на Blue Marlin." }],
        question: "Вам подобається Ocean Two?",
      }),
    );

    const { reply: result, trace } = await replyWithTrace("uk", ask, deps(chat));

    expect(result.intro).toBe("Ось що є в нашому каталозі.");
    expect(result.picks[0]?.reason).toBe("Родини: Водяні.");
    expect(result.question).toBeUndefined();
    expect(trace.removedSentences).toHaveLength(4);
  });

  it("returns no picks when no tool ran (off-topic, injection)", async () => {
    const { chat } = scripted(
      { content: "Не можу допомогти з погодою.", toolCalls: [] },
      final({
        intro: "Я допомагаю лише з парфумами.",
        picks: [{ id: "p1", reason: "Вигадка." }],
      }),
    );

    const result = await reply("uk", [{ role: "user", content: "Яка погода завтра?" }], deps(chat));

    expect(result).toEqual({ intro: "Я допомагаю лише з парфумами.", picks: [] });
  });

  it("reports invalid tool arguments back to the model", async () => {
    const { chat, requests } = scripted(
      toolCall("search_perfumes", { limit: 99 }),
      { content: null, toolCalls: [] },
      final({ intro: "Уточніть, будь ласка.", picks: [] }),
    );

    const { trace } = await replyWithTrace("uk", ask, deps(chat));

    expect(trace.toolCalls[0]?.ok).toBe(false);
    expect(requests[1]?.messages.find((m) => m.role === "tool")?.content).toContain("error");
  });

  it("retries a final answer that isn't JSON once, then fails with bad_response", async () => {
    const retried = scripted(
      { content: null, toolCalls: [] },
      { content: "not json", toolCalls: [] },
      { content: '```json\n{"intro":"Ок.","picks":[],"question":null}\n```', toolCalls: [] },
    );
    expect((await reply("uk", ask, deps(retried.chat))).intro).toBe("Ок.");

    const broken = scripted(
      { content: null, toolCalls: [] },
      { content: "not json", toolCalls: [] },
      { content: "{}}", toolCalls: [] },
    );
    const error = await reply("uk", ask, deps(broken.chat)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("bad_response");
  });

  it("is disabled without AI_BASE_URL and never calls a model", async () => {
    const { chat } = scripted();
    const loadCatalog = vi.fn(async () => catalog);
    await expect(reply("uk", ask, { config: null, chat, loadCatalog })).rejects.toBeInstanceOf(
      PerfumerDisabledError,
    );
    expect(chat).not.toHaveBeenCalled();
    expect(loadCatalog).not.toHaveBeenCalled();
  });

  it("passes model errors through", async () => {
    const chat = vi.fn<ChatFn>(async () => {
      throw new AiError("unavailable", "down");
    });
    await expect(reply("uk", ask, deps(chat))).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("rejects an empty conversation or one that doesn't end with the customer", async () => {
    const { chat } = scripted();
    await expect(reply("uk", [], deps(chat))).rejects.toThrow();
    await expect(
      reply("uk", [{ role: "assistant", content: "Привіт" }], deps(chat)),
    ).rejects.toThrow();
    expect(chat).not.toHaveBeenCalled();
  });
});
