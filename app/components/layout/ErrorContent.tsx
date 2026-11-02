import type { ReactNode } from "react";
import type { RouteErrorDescription } from "~/lib/route-error";
import { NotFoundLinks } from "./NotFoundLinks";

export type ErrorContentProps = RouteErrorDescription & {
  /** Extra content below the details, e.g. a link back to the blog. */
  children?: ReactNode;
};

/**
 * Page body for a route `ErrorBoundary`: the status as a small label, the explanation as the
 * page's one `h1`, and for a missing page links to the rest of the shop (#88).
 */
export function ErrorContent({ message, details, notFound, stack, children }: ErrorContentProps) {
  return (
    <main className="container mx-auto px-4 pt-16 pb-16">
      <p className="text-sm font-bold uppercase tracking-wide text-primary-dark">{message}</p>
      <h1 className="mt-2 max-w-3xl text-4xl font-bold leading-tight tracking-[-0.01em] text-ink md:text-5xl">
        {details}
      </h1>
      {children}
      {notFound && <NotFoundLinks />}
      {stack && (
        <pre className="mt-8 w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
