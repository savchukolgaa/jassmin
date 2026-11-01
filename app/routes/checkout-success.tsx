import { data } from "react-router";
import { getUser } from "~/.server/services/auth";
import { getOrderConfirmation } from "~/.server/services/orders";
import { getPaymentView } from "~/.server/services/payments";
import { getSessionOrderIds } from "~/.server/session";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { OrderSummary } from "~/features/checkout/OrderSummary";
import { PaymentStatus } from "~/features/checkout/PaymentStatus";
import { PAYMENT_KEYS, parseOrderId } from "~/lib/checkout";
import { metaTranslator, useT } from "~/lib/i18n";
import type { Route } from "./+types/checkout-success";

export function meta({ matches }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  return [
    { title: t("meta.title", { page: t("checkout.success.title") }) },
    { name: "robots", content: "noindex" },
  ];
}

// Only the order's user, or the browser it was placed in (its id is in the session), may see it.
// Everyone else gets a 404, so order ids can't be probed.
export async function loader({ request, params }: Route.LoaderArgs) {
  const orderId = parseOrderId(params.orderId);
  if (orderId === null) {
    throw data(null, { status: 404 });
  }
  const [user, orderIds] = await Promise.all([getUser(request), getSessionOrderIds(request)]);
  const order = await getOrderConfirmation(orderId, { userId: user?.id ?? null, orderIds });
  if (!order) {
    throw data(null, { status: 404 });
  }
  // Card orders show where their online payment stands (#44); cash on delivery has nothing to show.
  const payment = order.paymentMethod === "card" ? await getPaymentView(order.id) : null;
  return { ...order, payment };
}

export default function CheckoutSuccess({ loaderData: order }: Route.ComponentProps) {
  const { t } = useT();
  const payment = PAYMENT_KEYS[order.paymentMethod];

  return (
    <main className="container mx-auto px-4 pt-10 pb-16">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-4xl font-bold leading-tight tracking-[-0.01em] text-ink md:text-5xl">
              {t("checkout.success.heading")}
            </h1>
            <p className="text-xl font-extrabold text-primary-dark">
              {t("checkout.success.orderNumber", { id: order.id })}
            </p>
            <p className="text-body">{t("checkout.success.contactNote", { phone: order.phone })}</p>
          </div>
          <dl className="flex flex-col gap-4 rounded-card bg-white p-5 ring-1 ring-line">
            <div className="flex flex-col gap-1">
              <dt className="text-sm font-extrabold text-muted">
                {t("checkout.success.delivery")}
              </dt>
              <dd className="text-ink">
                {order.fullName}, {order.phone}
                <br />
                {order.shippingAddress}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-sm font-extrabold text-muted">{t("checkout.success.payment")}</dt>
              <dd className="text-ink">
                {t(payment.label)}
                <span className="block text-sm text-muted">{t(payment.note)}</span>
              </dd>
            </div>
          </dl>
          {order.payment && <PaymentStatus orderId={order.id} payment={order.payment} />}
          <ButtonLink to="/" size="lg" className="self-start">
            {t("checkout.success.continue")}
          </ButtonLink>
        </section>
        <OrderSummary
          lines={order.lines}
          subtotal={order.subtotal}
          discount={order.discount}
          total={order.totalAmount}
          freeShipping={order.freeShipping}
        />
      </div>
    </main>
  );
}
