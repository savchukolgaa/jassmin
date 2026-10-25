import { data, Link, redirect } from "react-router";
import { trackEvent } from "~/.server/analytics";
import { getLocale } from "~/.server/locale";
import { getActiveCartId, getCartOwner, getCartView } from "~/.server/services/cart";
import {
  createOrder,
  deliverOrderConfirmation,
  getCheckoutPrefill,
} from "~/.server/services/orders";
import { isCardPaymentAvailable, startPayment } from "~/.server/services/payments";
import { rememberOrder } from "~/.server/session";
import { focusRing } from "~/components/layout/nav";
import { CheckoutForm } from "~/features/checkout/CheckoutForm";
import { OrderSummary } from "~/features/checkout/OrderSummary";
import { toFieldErrors } from "~/lib/auth";
import {
  CHECKOUT_FIELDS,
  type CheckoutFormErrors,
  cartSummaryLine,
  checkoutValues,
  freeShippingInfo,
  parseCheckout,
} from "~/lib/checkout";
import { cn } from "~/lib/cn";
import { type Locale, metaTranslator, useT } from "~/lib/i18n";
import type { Route } from "./+types/checkout";

export function meta({ matches }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  return [{ title: t("meta.title", { page: t("checkout.title") }) }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const owner = await getCartOwner(request);
  const cart = await getCartView(owner);
  // The cart page explains sold-out and low-stock lines; checkout only starts without them.
  if (cart.lines.length === 0 || cart.lines.some((line) => line.quantity > line.stockQuantity)) {
    throw redirect("/cart");
  }
  // Not awaited: the page doesn't wait for tracking (#18). A failed submit (4xx) doesn't revalidate
  // this loader, so it records once per visit to the page.
  void trackEvent({ request, context }, "checkout_start", {
    properties: {
      subtotal: cart.subtotal,
      itemCount: cart.itemCount,
      discountAmount: cart.discount?.amount ?? "0.00",
      discountCode: cart.promo?.status === "applied" ? cart.promo.code : null,
    },
  });
  const prefill = owner.userId === null ? null : await getCheckoutPrefill(owner.userId);
  return {
    cart,
    prefill,
    // Free delivery is decided on what's left after the discount (#59).
    shipping: freeShippingInfo(cart.total),
    cardPaymentAvailable: isCardPaymentAvailable(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const values = checkoutValues(formData);
  const parsed = parseCheckout(formData);
  if (!parsed.success) {
    return data<CheckoutFormErrors>(
      { fieldErrors: toFieldErrors(parsed.error, CHECKOUT_FIELDS), values },
      { status: 400 },
    );
  }

  if (parsed.data.paymentMethod === "card" && !isCardPaymentAvailable()) {
    return data<CheckoutFormErrors>(
      { fieldErrors: { paymentMethod: "checkout.errors.cardUnavailable" }, values },
      { status: 400 },
    );
  }

  const owner = await getCartOwner(request);
  const cartId = await getActiveCartId(owner);
  if (cartId === undefined) {
    return redirect("/cart");
  }
  const locale = await getLocale(request);
  const { expectedTotal, ...customer } = parsed.data;
  const result = await createOrder({
    cartId,
    userId: owner.userId,
    customer,
    locale,
    expectedTotal,
  });
  if (!result.ok) {
    if (result.error === "cart-empty") {
      return redirect("/cart");
    }
    return data<CheckoutFormErrors>(
      {
        formError:
          result.error === "total-changed"
            ? "checkout.errors.totalChanged"
            : "checkout.errors.stockChanged",
        values,
      },
      { status: 409 },
    );
  }

  // After the order's transaction committed, and only once: a double submit gets `placed: false`.
  if (result.placed) {
    // The confirmation was queued with the order (#45). Not awaited and never rejects: the
    // redirect doesn't wait for SMTP, and `pnpm db:send-order-emails` retries a failure.
    void deliverOrderConfirmation(result.orderId);
    void trackEvent({ request, context }, "purchase", {
      properties: {
        orderId: result.orderId,
        subtotal: result.subtotal,
        totalAmount: result.totalAmount,
        discountAmount: result.discountAmount,
        discountId: result.discountId,
        discountCode: result.discountCode,
        paymentMethod: parsed.data.paymentMethod,
      },
    });
  }
  const headers = { "Set-Cookie": await rememberOrder(request, result.orderId) };
  // A card order goes on to the provider's payment page (#44); also after a double submit, since
  // the browser follows the last response. `startPayment` checks the stored order, so an order
  // that is paid already, or was placed as cash on delivery, goes to its success page instead.
  if (parsed.data.paymentMethod === "card") {
    const redirectUrl = await paymentRedirect(result.orderId, locale, request);
    if (redirectUrl) {
      return redirect(redirectUrl, { headers });
    }
  }
  return redirect(`/checkout/success/${result.orderId}`, { headers });
}

/**
 * The provider page for a new payment attempt, or `null` when one can't start. The order is placed
 * either way: its success page then offers to pay again.
 */
async function paymentRedirect(
  orderId: number,
  locale: Locale,
  request: Request,
): Promise<string | null> {
  try {
    const payment = await startPayment({ orderId, locale, origin: new URL(request.url).origin });
    return payment.ok ? payment.redirectUrl : null;
  } catch (error: unknown) {
    console.error(`Could not start the payment for order ${orderId}`, error);
    return null;
  }
}

export default function Checkout({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useT();
  const { cart, prefill, shipping, cardPaymentAvailable } = loaderData;

  return (
    <main className="container mx-auto px-4 pt-10 pb-16">
      <h1 className="text-4xl font-extrabold leading-tight tracking-[-0.04em] text-ink md:text-5xl">
        {t("checkout.heading")}
      </h1>
      {actionData?.formError && (
        <p
          role="alert"
          className="mt-4 rounded-card bg-blush px-4 py-3 font-bold text-primary-dark"
        >
          {t(actionData.formError)}{" "}
          <Link to="/cart" className={cn("rounded underline", focusRing("onLight"))}>
            {t("checkout.backToCart")}
          </Link>
        </p>
      )}
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <CheckoutForm
          prefill={prefill}
          fieldErrors={actionData?.fieldErrors}
          values={actionData?.values}
          cardAvailable={cardPaymentAvailable}
          expectedTotal={cart.total}
        />
        <OrderSummary
          lines={cart.lines.map(cartSummaryLine)}
          subtotal={cart.subtotal}
          discount={cart.discount}
          // Nothing is added for delivery.
          total={cart.total}
          freeShipping={shipping.free}
          remainingForFreeShipping={shipping.free ? undefined : shipping.remaining}
        />
      </div>
      <p className="mt-6">
        <Link
          to="/cart"
          className={cn("rounded font-bold text-primary-dark underline", focusRing("onLight"))}
        >
          {t("checkout.backToCart")}
        </Link>
      </p>
    </main>
  );
}
