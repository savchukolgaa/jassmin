import { data } from "react-router";
import { getVisitor } from "~/.server/analytics";
import {
  addItem,
  type CartChangeResult,
  getCartOwner,
  getCartView,
  removeItem,
  updateQuantity,
} from "~/.server/services/cart";
import { checkVariantForCart } from "~/.server/services/products";
import { CartLineItem } from "~/features/cart/CartLineItem";
import { CartSummary } from "~/features/cart/CartSummary";
import { EmptyCart } from "~/features/cart/EmptyCart";
import {
  type CartActionResult,
  type CartIntent,
  cartErrorMessage,
  parseCartAction,
} from "~/lib/cart";
import { metaTranslator, useT } from "~/lib/i18n";
import type { Route } from "./+types/cart";

export function meta({ matches }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  return [{ title: t("meta.title", { page: t("cart.title") }) }];
}

export async function loader({ request }: Route.LoaderArgs) {
  return getCartView(await getCartOwner(request));
}

function respond(result: CartChangeResult, intent: CartIntent, headers?: Headers) {
  if (result.ok) {
    return data<CartActionResult>({ ok: true, intent }, { headers });
  }
  return data<CartActionResult>(result, {
    status: result.error === "exceeds-stock" ? 409 : 404,
    headers,
  });
}

// Posted by `fetcher.Form`s (add-to-cart buttons, the cart page's stepper and remove buttons), or
// as a plain form without JS. The `_shop` loader revalidates afterwards, so the header badge
// updates.
export async function action({ request }: Route.ActionArgs) {
  const input = parseCartAction(await request.formData());
  if (!input.success) {
    return data<CartActionResult>({ ok: false, error: "invalid" }, { status: 400 });
  }
  const owner = await getCartOwner(request);

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
      // Only adding can create a cart, so only it needs the visitor's analytics session.
      const visitor = await getVisitor(request);
      const writer = {
        userId: owner.userId,
        anonymousId: visitor.anonymousId,
        sessionId: visitor.sessionId,
      };
      return respond(await addItem(writer, check.variant, quantity), "add", visitor.headers);
    }
    case "update":
      return respond(
        await updateQuantity(owner, input.data.variantId, input.data.quantity),
        "update",
      );
    case "remove":
      return respond(await removeItem(owner, input.data.variantId), "remove");
  }
}

export default function Cart({ loaderData: cart, actionData }: Route.ComponentProps) {
  const translator = useT();
  const { t } = translator;
  // Only set after a plain form post without JS; fetchers show their errors on the line.
  const error = actionData?.ok === false ? cartErrorMessage(actionData, translator) : null;

  return (
    <main className="container mx-auto px-4 pt-10 pb-16">
      <h1 className="text-4xl font-extrabold leading-tight tracking-[-0.04em] text-ink md:text-5xl">
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
