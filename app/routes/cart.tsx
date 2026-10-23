import { data } from "react-router";
import { checkVariantForCart } from "~/.server/services/products";
import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import { type CartActionResult, parseAddToCart } from "~/lib/cart";
import { useT } from "~/lib/i18n";
import type { Route } from "./+types/cart";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Cart — Jassmin" }];
}

// Stub until #10: validates add-to-cart submissions (product, chosen size and its stock) but
// stores nothing.
export async function action({ request }: Route.ActionArgs) {
  const input = parseAddToCart(await request.formData());
  if (!input.success) {
    return data<CartActionResult>({ ok: false, error: "invalid" }, { status: 400 });
  }
  const check = await checkVariantForCart(input.data.productId, input.data.variantId);
  if (!check.ok) {
    return data<CartActionResult>(
      { ok: false, error: check.error },
      { status: check.error === "out-of-stock" ? 409 : 400 },
    );
  }
  // #10: add `check.variant` (its `id`, `productId` and `price`) to the visitor's cart.
  return data<CartActionResult>({ ok: false, error: "cart-unavailable" });
}

// Placeholder until #10.
export default function Cart() {
  const { t } = useT();
  return <PagePlaceholder title={t("cart.title")} />;
}
