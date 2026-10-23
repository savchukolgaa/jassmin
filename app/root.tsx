import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";
import { getLocale } from "~/.server/locale";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { DEFAULT_LOCALE, I18nProvider, useT } from "~/lib/i18n";
import { describeRouteError } from "~/lib/route-error";
import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&display=swap",
  },
];

// Runs on every request and after every action, so switching language (`routes/locale.ts`)
// re-renders the page in the new locale.
export async function loader({ request }: Route.LoaderArgs) {
  return { locale: await getLocale(request) };
}

export function Layout({ children }: { children: React.ReactNode }) {
  // `undefined` when the root loader failed; the error page then renders in the default locale.
  const locale = useRouteLoaderData<typeof loader>("root")?.locale ?? DEFAULT_LOCALE;

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <Meta />
        <Links />
      </head>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

// Errors in public pages are caught by the `_shop` layout's boundary (which keeps the header);
// this one handles unmatched URLs, the admin area and failures of the layout loader itself.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  return <ErrorContent {...describeRouteError(error, t)} />;
}
