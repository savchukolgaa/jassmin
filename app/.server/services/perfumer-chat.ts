import type { PerfumerMessageProperties, PerfumerToolCall } from "~/lib/analytics";
import type { Locale } from "~/lib/i18n";
import {
  PERFUMER_TOOL_NAMES,
  type PerfumerActionResult,
  type PerfumerEntry,
  type PerfumerErrorKey,
  type PerfumerEvent,
  type PerfumerMessage,
  type PerfumerPick,
  type PerfumerReply,
  type PerfumerStoredErrorKey,
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
import type {
  PerfumerOwner,
  PerfumerTurnEnd,
  PerfumerTurnStart,
  PerfumerWriter,
} from "./perfumer-threads";

// The AI perfumer chat's one action (#163) and its stream (#164): the rate limits, the engine call
// (#162) and its errors turned into the chat's translated error keys. The routes only parse the
// request and pass keys. Each message is also described for analytics (#166): counts, ids,
// timings and error keys, never the customer's words or the perfumer's text. The routes record
// that event.
//
// The conversation is saved (#180): each message is appended to the customer's or visitor's
// thread, the model gets the stored history (never one the browser sent), and the answer, or an
// error marker, is saved when the turn ends. The threads live in `perfumer-threads.ts`, reached
// through `PerfumerChatStore`, so these functions' unit tests need no database.

export interface PerfumerChatInput {
  locale: Locale;
  /** Whose chat: the customer's account, else the visitor (`anonymousId`, also a rate key). */
  owner: PerfumerWriter;
  /** The customer's new message, validated by `parsePerfumerRequest` (1–500 characters). */
  message: string;
  /** How the conversation was opened. */
  entry: PerfumerEntry;
  /** Answers the thread's last message again after a retryable error, instead of a copy. */
  retry?: boolean;
  /** The client IP, or `undefined` when it isn't known. */
  ipKey: string | undefined;
  /** The request's signal: a customer who leaves or cancels stops the model call. */
  signal?: AbortSignal;
}

/** Where the conversation is saved: `perfumer-threads.ts`, or a fake in tests. */
export interface PerfumerChatStore {
  /** The `turn` the owner's next message would get, for a refused message's event. */
  nextTurn: (owner: PerfumerOwner) => Promise<number>;
  begin: (input: {
    owner: PerfumerWriter;
    message: string;
    entry: PerfumerEntry;
    retry: boolean;
  }) => Promise<PerfumerTurnStart>;
  end: (threadId: number, end: PerfumerTurnEnd) => Promise<void>;
}

const threads = () => import("./perfumer-threads");

/** The database store, loaded on first use. */
export const dbPerfumerChatStore: PerfumerChatStore = {
  nextTurn: async (owner) => (await threads()).nextPerfumerTurn(owner),
  begin: async (input) => (await threads()).beginPerfumerTurn(input),
  end: async (threadId, end) => (await threads()).endPerfumerTurn(threadId, end),
};

/** What the chat needs besides the engine: limits, the store, and for analytics a model, clock, ids. */
interface PerfumerChatBaseDeps {
  limiters: { byIp: RateLimiter; bySession: RateLimiter };
  store: PerfumerChatStore;
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
  store: dbPerfumerChatStore,
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
  { ipKey, owner }: Pick<PerfumerChatInput, "ipKey" | "owner">,
  { byIp, bySession }: PerfumerChatBaseDeps["limiters"],
): Promise<boolean> {
  const sessionKey: string | undefined = owner.anonymousId || undefined;
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

/** The event of a message the rate limit refused: no model, no latency, and nothing saved. */
async function rateLimitedEvent(
  { owner, entry }: Pick<PerfumerChatInput, "owner" | "entry">,
  replyId: string,
  store: PerfumerChatStore,
): Promise<PerfumerMessageProperties> {
  let turn = 1;
  try {
    turn = await store.nextTurn(owner);
  } catch (error) {
    console.error("AI perfumer: reading the thread failed", error);
  }
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

/** An answer as it's saved: the intro, the picks as product ids with reasons, never their data. */
export function toStoredReply(
  reply: PerfumerReply,
  replyId: string,
  turn: number,
): PerfumerTurnEnd {
  return {
    intro: reply.intro,
    reply: {
      picks: reply.picks.map(({ product, reason }) => ({ productId: product.id, reason })),
      ...(reply.question ? { question: reply.question } : {}),
      replyId,
      turn,
    },
  };
}

/** The error marker saved for a turn without an answer. */
function markerOf(key: PerfumerErrorKey, telemetry: PerfumerTelemetryError): PerfumerTurnEnd {
  const errorKey: PerfumerStoredErrorKey = telemetry === "cancelled" ? "cancelled" : key;
  return { errorKey };
}

/** Saves the end of a turn. A failure is logged, never shown: the customer has the answer. */
async function saveEnd(
  store: PerfumerChatStore,
  threadId: number,
  end: PerfumerTurnEnd,
): Promise<void> {
  try {
    await store.end(threadId, end);
  } catch (error) {
    console.error("AI perfumer: saving the answer failed", error);
  }
}

/** Saves the customer's message and reads the history; `null` (logged) when the database fails. */
async function beginTurn(
  { owner, message, entry, retry }: PerfumerChatInput,
  store: PerfumerChatStore,
): Promise<PerfumerTurnStart | null> {
  try {
    return await store.begin({ owner, message, entry, retry: retry ?? false });
  } catch (error) {
    console.error("AI perfumer: saving the message failed", error);
    return null;
  }
}

/** The chat's answer, and the `perfumer_message` event that describes it. */
export interface PerfumerChatOutcome {
  result: PerfumerActionResult;
  event: PerfumerMessageProperties;
}

/**
 * Answers one chat message. Over 10 messages in 5 minutes per IP or per visitor →
 * `rateLimited`, without calling the model or saving anything. Every accepted message counts
 * against both limits, and is saved with its answer or an error marker.
 */
export async function answerPerfumerMessage(
  input: PerfumerChatInput,
  deps: PerfumerChatDeps = defaultDeps,
): Promise<PerfumerChatOutcome> {
  const { locale, signal } = input;
  const replyId = deps.newReplyId();
  if (!(await admitPerfumerMessage(input, deps.limiters))) {
    return {
      result: { ok: false, error: "rateLimited" },
      event: await rateLimitedEvent(input, replyId, deps.store),
    };
  }
  const model = deps.model();
  const started = deps.now();
  const turnStart = await beginTurn(input, deps.store);
  if (!turnStart) {
    return {
      result: { ok: false, error: "unavailable" },
      event: perfumerMessageProperties({
        replyId,
        turn: 1,
        entry: input.entry,
        latencyMs: deps.now() - started,
        model,
        toolCalls: [],
        pickIds: [],
        askedQuestion: false,
        error: "unavailable",
      }),
    };
  }
  const { threadId, turn, entry, history } = turnStart;
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
    const answer = await deps.reply(locale, history, signal ? { signal } : {});
    await saveEnd(deps.store, threadId, toStoredReply(answer.reply, replyId, turn));
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
    await saveEnd(deps.store, threadId, markerOf(key, telemetry));
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
  /** The message couldn't be saved: nothing is answered, so there's no event either. */
  | { ok: false; error: "unavailable"; event?: undefined }
  | { ok: true; events: AsyncIterable<PerfumerEvent> };

/**
 * Starts answering one chat message as events (#164), with the same rate limits and error keys as
 * `answerPerfumerMessage`. A refused message is `rateLimited` before anything is streamed, so the
 * route can answer 429; an accepted one's events always end with `done` (carrying the reply's id)
 * or one `error`. The answer is saved before `done` is sent; an error or a cancel saves an error
 * marker. Stopping the iteration (or `signal`) stops the model call. `onEvent` gets the message's
 * `perfumer_message` event once the stream ends, however it ends (#166).
 */
export async function openPerfumerStream(
  input: PerfumerChatInput & { onEvent?: (event: PerfumerMessageProperties) => void },
  deps: PerfumerStreamDeps = defaultStreamDeps,
): Promise<PerfumerStreamResult> {
  const { locale, signal, onEvent } = input;
  const replyId = deps.newReplyId();
  if (!(await admitPerfumerMessage(input, deps.limiters))) {
    return {
      ok: false,
      error: "rateLimited",
      event: await rateLimitedEvent(input, replyId, deps.store),
    };
  }
  const model = deps.model();
  const started = deps.now();
  const turnStart = await beginTurn(input, deps.store);
  if (!turnStart) {
    return { ok: false, error: "unavailable" };
  }
  const { threadId, turn, entry, history } = turnStart;
  async function* events(): AsyncGenerator<PerfumerEvent, void, undefined> {
    const toolCalls: ToolCallRecord[] = [];
    let intro = "";
    let picks: PerfumerPick[] = [];
    let question: string | undefined;
    let error: PerfumerTelemetryError | null = null;
    let done = false;
    let saved = false;
    try {
      const stream = deps.replyStream(locale, history, {
        ...(signal ? { signal } : {}),
        onToolCall: (record) => toolCalls.push(record),
      });
      for await (const event of stream) {
        if (event.type === "intro") intro += event.text;
        if (event.type === "picks") picks = event.picks;
        if (event.type === "question") question = event.text;
        if (event.type === "done") {
          done = true;
          saved = true;
          // Saved before `done` reaches the page, so a reload right after shows the answer.
          const reply: PerfumerReply = { intro, picks, ...(question ? { question } : {}) };
          await saveEnd(deps.store, threadId, toStoredReply(reply, replyId, turn));
          yield { type: "done", replyId };
          continue;
        }
        yield event;
      }
    } catch (failure) {
      const { key, telemetry } = classify(failure, signal);
      error = telemetry;
      saved = true;
      await saveEnd(deps.store, threadId, markerOf(key, telemetry));
      yield { type: "error", error: key };
    } finally {
      // Ended without `done` or an error: the customer stopped reading.
      if (!done && error === null) error = "cancelled";
      if (!saved) await saveEnd(deps.store, threadId, { errorKey: "cancelled" });
      onEvent?.(
        perfumerMessageProperties({
          replyId,
          turn,
          entry,
          latencyMs: deps.now() - started,
          model,
          toolCalls,
          pickIds: error === null ? picks.map((pick) => pick.product.id) : [],
          askedQuestion: error === null && question !== undefined,
          error,
        }),
      );
    }
  }
  return { ok: true, events: events() };
}
