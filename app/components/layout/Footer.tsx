import { Link } from "react-router";
import { FOOTER_LINKS, navItemClasses } from "./nav";

/** Site footer shown on every public page, below the page content. */
export function Footer() {
  return (
    <footer className="relative overflow-hidden bg-primary text-white">
      <div className="container mx-auto flex flex-col gap-6 px-4 pt-10 pb-4">
        <nav aria-label="Footer">
          <ul className="-mx-3 flex flex-wrap gap-x-2 gap-y-1">
            {FOOTER_LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className={navItemClasses()}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-sm">
          © <span suppressHydrationWarning>{new Date().getFullYear()}</span> Jassmin
        </p>
      </div>
      {/* Decorative oversized wordmark; clipped by the footer so it never causes horizontal scroll. */}
      <p
        aria-hidden="true"
        className="pointer-events-none -mb-[0.18em] px-4 text-[clamp(5rem,22vw,18rem)] leading-none font-extrabold tracking-[-0.05em] whitespace-nowrap text-primary-light select-none"
      >
        jassmin.
      </p>
    </footer>
  );
}
