import { Outlet, useRouteLoaderData } from "react-router";
import { getHeaderState } from "~/.server/services/header";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { Footer } from "~/components/layout/Footer";
import { Header } from "~/components/layout/Header";
import { LOGGED_OUT_HEADER } from "~/lib/header";
import { useT } from "~/lib/i18n";
import { describeRouteError } from "~/lib/route-error";
import type { Route } from "./+types/_shop";

// Runs on every navigation and after every action, so the header (e.g. the cart badge) stays fresh.
export async function loader({ request }: Route.LoaderArgs) {
  return getHeaderState(request);
}

/** Layout for every public page; admin pages (#14) use their own layout. */
export default function ShopLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header {...loaderData} />
      <div className="flex-1">
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}

// Catches errors from every public page (e.g. a 404 product or the home page's CMS 503) and keeps
// the header and footer. Falls back to a logged-out header when the layout loader itself failed.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  const headerState = useRouteLoaderData<typeof loader>("routes/_shop") ?? LOGGED_OUT_HEADER;

  return (
    <div className="flex min-h-dvh flex-col">
      <Header {...headerState} />
      <div className="flex-1">
        <ErrorContent {...describeRouteError(error, t)} />
      </div>
      <Footer />
    </div>
  );
}
