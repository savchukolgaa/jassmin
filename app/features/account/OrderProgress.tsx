import { ORDER_PROGRESS_STEPS, type OrderProgressStep, orderProgressIndex } from "~/lib/account";
import { cn } from "~/lib/cn";
import type { OrderStatus } from "~/lib/enums";
import { useT } from "~/lib/i18n";

export interface OrderProgressProps {
  status: OrderStatus;
  /** When a step was reached; steps without a date show none. */
  dates?: Partial<Record<OrderProgressStep, Date | null>>;
}

/**
 * The pending → paid → shipped → completed indicator on a current order. Each step's state is
 * also given as text (not only colour), and the current one has `aria-current="step"`.
 */
export function OrderProgress({ status, dates = {} }: OrderProgressProps) {
  const { t, formatDate } = useT();
  const current = orderProgressIndex(status);
  if (current < 0) return null;
  const percent = (current / (ORDER_PROGRESS_STEPS.length - 1)) * 100;

  return (
    <div className="relative px-3">
      <div aria-hidden="true" className="absolute inset-x-12 top-3 h-1 rounded-full bg-line">
        <div
          className="h-1 rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-700"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ol aria-label={t("account.progress.label")} className="relative flex justify-between">
        {ORDER_PROGRESS_STEPS.map((step, index) => {
          const done = index < current;
          const now = index === current;
          const date = dates[step];
          return (
            <li
              key={step}
              aria-current={now ? "step" : undefined}
              className="flex w-20 flex-col items-center gap-2 text-center"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6.5 items-center justify-center rounded-full border-3 text-xs font-extrabold text-white",
                  done && "border-primary bg-primary",
                  now && "border-primary bg-white",
                  !done && !now && "border-line bg-white",
                )}
              >
                {done && "✓"}
              </span>
              <span
                className={cn(
                  "text-sm",
                  now ? "font-extrabold text-ink" : done ? "font-semibold text-ink" : "text-muted",
                )}
              >
                {t(`account.status.${step}`)}
                {(done || now) && (
                  <span className="sr-only">
                    {" "}
                    ({t(done ? "account.progress.done" : "account.progress.current")})
                  </span>
                )}
              </span>
              {date && (done || now) && (
                <span className="text-xs text-muted">{formatDate(date.toISOString())}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
