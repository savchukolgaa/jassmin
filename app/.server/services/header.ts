import type { HeaderState } from "~/lib/header";
import { readVisitor } from "../analytics";
import { getUser } from "./auth";
import { getCartCount } from "./cart";

/** Who is logged in and how many items are in their cart, for the shop header. */
export async function getHeaderState(request: Request): Promise<HeaderState> {
  // `null` for a stale cookie whose user no longer exists, so the header shows "Log in".
  const [user, visitor] = await Promise.all([getUser(request), readVisitor(request)]);
  const cartCount = await getCartCount({ userId: user?.id ?? null, ...visitor });

  return { user: user ? { id: user.id } : null, cartCount };
}
