// Data the shop header needs on every page, returned by the `_shop` layout loader.

export interface HeaderUser {
  id: number;
}

export interface HeaderState {
  /** `null` when the visitor is logged out. */
  user: HeaderUser | null;
  /** Number of items in the active cart. */
  cartCount: number;
}

export const LOGGED_OUT_HEADER: HeaderState = { user: null, cartCount: 0 };

/** Text for the cart badge: empty for an empty cart, capped at "99+". */
export function formatCartCount(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}
