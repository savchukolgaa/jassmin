import { data, redirect } from "react-router";
import { getLocale } from "~/.server/locale";
import { getUser } from "~/.server/services/auth";
import { startPayment } from "~/.server/services/payments";
import { getSessionOrderIds } from "~/.server/session";
import { parseOrderId } from "~/lib/checkout";
import type { Route } from "./+types/checkout-pay";

// POST only, from the success page's "Pay" / "Try again" button (#44): starts a new payment
// attempt for a card order that is still unpaid and sends the shopper to the provider. Starting an
// attempt writes a `payments` row, so a GET (a link, a prefetch) never does. Like the success
// page, only the order's user or the browser it was placed in may use it; anyone else gets a 404.
export async function action({ request, params }: Route.ActionArgs) {
  const orderId = parseOrderId(params.orderId);
  if (orderId === null) {
    throw data(null, { status: 404 });
  }
  const [user, orderIds, locale] = await Promise.all([
    getUser(request),
    getSessionOrderIds(request),
    getLocale(request),
  ]);
  const result = await startPayment({
    orderId,
    locale,
    origin: new URL(request.url).origin,
    viewer: { userId: user?.id ?? null, orderIds },
  }).catch((error: unknown) => {
    console.error(`Could not start the payment for order ${orderId}`, error);
    return null;
  });
  if (result?.ok) {
    return redirect(result.redirectUrl);
  }
  if (result?.error === "not-found") {
    throw data(null, { status: 404 });
  }
  // Paid meanwhile, no longer payable or no provider: the success page shows where it stands.
  return redirect(`/checkout/success/${orderId}`);
}

export function loader({ params }: Route.LoaderArgs) {
  const orderId = parseOrderId(params.orderId);
  return redirect(orderId === null ? "/" : `/checkout/success/${orderId}`);
}
