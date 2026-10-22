import type { HeaderState } from "~/lib/header";
import { getSession } from "../session";

/** Who is logged in and how many items are in their cart, for the shop header. */
export async function getHeaderState(request: Request): Promise<HeaderState> {
  const session = await getSession(request.headers.get("Cookie"));
  // Stub until #9: trust the session's userId instead of loading the user.
  const userId = session.get("userId");
  // Stub until #10: count the active cart's items.
  const cartCount = 0;

  return { user: userId ? { id: userId } : null, cartCount };
}
