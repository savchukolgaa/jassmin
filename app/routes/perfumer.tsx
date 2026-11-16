import { data } from "react-router";
import { isPerfumerEnabled } from "~/.server/ai/config";
import { ensureVisitor, trackEvent } from "~/.server/analytics";
import { eventsLimiter } from "~/.server/client-events";
import { getLocale } from "~/.server/locale";
import { getClientIp } from "~/.server/rate-limit";
import { answerPerfumerMessage } from "~/.server/services/perfumer-chat";
import { PerfumerPage } from "~/features/perfumer/PerfumerPage";
import { metaTranslator } from "~/lib/i18n";
import type { PerfumerActionResult, PerfumerErrorKey } from "~/lib/perfumer";
import {
  parsePerfumerFeedback,
  parsePerfumerPrefill,
  parsePerfumerRequest,
} from "~/lib/perfumer.schema";
import { errorMeta, seoMeta } from "~/lib/seo";
import type { Route } from "./+types/perfumer";

// The AI perfumer chat (#163): `/parfumer`, `/en/perfumer`. A 404 while the engine (#162) is off.
// The conversation lives in the browser; each message posts it here and gets the whole reply back.

export function meta({ matches, location, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return seoMeta(
    { matches, location },
    {
      title: t("meta.title", { page: t("perfumer.metaTitle") }),
      description: t("perfumer.metaDescription"),
    },
  );
}

/** A 404 unless `AI_BASE_URL` is set. */
function requirePerfumer() {
  if (!isPerfumerEnabled()) {
    throw data(null, { status: 404 });
  }
}

/**
 * `prefill`: a message from an entry point (`?q=`, #165), which the page sends once and then
 * removes from the URL. The canonical URL never has it (`seoMeta` keeps no query parameters here).
 */
export function loader({ request }: Route.LoaderArgs) {
  requirePerfumer();
  return { prefill: parsePerfumerPrefill(new URL(request.url).searchParams) };
}

const ERROR_STATUS: Record<PerfumerErrorKey, number> = {
  tooLong: 400,
  rateLimited: 429,
  unavailable: 503,
  timeout: 504,
};

/** The answer to a rating: `{ ok }`, never an error the customer has to read. */
export type PerfumerFeedbackActionResult = { ok: boolean };

/**
 * A rating of one answer (#166): recorded as `perfumer_feedback` with analytics consent, else
 * dropped. Limited like the client tracker's batches, so it can't flood `user_events`.
 */
async function rateAnswer(args: Route.ActionArgs, formData: FormData) {
  const parsed = parsePerfumerFeedback(formData);
  if (!parsed.ok) {
    return data<PerfumerFeedbackActionResult>({ ok: false }, { status: 400 });
  }
  const visitor = await ensureVisitor(args);
  const key = getClientIp(args.request) ?? visitor.anonymousId;
  if (await eventsLimiter.isBlocked(key)) {
    return data<PerfumerFeedbackActionResult>({ ok: false }, { status: 429 });
  }
  await eventsLimiter.hit(key);
  void trackEvent(args, "perfumer_feedback", {
    properties: { reply_id: parsed.replyId, turn: parsed.turn, rating: parsed.rating },
  });
  return data<PerfumerFeedbackActionResult>({ ok: true });
}

/**
 * One message: `payload` is `{ messages, turn, entry }` as JSON (the last 10 messages, the newest
 * the customer's). `intent=feedback` rates an answer instead.
 */
export async function action(args: Route.ActionArgs) {
  requirePerfumer();
  const { request } = args;
  const formData = await request.formData();
  if (formData.get("intent") === "feedback") {
    return rateAnswer(args, formData);
  }
  const parsed = parsePerfumerRequest(formData);
  if (!parsed.ok) {
    return data<PerfumerActionResult>(
      { ok: false, error: parsed.error },
      { status: ERROR_STATUS[parsed.error] },
    );
  }
  // The visitor's id works without analytics consent, like the guest cart's (#18).
  const [locale, visitor] = await Promise.all([getLocale(request), ensureVisitor(args)]);
  const { result, event } = await answerPerfumerMessage({
    locale,
    messages: parsed.messages,
    turn: parsed.turn,
    entry: parsed.entry,
    ipKey: getClientIp(request),
    sessionKey: visitor.anonymousId,
    signal: request.signal,
  });
  // One event per message (#166), with analytics consent; never any text.
  void trackEvent(args, "perfumer_message", { properties: event });
  return data<PerfumerActionResult>(result, {
    status: result.ok ? 200 : ERROR_STATUS[result.error],
  });
}

export default function PerfumerRoute({ loaderData }: Route.ComponentProps) {
  return <PerfumerPage prefill={loaderData.prefill} />;
}
