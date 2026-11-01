import { data, Link } from "react-router";
import { requireUser } from "~/.server/services/auth";
import { getAccountOrder } from "~/.server/services/orders";
import { focusRing } from "~/components/layout/nav";
import { OrderProgress } from "~/features/account/OrderProgress";
import { OrderStatusPill } from "~/features/account/OrderStatusPill";
import { OrderSummary } from "~/features/checkout/OrderSummary";
import { isCurrentOrder } from "~/lib/account";
import { PAYMENT_KEYS, parseOrderId } from "~/lib/checkout";
import { cn } from "~/lib/cn";
import { metaTranslator, type TextKey, useT } from "~/lib/i18n";
import { errorMeta, noindexMeta } from "~/lib/seo";
import type { Route } from "./+types/account.orders.$id";

// Private: kept out of search results (#85).
export function meta({ matches, loaderData, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  const page = loaderData ? t("account.order.title", { id: loaderData.id }) : t("account.title");
  return noindexMeta(t("meta.title", { page }));
}

// Only the order's user may see it; anyone else gets a 404, so order ids can't be probed.
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const orderId = parseOrderId(params.id);
  if (orderId === null) {
    throw data(null, { status: 404 });
  }
  const order = await getAccountOrder(user.id, orderId);
  if (!order) {
    throw data(null, { status: 404 });
  }
  return order;
}

export default function AccountOrder({ loaderData: order }: Route.ComponentProps) {
  const { t, formatDate } = useT();
  const payment = PAYMENT_KEYS[order.paymentMethod];
  const timeline: [TextKey, Date | null][] = [
    ["account.order.placedAt", order.createdAt],
    ["account.order.paidAt", order.paidAt],
    ["account.order.shippedAt", order.shippedAt],
    ["account.order.completedAt", order.completedAt],
    ["account.order.cancelledAt", order.cancelledAt],
    ["account.order.refundedAt", order.refundedAt],
  ];

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
      <section aria-labelledby="order-heading" className="flex flex-col gap-6">
        <Link
          to="/account"
          className={cn(
            "self-start rounded-pill font-extrabold text-primary-dark hover:underline",
            focusRing("onLight"),
          )}
        >
          <span aria-hidden="true">← </span>
          {t("account.order.back")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2
            id="order-heading"
            className="text-3xl font-bold tracking-[-0.01em] text-ink md:text-4xl"
          >
            {t("account.order.title", { id: order.id })}
          </h2>
          <OrderStatusPill status={order.status} />
        </div>
        {isCurrentOrder(order.status) && (
          <div className="rounded-card-lg bg-blush p-6">
            <OrderProgress
              status={order.status}
              dates={{
                pending: order.createdAt,
                paid: order.paidAt,
                shipped: order.shippedAt,
                completed: order.completedAt,
              }}
            />
          </div>
        )}
        <dl className="flex flex-col gap-4 rounded-card bg-white p-5 ring-1 ring-line">
          <div className="flex flex-col gap-1">
            <dt className="text-sm font-extrabold text-muted">{t("account.order.timeline")}</dt>
            <dd>
              <ul className="flex flex-col gap-1 text-ink">
                {timeline.map(([label, date]) =>
                  date ? (
                    <li key={label}>
                      {t(label)}: {formatDate(date.toISOString())}
                    </li>
                  ) : null,
                )}
              </ul>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-sm font-extrabold text-muted">{t("account.order.delivery")}</dt>
            <dd className="text-ink">
              {order.fullName}, {order.phone}
              <br />
              {order.shippingAddress}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-sm font-extrabold text-muted">{t("account.order.payment")}</dt>
            <dd className="text-ink">{t(payment.label)}</dd>
          </div>
        </dl>
      </section>
      <OrderSummary
        lines={order.lines}
        subtotal={order.subtotal}
        discount={order.discount}
        total={order.totalAmount}
        freeShipping={order.freeShipping}
      />
    </div>
  );
}
