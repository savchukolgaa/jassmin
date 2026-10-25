import { data, Link, redirect } from "react-router";
import { trackEvent } from "~/.server/analytics";
import { getLocale } from "~/.server/locale";
import { getActiveCartId, getCartOwner, getCartView } from "~/.server/services/cart";
import { deliverOrderEmails } from "~/.server/services/order-email";
import { createOrder, getCheckoutPrefill } from "~/.server/services/orders";
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
import { metaTranslator, useT } from "~/lib/i18n";
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
    properties: { subtotal: cart.subtotal, itemCount: cart.itemCount },
  });
  const prefill = owner.userId === null ? null : await getCheckoutPrefill(owner.userId);
  return { cart, prefill, shipping: freeShippingInfo(cart.subtotal) };
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

  const owner = await getCartOwner(request);
  const cartId = await getActiveCartId(owner);
  if (cartId === undefined) {
    return redirect("/cart");
  }
  const result = await createOrder({
    cartId,
    userId: owner.userId,
    customer: parsed.data,
    locale: await getLocale(request),
  });
  if (!result.ok) {
    if (result.error === "cart-empty") {
      return redirect("/cart");
    }
    return data<CheckoutFormErrors>(
      { formError: "checkout.errors.stockChanged", values },
      { status: 409 },
    );
  }

  // After the order's transaction committed, and only once: a double submit gets `placed: false`.
  if (result.placed) {
    // The confirmation was queued with the order (#45). Not awaited and never rejects: the
    // redirect doesn't wait for SMTP, and `pnpm db:send-order-emails` retries a failure.
    void deliverOrderEmails({ orderId: result.orderId });
    void trackEvent({ request, context }, "purchase", {
      properties: {
        orderId: result.orderId,
        subtotal: result.subtotal,
        paymentMethod: parsed.data.paymentMethod,
      },
    });
  }
  return redirect(`/checkout/success/${result.orderId}`, {
    headers: { "Set-Cookie": await rememberOrder(request, result.orderId) },
  });
}

export default function Checkout({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useT();
  const { cart, prefill, shipping } = loaderData;

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
        />
        <OrderSummary
          lines={cart.lines.map(cartSummaryLine)}
          subtotal={cart.subtotal}
          // Nothing is added for delivery or taken off as a discount yet.
          total={cart.subtotal}
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
