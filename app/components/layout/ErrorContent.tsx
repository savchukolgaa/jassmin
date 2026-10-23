import type { ReactNode } from "react";
import type { RouteErrorDescription } from "~/lib/route-error";

export type ErrorContentProps = RouteErrorDescription & {
  /** Extra content below the details, e.g. a link back to the catalog. */
  children?: ReactNode;
};

/** Page body for a route `ErrorBoundary`. */
export function ErrorContent({ message, details, stack, children }: ErrorContentProps) {
  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>{message}</h1>
      <p>{details}</p>
      {children}
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
