import { Link, NavLink } from "react-router";
import { formatCartCount, type HeaderState } from "~/lib/header";
import { CatalogMenu } from "./CatalogMenu";
import { CartIcon, UserIcon } from "./icons";
import { MobileMenu } from "./MobileMenu";
import { ABOUT_LINK, CONTACTS_LINK, iconButtonClasses, navItemClasses } from "./nav";

export type HeaderProps = HeaderState;

/** Site header shown on every public page; data comes from the `_shop` layout loader. */
export function Header({ user, cartCount }: HeaderProps) {
  const badge = formatCartCount(cartCount);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-950/90">
      <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
        <Link
          to="/"
          className="rounded-lg text-2xl font-semibold tracking-tight text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Jassmin
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1">
          <ul className="hidden items-center gap-1 md:flex">
            <li>
              <Link to={ABOUT_LINK.to} className={navItemClasses()}>
                {ABOUT_LINK.label}
              </Link>
            </li>
            <li>
              <CatalogMenu />
            </li>
            <li>
              <Link to={CONTACTS_LINK.to} className={navItemClasses()}>
                {CONTACTS_LINK.label}
              </Link>
            </li>
          </ul>

          <NavLink
            to={user ? "/account" : "/login"}
            aria-label={user ? "My account" : "Log in"}
            className={({ isActive }) => iconButtonClasses(isActive)}
          >
            <UserIcon className="size-6" />
          </NavLink>
          <NavLink
            to="/cart"
            aria-label={`Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`}
            className={({ isActive }) => iconButtonClasses(isActive)}
          >
            <CartIcon className="size-6" />
            {badge && (
              <span
                aria-hidden="true"
                className="absolute -top-0.5 -right-0.5 h-5 min-w-5 rounded-full bg-primary px-1 text-center text-xs leading-5 font-semibold text-white"
              >
                {badge}
              </span>
            )}
          </NavLink>
          <MobileMenu />
        </nav>
      </div>
    </header>
  );
}
