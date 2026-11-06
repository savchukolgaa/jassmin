import { data } from "react-router";
import { ensureVisitor, type RequestArgs, trackEvent } from "~/.server/analytics";
import { getClientIp, promoCodeLimiter } from "~/.server/rate-limit";
import {
  addItem,
  applyPromoCode,
  type CartChangeResult,
  getCartOwner,
  getCartView,
  removeItem,
  removePromoCode,
  updateQuantity,
} from "~/.server/services/cart";
import { checkVariantForCart } from "~/.server/services/products";
import { CartLineItem } from "~/features/cart/CartLineItem";
import { CartSummary } from "~/features/cart/CartSummary";
import { EmptyCart } from "~/features/cart/EmptyCart";
import { type CartActionResult, type CartIntent, cartErrorMessage } from "~/lib/cart";
import { parseCartAction } from "~/lib/cart.schema";
import { metaTranslator, useT } from "~/lib/i18n";
import { errorMeta, noindexMeta } from "~/lib/seo";
import type { Route } from "./+types/cart";

// Private or transactional: kept out of search results (#85).
export function meta({ matches, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return noindexMeta(t("meta.title", { page: t("cart.title") }));
}

export async function loader({ request }: Route.LoaderArgs) {
  return getCartView(await getCartOwner(request));
}

function respond(result: CartChangeResult, intent: CartIntent) {
  if (result.ok) {
    return data<CartActionResult>({ ok: true, intent });
  }
  return data<CartActionResult>(result, { status: result.error === "exceeds-stock" ? 409 : 404 });
}

// Records `add_to_cart` / `remove_from_cart` (#18) for a change that moved the quantity; the
// stepper's +/− count too, marked `source: "stepper"`. Not awaited: the cart doesn't wait.
function trackChange(
  args: RequestArgs,
  result: CartChangeResult,
  variantId: string,
  source?: "stepper",
) {
  if (!result.ok || result.change.quantityDelta === 0) {
    return;
  }
  const { productId, volumeMl, quantityDelta } = result.change;
  void trackEvent(args, quantityDelta > 0 ? "add_to_cart" : "remove_from_cart", {
    productId,
    properties: {
      variantId,
      volumeMl,
      quantity: Math.abs(quantityDelta),
      ...(source && { source }),
    },
  });
}

// Posted by `fetcher.Form`s (add-to-cart buttons, the cart page's stepper and remove buttons), or
// as a plain form without JS. The `_shop` loader revalidates afterwards, so the header badge
// updates.
export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const input = parseCartAction(formData);
  if (!input.success) {
    // A malformed code reads as an unknown one.
    const error = formData.get("intent") === "apply-promo" ? "promo-invalid" : "invalid";
    return data<CartActionResult>({ ok: false, error }, { status: 400 });
  }
  const owner = await getCartOwner(request);
  const args = { request, context };

  switch (input.data.intent) {
    case "add": {
      const { productId, variantId, quantity } = input.data;
      const check = await checkVariantForCart(productId, variantId);
      if (!check.ok) {
        return data<CartActionResult>(
          { ok: false, error: check.error },
          { status: check.error === "out-of-stock" ? 409 : 400 },
        );
      }
      // Only adding can create a cart, so only it needs the visitor's analytics session (even
      // without analytics consent: the guest cart hangs off it). The `_shop` middleware sends the
      // visitor cookies.
      const visitor = await ensureVisitor(args);
      const writer = {
        userId: owner.userId,
        anonymousId: visitor.anonymousId,
        sessionId: visitor.sessionId,
      };
      const result = await addItem(writer, check.variant, quantity);
      trackChange(args, result, variantId);
      return respond(result, "add");
    }
    case "update": {
      const { variantId, quantity } = input.data;
      const result = await updateQuantity(owner, variantId, quantity);
      trackChange(args, result, variantId, "stepper");
      return respond(result, "update");
    }
    case "remove": {
      const result = await removeItem(owner, input.data.variantId);
      trackChange(args, result, input.data.variantId);
      return respond(result, "remove");
    }
    case "apply-promo": {
      // Refused codes count against the client, so codes can't be guessed one after another.
      const key = getClientIp(request) ?? owner.anonymousId ?? "anonymous";
      if (await promoCodeLimiter.isBlocked(key)) {
        return data<CartActionResult>({ ok: false, error: "promo-rate-limited" }, { status: 429 });
      }
      const result = await applyPromoCode(owner, input.data.code);
      if (!result.ok) {
        await promoCodeLimiter.hit(key);
        return data<CartActionResult>(result, {
          status: result.error === "promo-invalid" ? 400 : 409,
        });
      }
      return data<CartActionResult>({ ok: true, intent: "apply-promo" });
    }
    case "remove-promo": {
      await removePromoCode(owner);
      return data<CartActionResult>({ ok: true, intent: "remove-promo" });
    }
  }
}

export default function Cart({ loaderData: cart, actionData }: Route.ComponentProps) {
  const translator = useT();
  const { t } = translator;
  // Only set after a plain form post without JS; fetchers show their errors on the line.
  const error = actionData?.ok === false ? cartErrorMessage(actionData, translator) : null;

  return (
    <main className="container mx-auto px-4 pt-10 pb-16">
      <h1 className="text-4xl font-bold leading-tight tracking-[-0.01em] text-ink md:text-5xl">
        {t("cart.heading")}
      </h1>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-card bg-blush px-4 py-3 font-bold text-primary-dark"
        >
          {error}
        </p>
      )}
      {cart.lines.length === 0 ? (
        <EmptyCart />
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <ul aria-label={t("cart.lines")} className="flex flex-col gap-4">
            {cart.lines.map((line) => (
              <CartLineItem key={line.variantId} line={line} />
            ))}
          </ul>
          <CartSummary cart={cart} />
        </div>
      )}
    </main>
  );
}
