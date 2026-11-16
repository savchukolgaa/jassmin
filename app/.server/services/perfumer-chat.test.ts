import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEventProperties } from "~/lib/analytics.schema";
import type { PerfumerReply } from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import { AiError } from "../ai/errors";
import type { PerfumerResult, PerfumerTrace } from "../ai/perfumer";
import { createMemoryRateLimitStore, createRateLimiter } from "../rate-limit";
import {
  answerPerfumerMessage,
  type PerfumerChatDeps,
  perfumerMessageProperties,
  toolCallSummary,
} from "./perfumer-chat";

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
};
const result = (reply: PerfumerReply, toolCalls = trace.toolCalls): PerfumerResult => ({
  reply,
  trace: { ...trace, toolCalls },
});
const messages = [{ role: "user" as const, content: CUSTOMER }];

let now = 0;
let clock = 0;
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
  deps = {
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

const ask = (ipKey: string | undefined, sessionKey: string | undefined, signal?: AbortSignal) =>
  answerPerfumerMessage(
    { locale: "uk", messages, turn: 3, entry: "catalog", ipKey, sessionKey, signal },
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
      answer: result(answer, many),
      error: null,
    });
    expect(event.tool_calls).toHaveLength(12);
    expect(event.latency_ms).toBe(2);
    expect(parseEventProperties("perfumer_message", event)).not.toBeNull();
  });
});
