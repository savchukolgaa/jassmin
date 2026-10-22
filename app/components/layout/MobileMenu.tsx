import { Link, NavLink } from "react-router";
import { cn } from "~/lib/cn";
import { CloseIcon, MenuIcon } from "./icons";
import {
  ABOUT_LINK,
  CATALOG_LINKS,
  CONTACTS_LINK,
  iconButtonClasses,
  navItemClasses,
  summaryReset,
} from "./nav";
import { useDisclosure } from "./useDisclosure";

/** Hamburger menu below `md` with the same links as the inline nav. */
export function MobileMenu() {
  const { detailsProps, summaryProps } = useDisclosure();

  return (
    <details {...detailsProps} className="group md:hidden">
      <summary
        {...summaryProps}
        aria-label="Menu"
        className={cn(iconButtonClasses(), summaryReset)}
      >
        <MenuIcon className="size-6 group-open:hidden" />
        <CloseIcon className="hidden size-6 group-open:block" />
      </summary>
      {/* Positioned against the sticky <header>, so it spans the full width below the bar. */}
      <div className="absolute inset-x-0 top-full border-b border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-950">
        <ul className="container mx-auto flex flex-col gap-1 p-4">
          <li>
            <Link to={ABOUT_LINK.to} className={cn(navItemClasses(), "flex")}>
              {ABOUT_LINK.label}
            </Link>
          </li>
          <li>
            <span className="block px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
              Catalog
            </span>
            <ul className="flex flex-col gap-1 pl-3">
              {CATALOG_LINKS.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    className={({ isActive }) => cn(navItemClasses(isActive), "flex")}
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </li>
          <li>
            <Link to={CONTACTS_LINK.to} className={cn(navItemClasses(), "flex")}>
              {CONTACTS_LINK.label}
            </Link>
          </li>
        </ul>
      </div>
    </details>
  );
}
