import { data, Link, redirect, type ShouldRevalidateFunctionArgs, useFetcher } from "react-router";
import { trackEvent } from "~/.server/analytics";
import { getLocale } from "~/.server/locale";
import { getClientIp, giftCardCodeLimiter } from "~/.server/rate-limit";
import {
  type CartOwner,
  getActiveCartId,
  getCartOwner,
  getCartView,
} from "~/.server/services/cart";
import { pushToCms } from "~/.server/services/cms-sync";
import { applyGiftCard, getCheckoutGiftCard, removeGiftCard } from "~/.server/services/gift-cards";
import {
  createOrder,
  deliverOrderConfirmation,
  getCheckoutPrefill,
} from "~/.server/services/orders";
import { isCardPaymentAvailable, startPayment } from "~/.server/services/payments";
import { rememberOrder } from "~/.server/session";
import { focusRing } from "~/components/layout/nav";
import { CheckoutForm } from "~/features/checkout/CheckoutForm";
import { GiftCardField } from "~/features/checkout/GiftCardField";
import { OrderSummary } from "~/features/checkout/OrderSummary";
import { toFieldErrors } from "~/lib/auth.schema";
import {
  CHECKOUT_FIELDS,
  type CheckoutFormErrors,
  cartSummaryLine,
  checkoutValues,
  freeShippingInfo,
} from "~/lib/checkout";
import { parseCheckout } from "~/lib/checkout.schema";
import { cn } from "~/lib/cn";
import {
  amountDueAfter,
  CHECKOUT_GIFT_CARD_FETCHER,
  type CheckoutGiftCardResult,
  GIFT_CARD_ERROR_KEYS,
  type GiftCardIntent,
  isGiftCardIntent,
} from "~/lib/gift-cards";
import { giftCardCodeSchema } from "~/lib/gift-cards.schema";
import { type Locale, metaTranslator, usePathFor, useT } from "~/lib/i18n";
import { crossesLocale, pathFor } from "~/lib/paths";
import { errorMeta, noindexMeta } from "~/lib/seo";
import type { Route } from "./+types/checkout";

// Private or transactional: kept out of search results (#85).
export function meta({ matches, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return noindexMeta(t("meta.title", { page: t("checkout.title") }));
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const owner = await getCartOwner(request);
  const cart = await getCartView(owner);
  // The cart page explains sold-out and low-stock lines; checkout only starts without them.
  if (cart.lines.length === 0 || cart.lines.some((line) => line.quantity > line.stockQuantity)) {
    throw redirect(pathFor(await getLocale(request), "cart"));
  }
  // Not awaited: the page doesn't wait for tracking (#18). A failed submit (4xx) doesn't revalidate
  // this loader, so it records once per visit to the page.
  void trackEvent({ request, context }, "checkout_start", {
    properties: {
      subtotal: cart.subtotal,
      item_count: cart.itemCount,
      discount_amount: cart.discount?.amount ?? "0.00",
      discount_code: cart.promo?.status === "applied" ? cart.promo.code : null,
    },
  });
  const [prefill, giftCard] = await Promise.all([
    owner.userId === null ? null : getCheckoutPrefill(owner.userId),
    getCheckoutGiftCard(owner, cart.total),
  ]);
  return {
    cart,
    prefill,
    // Free delivery is decided on what's left after the discount (#59), before the gift card.
    shipping: freeShippingInfo(cart.total),
    cardPaymentAvailable: isCardPaymentAvailable(),
    giftCard,
    // What is left to pay after the gift card (#125); the form posts it as `expectedTotal`.
    amountDue: amountDueAfter(cart.total, giftCard),
  };
}

/**
 * The gift card intents answer with the new summary themselves (`CheckoutGiftCardResult`), so
 * this loader doesn't run again for them and `checkout_start` is recorded once per visit.
 */
export function shouldRevalidate({
  formData,
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (crossesLocale({ currentUrl, nextUrl })) {
    return true;
  }
  if (isGiftCardIntent(formData?.get("intent"))) {
    return false;
  }
  return defaultShouldRevalidate;
}

/** Applies or removes the checkout's gift card (#125). */
async function giftCardAction(
  request: Request,
  formData: FormData,
  owner: CartOwner,
  intent: GiftCardIntent,
) {
  if (intent === "apply-gift-card") {
    // Refused codes count against the client, so codes can't be guessed one after another.
    const key = getClientIp(request) ?? owner.anonymousId ?? "anonymous";
    if (await giftCardCodeLimiter.isBlocked(key)) {
      return data<CheckoutGiftCardResult>(
        { ok: false, error: GIFT_CARD_ERROR_KEYS["too-many-attempts"] },
        { status: 429 },
      );
    }
    const parsed = giftCardCodeSchema.safeParse(Object.fromEntries(formData));
    const result = parsed.success
      ? await applyGiftCard(owner, parsed.data.code)
      : ({ ok: false, error: "unknown" } as const);
    if (!result.ok) {
      if (result.error === "no-cart") {
        return redirect(pathFor(await getLocale(request), "cart"));
      }
      await giftCardCodeLimiter.hit(key);
      return data<CheckoutGiftCardResult>(
        { ok: false, error: GIFT_CARD_ERROR_KEYS[result.error] },
        { status: result.error === "unknown" ? 400 : 409 },
      );
    }
  } else {
    await removeGiftCard(owner);
  }
  const cart = await getCartView(owner);
  const giftCard = await getCheckoutGiftCard(owner, cart.total);
  return data<CheckoutGiftCardResult>({
    ok: true,
    giftCard,
    amountDue: amountDueAfter(cart.total, giftCard),
  });
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (isGiftCardIntent(intent)) {
    return giftCardAction(request, formData, await getCartOwner(request), intent);
  }
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
  const locale = await getLocale(request);
  if (cartId === undefined) {
    return redirect(pathFor(locale, "cart"));
  }
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
      return redirect(pathFor(locale, "cart"));
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
    // The order and the lower stock were queued for Strapi (#40); never rejects either.
    void pushToCms();
    void trackEvent({ request, context }, "purchase", {
      properties: {
        order_id: result.orderId,
        subtotal: result.subtotal,
        total_amount: result.totalAmount,
        discount_amount: result.discountAmount,
        discount_id: result.discountId,
        discount_code: result.discountCode,
        gift_card_amount: result.giftCardAmount,
        // `gift_card` when the card paid the whole order (#125).
        payment_method: result.paymentMethod,
        // Each line's price and share of the discount, and whether it's the customer's first
        // order (#129).
        items: result.items,
        is_first_order: result.isFirstOrder,
      },
    });
  }
  const headers = { "Set-Cookie": await rememberOrder(request, result.orderId) };
  // A card order goes on to the provider's payment page (#44); also after a double submit, since
  // the browser follows the last response. `startPayment` checks the stored order, so an order
  // that is paid already, or was placed as cash on delivery, goes to its success page instead.
  // An order a gift card paid in full (#125) has nothing left to pay.
  const paymentMethod = result.placed ? result.paymentMethod : parsed.data.paymentMethod;
  if (paymentMethod === "card") {
    const redirectUrl = await paymentRedirect(result.orderId, locale, request);
    if (redirectUrl) {
      return redirect(redirectUrl, { headers });
    }
  }
  return redirect(pathFor(locale, "checkoutSuccess", { orderId: String(result.orderId) }), {
    headers,
  });
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
  const path = usePathFor();
  const { cart, prefill, shipping, cardPaymentAvailable } = loaderData;
  // The gift card form's answer, until the next load brings the same (#125).
  const giftCardFetcher = useFetcher<CheckoutGiftCardResult>({ key: CHECKOUT_GIFT_CARD_FETCHER });
  const latest = giftCardFetcher.data?.ok ? giftCardFetcher.data : null;
  const giftCard = latest ? latest.giftCard : loaderData.giftCard;
  const amountDue = latest ? latest.amountDue : loaderData.amountDue;
  const formError = actionData && "formError" in actionData ? actionData.formError : undefined;
  const formErrors = actionData && "values" in actionData ? actionData : undefined;

  return (
    <main className="container mx-auto px-4 pt-10 pb-16">
      <h1 className="text-4xl font-bold leading-tight tracking-[-0.01em] text-ink md:text-5xl">
        {t("checkout.heading")}
      </h1>
      {formError && (
        <p
          role="alert"
          className="mt-4 rounded-card bg-blush px-4 py-3 font-bold text-primary-dark"
        >
          {t(formError)}{" "}
          <Link to={path("cart")} className={cn("rounded underline", focusRing("onLight"))}>
            {t("checkout.backToCart")}
          </Link>
        </p>
      )}
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <CheckoutForm
          prefill={prefill}
          fieldErrors={formErrors?.fieldErrors}
          values={formErrors?.values}
          cardAvailable={cardPaymentAvailable}
          expectedTotal={amountDue}
          paidByGiftCard={giftCard !== null && Number(amountDue) === 0}
        />
        <OrderSummary
          lines={cart.lines.map(cartSummaryLine)}
          subtotal={cart.subtotal}
          discount={cart.discount}
          giftCardAmount={giftCard?.amount}
          // Nothing is added for delivery; the gift card comes off last.
          total={amountDue}
          freeShipping={shipping.free}
          remainingForFreeShipping={shipping.free ? undefined : shipping.remaining}
        >
          <GiftCardField giftCard={giftCard} />
        </OrderSummary>
      </div>
      <p className="mt-6">
        <Link
          to={path("cart")}
          className={cn("rounded font-bold text-primary-dark underline", focusRing("onLight"))}
        >
          {t("checkout.backToCart")}
        </Link>
      </p>
    </main>
  );
}
