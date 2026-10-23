import { requireAdmin } from "~/.server/services/auth";
import { AdminPlaceholder } from "~/features/admin/AdminPlaceholder";
import type { Route } from "./+types/admin.orders";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Orders — Jassmin admin" }, { name: "robots", content: "noindex" }];
}

// Placeholder until #17. Its loader and every action it adds must start with `requireAdmin`.
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return null;
}

export default function AdminOrders() {
  return <AdminPlaceholder title="Orders" issue={17} />;
}
