import { useId } from "react";
import { useFetcher } from "react-router";
import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";
import type { PerfumerRating } from "~/lib/perfumer";
import { CheckIcon, ThumbDownIcon, ThumbUpIcon } from "./icons";

// The rating under each perfumer answer (#166), as approved on the C+ canvas: "Was this helpful?"
// and two round 44px thumb buttons. A chosen 👍 fills pink, a chosen 👎 fills ink, so the two
// differ by more than colour; a thanks note follows. Pressing the other button changes the rating.
// Each answer posts through its own fetcher, so a rating never disturbs the chat's request.

export interface PerfumerFeedbackProps {
  replyId: string;
  /** The customer's message number this answer replied to. */
  turn: number;
  rating: PerfumerRating | undefined;
  onRate: (rating: PerfumerRating) => void;
}

const BUTTON =
  "flex size-11 cursor-pointer items-center justify-center rounded-full border-2 transition-[transform,background-color,border-color,color] duration-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary motion-safe:hover:scale-106";

export function PerfumerFeedback({ replyId, turn, rating, onRate }: PerfumerFeedbackProps) {
  const { t } = useT();
  const labelId = useId();
  const fetcher = useFetcher({ key: `perfumer-feedback-${replyId}` });

  function rate(next: PerfumerRating) {
    if (next === rating) return;
    onRate(next);
    void fetcher.submit(
      { intent: "feedback", replyId, turn: String(turn), rating: next },
      { method: "post" },
    );
  }

  const options = [
    { value: "up", label: t("perfumer.feedback.up"), Icon: ThumbUpIcon, chosen: "bg-primary" },
    { value: "down", label: t("perfumer.feedback.down"), Icon: ThumbDownIcon, chosen: "bg-ink" },
  ] as const;

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-1 pt-0.5">
      <p id={labelId} className="text-sm font-bold text-muted">
        {t("perfumer.feedback.question")}
      </p>
      <fieldset aria-labelledby={labelId} className="m-0 flex gap-2 border-0 p-0">
        {options.map(({ value, label, Icon, chosen }) => {
          const pressed = rating === value;
          return (
            <button
              key={value}
              type="button"
              aria-label={label}
              aria-pressed={pressed}
              onClick={() => rate(value)}
              className={cn(
                BUTTON,
                pressed
                  ? cn(chosen, "border-transparent text-white")
                  : "border-line bg-white text-muted hover:border-primary hover:text-primary-dark",
              )}
            >
              <Icon className="size-5" />
            </button>
          );
        })}
      </fieldset>
      <p aria-live="polite" className="text-sm font-extrabold text-success">
        {rating && (
          <span className="inline-flex items-center gap-1.5 motion-safe:animate-pop">
            <CheckIcon className="size-4" />
            {t("perfumer.feedback.thanks")}
          </span>
        )}
      </p>
    </div>
  );
}
