import { Link, NavLink } from "react-router";
import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";
import { CloseIcon, MenuIcon } from "./icons";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { iconButtonClasses, navItemClasses, summaryReset, useNavLinks } from "./nav";
import { useDisclosure } from "./useDisclosure";

/** Hamburger menu below `lg` with the same links and language switcher as the inline nav. */
export function MobileMenu() {
  const { t } = useT();
  const links = useNavLinks();
  const { detailsProps, summaryProps } = useDisclosure();

  return (
    <details {...detailsProps} className="group lg:hidden">
      <summary
        {...summaryProps}
        aria-label={t("nav.menu")}
        className={cn(iconButtonClasses(false, "onLight"), summaryReset)}
      >
        <MenuIcon className="size-6 group-open:hidden" />
        <CloseIcon className="hidden size-6 group-open:block" />
      </summary>
      {/* Positioned against the sticky <header>, so it spans the full width below the bar. */}
      <div className="absolute inset-x-0 top-full rounded-b-card border-line border-t bg-white text-ink shadow-xl">
        <ul className="container mx-auto flex flex-col gap-1 p-4">
          <li>
            <Link to={links.about.to} className={cn(navItemClasses(false, "onLight"), "flex")}>
              {t(links.about.labelKey)}
            </Link>
          </li>
          <li>
            <span className="block px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
              {t("nav.catalog")}
            </span>
            <ul className="flex flex-col gap-1 pl-3">
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
          </li>
          <li>
            <NavLink
              to={links.bestsellers.to}
              className={({ isActive }) => cn(navItemClasses(isActive, "onLight"), "flex")}
            >
              {t(links.bestsellers.labelKey)}
            </NavLink>
          </li>
          <li>
            <NavLink
              to={links.offers.to}
              className={({ isActive }) => cn(navItemClasses(isActive, "onLight"), "flex")}
            >
              {t(links.offers.labelKey)}
            </NavLink>
          </li>
          <li>
            <Link to={links.contacts.to} className={cn(navItemClasses(false, "onLight"), "flex")}>
              {t(links.contacts.labelKey)}
            </Link>
          </li>
          <li className="mt-2 border-line border-t pt-3">
            <LocaleSwitcher tone="onLight" />
          </li>
        </ul>
      </div>
    </details>
  );
}
