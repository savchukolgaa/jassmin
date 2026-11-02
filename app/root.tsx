import manropeCyrillic from "@fontsource-variable/manrope/files/manrope-cyrillic-wght-normal.woff2?url";
import playfairCyrillic from "@fontsource-variable/playfair-display/files/playfair-display-cyrillic-wght-normal.woff2?url";
import {
  type LinkDescriptor,
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
import { localeRedirectMiddleware } from "~/.server/locale-middleware";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { DEFAULT_LOCALE, I18nProvider, useT } from "~/lib/i18n";
import { localeFromPath } from "~/lib/paths";
import { describeRouteError } from "~/lib/route-error";
import { errorMeta } from "~/lib/seo";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";

/**
 * The font files above the fold in Ukrainian, the default language (#88): preloaded so text
 * doesn't wait for the stylesheet to find them. The fonts themselves come from `app.css`.
 */
const PRELOADED_FONTS = [manropeCyrillic, playfairCyrillic];

/**
 * The stylesheet has a `precedence`, so React 19 puts it in the `<head>` before the route modules'
 * `modulepreload` links (#96). Without one it comes after all of them, and the only
 * render-blocking request of the page starts last, competing with the JS for bandwidth.
 */
export const links: Route.LinksFunction = () => [
  ...PRELOADED_FONTS.map(
    (href): LinkDescriptor => ({
      rel: "preload",
      href,
      as: "font",
      type: "font/woff2",
      crossOrigin: "anonymous",
    }),
  ),
  { rel: "stylesheet", href: stylesheet, precedence: "default" },
];

// Sends visitors who chose English from Ukrainian pages to the English ones (#84).
export const middleware: Route.MiddlewareFunction[] = [localeRedirectMiddleware];

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
