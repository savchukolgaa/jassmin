import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEventProperties } from "~/lib/analytics.schema";
import type { PerfumerEvent, PerfumerReply } from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import { AiError } from "../ai/errors";
import type { PerfumerResult, PerfumerTrace } from "../ai/perfumer";
import { createMemoryRateLimitStore, createRateLimiter } from "../rate-limit";
import {
  answerPerfumerMessage,
  openPerfumerStream,
  type PerfumerChatDeps,
  type PerfumerChatStore,
  type PerfumerStreamDeps,
  perfumerMessageProperties,
  toolCallSummary,
} from "./perfumer-chat";
import type { PerfumerTurnEnd } from "./perfumer-threads";

const REPLY_ID = "6f9b3c2a-1d4e-4b8a-9c7d-2e5f8a1b3c4d";
const PRODUCT = "01a1652b-6e25-7c03-ae47-25b57131fb06";

const CUSTOMER = "Щось свіже, як після душу, до 600 грн";
const INTRO = "Ось що є: легкі цитрусові аромати.";
const REASON = "Бергамот і лимон звучать яскраво.";
const QUESTION = "Вам ближчі тихі аромати?";

const product = { id: PRODUCT, title: "Ocean Two", brand: "Jassmin" } as ProductSummary;
const answer: PerfumerReply = { intro: "Ось що є.", picks: [] };
const rich: PerfumerReply = {
  intro: INTRO,
  picks: [{ product, reason: REASON }],
  question: QUESTION,
};
const trace: PerfumerTrace = {
  toolCalls: [
    {
      name: "search_perfumes",
      arguments: { families: ["свіжі"], max_price_uah: 600, notes: [CUSTOMER] },
      ok: true,
      resultIds: ["p1"],
    },
  ],
  rounds: 1,
  modelPickIds: ["p1"],
  droppedPickIds: [],
  removedSentences: [],
  searchNudged: false,
  tokens: { input: 120, output: 40, unreported: 0 },
};
const result = (reply: PerfumerReply, toolCalls = trace.toolCalls): PerfumerResult => ({
  reply,
  trace: { ...trace, toolCalls },
});
const messages = [{ role: "user" as const, content: CUSTOMER }];

let now = 0;
let clock = 0;
/** The turn the fake store gives the next message. */
let turn = 3;
/** What the fake store saved: [threadId, end]. */
let saved: [number, PerfumerTurnEnd][] = [];
let store: PerfumerChatStore & {
  begin: ReturnType<typeof vi.fn<PerfumerChatStore["begin"]>>;
  nextTurn: ReturnType<typeof vi.fn<PerfumerChatStore["nextTurn"]>>;
};

const owner = (anonymousId: string) => ({ userId: null, anonymousId });
let deps: PerfumerChatDeps & { reply: ReturnType<typeof vi.fn<PerfumerChatDeps["reply"]>> };

function limiter(name: string) {
  return createRateLimiter({
    name,
    limit: 10,
    windowMs: 5 * 60_000,
    store: createMemoryRateLimitStore(),
    now: () => now,
  });
}

beforeEach(() => {
  now = Date.parse("2026-11-16T12:00:00Z");
  clock = 1000;
  turn = 3;
  saved = [];
  store = {
    nextTurn: vi.fn<PerfumerChatStore["nextTurn"]>(async () => turn),
    begin: vi.fn<PerfumerChatStore["begin"]>(async ({ entry }) => ({
      threadId: 7,
      turn,
      entry,
      history: messages,
    })),
    end: async (threadId, end) => {
      saved.push([threadId, end]);
    },
  };
  deps = {
    store,
    reply: vi.fn<PerfumerChatDeps["reply"]>(async () => {
      clock += 8400;
      return result(answer, []);
    }),
    limiters: { byIp: limiter("ip"), bySession: limiter("session") },
    model: () => "granite4.1:3b",
    now: () => clock,
    newReplyId: () => REPLY_ID,
  };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const ask = (ipKey: string | undefined, sessionKey: string, signal?: AbortSignal) =>
  answerPerfumerMessage(
    { locale: "uk", owner: owner(sessionKey), message: CUSTOMER, entry: "catalog", ipKey, signal },
    deps,
  );

const resultOf = async (...args: Parameters<typeof ask>) => (await ask(...args)).result;

describe("answerPerfumerMessage", () => {
  it("returns the engine's reply in the page's language, with its reply id", async () => {
    await expect(resultOf("1.1.1.1", "visitor")).resolves.toEqual({
      ok: true,
      reply: answer,
      replyId: REPLY_ID,
    });
    expect(deps.reply).toHaveBeenCalledWith("uk", messages, {});
  });

  it("passes the request's signal to the engine", async () => {
    const signal = new AbortController().signal;
    await ask("1.1.1.1", "visitor", signal);
    expect(deps.reply).toHaveBeenCalledWith("uk", messages, { signal });
  });

  it("allows 10 messages per IP in 5 minutes, then refuses without calling the model", async () => {
    for (let n = 0; n < 10; n++) {
      expect((await resultOf("1.1.1.1", `visitor-${n}`)).ok).toBe(true);
    }
    await expect(resultOf("1.1.1.1", "another")).resolves.toEqual({
      ok: false,
      error: "rateLimited",
    });
    expect(deps.reply).toHaveBeenCalledTimes(10);
    // Another IP is unaffected.
    expect((await resultOf("2.2.2.2", "another")).ok).toBe(true);
  });

  it("allows 10 messages per visitor, whatever their IP", async () => {
    for (let n = 0; n < 10; n++) {
      await ask(`10.0.0.${n}`, "visitor");
    }
    await expect(resultOf("10.0.0.99", "visitor")).resolves.toEqual({
      ok: false,
      error: "rateLimited",
    });
  });

  it("counts failed answers too, and lets the customer go on after 5 minutes", async () => {
    deps.reply.mockRejectedValue(new AiError("timeout", "slow"));
    for (let n = 0; n < 10; n++) {
      await ask("1.1.1.1", "visitor");
    }
    expect((await resultOf("1.1.1.1", "visitor")).ok).toBe(false);
    expect(deps.reply).toHaveBeenCalledTimes(10);

    now += 5 * 60_000;
    deps.reply.mockResolvedValue(result(answer));
    expect((await resultOf("1.1.1.1", "visitor")).ok).toBe(true);
  });

  it("limits a request without an IP by its visitor", async () => {
    for (let n = 0; n < 10; n++) {
      await ask(undefined, "visitor");
    }
    expect(await resultOf(undefined, "visitor")).toEqual({ ok: false, error: "rateLimited" });
  });

  it.each([
    ["timeout", "timeout"],
    ["unavailable", "unavailable"],
    ["bad_response", "unavailable"],
  ] as const)("maps the engine's %s error to %s", async (kind, error) => {
    deps.reply.mockRejectedValue(new AiError(kind, "failed"));
    await expect(resultOf("1.1.1.1", "visitor")).resolves.toEqual({ ok: false, error });
  });

  it("maps an unexpected error to unavailable and logs it", async () => {
    deps.reply.mockRejectedValue(new Error("database down"));
    await expect(resultOf("1.1.1.1", "visitor")).resolves.toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("the perfumer_message event (#166)", () => {
  it("describes an answer: latency, model, tool and argument names, picks, question", async () => {
    deps.reply.mockImplementation(async () => {
      clock += 12_345;
      return result(rich);
    });
    const { event } = await ask("1.1.1.1", "visitor");
    expect(event).toEqual({
      reply_id: REPLY_ID,
      turn: 3,
      latency_ms: 12_345,
      model: "granite4.1:3b",
      tool_calls: [
        { name: "search_perfumes", argument_keys: ["families", "max_price_uah", "notes"] },
      ],
      pick_ids: [PRODUCT],
      asked_question: true,
      error: null,
      entry: "catalog",
    });
    expect(parseEventProperties("perfumer_message", event)).toEqual(event);
  });

  it("never holds the customer's words or the perfumer's text", async () => {
    deps.reply.mockResolvedValue(result(rich));
    const { event } = await ask("1.1.1.1", "visitor");
    const json = JSON.stringify(event);
    for (const text of [CUSTOMER, "свіжі", INTRO, REASON, QUESTION, "Ocean Two", "Jassmin"]) {
      expect(json).not.toContain(text);
    }
  });

  it("records a failed answer with its finer error and no picks", async () => {
    deps.reply.mockImplementation(async () => {
      clock += 90_000;
      throw new AiError("bad_response", "not JSON");
    });
    const { event } = await ask("1.1.1.1", "visitor");
    expect(event).toMatchObject({
      error: "bad_response",
      latency_ms: 90_000,
      model: "granite4.1:3b",
      tool_calls: [],
      pick_ids: [],
      asked_question: false,
    });
  });

  it("records a cancelled answer as cancelled", async () => {
    const controller = new AbortController();
    deps.reply.mockImplementation(async () => {
      controller.abort();
      throw new AiError("timeout", "aborted");
    });
    const outcome = await ask("1.1.1.1", "visitor", controller.signal);
    expect(outcome.result).toEqual({ ok: false, error: "timeout" });
    expect(outcome.event.error).toBe("cancelled");
  });

  it("records a rate-limited message without a model or a latency", async () => {
    for (let n = 0; n < 10; n++) {
      await ask("1.1.1.1", "visitor");
    }
    const { event } = await ask("1.1.1.1", "visitor");
    expect(event).toMatchObject({ error: "rate_limited", model: null, latency_ms: 0 });
    expect(parseEventProperties("perfumer_message", event)).not.toBeNull();
  });

  it("names unknown tools `other`, keeps only identifier-like argument names, caps the calls", () => {
    expect(
      toolCallSummary({
        name: "drop_table",
        arguments: { "схоже на": 1, Title: 2, title: 3 },
        ok: false,
        resultIds: [],
      }),
    ).toEqual({ name: "other", argument_keys: ["title"] });
    expect(
      toolCallSummary({ name: "similar_to", arguments: "{not json", ok: false, resultIds: [] }),
    ).toEqual({ name: "similar_to", argument_keys: [] });

    const many = Array.from({ length: 16 }, () => trace.toolCalls[0]).filter(
      (call) => call !== undefined,
    );
    const event = perfumerMessageProperties({
      replyId: REPLY_ID,
      turn: 1,
      entry: "direct",
      latencyMs: 1.6,
      model: "m",
      toolCalls: many,
      pickIds: [],
      askedQuestion: false,
      error: null,
    });
    expect(event.tool_calls).toHaveLength(12);
    expect(event.latency_ms).toBe(2);
    expect(parseEventProperties("perfumer_message", event)).not.toBeNull();
  });
});

describe("openPerfumerStream (#164)", () => {
  const reply: PerfumerEvent[] = [
    { type: "step", step: { tool: "search", families: ["водяні"], found: 2 } },
    { type: "intro", text: "Ось що є." },
    { type: "picks", picks: [] },
    { type: "done" },
  ];
  /** What the customer receives: the same events, `done` carrying the reply's id (#166). */
  const received: PerfumerEvent[] = [...reply.slice(0, -1), { type: "done", replyId: REPLY_ID }];

  function streamDeps(
    replyStream: PerfumerStreamDeps["replyStream"] = async function* () {
      yield* reply;
    },
  ) {
    return {
      replyStream: vi.fn<PerfumerStreamDeps["replyStream"]>(replyStream),
      limiters: deps.limiters,
      store: deps.store,
      model: deps.model,
      now: deps.now,
      newReplyId: deps.newReplyId,
    };
  }

  async function collect(iterable: AsyncIterable<PerfumerEvent>): Promise<PerfumerEvent[]> {
    const all: PerfumerEvent[] = [];
    for await (const event of iterable) all.push(event);
    return all;
  }

  async function stream(
    sd: PerfumerStreamDeps,
    ipKey: string | undefined = "1.1.1.1",
    signal?: AbortSignal,
  ): Promise<PerfumerEvent[] | "rateLimited" | "unavailable"> {
    const result = await openPerfumerStream(
      { locale: "en", owner: owner("visitor"), message: CUSTOMER, entry: "menu", ipKey, signal },
      sd,
    );
    return result.ok ? collect(result.events) : result.error;
  }

  it("passes the engine's events through, with the request's signal", async () => {
    const sd = streamDeps();
    const signal = new AbortController().signal;
    await expect(stream(sd, "1.1.1.1", signal)).resolves.toEqual(received);
    expect(sd.replyStream).toHaveBeenCalledWith("en", messages, {
      signal,
      onToolCall: expect.any(Function),
    });
  });

  it("shares the action's rate limit and refuses before streaming, without the model", async () => {
    for (let n = 0; n < 10; n++) {
      await ask("1.1.1.1", "visitor");
    }
    const sd = streamDeps();
    await expect(stream(sd)).resolves.toBe("rateLimited");
    expect(sd.replyStream).not.toHaveBeenCalled();
  });

  it("counts a streamed message against the limits", async () => {
    const sd = streamDeps();
    for (let n = 0; n < 10; n++) {
      await stream(sd, `10.0.0.${n}`);
    }
    await expect(resultOf("10.0.0.99", "visitor")).resolves.toEqual({
      ok: false,
      error: "rateLimited",
    });
  });

  it("ends a failed reply with one error event, after what was already sent", async () => {
    const sd = streamDeps(async function* () {
      yield { type: "step", step: { tool: "similar", found: 0 } };
      throw new AiError("timeout", "too slow");
    });
    await expect(stream(sd)).resolves.toEqual([
      { type: "step", step: { tool: "similar", found: 0 } },
      { type: "error", error: "timeout" },
    ]);

    const broken = streamDeps(async function* () {
      yield* [];
      throw new Error("database down");
    });
    await expect(stream(broken, "2.2.2.2")).resolves.toEqual([
      { type: "error", error: "unavailable" },
    ]);
    expect(console.error).toHaveBeenCalled();
  });

  describe("its perfumer_message event (#166)", () => {
    async function streamed(
      replyStream: PerfumerStreamDeps["replyStream"],
      { signal, stopAfter }: { signal?: AbortSignal; stopAfter?: number } = {},
    ) {
      const events: unknown[] = [];
      turn = 4;
      const result = await openPerfumerStream(
        {
          locale: "uk",
          owner: owner("visitor"),
          message: CUSTOMER,
          entry: "corner",
          ipKey: "3.3.3.3",
          signal,
          onEvent: (event) => events.push(event),
        },
        streamDeps(replyStream),
      );
      if (!result.ok) throw new Error("refused");
      let seen = 0;
      for await (const _event of result.events) {
        if (stopAfter !== undefined && ++seen >= stopAfter) break;
      }
      return events;
    }

    it("is recorded once the stream ends, with the tool calls, picks and question, no text", async () => {
      const events = await streamed(async function* (_locale, _messages, engineDeps) {
        const call = trace.toolCalls[0];
        if (call) engineDeps.onToolCall?.(call);
        clock += 5000;
        yield { type: "intro", text: INTRO };
        yield { type: "picks", picks: [{ product, reason: REASON }] };
        yield { type: "question", text: QUESTION };
        yield { type: "done" };
      });
      expect(events).toEqual([
        {
          reply_id: REPLY_ID,
          turn: 4,
          latency_ms: 5000,
          model: "granite4.1:3b",
          tool_calls: [
            { name: "search_perfumes", argument_keys: ["families", "max_price_uah", "notes"] },
          ],
          pick_ids: [PRODUCT],
          asked_question: true,
          error: null,
          entry: "corner",
        },
      ]);
      const json = JSON.stringify(events);
      for (const text of [CUSTOMER, INTRO, REASON, QUESTION, "Ocean Two"]) {
        expect(json).not.toContain(text);
      }
    });

    it("records a failed stream with its finer error", async () => {
      const events = await streamed(async function* () {
        yield* [];
        throw new AiError("bad_response", "not JSON");
      });
      expect(events).toMatchObject([
        { error: "bad_response", pick_ids: [], asked_question: false },
      ]);
    });

    it("records a stream the customer stopped reading as cancelled", async () => {
      const events = await streamed(
        async function* () {
          yield { type: "intro", text: INTRO };
          yield { type: "picks", picks: [{ product, reason: REASON }] };
          yield { type: "done" };
        },
        { stopAfter: 1 },
      );
      expect(events).toMatchObject([{ error: "cancelled", pick_ids: [] }]);
    });

    it("returns the rate-limited message's event instead of streaming", async () => {
      for (let n = 0; n < 10; n++) {
        await ask("4.4.4.4", "visitor-4");
      }
      turn = 2;
      const result = await openPerfumerStream(
        {
          locale: "uk",
          owner: owner("visitor-4"),
          message: CUSTOMER,
          entry: "menu",
          ipKey: "4.4.4.4",
        },
        streamDeps(),
      );
      expect(result).toMatchObject({
        ok: false,
        error: "rateLimited",
        event: { error: "rate_limited", model: null, latency_ms: 0, turn: 2 },
      });
    });
  });
});

describe("saving the conversation (#180)", () => {
  const history = [
    { role: "user" as const, content: "Щось тепле" },
    { role: "assistant" as const, content: "Ось теплі аромати." },
    { role: "user" as const, content: CUSTOMER },
  ];

  it("sends the model the stored history and saves the answer as product ids", async () => {
    store.begin.mockImplementation(async ({ entry }) => ({ threadId: 9, turn: 2, entry, history }));
    deps.reply.mockResolvedValue(result(rich));
    const outcome = await ask("1.1.1.1", "visitor");
    expect(store.begin).toHaveBeenCalledWith({
      owner: { userId: null, anonymousId: "visitor" },
      message: CUSTOMER,
      entry: "catalog",
      retry: false,
    });
    expect(deps.reply).toHaveBeenCalledWith("uk", history, {});
    expect(saved).toEqual([
      [
        9,
        {
          intro: INTRO,
          reply: {
            picks: [{ productId: PRODUCT, reason: REASON }],
            question: QUESTION,
            replyId: REPLY_ID,
            turn: 2,
          },
        },
      ],
    ]);
    expect(outcome.event.turn).toBe(2);
  });

  it("passes a retry on to the store", async () => {
    await answerPerfumerMessage(
      {
        locale: "uk",
        owner: owner("visitor"),
        message: CUSTOMER,
        entry: "direct",
        retry: true,
        ipKey: "1.1.1.1",
      },
      deps,
    );
    expect(store.begin).toHaveBeenCalledWith(expect.objectContaining({ retry: true }));
  });

  it("saves an error marker for a failed or cancelled answer", async () => {
    deps.reply.mockRejectedValueOnce(new AiError("timeout", "slow"));
    await ask("1.1.1.1", "visitor");
    const controller = new AbortController();
    deps.reply.mockImplementationOnce(async () => {
      controller.abort();
      throw new AiError("timeout", "aborted");
    });
    await ask("1.1.1.1", "visitor", controller.signal);
    expect(saved).toEqual([
      [7, { errorKey: "timeout" }],
      [7, { errorKey: "cancelled" }],
    ]);
  });

  it("saves nothing for a rate-limited message, and takes its turn from the thread", async () => {
    for (let n = 0; n < 10; n++) {
      await ask("1.1.1.1", "visitor");
    }
    store.begin.mockClear();
    saved = [];
    turn = 6;
    const { event } = await ask("1.1.1.1", "visitor");
    expect(store.begin).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(event.turn).toBe(6);
  });

  it("answers unavailable without calling the model when the message can't be saved", async () => {
    store.begin.mockRejectedValue(new Error("database down"));
    await expect(resultOf("1.1.1.1", "visitor")).resolves.toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(deps.reply).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("still answers when saving the answer fails", async () => {
    store.end = async () => {
      throw new Error("database down");
    };
    expect((await resultOf("1.1.1.1", "visitor")).ok).toBe(true);
  });

  describe("when streamed", () => {
    function streamWith(replyStream: PerfumerStreamDeps["replyStream"], signal?: AbortSignal) {
      return openPerfumerStream(
        {
          locale: "uk",
          owner: owner("visitor"),
          message: CUSTOMER,
          entry: "menu",
          ipKey: "5.5.5.5",
          signal,
        },
        { ...deps, replyStream },
      );
    }

    it("saves the answer before `done` reaches the page", async () => {
      const result = await streamWith(async function* () {
        yield { type: "intro", text: "Ось що є. " };
        yield { type: "intro", text: INTRO };
        yield { type: "picks", picks: [{ product, reason: REASON }] };
        yield { type: "question", text: QUESTION };
        yield { type: "done" };
      });
      if (!result.ok) throw new Error("refused");
      for await (const event of result.events) {
        if (event.type === "done") {
          expect(saved).toEqual([
            [
              7,
              {
                intro: `Ось що є. ${INTRO}`,
                reply: {
                  picks: [{ productId: PRODUCT, reason: REASON }],
                  question: QUESTION,
                  replyId: REPLY_ID,
                  turn: 3,
                },
              },
            ],
          ]);
        }
      }
      expect(saved).toHaveLength(1);
    });

    it("saves an error marker for a failed stream, and `cancelled` for a stopped one", async () => {
      const failed = await streamWith(async function* () {
        yield* [];
        throw new AiError("unavailable", "down");
      });
      if (!failed.ok) throw new Error("refused");
      for await (const _event of failed.events) {
        // Read to the end.
      }
      const stopped = await streamWith(async function* () {
        yield { type: "intro", text: INTRO };
        yield { type: "done" };
      });
      if (!stopped.ok) throw new Error("refused");
      for await (const _event of stopped.events) {
        break;
      }
      expect(saved).toEqual([
        [7, { errorKey: "unavailable" }],
        [7, { errorKey: "cancelled" }],
      ]);
    });

    it("streams nothing when the message can't be saved", async () => {
      store.begin.mockRejectedValue(new Error("database down"));
      await expect(
        streamWith(async function* () {
          yield { type: "done" };
        }),
      ).resolves.toEqual({ ok: false, error: "unavailable" });
    });
  });
});
