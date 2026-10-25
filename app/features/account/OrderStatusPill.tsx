import { isCurrentOrder } from "~/lib/account";
import { cn } from "~/lib/cn";
import type { OrderStatus } from "~/lib/enums";
import { useT } from "~/lib/i18n";

/** Pill colours from the theme tokens: current orders pink, delivered green, the rest neutral. */
function pillTone(status: OrderStatus): string {
  if (isCurrentOrder(status)) return "bg-primary text-white";
  if (status === "completed") return "bg-success-bg text-success";
  return "bg-card text-body";
}

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const { t } = useT();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-pill px-4 py-1.5 text-sm font-extrabold",
        pillTone(status),
      )}
    >
      {t(`account.status.${status}`)}
    </span>
  );
}
