import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { describeRouteError } from "~/lib/route-error";
import type { Route } from "./+types/root";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
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
  return <ErrorContent {...describeRouteError(error)} />;
}
