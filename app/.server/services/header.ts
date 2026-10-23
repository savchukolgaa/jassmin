import type { HeaderState } from "~/lib/header";
import { getUser } from "./auth";

/** Who is logged in and how many items are in their cart, for the shop header. */
export async function getHeaderState(request: Request): Promise<HeaderState> {
  // `null` for a stale cookie whose user no longer exists, so the header shows "Log in".
  const user = await getUser(request);
  // Stub until #10: count the active cart's items.
  const cartCount = 0;

  return { user: user ? { id: user.id } : null, cartCount };
}
