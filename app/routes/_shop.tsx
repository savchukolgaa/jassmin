import { Outlet, useRouteLoaderData } from "react-router";
import { visitorMiddleware } from "~/.server/analytics-middleware";
import { getConsent } from "~/.server/consent";
import { getHeaderState } from "~/.server/services/header";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { Footer } from "~/components/layout/Footer";
import { Header } from "~/components/layout/Header";
import { useClientPageViews } from "~/features/analytics/useClientPageViews";
import { CookieBanner } from "~/features/consent/CookieBanner";
import { LOGGED_OUT_HEADER } from "~/lib/header";
import { useT } from "~/lib/i18n";
import { describeRouteError } from "~/lib/route-error";
import type { Route } from "./+types/_shop";

// Finds the analytics visitor (once they accepted cookies) and records full page loads (#18).
export const middleware: Route.MiddlewareFunction[] = [visitorMiddleware];

// Runs on every navigation and after every action, so the header (e.g. the cart badge) and the
// cookie banner stay fresh.
export async function loader({ request }: Route.LoaderArgs) {
  const [header, consent] = await Promise.all([getHeaderState(request), getConsent(request)]);
  return { header, consent };
}

/** Layout for every public page; admin pages (#14) use their own layout. */
export default function ShopLayout({ loaderData }: Route.ComponentProps) {
  const { header, consent } = loaderData;
  useClientPageViews(consent === "granted");
  return (
    <div className="flex min-h-dvh flex-col">
      <Header {...header} />
      <div className="flex-1">
        <Outlet />
      </div>
      <Footer />
      {consent === null && <CookieBanner />}
    </div>
  );
}

// Catches errors from every public page (e.g. a 404 product or the home page's CMS 503) and keeps
// the header and footer. Falls back to a logged-out header when the layout loader itself failed.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  const headerState =
    useRouteLoaderData<typeof loader>("routes/_shop")?.header ?? LOGGED_OUT_HEADER;

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
