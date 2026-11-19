import { data } from "react-router";
import { isPerfumerEnabled } from "~/.server/ai/config";
import { ensureVisitor, trackEvent } from "~/.server/analytics";
import { eventsLimiter } from "~/.server/client-events";
import { getLocale } from "~/.server/locale";
import { getClientIp } from "~/.server/rate-limit";
import { answerPerfumerMessage } from "~/.server/services/perfumer-chat";
import {
  deletePerfumerChat,
  getPerfumerOwner,
  getPerfumerThreadView,
  getPerfumerWriter,
  ratePerfumerReply,
  startNewPerfumerChat,
} from "~/.server/services/perfumer-threads";
import { PerfumerPage } from "~/features/perfumer/PerfumerPage";
import { shouldRevalidateView } from "~/lib/analytics";
import { metaTranslator } from "~/lib/i18n";
import type { PerfumerActionResult, PerfumerErrorKey } from "~/lib/perfumer";
import {
  parsePerfumerChatIntent,
  parsePerfumerFeedback,
  parsePerfumerPrefill,
  parsePerfumerRequest,
} from "~/lib/perfumer.schema";
import { errorMeta, seoMeta } from "~/lib/seo";
import type { Route } from "./+types/perfumer";

// The AI perfumer chat (#163): `/parfumer`, `/en/perfumer`. A 404 while the engine (#162) is off.
// The conversation is saved on the server (#180): the loader returns the visitor's or customer's
// chat, and each message posts only the new text here (or to the stream, #164).

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

/** The page shows a customer's saved chat: never cached by a shared cache. */
export function headers() {
  return { "Cache-Control": "private, no-store" };
}

/**
 * `thread`: the visitor's or customer's saved chat (#180), `null` without one. `prefill`: a
 * message from an entry point (`?q=`, #165), which the page sends once and then removes from the
 * URL. The canonical URL never has it (`seoMeta` keeps no query parameters here).
 */
export async function loader({ request }: Route.LoaderArgs) {
  requirePerfumer();
  const thread = await getPerfumerThreadView(await getPerfumerOwner(request));
  return { prefill: parsePerfumerPrefill(new URL(request.url).searchParams), thread };
}

/**
 * A form posted from the page (a cart add from a card, #169, a message, a rating, "New chat")
 * doesn't rerun the loader, so it never replaces the thread the page is showing. The `_shop`
 * loader still runs, so the cart badge updates.
 */
export const shouldRevalidate = shouldRevalidateView;

const ERROR_STATUS: Record<PerfumerErrorKey, number> = {
  tooLong: 400,
  rateLimited: 429,
  unavailable: 503,
  timeout: 504,
};

/** The answer to a rating, "New chat" or "Delete chat": `{ ok }`, never an error to read. */
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
  // Kept on the saved answer too (#180), so the page shows it after a reload.
  try {
    await ratePerfumerReply(await getPerfumerOwner(args.request), parsed.replyId, parsed.rating);
  } catch (error) {
    console.error("AI perfumer: saving the rating failed", error);
  }
  return data<PerfumerFeedbackActionResult>({ ok: true });
}

/**
 * One message: `payload` is `{ message, entry, retry? }` as JSON (#180); the conversation comes
 * from the database. `intent=feedback` rates an answer, `intent=new-chat` closes the chat and
 * `intent=delete-chat` deletes it for the customer (its rows stay until the retention job).
 */
export async function action(args: Route.ActionArgs) {
  requirePerfumer();
  const { request } = args;
  const formData = await request.formData();
  if (formData.get("intent") === "feedback") {
    return rateAnswer(args, formData);
  }
  const intent = parsePerfumerChatIntent(formData);
  if (intent) {
    const owner = await getPerfumerOwner(request);
    await (intent === "new-chat" ? startNewPerfumerChat(owner) : deletePerfumerChat(owner));
    return data<PerfumerFeedbackActionResult>({ ok: true });
  }
  const parsed = parsePerfumerRequest(formData);
  if (!parsed.ok) {
    return data<PerfumerActionResult>(
      { ok: false, error: parsed.error },
      { status: ERROR_STATUS[parsed.error] },
    );
  }
  // The visitor's id works without analytics consent, like the guest cart's (#18).
  const [locale, owner] = await Promise.all([getLocale(request), getPerfumerWriter(args)]);
  const { result, event } = await answerPerfumerMessage({
    locale,
    owner,
    message: parsed.message,
    entry: parsed.entry,
    retry: parsed.retry,
    ipKey: getClientIp(request),
    signal: request.signal,
  });
  // One event per message (#166), with analytics consent; never any text.
  void trackEvent(args, "perfumer_message", { properties: event });
  return data<PerfumerActionResult>(result, {
    status: result.ok ? 200 : ERROR_STATUS[result.error],
  });
}

export default function PerfumerRoute({ loaderData }: Route.ComponentProps) {
  return <PerfumerPage prefill={loaderData.prefill} thread={loaderData.thread} />;
}
