import { Button } from "~/components/ui/Button";
import { ProductListProvider } from "~/features/analytics/ProductList";
import { ProductCard } from "~/features/catalog/ProductCard";
import { useT } from "~/lib/i18n";
import {
  isRetryable,
  type PerfumerErrorKey,
  type PerfumerPick,
  type PerfumerRating,
  type ThreadItem,
} from "~/lib/perfumer";
import { AlertIcon, QuestionIcon, RetryIcon } from "./icons";
import { PerfumerFeedback } from "./PerfumerFeedback";
import { PerfumerName } from "./PerfumerName";
import { ThinkingBubble } from "./ThinkingBubble";
import { TypingText } from "./TypingText";
import type { PendingTurn } from "./usePerfumerThread";

// The conversation (#163): the customer's bubbles on the right, the perfumer's turns (intro, cards
// with reasons, question) on the left, errors and cancels, and the "choosing…" bubble last. Every
// text is a plain text node: nothing the model or the customer wrote is rendered as HTML. Each
// answer's cards are a `perfumer` product list (#166), so their impressions and clicks are tracked
// with their position, and each answer can be rated.

const LABEL = "text-xs font-extrabold tracking-[0.08em] text-primary-dark uppercase";

export interface MessageThreadProps {
  items: readonly ThreadItem[];
  pending: PendingTurn | null;
  onCancel: () => void;
  onRetry: (errorId: string) => void;
  onRate: (itemId: string, rating: PerfumerRating) => void;
}

export function MessageThread({ items, pending, onCancel, onRetry, onRate }: MessageThreadProps) {
  const { t } = useT();
  const last = items.at(-1);

  return (
    <ol
      aria-live="polite"
      aria-relevant="additions"
      aria-label={t("perfumer.threadLabel")}
      className="flex flex-col gap-6 pb-8"
    >
      {items.map((item) => {
        switch (item.role) {
          case "user":
            return <UserBubble key={item.id} text={item.text} />;
          case "perfumer":
            return (
              <PerfumerTurn
                key={item.id}
                item={item}
                onRate={(rating) => onRate(item.id, rating)}
              />
            );
          case "error":
            return (
              <ErrorBubble
                key={item.id}
                error={item.error}
                // Only the latest turn can be retried, and not while another is awaited.
                onRetry={
                  item === last && !pending && isRetryable(item.error)
                    ? () => onRetry(item.id)
                    : undefined
                }
              />
            );
          case "cancelled":
            return (
              <li key={item.id} className="flex animate-fade-up justify-center">
                <p className="rounded-pill bg-card px-4 py-2 text-center text-sm font-bold text-muted">
                  {t("perfumer.cancelled")}
                </p>
              </li>
            );
          default:
            return null;
        }
      })}
      {pending?.intro ? <StreamingTurn key={`${pending.id}-reply`} pending={pending} /> : null}
      {pending && !pending.picks && (
        <ThinkingBubble
          key={pending.id}
          onCancel={onCancel}
          steps={pending.steps}
          writing={pending.intro !== ""}
        />
      )}
    </ol>
  );
}

function UserBubble({ text }: { text: string }) {
  const { t } = useT();
  return (
    <li className="flex animate-fade-up flex-col items-end gap-1.5">
      <span className="sr-only">{t("perfumer.you")}</span>
      <p className="max-w-[min(80%,35rem)] rounded-[1.5rem_1.5rem_0.5rem_1.5rem] bg-primary px-4.5 py-3.5 font-semibold wrap-anywhere whitespace-pre-line text-white">
        {text}
      </p>
    </li>
  );
}

const INTRO_BUBBLE =
  "rounded-[0.5rem_1.5rem_1.5rem_1.5rem] border border-line bg-white px-5 py-4 text-[1.0625rem] leading-relaxed whitespace-pre-line text-ink";

/**
 * The reply while it streams (#164): the intro typing in, then the cards. `aria-busy` keeps screen
 * readers from reading it piece by piece; the finished turn that replaces it is announced whole.
 */
function StreamingTurn({ pending }: { pending: PendingTurn }) {
  return (
    <li aria-busy="true" className="flex animate-fade-up flex-col gap-3.5">
      <PerfumerName />
      <p className={INTRO_BUBBLE}>
        <TypingText text={pending.intro} />
      </p>
      {pending.picks && <PickList picks={pending.picks} />}
    </li>
  );
}

/**
 * The cards of a reply. `tracked`: a finished answer's cards are a `perfumer` product list (#166),
 * so their impressions and clicks are recorded with their position. The cards of a reply still
 * streaming aren't, so the finished turn that replaces them doesn't count them twice.
 */
function PickList({
  picks,
  tracked = false,
}: {
  picks: readonly PerfumerPick[];
  tracked?: boolean;
}) {
  const { t } = useT();
  if (picks.length === 0) return null;
  const list = (
    <ul
      aria-label={t("perfumer.picksLabel")}
      className="grid grid-cols-[repeat(auto-fill,minmax(min(18.75rem,100%),1fr))] gap-4"
    >
      {picks.map((pick, index) => (
        <li key={pick.product.id} className="flex">
          <ProductCard
            product={pick.product}
            headingLevel={3}
            purchase={false}
            listIndex={tracked ? index : undefined}
          >
            <div className="mt-3.5 flex flex-col gap-1.5 rounded-2xl bg-blush px-3.5 pt-3.5 pb-4">
              <p className={LABEL}>{t("perfumer.whyItFits")}</p>
              <p className="text-[0.9375rem] leading-normal whitespace-pre-line text-body">
                {pick.reason}
              </p>
            </div>
          </ProductCard>
        </li>
      ))}
    </ul>
  );
  if (!tracked) return list;
  return (
    <ProductListProvider listId="perfumer" productIds={picks.map((pick) => pick.product.id)}>
      {list}
    </ProductListProvider>
  );
}

function PerfumerTurn({
  item,
  onRate,
}: {
  item: Extract<ThreadItem, { role: "perfumer" }>;
  onRate: (rating: PerfumerRating) => void;
}) {
  const { t } = useT();
  const { reply, replyId } = item;
  return (
    <li className="flex animate-fade-up flex-col gap-3.5">
      <PerfumerName />
      <p className={INTRO_BUBBLE}>{reply.intro}</p>
      <PickList picks={reply.picks} tracked />
      {reply.question && (
        <div className="flex items-start gap-3 rounded-card border-2 border-primary bg-blush px-5 py-4">
          <QuestionIcon className="mt-0.5 size-5.5 flex-none text-primary-dark" />
          <div className="flex flex-col gap-1">
            <p className={LABEL}>{t("perfumer.questionLabel")}</p>
            <p className="text-[1.0625rem] leading-normal font-semibold whitespace-pre-line text-ink">
              {reply.question}
            </p>
          </div>
        </div>
      )}
      {replyId && (
        <PerfumerFeedback
          replyId={replyId}
          turn={item.turn ?? 1}
          rating={item.rating}
          onRate={onRate}
        />
      )}
    </li>
  );
}

function ErrorBubble({ error, onRetry }: { error: PerfumerErrorKey; onRetry?: () => void }) {
  const { t } = useT();
  return (
    <li className="flex animate-fade-up flex-col items-start gap-3 rounded-[0.5rem_1.5rem_1.5rem_1.5rem] border border-line bg-blush px-5 py-4.5">
      <p className="flex items-start gap-3 font-semibold text-ink">
        <AlertIcon className="mt-0.5 size-5.5 flex-none text-primary-dark" />
        {t(`perfumer.errors.${error}`)}
      </p>
      {onRetry && (
        <Button type="button" size="sm" onClick={onRetry}>
          <RetryIcon className="size-4.5" />
          {t("perfumer.retry")}
        </Button>
      )}
    </li>
  );
}
