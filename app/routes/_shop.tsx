import { Outlet, useRouteLoaderData } from "react-router";
import { visitorMiddleware } from "~/.server/analytics-middleware";
import { getSocialLinks } from "~/.server/cms/social";
import { getConsent } from "~/.server/consent";
import { getLocale, shouldSuggestEnglish } from "~/.server/locale";
import { getHeaderState } from "~/.server/services/header";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { Footer } from "~/components/layout/Footer";
import { Header } from "~/components/layout/Header";
import { LanguageHint } from "~/components/layout/LanguageHint";
import { TrackingProvider } from "~/features/analytics/tracking";
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
// `suggestEnglish`: offer "View in English" to a browser that prefers it on a Ukrainian page (#84).
// `socialLinks`: the footer's and mobile menu's icons, cached for a minute and `[]` while Strapi is
// down, so they never slow down or fail a page (#101).
export async function loader({ request }: Route.LoaderArgs) {
  const [header, consent, suggestEnglish, socialLinks] = await Promise.all([
    getHeaderState(request),
    getConsent(request),
    shouldSuggestEnglish(request),
    getLocale(request).then(getSocialLinks),
  ]);
  return { header, consent, suggestEnglish, socialLinks };
}

/** Layout for every page. Products and orders are managed in the Strapi admin (#40). */
export default function ShopLayout({ loaderData }: Route.ComponentProps) {
  const { header, consent, suggestEnglish, socialLinks } = loaderData;
  const tracking = consent === "granted";
  useClientPageViews(tracking);
  return (
    <TrackingProvider enabled={tracking}>
      <div className="flex min-h-dvh flex-col">
        {suggestEnglish && <LanguageHint />}
        <Header {...header} socialLinks={socialLinks} />
        <div className="flex-1">
          <Outlet />
        </div>
        <Footer socialLinks={socialLinks} />
        {consent === null && <CookieBanner />}
      </div>
    </TrackingProvider>
  );
}

// Catches errors from every public page (e.g. a 404 product or the home page's CMS 503) and keeps
// the header and footer. Falls back to a logged-out header when the layout loader itself failed.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  const layoutData = useRouteLoaderData<typeof loader>("routes/_shop");
  const headerState = layoutData?.header ?? LOGGED_OUT_HEADER;
  const socialLinks = layoutData?.socialLinks ?? [];

  return (
    <div className="flex min-h-dvh flex-col">
      <Header {...headerState} socialLinks={socialLinks} />
      <div className="flex-1">
        <ErrorContent {...describeRouteError(error, t)} />
      </div>
      <Footer socialLinks={socialLinks} />
    </div>
  );
}
