import { Link } from "react-router";
import type { TextKey } from "~/lib/i18n";
import { usePathFor, useT } from "~/lib/i18n";
import { focusRing } from "./nav";

/** Links of a 404 page (#88), named after where they go, in the page's language (#84). */
export function NotFoundLinks() {
  const { t } = useT();
  const path = usePathFor();
  const links: { to: string; labelKey: TextKey }[] = [
    { to: path("catalog", { gender: "women" }), labelKey: "catalog.title.women" },
    { to: path("catalog", { gender: "men" }), labelKey: "catalog.title.men" },
    { to: path("popular"), labelKey: "nav.bestsellers" },
    { to: path("blog"), labelKey: "nav.blog" },
  ];
  return (
    <nav aria-label={t("errors.notFoundLinks")} className="mt-8">
      <ul className="flex flex-wrap gap-3">
        {links.map((link) => (
          <li key={link.to}>
            <Link
              to={link.to}
              className={`inline-flex min-h-11 items-center rounded-pill bg-blush px-5 font-bold text-primary-dark hover:underline ${focusRing("onLight")}`}
            >
              {t(link.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
