// Optimistic and stock state of a cart line, kept apart from the components so it can be tested
// without rendering.
import { type CartLine, MAX_LINE_QUANTITY } from "~/lib/cart";

/** Prefix of every cart line's fetcher key, so the summary can tell when a line is saving. */
export const CART_LINE_FETCHER_PREFIX = "cart-line-";

export function cartLineFetcherKey(variantId: string): string {
  return `${CART_LINE_FETCHER_PREFIX}${variantId}`;
}

/** The quantity to show: the one being submitted while an update is in flight, else the saved one. */
export function optimisticQuantity(formData: FormData | undefined, saved: number): number {
  if (formData?.get("intent") !== "update") {
    return saved;
  }
  const quantity = Number(formData.get("quantity"));
  return Number.isInteger(quantity) && quantity > 0 ? quantity : saved;
}

/** Whether the line is being removed, so it can be hidden right away. */
export function isPendingRemove(formData: FormData | undefined): boolean {
  return formData?.get("intent") === "remove";
}

/** The most the stepper may go up to: the stock, capped per line. */
export function maxQuantity(line: Pick<CartLine, "stockQuantity">): number {
  return Math.max(0, Math.min(line.stockQuantity, MAX_LINE_QUANTITY));
}

/** A warning for a line whose stock has dropped since it was added, else `null`. */
export function stockNotice(line: Pick<CartLine, "quantity" | "stockQuantity">): string | null {
  if (line.stockQuantity <= 0) {
    return "This volume is now out of stock. Remove it to check out.";
  }
  if (line.quantity > line.stockQuantity) {
    return `Only ${line.stockQuantity} left. Lower the quantity to check out.`;
  }
  return null;
}
