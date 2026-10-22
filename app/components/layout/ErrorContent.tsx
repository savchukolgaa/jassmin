import type { RouteErrorDescription } from "~/lib/route-error";

/** Page body for a route `ErrorBoundary`. */
export function ErrorContent({ message, details, stack }: RouteErrorDescription) {
  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
