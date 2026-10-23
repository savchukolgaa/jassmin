import { useFetchers } from "react-router";
import { ButtonLink } from "~/components/ui/ButtonLink";
import type { CartView } from "~/lib/cart";
import { cn } from "~/lib/cn";
import { createTranslator, type Translator, useT } from "~/lib/i18n";
import { CART_LINE_FETCHER_PREFIX } from "./cart-line-state";

export function formatItemCount(count: number, { t }: Translator = createTranslator()): string {
  return t("cart.itemCount", { count });
}

/** Item count, subtotal and the checkout button, next to the cart lines. */
export function CartSummary({ cart }: { cart: CartView }) {
  const translator = useT();
  const { t, formatPrice } = translator;
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
        {t("cart.summary")}
      </h2>
      <dl
        aria-busy={saving || undefined}
        className={cn("flex flex-col gap-2", saving && "opacity-50")}
      >
        <div className="flex justify-between gap-4 text-muted">
          <dt>{t("cart.itemsLabel")}</dt>
          <dd>{formatItemCount(cart.itemCount, translator)}</dd>
        </div>
        <div className="flex justify-between gap-4 text-lg font-extrabold text-ink">
          <dt>{t("cart.subtotal")}</dt>
          <dd>{formatPrice(cart.subtotal)}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted">{t("cart.deliveryNote")}</p>
      <ButtonLink to="/checkout" size="lg" className="w-full">
        {t("cart.checkout")}
      </ButtonLink>
    </aside>
  );
}
