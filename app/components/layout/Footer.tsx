import { Form, Link, useLocation } from "react-router";
import { useT } from "~/lib/i18n";
import { navItemClasses, useNavLinks } from "./nav";

/** Site footer shown on every public page, below the page content. */
export function Footer() {
  const { t } = useT();
  const links = useNavLinks();
  const { pathname, search } = useLocation();

  return (
    <footer className="relative overflow-hidden bg-primary text-white">
      <div className="container mx-auto flex flex-col gap-6 px-4 pt-10 pb-4">
        <nav aria-label={t("nav.footer")}>
          <ul className="-mx-3 flex flex-wrap gap-x-2 gap-y-1">
            {links.footer.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className={navItemClasses()}>
                  {t(link.labelKey)}
                </Link>
              </li>
            ))}
            <li>
              {/* Forgets the cookie banner's answer (`/consent`), so the banner shows again. */}
              <Form method="post" action="/consent">
                <input type="hidden" name="redirectTo" value={pathname + search} />
                <button type="submit" name="consent" value="reset" className={navItemClasses()}>
                  {t("consent.settings")}
                </button>
              </Form>
            </li>
          </ul>
        </nav>
        <p className="text-sm">
          © <span suppressHydrationWarning>{new Date().getFullYear()}</span> Jassmin
        </p>
      </div>
      {/* Decorative oversized wordmark; clipped by the footer so it never causes horizontal scroll. */}
      <p
        aria-hidden="true"
        className="pointer-events-none -mb-[0.18em] px-4 text-[clamp(5rem,22vw,18rem)] leading-none font-serif font-bold tracking-[-0.01em] whitespace-nowrap text-primary-light select-none"
      >
        jassmin.
      </p>
    </footer>
  );
}
