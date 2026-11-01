import { data, redirect } from "react-router";
import { matchLegacyPath } from "~/lib/paths";
import type { Route } from "./+types/redirects";

// Every URL no page matches (#84): old paths (`/catalog/women`, `/products/…`, `/uk/…`) and
// Ukrainian segments under `/en` answer with a permanent redirect to their page, keeping the
// query. Anything else is a 404, rendered by the root error boundary as before.
export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const target = matchLegacyPath(url.pathname + url.search);
  if (target === null) {
    throw data(null, { status: 404 });
  }
  return redirect(target, 301);
}

// A POST to an unknown path is a 404 too, not a 405.
export function action() {
  throw data(null, { status: 404 });
}
