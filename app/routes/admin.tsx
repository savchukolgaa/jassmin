import { Link, Outlet } from "react-router";
import { getEnv } from "~/.server/env";
import { requireAdmin } from "~/.server/services/auth";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { AdminLayout } from "~/features/admin/AdminLayout";
import { strapiAdminUrl } from "~/features/admin/admin-nav";
import { describeRouteError } from "~/lib/route-error";
import type { Route } from "./+types/admin";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Admin — Jassmin" }, { name: "robots", content: "noindex" }];
}

// Guards the layout only: every nested admin loader and action must call `requireAdmin` too,
// because this loader doesn't run for child actions.
export async function loader({ request }: Route.LoaderArgs) {
  const admin = await requireAdmin(request);
  return {
    adminName: admin.fullName,
    strapiAdminUrl: strapiAdminUrl(getEnv().STRAPI_URL),
  };
}

export default function Admin({ loaderData }: Route.ComponentProps) {
  return (
    <AdminLayout {...loaderData}>
      <Outlet />
    </AdminLayout>
  );
}

// Without the sidebar, so a forbidden (403) user never sees the admin navigation.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <ErrorContent {...describeRouteError(error)}>
      <p className="mt-4">
        <Link to="/" className="font-bold text-primary-dark underline">
          Back to shop
        </Link>
      </p>
    </ErrorContent>
  );
}
