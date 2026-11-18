import { describe, expect, it, vi } from "vitest";
import type { PerfumerEvent } from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import type { PerfumerProductRow } from "../db/queries/perfumer";
import type { ChatFn, ChatRequest, ChatResult, ChatStreamFn, TokenUsage } from "./client";
import type { PerfumerConfig } from "./config";
import { AiError, PerfumerDisabledError } from "./errors";
import {
  MAX_TOOL_ROUNDS,
  type PerfumerTrace,
  reply,
  replyStream,
  replyWithTrace,
} from "./perfumer";

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
      final({ intro: "Я допомагаю лише з парфумами.", picks: [], question: null }),
    );

    const result = await reply("uk", [{ role: "user", content: "Яка погода завтра?" }], deps(chat));

    expect(result).toEqual({ intro: "Я допомагаю лише з парфумами.", picks: [] });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("tells a model that picked without searching to search, once", async () => {
    const { chat, requests } = scripted(
      { content: "Ось троянди.", toolCalls: [] },
      final({ intro: "Ось.", picks: [{ id: "p1", reason: "Вигадка." }] }),
      toolCall("search_perfumes", { notes: ["троянда"] }),
      final({ intro: "Ось троянди.", picks: [{ id: "p1", reason: "Троянда." }] }),
    );

    const { reply: result, trace } = await replyWithTrace("uk", ask, deps(chat));

    expect(trace.searchNudged).toBe(true);
    // Four calls, none of which reported usage (#167).
    expect(trace.tokens).toEqual({ input: 0, output: 0, unreported: 4 });
    expect(requests[2]?.messages.at(-1)?.content).toContain("search_perfumes");
    expect(result.picks.map((p) => p.product.title)).toEqual(["Rose Garden"]);
  });

  it("drops the picks when the model still doesn't search", async () => {
    const { chat } = scripted(
      { content: null, toolCalls: [] },
      final({ intro: "Ось.", picks: [{ id: "p1", reason: "Вигадка." }] }),
      { content: "Ні.", toolCalls: [] },
    );

    const result = await reply("uk", ask, deps(chat));

    expect(result.picks).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(3);
  });

  it("may name back a catalog perfume the customer named", async () => {
    const { chat } = scripted(
      toolCall("similar_to", { title: "Rose Garden" }),
      { content: null, toolCalls: [] },
      final({
        intro: "Схожі на Rose Garden аромати. Але не Aquarius.",
        picks: [{ id: "p1", reason: "Теж свіжий." }],
      }),
    );

    const result = await reply(
      "uk",
      [{ role: "user", content: "Що схоже на rose garden?" }],
      deps(chat),
    );

    expect(result.intro).toBe("Схожі на Rose Garden аромати.");
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

  it("passes the caller's cancel signal to the model call (#163)", async () => {
    const controller = new AbortController();
    const chat = vi.fn<ChatFn>(async (_request, signal) => {
      controller.abort();
      expect(signal.aborted).toBe(true);
      throw new AiError("timeout", "cancelled");
    });
    await expect(
      reply("uk", ask, { ...deps(chat), signal: controller.signal }),
    ).rejects.toMatchObject({ kind: "timeout" });
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

/**
 * A fake streamed intro: yields `pieces`, recording the request and signal it got, then reports
 * `usage` like a server's last chunk, when given.
 */
function streamedWithUsage(usage: TokenUsage | undefined, ...pieces: string[]) {
  const calls: { request: Omit<ChatRequest, "onUsage">; signal: AbortSignal }[] = [];
  const chatStream = vi.fn<ChatStreamFn>(async function* (request, signal) {
    const { onUsage, ...rest } = request;
    calls.push({ request: structuredClone(rest), signal });
    for (const piece of pieces) {
      yield piece;
    }
    if (usage) onUsage?.(usage);
  });
  return { chatStream, calls };
}

function streamed(...pieces: string[]) {
  return streamedWithUsage(undefined, ...pieces);
}

async function events(iterable: AsyncIterable<PerfumerEvent>): Promise<PerfumerEvent[]> {
  const all: PerfumerEvent[] = [];
  for await (const event of iterable) {
    all.push(event);
  }
  return all;
}

const picksAnswer = (picks: { id: string; reason: string }[], question: string | null = null) =>
  final({ picks, question });

describe("perfumer.replyStream (#164)", () => {
  it("yields steps, then the intro, then the picks, the question and done", async () => {
    const { chat, requests } = scripted(
      toolCall("search_perfumes", { families: ["aquatic"], max_price_uah: 1000 }),
      toolCall("similar_to", { title: "rose garden" }, "c2"),
      { content: null, toolCalls: [] },
      picksAnswer([{ id: "p1", reason: "Легкий бриз." }], "Для дня чи вечора?"),
    );
    const { chatStream, calls } = streamed("Ось свіжі ", "морські аромати. Вони", " легкі.");

    const all = await events(replyStream("uk", ask, { ...deps(chat), chatStream }));

    expect(all.map((event) => event.type)).toEqual([
      "step",
      "step",
      "intro",
      "intro",
      "picks",
      "question",
      "done",
    ]);
    expect(all[0]).toEqual({
      type: "step",
      step: { tool: "search", families: ["водяні"], maxPriceUah: 1000, found: 2 },
    });
    expect(all[1]).toMatchObject({ type: "step", step: { tool: "similar", title: "Rose Garden" } });
    expect(all.filter((e) => e.type === "intro").map((e) => e.type === "intro" && e.text)).toEqual([
      "Ось свіжі морські аромати.",
      " Вони легкі.",
    ]);
    const picks = all.find((e) => e.type === "picks");
    expect(picks?.type === "picks" && picks.picks.map((p) => [p.product.title, p.reason])).toEqual([
      ["Ocean One", "Легкий бриз."],
    ]);
    expect(all).toContainEqual({ type: "question", text: "Для дня чи вечора?" });

    // The picks were asked for without the intro; the intro call knows them and has no tools.
    expect(requests.at(-1)?.responseFormat?.name).toBe("perfumer_picks");
    const introRequest = calls[0]?.request;
    expect(introRequest?.tools).toBeUndefined();
    expect(introRequest?.responseFormat).toBeUndefined();
    expect(introRequest?.messages.at(-1)?.content).toContain("p1");
  });

  it("removes a sentence naming a perfume outside the picks, keeping the others", async () => {
    const { chat } = scripted(
      toolCall("search_perfumes", { notes: ["морські ноти"] }),
      { content: null, toolCalls: [] },
      picksAnswer([{ id: "p1", reason: "Бриз." }]),
    );
    const { chatStream } = streamed(
      "Ось морські аромати. ",
      "Схоже на Aquarius. ",
      "Ocean One найсвіжіший.",
    );

    const all = await events(replyStream("uk", ask, { ...deps(chat), chatStream }));
    const intro = all.flatMap((e) => (e.type === "intro" ? [e.text] : [])).join("");

    expect(intro).toBe("Ось морські аромати. Ocean One найсвіжіший.");
  });

  it("falls back to the translated intro when every sentence is removed", async () => {
    const { chat } = scripted(
      toolCall("search_perfumes", { notes: ["морські ноти"] }),
      { content: null, toolCalls: [] },
      picksAnswer([{ id: "p1", reason: "Бриз." }]),
    );
    const { chatStream } = streamed("Спробуйте Aquarius за 500 грн.");

    const all = await events(replyStream("uk", ask, { ...deps(chat), chatStream }));

    expect(all.filter((e) => e.type === "intro")).toEqual([
      { type: "intro", text: "Ось що є в нашому каталозі." },
    ]);
  });

  it("has no steps and no picks when no tool ran", async () => {
    const { chat } = scripted(
      { content: "Я допомагаю лише з парфумами.", toolCalls: [] },
      picksAnswer([]),
    );
    const { chatStream, calls } = streamed("Я допомагаю з вибором парфумів.");

    const all = await events(replyStream("en", ask, { ...deps(chat), chatStream }));

    expect(all).toEqual([
      { type: "intro", text: "Я допомагаю з вибором парфумів." },
      { type: "picks", picks: [] },
      { type: "done" },
    ]);
    expect(calls[0]?.request.messages.at(-1)?.content).toContain("You chose no perfumes");
  });

  it("stops the model call when the caller stops reading", async () => {
    const { chat } = scripted(
      toolCall("search_perfumes", { notes: ["морські ноти"] }),
      { content: null, toolCalls: [] },
      picksAnswer([{ id: "p1", reason: "Бриз." }]),
    );
    const { chatStream, calls } = streamed("Перше речення. ", "Друге речення. ", "Третє.");

    for await (const event of replyStream("uk", ask, { ...deps(chat), chatStream })) {
      if (event.type === "intro") break;
    }

    expect(calls[0]?.signal.aborted).toBe(true);
  });

  it("stops the model call when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const seen: AbortSignal[] = [];
    const chat = vi.fn<ChatFn>(async (_request, signal) => {
      seen.push(signal);
      controller.abort();
      throw new AiError("timeout", "cancelled");
    });

    await expect(
      events(replyStream("uk", ask, { ...deps(chat), signal: controller.signal })),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(seen[0]?.aborted).toBe(true);
  });

  it("passes errors of the streamed intro through", async () => {
    const { chat } = scripted(
      toolCall("search_perfumes", { notes: ["морські ноти"] }),
      { content: null, toolCalls: [] },
      picksAnswer([{ id: "p1", reason: "Бриз." }]),
    );
    const chatStream = vi.fn<ChatStreamFn>(async function* () {
      yield "Перше речення. ";
      throw new AiError("unavailable", "broke off");
    });

    const seen: PerfumerEvent[] = [];
    await expect(
      (async () => {
        for await (const event of replyStream("uk", ask, { ...deps(chat), chatStream })) {
          seen.push(event);
        }
      })(),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(seen.map((e) => e.type)).toEqual(["step", "intro"]);
  });

  it("hands the trace to onTrace once, before done, outside the events (#172)", async () => {
    const { chat } = scripted(
      toolCall("search_perfumes", { notes: ["морські ноти"] }),
      { content: null, toolCalls: [] },
      picksAnswer([
        { id: "p1", reason: "Бриз." },
        { id: "p9", reason: "Вигадка." },
      ]),
    );
    const { chatStream } = streamed("Ось морські аромати. ", "Схоже на Aquarius.");
    const order: string[] = [];
    const onTrace = vi.fn((_trace: PerfumerTrace) => {
      order.push("trace");
    });

    const all: PerfumerEvent[] = [];
    for await (const event of replyStream("uk", ask, { ...deps(chat), chatStream, onTrace })) {
      order.push(event.type);
      all.push(event);
    }

    expect(onTrace).toHaveBeenCalledTimes(1);
    expect(order.slice(-2)).toEqual(["trace", "done"]);
    const trace = onTrace.mock.calls[0]?.[0];
    expect(trace?.toolCalls.map((call) => call.name)).toEqual(["search_perfumes"]);
    expect(trace?.modelPickIds).toEqual(["p1", "p9"]);
    expect(trace?.droppedPickIds).toEqual(["p9"]);
    expect(trace?.removedSentences).toEqual(["Схоже на Aquarius."]);
    expect(all.some((event) => "trace" in event)).toBe(false);
  });

  it("sums the tokens of every call in the trace, counting calls without usage (#167)", async () => {
    const { chat } = scripted(
      {
        ...toolCall("search_perfumes", { notes: ["морські ноти"] }),
        usage: { input: 900, output: 30 },
      },
      { content: null, toolCalls: [], usage: { input: 1500, output: 5 } },
      // This server forgot the usage on one call.
      picksAnswer([{ id: "p1", reason: "Бриз." }]),
    );
    const { chatStream } = streamedWithUsage({ input: 1600, output: 60 }, "Ось морські аромати.");
    const onTrace = vi.fn((_trace: PerfumerTrace) => {});

    await events(replyStream("uk", ask, { ...deps(chat), chatStream, onTrace }));

    expect(onTrace.mock.calls[0]?.[0].tokens).toEqual({ input: 4000, output: 95, unreported: 1 });
  });

  it("counts a streamed intro that reports no usage as unreported (#167)", async () => {
    const { chat } = scripted(
      {
        ...toolCall("search_perfumes", { notes: ["морські ноти"] }),
        usage: { input: 10, output: 1 },
      },
      { content: null, toolCalls: [], usage: { input: 10, output: 1 } },
      { ...picksAnswer([{ id: "p1", reason: "Бриз." }]), usage: { input: 10, output: 1 } },
    );
    const { chatStream } = streamed("Ось морські аромати.");
    const onTrace = vi.fn((_trace: PerfumerTrace) => {});

    await events(replyStream("uk", ask, { ...deps(chat), chatStream, onTrace }));

    expect(onTrace.mock.calls[0]?.[0].tokens).toEqual({ input: 30, output: 3, unreported: 1 });
  });

  it("doesn't call onTrace when the reply fails", async () => {
    const { chat } = scripted(
      toolCall("search_perfumes", { notes: ["морські ноти"] }),
      { content: null, toolCalls: [] },
      { content: "not json", toolCalls: [] },
      { content: "still not json", toolCalls: [] },
    );
    const onTrace = vi.fn();

    await expect(events(replyStream("uk", ask, { ...deps(chat), onTrace }))).rejects.toMatchObject({
      kind: "bad_response",
    });
    expect(onTrace).not.toHaveBeenCalled();
  });

  it("is disabled without AI_BASE_URL and never calls a model", async () => {
    const { chat } = scripted();
    await expect(events(replyStream("uk", ask, { ...deps(chat), config: null }))).rejects.toThrow(
      PerfumerDisabledError,
    );
    expect(chat).not.toHaveBeenCalled();
  });
});
