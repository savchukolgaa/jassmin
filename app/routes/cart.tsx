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
import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import { type CartActionResult, type CartIntent, parseCartAction } from "~/lib/cart";
import type { Route } from "./+types/cart";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Cart — Jassmin" }];
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

// Replaced by the cart page in the next step.
export default function Cart() {
  return <PagePlaceholder title="Cart" />;
}
