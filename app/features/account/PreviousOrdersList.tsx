import { ChevronDownIcon } from "~/components/layout/icons";
import { focusRing, summaryReset } from "~/components/layout/nav";
import { ButtonLink } from "~/components/ui/ButtonLink";
import type { AccountOrder } from "~/lib/account";
import { cn } from "~/lib/cn";
import { usePathFor, useT } from "~/lib/i18n";
import { OrderLineItem } from "./OrderLineItem";
import { OrderStatusPill } from "./OrderStatusPill";

/**
 * The order history as expandable rows. `<details>` opens without JavaScript, so the items show
 * before hydration too.
 */
export function PreviousOrdersList({ orders }: { orders: AccountOrder[] }) {
  const { t, formatDate, formatPrice } = useT();
  const path = usePathFor();

  return (
    <ul className="overflow-hidden rounded-card-lg border-2 border-ink">
      {orders.map((order) => {
        const number = t("account.orders.number", { id: order.id });
        return (
          <li key={order.id} className="border-b-2 border-line last:border-b-0">
            <details className="group">
              <summary
                className={cn(
                  summaryReset,
                  focusRing("onLight"),
                  "flex min-h-19 flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3 transition-colors hover:bg-blush",
                  "focus-visible:-outline-offset-4",
                )}
              >
                <span className="min-w-36 flex-1 font-extrabold text-ink">{number}</span>
                <span className="min-w-28 flex-1 text-muted">
                  {formatDate(order.createdAt.toISOString())}
                </span>
                <span className="min-w-24 flex-1 font-serif font-bold text-ink">
                  {formatPrice(order.totalAmount)}
                </span>
                <OrderStatusPill status={order.status} />
                <ChevronDownIcon
                  aria-hidden="true"
                  className="size-5 shrink-0 text-ink motion-safe:transition-transform group-open:rotate-180"
                />
                <span className="sr-only">{t("account.orders.showItems", { id: order.id })}</span>
              </summary>
              <div className="flex flex-col gap-4 bg-blush px-6 pt-2 pb-5">
                <ul className="flex flex-col gap-3">
                  {order.lines.map((line) => (
                    <OrderLineItem key={line.key} line={line} />
                  ))}
                </ul>
                <ButtonLink
                  to={path("accountOrder", { id: String(order.id) })}
                  variant="ghost"
                  size="sm"
                  className="self-start"
                >
                  {t("account.orders.details")}
                  <span className="sr-only">: {number}</span>
                  <span aria-hidden="true">→</span>
                </ButtonLink>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
