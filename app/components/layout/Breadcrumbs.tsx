import { Link } from "react-router";
import { useT } from "~/lib/i18n";
import type { Breadcrumb } from "~/lib/structured-data";
import { focusRing } from "./nav";

/**
 * The visible breadcrumb trail (#86), matching the page's `BreadcrumbList` JSON-LD. The last item
 * is the current page: plain text with `aria-current`.
 */
export function Breadcrumbs({ items }: { items: readonly Breadcrumb[] }) {
  const { t } = useT();

  return (
    <nav aria-label={t("nav.breadcrumb")} className="text-sm">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((crumb, index) => {
          const last = index === items.length - 1;
          return (
            <li key={crumb.to} className="flex min-w-0 items-center gap-2">
              {last ? (
                <span aria-current="page" className="truncate font-bold text-muted">
                  {crumb.name}
                </span>
              ) : (
                <>
                  <Link
                    to={crumb.to}
                    className={`rounded-pill font-bold text-primary-dark hover:underline ${focusRing("onLight")}`}
                  >
                    {crumb.name}
                  </Link>
                  <span aria-hidden="true" className="text-muted">
                    /
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
