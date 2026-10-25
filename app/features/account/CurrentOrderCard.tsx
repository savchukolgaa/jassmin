import { ButtonLink } from "~/components/ui/ButtonLink";
import type { AccountOrder } from "~/lib/account";
import { useT } from "~/lib/i18n";
import { OrderLineThumb } from "./OrderLineItem";
import { OrderProgress } from "./OrderProgress";
import { OrderStatusPill } from "./OrderStatusPill";

const MAX_THUMBS = 3;

/** An order on its way: status, progress and a link to its details (C+ Account). */
export function CurrentOrderCard({ order }: { order: AccountOrder }) {
  const { t, formatDate, formatPrice } = useT();
  const number = t("account.orders.number", { id: order.id });

  return (
    <article
      aria-labelledby={`order-${order.id}`}
      className="flex flex-col gap-6 rounded-card-lg bg-blush p-6 md:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 id={`order-${order.id}`} className="text-xl font-extrabold text-ink">
            {number}
          </h3>
          <p className="text-muted">
            {[
              t("account.orders.placedOn", { date: formatDate(order.createdAt.toISOString()) }),
              t("account.orders.items", { count: order.itemCount }),
              formatPrice(order.totalAmount),
            ].join(" · ")}
          </p>
        </div>
        <OrderStatusPill status={order.status} />
      </div>
      <OrderProgress
        status={order.status}
        dates={{ pending: order.createdAt, paid: order.paidAt }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {order.lines.slice(0, MAX_THUMBS).map((line) => (
            <OrderLineThumb key={line.key} line={line} />
          ))}
        </div>
        <ButtonLink to={`/account/orders/${order.id}`} variant="dark" size="sm">
          {t("account.orders.details")}
          <span className="sr-only">: {number}</span>
          <span aria-hidden="true">→</span>
        </ButtonLink>
      </div>
    </article>
  );
}
