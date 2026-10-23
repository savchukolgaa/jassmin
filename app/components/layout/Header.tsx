import { Link, NavLink } from "react-router";
import { cn } from "~/lib/cn";
import { formatCartCount, type HeaderState } from "~/lib/header";
import { CatalogMenu } from "./CatalogMenu";
import { CartIcon, UserIcon } from "./icons";
import { MobileMenu } from "./MobileMenu";
import { ABOUT_LINK, CONTACTS_LINK, focusRing, iconButtonClasses, navItemClasses } from "./nav";

export type HeaderProps = HeaderState;

/** Site header shown on every public page; data comes from the `_shop` layout loader. */
export function Header({ user, cartCount }: HeaderProps) {
  const badge = formatCartCount(cartCount);

  return (
    <header className="sticky top-0 z-40 bg-primary text-white">
      <div className="container mx-auto flex h-16 items-center justify-between gap-2 px-4">
        <Link
          to="/"
          aria-label="Jassmin, home"
          className={cn(
            "rounded-pill text-2xl font-extrabold tracking-[-0.05em] text-white",
            focusRing(),
          )}
        >
          jassmin
          <span aria-hidden="true" className="text-primary-light">
            .
          </span>
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
            className={({ isActive }) =>
              user
                ? cn(
                    "inline-flex size-11 items-center justify-center rounded-full bg-white text-primary",
                    "transition-colors hover:bg-blush",
                    focusRing(),
                  )
                : iconButtonClasses(isActive)
            }
          >
            <UserIcon className="size-6" />
          </NavLink>
          <NavLink
            to="/cart"
            aria-label={`Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`}
            className={cn(
              "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-pill",
              "bg-white px-3 text-sm font-extrabold text-primary transition-colors hover:bg-blush",
              focusRing(),
            )}
          >
            <CartIcon className="size-5" />
            {badge && <span aria-hidden="true">{badge}</span>}
          </NavLink>
          <MobileMenu />
        </nav>
      </div>
    </header>
  );
}
