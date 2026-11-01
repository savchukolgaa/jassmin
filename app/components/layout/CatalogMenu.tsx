import { NavLink, useLocation } from "react-router";
import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";
import { matchPage } from "~/lib/paths";
import { ChevronDownIcon } from "./icons";
import { headerNavItemClasses, navItemClasses, summaryReset, useNavLinks } from "./nav";
import { useDisclosure } from "./useDisclosure";

/** "Каталог ▾" / "Catalog ▾" dropdown with the men's and women's catalogs. */
export function CatalogMenu() {
  const { t } = useT();
  const { detailsProps, summaryProps } = useDisclosure();
  const links = useNavLinks();
  const inCatalog = matchPage(useLocation().pathname)?.page === "catalog";

  return (
    <details {...detailsProps} className="group relative">
      <summary {...summaryProps} className={cn(headerNavItemClasses(inCatalog), summaryReset)}>
        {t("nav.catalog")}
        <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="absolute top-full right-0 z-10 mt-2 w-56 rounded-card border border-line bg-white p-2 text-ink shadow-xl">
        {links.catalog.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              className={({ isActive }) => cn(navItemClasses(isActive, "onLight"), "flex")}
            >
              {t(link.labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>
    </details>
  );
}
