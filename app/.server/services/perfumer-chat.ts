import type { PerfumerMessageProperties, PerfumerToolCall } from "~/lib/analytics";
import type { Locale } from "~/lib/i18n";
import {
  PERFUMER_TOOL_NAMES,
  type PerfumerActionResult,
  type PerfumerEntry,
  type PerfumerErrorKey,
  type PerfumerEvent,
  type PerfumerMessage,
  type PerfumerTelemetryError,
  type PerfumerToolName,
} from "~/lib/perfumer";
import type { ToolCallRecord } from "../ai/catalog-tools";
import { getPerfumerConfig } from "../ai/config";
import { AiError } from "../ai/errors";
import {
  type PerfumerDeps,
  type PerfumerResult,
  replyStream,
  replyWithTrace,
} from "../ai/perfumer";
import { perfumerLimiters, type RateLimiter } from "../rate-limit";

// The AI perfumer chat's one action (#163) and its stream (#164): the rate limits, the engine call
// (#162) and its errors turned into the chat's translated error keys. The routes only parse the
// request and pass keys. Each message is also described for analytics (#166): counts, ids,
// timings and error keys, never the customer's words or the perfumer's text. The routes record
// that event.

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

/** What the chat needs besides the engine: limits, and for analytics the model, a clock and ids. */
interface PerfumerChatBaseDeps {
  limiters: { byIp: RateLimiter; bySession: RateLimiter };
  /** The configured `AI_MODEL`, for analytics. */
  model: () => string | null;
  /** Milliseconds, for the answer's latency. */
  now: () => number;
  newReplyId: () => string;
}

export interface PerfumerChatDeps extends PerfumerChatBaseDeps {
  reply: (
    locale: Locale,
    messages: readonly PerfumerMessage[],
    deps: Pick<PerfumerDeps, "signal">,
  ) => Promise<PerfumerResult>;
}

const baseDeps: PerfumerChatBaseDeps = {
  limiters: perfumerLimiters,
  model: () => getPerfumerConfig()?.model ?? null,
  now: () => performance.now(),
  newReplyId: () => crypto.randomUUID(),
};

const defaultDeps: PerfumerChatDeps = { ...baseDeps, reply: replyWithTrace };

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
  toolCalls: readonly ToolCallRecord[];
  /** `products.public_id` of the picks shown. */
  pickIds: readonly string[];
  askedQuestion: boolean;
  error: PerfumerTelemetryError | null;
}

/** The `perfumer_message` properties for one message: no text from either side. */
export function perfumerMessageProperties({
  replyId,
  turn,
  entry,
  latencyMs,
  model,
  toolCalls,
  pickIds,
  askedQuestion,
  error,
}: MessageEventInput): PerfumerMessageProperties {
  return {
    reply_id: replyId,
    turn,
    latency_ms: Math.max(0, Math.round(latencyMs)),
    model: model ? model.slice(0, 100) : null,
    tool_calls: toolCalls.slice(0, MAX_TOOL_CALLS).map(toolCallSummary),
    pick_ids: [...pickIds],
    asked_question: askedQuestion,
    error,
    entry,
  };
}

/**
 * Whether a message may be answered: over 10 messages in 5 minutes per IP or per visitor, it may
 * not. An accepted message counts against both limits, answered or not.
 */
async function admitPerfumerMessage(
  { ipKey, sessionKey }: Pick<PerfumerChatInput, "ipKey" | "sessionKey">,
  { byIp, bySession }: PerfumerChatBaseDeps["limiters"],
): Promise<boolean> {
  // Each key falls back to the other, so a request without either still has a bound.
  const ip = ipKey ?? sessionKey ?? "anonymous";
  const session = sessionKey ?? ipKey ?? "anonymous";
  const [ipBlocked, sessionBlocked] = await Promise.all([
    byIp.isBlocked(ip),
    bySession.isBlocked(session),
  ]);
  if (ipBlocked || sessionBlocked) {
    return false;
  }
  await Promise.all([byIp.hit(ip), bySession.hit(session)]);
  return true;
}

/** The chat's error key for a failed reply, logging what isn't the customer's doing, and the
 * finer reason analytics records. */
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

/** The event of a message the rate limit refused: no model, no latency. */
function rateLimitedEvent(
  { turn, entry }: Pick<PerfumerChatInput, "turn" | "entry">,
  replyId: string,
): PerfumerMessageProperties {
  return perfumerMessageProperties({
    replyId,
    turn,
    entry,
    latencyMs: 0,
    model: null,
    toolCalls: [],
    pickIds: [],
    askedQuestion: false,
    error: "rate_limited",
  });
}

/** The chat's answer, and the `perfumer_message` event that describes it. */
export interface PerfumerChatOutcome {
  result: PerfumerActionResult;
  event: PerfumerMessageProperties;
}

/**
 * Answers one chat message. Over 10 messages in 5 minutes per IP or per visitor →
 * `rateLimited`, without calling the model. Every accepted message counts against both limits.
 */
export async function answerPerfumerMessage(
  input: PerfumerChatInput,
  deps: PerfumerChatDeps = defaultDeps,
): Promise<PerfumerChatOutcome> {
  const { locale, messages, turn, entry, signal } = input;
  const replyId = deps.newReplyId();
  if (!(await admitPerfumerMessage(input, deps.limiters))) {
    return { result: { ok: false, error: "rateLimited" }, event: rateLimitedEvent(input, replyId) };
  }
  const model = deps.model();
  const started = deps.now();
  const describe = (
    fields: Pick<MessageEventInput, "toolCalls" | "pickIds" | "askedQuestion" | "error">,
  ) =>
    perfumerMessageProperties({
      replyId,
      turn,
      entry,
      latencyMs: deps.now() - started,
      model,
      ...fields,
    });
  try {
    const answer = await deps.reply(locale, messages, signal ? { signal } : {});
    return {
      result: { ok: true, reply: answer.reply, replyId },
      event: describe({
        toolCalls: answer.trace.toolCalls,
        pickIds: answer.reply.picks.map((pick) => pick.product.id),
        askedQuestion: Boolean(answer.reply.question),
        error: null,
      }),
    };
  } catch (error) {
    const { key, telemetry } = classify(error, signal);
    return {
      result: { ok: false, error: key },
      event: describe({ toolCalls: [], pickIds: [], askedQuestion: false, error: telemetry }),
    };
  }
}

export interface PerfumerStreamDeps extends PerfumerChatBaseDeps {
  replyStream: (
    locale: Locale,
    messages: readonly PerfumerMessage[],
    deps: Pick<PerfumerDeps, "signal" | "onToolCall">,
  ) => AsyncIterable<PerfumerEvent>;
}

const defaultStreamDeps: PerfumerStreamDeps = { ...baseDeps, replyStream };

export type PerfumerStreamResult =
  | { ok: false; error: "rateLimited"; event: PerfumerMessageProperties }
  | { ok: true; events: AsyncIterable<PerfumerEvent> };

/**
 * Starts answering one chat message as events (#164), with the same rate limits and error keys as
 * `answerPerfumerMessage`. A refused message is `rateLimited` before anything is streamed, so the
 * route can answer 429; an accepted one's events always end with `done` (carrying the reply's id)
 * or one `error`. Stopping the iteration (or `signal`) stops the model call. `onEvent` gets the
 * message's `perfumer_message` event once the stream ends, however it ends (#166).
 */
export async function openPerfumerStream(
  input: PerfumerChatInput & { onEvent?: (event: PerfumerMessageProperties) => void },
  deps: PerfumerStreamDeps = defaultStreamDeps,
): Promise<PerfumerStreamResult> {
  const { locale, messages, turn, entry, signal, onEvent } = input;
  const replyId = deps.newReplyId();
  if (!(await admitPerfumerMessage(input, deps.limiters))) {
    return { ok: false, error: "rateLimited", event: rateLimitedEvent(input, replyId) };
  }
  const model = deps.model();
  const started = deps.now();
  async function* events(): AsyncGenerator<PerfumerEvent, void, undefined> {
    const toolCalls: ToolCallRecord[] = [];
    let pickIds: string[] = [];
    let askedQuestion = false;
    let error: PerfumerTelemetryError | null = null;
    let done = false;
    try {
      const stream = deps.replyStream(locale, messages, {
        ...(signal ? { signal } : {}),
        onToolCall: (record) => toolCalls.push(record),
      });
      for await (const event of stream) {
        if (event.type === "picks") pickIds = event.picks.map((pick) => pick.product.id);
        if (event.type === "question") askedQuestion = true;
        if (event.type === "done") {
          done = true;
          yield { type: "done", replyId };
          continue;
        }
        yield event;
      }
    } catch (failure) {
      const { key, telemetry } = classify(failure, signal);
      error = telemetry;
      yield { type: "error", error: key };
    } finally {
      // Ended without `done` or an error: the customer stopped reading.
      if (!done && error === null) error = "cancelled";
      onEvent?.(
        perfumerMessageProperties({
          replyId,
          turn,
          entry,
          latencyMs: deps.now() - started,
          model,
          toolCalls,
          pickIds: error === null ? pickIds : [],
          askedQuestion: error === null && askedQuestion,
          error,
        }),
      );
    }
  }
  return { ok: true, events: events() };
}
