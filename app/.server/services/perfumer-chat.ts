import type { Locale } from "~/lib/i18n";
import type { PerfumerActionResult, PerfumerMessage, PerfumerReply } from "~/lib/perfumer";
import { AiError } from "../ai/errors";
import { type PerfumerDeps, reply as perfumerReply } from "../ai/perfumer";
import { perfumerLimiters, type RateLimiter } from "../rate-limit";

// The AI perfumer chat's one action (#163): the rate limits, the engine call (#162) and its errors
// turned into the chat's translated error keys. The route only parses the request and passes keys.

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
 * Answers one chat message. Over 10 messages in 5 minutes per IP or per visitor →
 * `rateLimited`, without calling the model. Every accepted message counts against both limits.
 */
export async function answerPerfumerMessage(
  { locale, messages, ipKey, sessionKey, signal }: PerfumerChatInput,
  deps: PerfumerChatDeps = defaultDeps,
): Promise<PerfumerActionResult> {
  // Each key falls back to the other, so a request without either still has a bound.
  const ip = ipKey ?? sessionKey ?? "anonymous";
  const session = sessionKey ?? ipKey ?? "anonymous";
  const { byIp, bySession } = deps.limiters;
  const [ipBlocked, sessionBlocked] = await Promise.all([
    byIp.isBlocked(ip),
    bySession.isBlocked(session),
  ]);
  if (ipBlocked || sessionBlocked) {
    return { ok: false, error: "rateLimited" };
  }
  await Promise.all([byIp.hit(ip), bySession.hit(session)]);

  try {
    return { ok: true, reply: await deps.reply(locale, messages, signal ? { signal } : {}) };
  } catch (error) {
    if (signal?.aborted) {
      // The customer left or cancelled: nobody reads this answer.
      return { ok: false, error: "timeout" };
    }
    if (error instanceof AiError) {
      console.warn(`AI perfumer: ${error.kind}: ${error.message}`);
      return { ok: false, error: error.kind === "timeout" ? "timeout" : "unavailable" };
    }
    console.error("AI perfumer failed", error);
    return { ok: false, error: "unavailable" };
  }
}
