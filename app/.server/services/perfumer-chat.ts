import type { Locale } from "~/lib/i18n";
import type {
  PerfumerActionResult,
  PerfumerErrorKey,
  PerfumerEvent,
  PerfumerMessage,
  PerfumerReply,
} from "~/lib/perfumer";
import { AiError } from "../ai/errors";
import { type PerfumerDeps, reply as perfumerReply, replyStream } from "../ai/perfumer";
import { perfumerLimiters, type RateLimiter } from "../rate-limit";

// The AI perfumer chat's one action (#163) and its stream (#164): the rate limits, the engine call
// (#162) and its errors turned into the chat's translated error keys. The routes only parse the
// request and pass keys.

export interface PerfumerChatInput {
  locale: Locale;
  /** Validated by `parsePerfumerRequest`: 1–10 messages, the last the customer's. */
  messages: PerfumerMessage[];
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
  ) => Promise<PerfumerReply>;
  limiters: { byIp: RateLimiter; bySession: RateLimiter };
}

const defaultDeps: PerfumerChatDeps = { reply: perfumerReply, limiters: perfumerLimiters };

/**
 * Whether a message may be answered: over 10 messages in 5 minutes per IP or per visitor, it may
 * not. An accepted message counts against both limits, answered or not.
 */
async function admitPerfumerMessage(
  { ipKey, sessionKey }: Pick<PerfumerChatInput, "ipKey" | "sessionKey">,
  { byIp, bySession }: PerfumerChatDeps["limiters"],
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

/** The chat's error key for a failed reply, logging what isn't the customer's doing. */
function errorKeyOf(error: unknown, signal: AbortSignal | undefined): PerfumerErrorKey {
  if (signal?.aborted) {
    // The customer left or cancelled: nobody reads this answer.
    return "timeout";
  }
  if (error instanceof AiError) {
    console.warn(`AI perfumer: ${error.kind}: ${error.message}`);
    return error.kind === "timeout" ? "timeout" : "unavailable";
  }
  console.error("AI perfumer failed", error);
  return "unavailable";
}

/**
 * Answers one chat message. Over 10 messages in 5 minutes per IP or per visitor →
 * `rateLimited`, without calling the model. Every accepted message counts against both limits.
 */
export async function answerPerfumerMessage(
  { locale, messages, ipKey, sessionKey, signal }: PerfumerChatInput,
  deps: PerfumerChatDeps = defaultDeps,
): Promise<PerfumerActionResult> {
  if (!(await admitPerfumerMessage({ ipKey, sessionKey }, deps.limiters))) {
    return { ok: false, error: "rateLimited" };
  }
  try {
    return { ok: true, reply: await deps.reply(locale, messages, signal ? { signal } : {}) };
  } catch (error) {
    return { ok: false, error: errorKeyOf(error, signal) };
  }
}

export interface PerfumerStreamDeps {
  replyStream: (
    locale: Locale,
    messages: readonly PerfumerMessage[],
    deps: Pick<PerfumerDeps, "signal">,
  ) => AsyncIterable<PerfumerEvent>;
  limiters: PerfumerChatDeps["limiters"];
}

const defaultStreamDeps: PerfumerStreamDeps = { replyStream, limiters: perfumerLimiters };

/**
 * Answers one chat message as events (#164), with the same rate limits and error keys as
 * `answerPerfumerMessage`: a refused or failed message ends with one `error` event, so the stream
 * always ends with `done` or `error`. Stopping the iteration stops the model call.
 */
export async function* streamPerfumerMessage(
  { locale, messages, ipKey, sessionKey, signal }: PerfumerChatInput,
  deps: PerfumerStreamDeps = defaultStreamDeps,
): AsyncGenerator<PerfumerEvent, void, undefined> {
  if (!(await admitPerfumerMessage({ ipKey, sessionKey }, deps.limiters))) {
    yield { type: "error", error: "rateLimited" };
    return;
  }
  try {
    yield* deps.replyStream(locale, messages, signal ? { signal } : {});
  } catch (error) {
    yield { type: "error", error: errorKeyOf(error, signal) };
  }
}
