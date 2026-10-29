import { useFetchers } from "react-router";
import { ButtonLink } from "~/components/ui/ButtonLink";
import type { CartView } from "~/lib/cart";
import { FREE_SHIPPING_THRESHOLD } from "~/lib/checkout";
import { cn } from "~/lib/cn";
import { discountLabel } from "~/lib/discounts";
import { createTranslator, type Translator, useT } from "~/lib/i18n";
import { CART_LINE_FETCHER_PREFIX } from "./cart-line-state";
import { PROMO_FETCHER_KEY, PromoCodeForm } from "./PromoCodeForm";

export function formatItemCount(count: number, { t }: Translator = createTranslator()): string {
  return t("cart.itemCount", { count });
}

/**
 * Item count, subtotal, the discount (#59) and what's left to pay, the promo code form and the
 * checkout button, next to the cart lines.
 */
export function CartSummary({ cart }: { cart: CartView }) {
  const translator = useT();
  const { t, formatPrice } = translator;
  // The amounts come from the server, so they're dimmed until a line or code change is saved.
  const saving = useFetchers().some(
    (f) =>
      (f.key.startsWith(CART_LINE_FETCHER_PREFIX) || f.key === PROMO_FETCHER_KEY) &&
      f.state !== "idle",
  );
  const { discount } = cart;

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
        {discount ? (
          <>
            <div className="flex justify-between gap-4 text-muted">
              <dt>{t("cart.subtotal")}</dt>
              <dd>{formatPrice(cart.subtotal)}</dd>
            </div>
            <div className="flex justify-between gap-4 font-bold text-success">
              <dt>{discountLabel(discount, translator)}</dt>
              <dd>−{formatPrice(discount.amount)}</dd>
            </div>
            <div className="flex justify-between gap-4 text-lg font-extrabold text-ink">
              <dt>{t("cart.total")}</dt>
              <dd>{formatPrice(cart.total)}</dd>
            </div>
          </>
        ) : (
          <div className="flex justify-between gap-4 text-lg font-extrabold text-ink">
            <dt>{t("cart.subtotal")}</dt>
            <dd>{formatPrice(cart.subtotal)}</dd>
          </div>
        )}
      </dl>
      <PromoCodeForm promo={cart.promo} />
      <p className="text-sm text-muted">
        {t("cart.deliveryNote", { threshold: formatPrice(FREE_SHIPPING_THRESHOLD) })}
      </p>
      <ButtonLink to="/checkout" size="lg" className="w-full">
        {t("cart.checkout")}
      </ButtonLink>
    </aside>
  );
}
