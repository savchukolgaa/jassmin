import { Link, NavLink } from "react-router";
import type { SocialLink } from "~/lib/cms";
import { cn } from "~/lib/cn";
import { formatCartCount, type HeaderState } from "~/lib/header";
import { usePathFor, useT } from "~/lib/i18n";
import { CatalogMenu } from "./CatalogMenu";
import { CartIcon, UserIcon } from "./icons";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { MobileMenu } from "./MobileMenu";
import { focusRing, headerNavItemClasses, iconButtonClasses, useNavLinks } from "./nav";

export type HeaderProps = HeaderState & {
  /** The store's social profiles, shown in the mobile menu (#101). */
  socialLinks?: readonly SocialLink[];
};

/**
 * Site header shown on every public page; data comes from the `_shop` layout loader. White with
 * `ink` text (#72), so it stands apart from the deep-pink hero; colours are tokens only.
 */
export function Header({ user, cartCount, socialLinks = [] }: HeaderProps) {
  const { t } = useT();
  const path = usePathFor();
  const links = useNavLinks();
  const badge = formatCartCount(cartCount);

  return (
    <header className="sticky top-0 z-40 border-line border-b bg-white text-ink">
      <div className="container mx-auto flex h-16 items-center justify-between gap-2 px-4">
        <Link
          to={path("home")}
          aria-label={t("nav.home")}
          className={cn(
            "rounded-pill font-serif text-2xl font-bold tracking-[-0.01em] text-ink",
            focusRing("onLight"),
          )}
        >
          jassmin
          <span aria-hidden="true" className="text-primary">
            .
          </span>
        </Link>

        <nav aria-label={t("nav.main")} className="flex items-center gap-1">
          <ul className="hidden items-center gap-1 lg:flex">
            <li>
              <Link to={links.about.to} className={headerNavItemClasses()}>
                {t(links.about.labelKey)}
              </Link>
            </li>
            <li>
              <CatalogMenu />
            </li>
            <li>
              <NavLink
                to={links.bestsellers.to}
                className={({ isActive }) => headerNavItemClasses(isActive)}
              >
                {t(links.bestsellers.labelKey)}
              </NavLink>
            </li>
            <li>
              <NavLink
                to={links.offers.to}
                className={({ isActive }) => headerNavItemClasses(isActive)}
              >
                {t(links.offers.labelKey)}
              </NavLink>
            </li>
            <li>
              <Link to={links.contacts.to} className={headerNavItemClasses()}>
                {t(links.contacts.labelKey)}
              </Link>
            </li>
          </ul>

          <LocaleSwitcher tone="onLight" className="hidden lg:flex" />
          <NavLink
            to={user ? path("account") : path("login")}
            aria-label={user ? t("nav.account") : t("nav.logIn")}
            className={({ isActive }) =>
              user
                ? cn(
                    "inline-flex size-11 items-center justify-center rounded-full bg-primary text-white",
                    "transition-colors hover:bg-primary-dark",
                    focusRing("onLight"),
                  )
                : iconButtonClasses(isActive, "onLight")
            }
          >
            <UserIcon className="size-6" />
          </NavLink>
          <NavLink
            to={path("cart")}
            aria-label={t("nav.cart", { count: cartCount })}
            className={cn(
              "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-pill",
              "bg-primary px-3 text-sm font-extrabold text-white transition-colors hover:bg-primary-dark",
              focusRing("onLight"),
            )}
          >
            <CartIcon className="size-5" />
            {badge && <span aria-hidden="true">{badge}</span>}
          </NavLink>
          <MobileMenu socialLinks={socialLinks} />
        </nav>
      </div>
    </header>
  );
}
