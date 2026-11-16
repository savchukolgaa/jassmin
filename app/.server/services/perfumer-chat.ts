import type { PerfumerMessageProperties, PerfumerToolCall } from "~/lib/analytics";
import type { Locale } from "~/lib/i18n";
import {
  PERFUMER_TOOL_NAMES,
  type PerfumerActionResult,
  type PerfumerEntry,
  type PerfumerErrorKey,
  type PerfumerMessage,
  type PerfumerReply,
  type PerfumerTelemetryError,
  type PerfumerToolName,
} from "~/lib/perfumer";
import type { ToolCallRecord } from "../ai/catalog-tools";
import { getPerfumerConfig } from "../ai/config";
import { AiError } from "../ai/errors";
import { type PerfumerDeps, type PerfumerResult, replyWithTrace } from "../ai/perfumer";
import { perfumerLimiters, type RateLimiter } from "../rate-limit";

// The AI perfumer chat's one action (#163): the rate limits, the engine call (#162) and its errors
// turned into the chat's translated error keys. The route only parses the request and passes keys.
// It also describes each message for analytics (#166): counts, ids, timings and error keys, never
// the customer's words or the perfumer's text. The route records that event.

export interface PerfumerChatInput {
  locale: Locale;
  /** Validated by `parsePerfumerRequest`: 1–10 messages, the last the customer's. */
  messages: PerfumerMessage[];
  /** The customer's message number in the whole thread (the history sent is cut to 10). */
  turn: number;
  /** How the conversation was opened. */
  entry: PerfumerEntry;
  /** The client IP, or `undefined` when it isn't known. */
  ipKey: string | undefined;
  /** The visitor's `anonymousId`. */
  sessionKey: string | undefined;
  /** The request's signal: a customer who leaves or cancels stops the model call. */
  signal?: AbortSignal;
}

export interface PerfumerChatDeps {
  reply: (
    locale: Locale,
    messages: readonly PerfumerMessage[],
    deps: Pick<PerfumerDeps, "signal">,
  ) => Promise<PerfumerResult>;
  limiters: { byIp: RateLimiter; bySession: RateLimiter };
  /** The configured `AI_MODEL`, for analytics. */
  model: () => string | null;
  /** Milliseconds, for the answer's latency. */
  now: () => number;
  newReplyId: () => string;
}

const defaultDeps: PerfumerChatDeps = {
  reply: replyWithTrace,
  limiters: perfumerLimiters,
  model: () => getPerfumerConfig()?.model ?? null,
  now: () => performance.now(),
  newReplyId: () => crypto.randomUUID(),
};

/** The chat's answer, and the `perfumer_message` event that describes it. */
export interface PerfumerChatOutcome {
  result: PerfumerActionResult;
  event: PerfumerMessageProperties;
}

/** A tool argument's name as the event contract takes it; anything else is left out. */
const ARGUMENT_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** Most tool calls and argument names one event lists. */
const MAX_TOOL_CALLS = 12;
const MAX_ARGUMENT_KEYS = 10;

function toolName(name: string): PerfumerToolName {
  return PERFUMER_TOOL_NAMES.find((known) => known === name && known !== "other") ?? "other";
}

/** A tool call as analytics keeps it: the tool's name and its arguments' names, never values. */
export function toolCallSummary(record: ToolCallRecord): PerfumerToolCall {
  const args = record.arguments;
  const keys =
    args !== null && typeof args === "object" && !Array.isArray(args)
      ? Object.keys(args).filter((key) => ARGUMENT_KEY.test(key))
      : [];
  return { name: toolName(record.name), argument_keys: keys.slice(0, MAX_ARGUMENT_KEYS) };
}

export interface MessageEventInput {
  replyId: string;
  turn: number;
  entry: PerfumerEntry;
  latencyMs: number;
  model: string | null;
  /** The engine's result; `undefined` when it failed or wasn't called. */
  answer?: PerfumerResult;
  error: PerfumerTelemetryError | null;
}

/** The `perfumer_message` properties for one message: no text from either side. */
export function perfumerMessageProperties({
  replyId,
  turn,
  entry,
  latencyMs,
  model,
  answer,
  error,
}: MessageEventInput): PerfumerMessageProperties {
  const reply: PerfumerReply | undefined = answer?.reply;
  return {
    reply_id: replyId,
    turn,
    latency_ms: Math.max(0, Math.round(latencyMs)),
    model: model ? model.slice(0, 100) : null,
    tool_calls: (answer?.trace.toolCalls ?? []).slice(0, MAX_TOOL_CALLS).map(toolCallSummary),
    pick_ids: (reply?.picks ?? []).map((pick) => pick.product.id),
    asked_question: Boolean(reply?.question),
    error,
    entry,
  };
}

/** The chat's error key for an engine failure, and the finer one analytics records. */
function classify(
  error: unknown,
  signal: AbortSignal | undefined,
): { key: PerfumerErrorKey; telemetry: PerfumerTelemetryError } {
  if (signal?.aborted) {
    // The customer left or cancelled: nobody reads this answer.
    return { key: "timeout", telemetry: "cancelled" };
  }
  if (error instanceof AiError) {
    console.warn(`AI perfumer: ${error.kind}: ${error.message}`);
    return { key: error.kind === "timeout" ? "timeout" : "unavailable", telemetry: error.kind };
  }
  console.error("AI perfumer failed", error);
  return { key: "unavailable", telemetry: "unavailable" };
}

/**
 * Answers one chat message. Over 10 messages in 5 minutes per IP or per visitor →
 * `rateLimited`, without calling the model. Every accepted message counts against both limits.
 */
export async function answerPerfumerMessage(
  { locale, messages, turn, entry, ipKey, sessionKey, signal }: PerfumerChatInput,
  deps: PerfumerChatDeps = defaultDeps,
): Promise<PerfumerChatOutcome> {
  const replyId = deps.newReplyId();
  const started = deps.now();
  const describe = (fields: Pick<MessageEventInput, "error" | "answer" | "model">) =>
    perfumerMessageProperties({
      replyId,
      turn,
      entry,
      latencyMs: fields.model === null ? 0 : deps.now() - started,
      ...fields,
    });

  // Each key falls back to the other, so a request without either still has a bound.
  const ip = ipKey ?? sessionKey ?? "anonymous";
  const session = sessionKey ?? ipKey ?? "anonymous";
  const { byIp, bySession } = deps.limiters;
  const [ipBlocked, sessionBlocked] = await Promise.all([
    byIp.isBlocked(ip),
    bySession.isBlocked(session),
  ]);
  if (ipBlocked || sessionBlocked) {
    return {
      result: { ok: false, error: "rateLimited" },
      event: describe({ error: "rate_limited", model: null }),
    };
  }
  await Promise.all([byIp.hit(ip), bySession.hit(session)]);

  const model = deps.model();
  try {
    const answer = await deps.reply(locale, messages, signal ? { signal } : {});
    return {
      result: { ok: true, reply: answer.reply, replyId },
      event: describe({ error: null, answer, model }),
    };
  } catch (error) {
    const { key, telemetry } = classify(error, signal);
    return { result: { ok: false, error: key }, event: describe({ error: telemetry, model }) };
  }
}
