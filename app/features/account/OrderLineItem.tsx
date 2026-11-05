import type { AccountOrderLine } from "~/lib/account";
import { useT } from "~/lib/i18n";
import { PRODUCT_IMAGE_SIZES } from "~/lib/images";
import { formatVolume } from "~/lib/products";
import { SHOP_BOTTLE_IMAGE } from "~/lib/shop-bottle";

/**
 * The product’s photo, the shop's bottle photo when it has none (every perfume comes in the same
 * bottle, #122), or a neutral tile once the product has been deleted.
 */
export function OrderLineThumb({
  line,
  size = "md",
}: {
  line: AccountOrderLine;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "size-12 rounded-xl" : "size-13 rounded-2xl";
  const photo = `${box} shrink-0 border-2 border-white bg-white object-cover`;
  if (line.imageUrl) {
    return <img src={line.imageUrl} alt="" loading="lazy" className={photo} />;
  }
  if (line.productId && line.title !== null && line.brand !== null) {
    return (
      <img
        src={SHOP_BOTTLE_IMAGE.url}
        srcSet={SHOP_BOTTLE_IMAGE.srcSet ?? undefined}
        sizes={PRODUCT_IMAGE_SIZES.orderThumb}
        alt=""
        loading="lazy"
        decoding="async"
        className={photo}
      />
    );
  }
  return <span aria-hidden="true" className={`${box} shrink-0 border-2 border-white bg-card`} />;
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
      <p className="shrink-0 font-serif font-bold text-ink">{formatPrice(line.unitPrice)}</p>
    </li>
  );
}
