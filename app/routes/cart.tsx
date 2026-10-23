import { data } from "react-router";
import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import { type CartActionResult, parseAddToCart } from "~/lib/cart";
import type { Route } from "./+types/cart";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Cart — Jassmin" }];
}

// Stub until #10: validates add-to-cart submissions from the catalog (#8) but stores nothing.
export async function action({ request }: Route.ActionArgs) {
  const input = parseAddToCart(await request.formData());
  if (!input.success) {
    return data<CartActionResult>({ ok: false, error: "invalid" }, { status: 400 });
  }
  return data<CartActionResult>({ ok: false, error: "cart-unavailable" });
}

// Placeholder until #10.
export default function Cart() {
  return <PagePlaceholder title="Cart" />;
}
