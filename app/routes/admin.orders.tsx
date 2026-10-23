import { requireAdmin } from "~/.server/services/auth";
import { AdminPlaceholder } from "~/features/admin/AdminPlaceholder";
import { metaTranslator, useT } from "~/lib/i18n";
import type { Route } from "./+types/admin.orders";

export function meta({ matches }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  return [
    { title: t("admin.metaTitle", { page: t("admin.nav.orders") }) },
    { name: "robots", content: "noindex" },
  ];
}

// Placeholder until #17. Its loader and every action it adds must start with `requireAdmin`.
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return null;
}

export default function AdminOrders() {
  const { t } = useT();
  return <AdminPlaceholder title={t("admin.nav.orders")} issue={17} />;
}
