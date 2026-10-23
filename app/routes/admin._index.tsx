import { redirect } from "react-router";
import { requireAdmin } from "~/.server/services/auth";
import type { Route } from "./+types/admin._index";

// `/admin` opens the product list.
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return redirect("/admin/products");
}
