import { useEffect, useState } from "react";
import { focusRing } from "~/components/layout/nav";
import { cn } from "~/lib/cn";
import { type TextKey, useT } from "~/lib/i18n";
import { PerfumerName } from "./PerfumerName";

/** The cancel button appears after this long, once a slow answer is likely (#163). */
export const CANCEL_AFTER_MS = 10_000;

/** How often the hint under "choosing…" changes. */
export const HINT_EVERY_MS = 4_000;

const HINTS = [
  "perfumer.hints.search",
  "perfumer.hints.notes",
  "perfumer.hints.stock",
  "perfumer.hints.choose",
] as const satisfies readonly TextKey[];

/**
 * The perfumer's "choosing…" turn while a reply is awaited: three bouncing dots (only with motion
 * allowed), a hint that changes every 4 s (as text, so it also changes with reduced motion) and,
 * after 10 s, a cancel button. Re-keyed per message, so its timers restart.
 */
export function ThinkingBubble({ onCancel }: { onCancel: () => void }) {
  const { t } = useT();
  const [hint, setHint] = useState(0);
  const [canCancel, setCanCancel] = useState(false);

  useEffect(() => {
    const hints = setInterval(() => setHint((n) => (n + 1) % HINTS.length), HINT_EVERY_MS);
    const cancel = setTimeout(() => setCanCancel(true), CANCEL_AFTER_MS);
    return () => {
      clearInterval(hints);
      clearTimeout(cancel);
    };
  }, []);

  return (
    <li className="flex animate-pop flex-col items-start gap-2.5">
      <PerfumerName />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[0.5rem_1.5rem_1.5rem_1.5rem] border border-line bg-white px-5 py-4">
        <span aria-hidden="true" className="inline-flex h-6 items-center gap-1.5">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className={cn(
                "size-2.25 rounded-full bg-primary motion-safe:animate-dot",
                dot === 1 && "[animation-delay:150ms]",
                dot === 2 && "[animation-delay:300ms]",
              )}
            />
          ))}
        </span>
        <div role="status" className="flex flex-col gap-0.5">
          <p className="font-extrabold text-ink">{t("perfumer.thinking")}</p>
          <p className="text-sm font-semibold text-muted">
            {t(HINTS[hint] ?? HINTS[0])} · {t("perfumer.usually")}
          </p>
        </div>
        {canCancel && (
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              "inline-flex min-h-11 animate-pop items-center rounded-pill border-2 border-line bg-white px-4.5",
              "font-extrabold text-primary-dark transition-colors hover:border-primary",
              focusRing("onLight"),
            )}
          >
            {t("perfumer.cancel")}
          </button>
        )}
      </div>
    </li>
  );
}
