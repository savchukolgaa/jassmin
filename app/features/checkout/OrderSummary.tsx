import type { ReactNode } from "react";
import { FREE_SHIPPING_THRESHOLD, type OrderSummaryLine } from "~/lib/checkout";
import { type DiscountLine, discountLabel } from "~/lib/discounts";
import { useT } from "~/lib/i18n";
import { formatVolume } from "~/lib/products";

export interface OrderSummaryProps {
  lines: OrderSummaryLine[];
  subtotal: string;
  /** The applied discount (#59); no row without one. */
  discount?: DiscountLine | null;
  /** What a gift card pays (#125); no row without one. */
  giftCardAmount?: string | null;
  /** What is left to pay, after the discount and any gift card. */
  total: string;
  freeShipping: boolean;
  /** How much is missing for free delivery, shown as a hint at checkout. */
  remainingForFreeShipping?: string;
  /** Shown at the bottom of the summary, e.g. the checkout's gift card field. */
  children?: ReactNode;
}

/** The order's lines and amounts, on the checkout page and the order's success page. */
export function OrderSummary({
  lines,
  subtotal,
  discount,
  giftCardAmount,
  total,
  freeShipping,
  remainingForFreeShipping,
  children,
}: OrderSummaryProps) {
  const translator = useT();
  const { t, formatPrice } = translator;

  return (
    <aside
      aria-labelledby="order-summary-heading"
      className="flex flex-col gap-4 rounded-card-lg bg-blush p-6 lg:sticky lg:top-24"
    >
      <h2 id="order-summary-heading" className="text-2xl font-bold tracking-[-0.01em] text-ink">
        {t("checkout.summary")}
      </h2>
      <ul className="flex flex-col gap-3">
        {lines.map((line) => {
          const volume =
            line.volumeMl === null
              ? null
              : formatVolume({ volumeMl: line.volumeMl, packSize: line.packSize ?? 1 }, translator);
          const details = [volume, t("checkout.lineQuantity", { quantity: line.quantity })]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={line.key} className="flex justify-between gap-4">
              <div className="min-w-0">
                {line.brand && (
                  <p className="text-xs font-bold uppercase tracking-wide text-primary-dark">
                    {line.brand}
                  </p>
                )}
                <p className="font-bold text-ink">{line.title ?? t("checkout.deletedProduct")}</p>
                <p className="text-sm text-muted">{details}</p>
              </div>
              <p className="shrink-0 font-bold text-ink">{formatPrice(line.lineTotal)}</p>
            </li>
          );
        })}
      </ul>
      <dl className="flex flex-col gap-2 border-t border-line pt-4">
        <div className="flex justify-between gap-4 text-muted">
          <dt>{t("checkout.subtotal")}</dt>
          <dd>{formatPrice(subtotal)}</dd>
        </div>
        {discount && (
          <div className="flex justify-between gap-4 font-bold text-success">
            <dt>{discountLabel(discount, translator)}</dt>
            <dd className="shrink-0">−{formatPrice(discount.amount)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4 text-muted">
          <dt>{t("checkout.shipping")}</dt>
          <dd className="text-right">
            {freeShipping ? (
              <span className="font-bold text-success">{t("checkout.shippingFree")}</span>
            ) : (
              t("checkout.shippingCarrierRate")
            )}
          </dd>
        </div>
        {giftCardAmount && Number(giftCardAmount) > 0 && (
          <div className="flex justify-between gap-4 font-bold text-success">
            <dt>{t("checkout.giftCard.line")}</dt>
            <dd className="shrink-0">−{formatPrice(giftCardAmount)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4 text-lg font-extrabold text-ink">
          <dt>{t("checkout.total")}</dt>
          <dd className="font-serif font-bold">{formatPrice(total)}</dd>
        </div>
      </dl>
      {!freeShipping && remainingForFreeShipping && (
        <p className="text-sm text-muted">
          {t("checkout.freeShippingHint", {
            amount: formatPrice(remainingForFreeShipping),
            threshold: formatPrice(FREE_SHIPPING_THRESHOLD),
          })}
        </p>
      )}
      {children}
    </aside>
  );
}
