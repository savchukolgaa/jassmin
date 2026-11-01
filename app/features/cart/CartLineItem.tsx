import { Link, useFetcher } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { productHref } from "~/features/catalog/ProductCard";
import { ProductImage } from "~/features/catalog/ProductImage";
import { type CartActionResult, type CartLine, cartErrorMessage } from "~/lib/cart";
import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";
import { formatVolume } from "~/lib/products";
import {
  cartLineFetcherKey,
  isPendingRemove,
  maxQuantity,
  optimisticQuantity,
  stockNotice,
} from "./cart-line-state";
import { QuantityStepper } from "./QuantityStepper";

/** One line of the cart page: quantity changes and removal show at once, before the server answers. */
export function CartLineItem({ line }: { line: CartLine }) {
  const translator = useT();
  const { t, formatPrice } = translator;
  const fetcher = useFetcher<CartActionResult>({ key: cartLineFetcherKey(line.variantId) });
  if (isPendingRemove(fetcher.formData)) {
    return null;
  }

  const quantity = optimisticQuantity(fetcher.formData, line.quantity);
  const href = productHref(line.productId);
  const volume = formatVolume(line, translator);
  const error =
    fetcher.state === "idle" && fetcher.data?.ok === false
      ? cartErrorMessage(fetcher.data, translator)
      : null;
  const notice = error ?? stockNotice({ quantity, stockQuantity: line.stockQuantity }, translator);

  return (
    <li className="flex gap-4 rounded-card bg-white p-3 ring-1 ring-line sm:p-4">
      <Link to={href} tabIndex={-1} aria-hidden="true" className="w-24 shrink-0 sm:w-28">
        <ProductImage
          imageUrl={line.imageUrl}
          title={line.title}
          brand={line.brand}
          className="rounded-t-full"
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-bold uppercase tracking-wide text-primary-dark">{line.brand}</p>
        <h2 className="text-xl font-bold leading-tight tracking-[-0.01em] text-ink">
          <Link to={href} className={cn("rounded hover:underline", focusRing("onLight"))}>
            {line.title}
          </Link>
        </h2>
        <p className="text-sm text-muted">
          {volume} · {t("cart.each", { price: formatPrice(line.unitPrice) })}
        </p>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-3">
          <fetcher.Form method="post" action="/cart">
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="variantId" value={line.variantId} />
            <QuantityStepper
              quantity={quantity}
              max={maxQuantity(line)}
              label={`${line.title}, ${volume}`}
            />
          </fetcher.Form>
          <p
            aria-busy={fetcher.state !== "idle" || undefined}
            className={cn(
              "font-serif text-lg font-bold text-ink transition-opacity",
              fetcher.state !== "idle" && "opacity-50",
            )}
          >
            {formatPrice(line.lineTotal)}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="min-h-5 text-sm font-bold text-primary-dark">
            {notice}
          </p>
          <fetcher.Form method="post" action="/cart">
            <input type="hidden" name="intent" value="remove" />
            <input type="hidden" name="variantId" value={line.variantId} />
            <button
              type="submit"
              aria-label={t("cart.removeItem", { item: `${line.title}, ${volume}` })}
              className={cn(
                "min-h-11 rounded-pill px-3 text-sm font-bold text-muted underline-offset-4",
                "hover:text-primary-dark hover:underline",
                focusRing("onLight"),
              )}
            >
              {t("cart.remove")}
            </button>
          </fetcher.Form>
        </div>
      </div>
    </li>
  );
}
