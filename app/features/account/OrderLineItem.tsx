import type { AccountOrderLine } from "~/lib/account";
import { useT } from "~/lib/i18n";
import { formatVolume } from "~/lib/products";

/** The product’s picture, or a neutral tile without one. */
export function OrderLineThumb({
  line,
  size = "md",
}: {
  line: AccountOrderLine;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "size-12 rounded-xl" : "size-13 rounded-2xl";
  return line.imageUrl ? (
    <img
      src={line.imageUrl}
      alt=""
      loading="lazy"
      className={`${box} shrink-0 border-2 border-white bg-white object-cover`}
    />
  ) : (
    <span aria-hidden="true" className={`${box} shrink-0 border-2 border-white bg-card`} />
  );
}

/** One bought line, at its `price_at_purchase`. */
export function OrderLineItem({ line }: { line: AccountOrderLine }) {
  const translator = useT();
  const { t, formatPrice } = translator;
  const volume =
    line.volumeMl === null
      ? null
      : formatVolume({ volumeMl: line.volumeMl, packSize: line.packSize ?? 1 }, translator);
  const details = [line.brand, volume, t("checkout.lineQuantity", { quantity: line.quantity })]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex items-center gap-4">
      <OrderLineThumb line={line} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="font-extrabold text-ink">{line.title ?? t("checkout.deletedProduct")}</p>
        <p className="text-sm text-muted">{details}</p>
      </div>
      <p className="shrink-0 font-extrabold text-ink">{formatPrice(line.unitPrice)}</p>
    </li>
  );
}
