import { useFetcher } from "react-router";
import { Button } from "~/components/ui/Button";
import type { ButtonSize } from "~/components/ui/button-styles";
import { CART_ERROR_MESSAGES, type CartActionResult } from "~/lib/cart";

export interface AddToCartFormProps {
  /** The product's public id. */
  productId: string;
  inStock: boolean;
  size?: ButtonSize;
  className?: string;
}

/** Posts `intent=add` to the cart action without navigating away. */
export function AddToCartForm({ productId, inStock, size = "md", className }: AddToCartFormProps) {
  const fetcher = useFetcher<CartActionResult>({ key: `add-to-cart-${productId}` });
  const error = fetcher.state === "idle" && fetcher.data?.ok === false ? fetcher.data.error : null;

  return (
    <fetcher.Form method="post" action="/cart" className={className}>
      <input type="hidden" name="intent" value="add" />
      <input type="hidden" name="productId" value={productId} />
      <Button
        type="submit"
        size={size}
        className="w-full"
        disabled={!inStock}
        loading={fetcher.state !== "idle"}
      >
        {inStock ? "Add to cart" : "Out of stock"}
      </Button>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-gray-600 dark:text-gray-400">
        {error ? CART_ERROR_MESSAGES[error] : null}
      </p>
    </fetcher.Form>
  );
}
