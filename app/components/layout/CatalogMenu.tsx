import { NavLink, useMatch } from "react-router";
import { cn } from "~/lib/cn";
import { ChevronDownIcon } from "./icons";
import { CATALOG_LINKS, navItemClasses, summaryReset } from "./nav";
import { useDisclosure } from "./useDisclosure";

/** "Catalog ▾" dropdown with the men's and women's catalogs. */
export function CatalogMenu() {
  const { detailsProps, summaryProps } = useDisclosure();
  const inCatalog = useMatch("/catalog/*") !== null;

  return (
    <details {...detailsProps} className="group relative">
      <summary {...summaryProps} className={cn(navItemClasses(inCatalog), summaryReset)}>
        Catalog
        <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="absolute top-full right-0 z-10 mt-2 w-56 rounded-card bg-white p-2 text-ink shadow-xl">
        {CATALOG_LINKS.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              className={({ isActive }) => cn(navItemClasses(isActive, "onLight"), "flex")}
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </details>
  );
}
