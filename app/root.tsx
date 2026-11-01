import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  type ShouldRevalidateFunctionArgs,
  useRouteLoaderData,
} from "react-router";
import { getEnv, getSiteUrl } from "~/.server/env";
import { getLocale } from "~/.server/locale";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { DEFAULT_LOCALE, I18nProvider, useT } from "~/lib/i18n";
import { localeFromPath } from "~/lib/paths";
import { describeRouteError } from "~/lib/route-error";
import { errorMeta } from "~/lib/seo";
import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&family=Playfair+Display:wght@600..700&display=swap",
  },
];

// The page's locale comes from its URL (#84). Runs on every request, after every action and
// whenever a navigation crosses into the other language (`shouldRevalidate`). `site.url` is the
// public origin for canonical and Open Graph URLs (#85), read by `seoMeta` in every route's `meta`.
export async function loader({ request }: Route.LoaderArgs) {
  return { locale: await getLocale(request), site: { url: getSiteUrl(getEnv(), request) } };
}

// Only unmatched URLs and failures above the shop layout end here: every page has its own `meta`.
export function meta({ matches, error }: Route.MetaArgs) {
  return error ? errorMeta({ matches, error }) : [];
}

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return (
    localeFromPath(currentUrl.pathname) !== localeFromPath(nextUrl.pathname) ||
    defaultShouldRevalidate
  );
}

const JS_CLASS_SCRIPT = 'document.documentElement.classList.add("js")';

export function Layout({ children }: { children: React.ReactNode }) {
  // `undefined` when the root loader failed; the error page then renders in the default locale.
  const locale = useRouteLoaderData<typeof loader>("root")?.locale ?? DEFAULT_LOCALE;

  return (
    // The inline script changes the class before React hydrates.
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        {/* Marks pages where JS runs, before first paint: product cards show a price skeleton
            until hydration there, and their "from" price without JS (#74). */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant, no user input; a text child would be HTML-escaped.
          dangerouslySetInnerHTML={{ __html: JS_CLASS_SCRIPT }}
        />
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
// this one handles unmatched URLs, resource routes and failures of the layout loader itself.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  return <ErrorContent {...describeRouteError(error, t)} />;
}
