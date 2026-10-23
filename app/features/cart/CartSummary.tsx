import { useFetchers } from "react-router";
import { ButtonLink } from "~/components/ui/ButtonLink";
import type { CartView } from "~/lib/cart";
import { cn } from "~/lib/cn";
import { formatPrice } from "~/lib/money";
import { CART_LINE_FETCHER_PREFIX } from "./cart-line-state";

export function formatItemCount(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

/** Item count, subtotal and the checkout button, next to the cart lines. */
export function CartSummary({ cart }: { cart: CartView }) {
  // The subtotal comes from the server, so it's dimmed until a line change has been saved.
  const saving = useFetchers().some(
    (f) => f.key.startsWith(CART_LINE_FETCHER_PREFIX) && f.state !== "idle",
  );

  return (
    <aside
      aria-labelledby="cart-summary-heading"
      className="flex flex-col gap-4 rounded-card-lg bg-blush p-6 lg:sticky lg:top-24"
    >
      <h2 id="cart-summary-heading" className="text-2xl font-extrabold tracking-[-0.03em] text-ink">
        Order summary
      </h2>
      <dl
        aria-busy={saving || undefined}
        className={cn("flex flex-col gap-2", saving && "opacity-50")}
      >
        <div className="flex justify-between gap-4 text-muted">
          <dt>Items</dt>
          <dd>{formatItemCount(cart.itemCount)}</dd>
        </div>
        <div className="flex justify-between gap-4 text-lg font-extrabold text-ink">
          <dt>Subtotal</dt>
          <dd>{formatPrice(cart.subtotal)}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted">Delivery is calculated at checkout.</p>
      <ButtonLink to="/checkout" size="lg" className="w-full">
        Proceed to checkout
      </ButtonLink>
    </aside>
  );
}
