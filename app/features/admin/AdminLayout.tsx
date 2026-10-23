import type { ReactNode } from "react";
import { Form, Link, NavLink } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { ADMIN_NAV_ITEMS, adminNavItemClasses } from "./admin-nav";

export interface AdminLayoutProps {
  adminName: string;
  /** Absolute URL of the Strapi admin panel. */
  strapiAdminUrl: string;
  children?: ReactNode;
}

/** Shell of every `/admin` page: deep-pink top bar, sidebar navigation (a row on mobile), content. */
export function AdminLayout({ adminName, strapiAdminUrl, children }: AdminLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-blush">
      <header className="bg-primary text-white">
        <div className="flex h-16 items-center justify-between gap-2 px-4">
          <Link
            to="/admin"
            aria-label="Jassmin admin, home"
            className={cn(
              "rounded-pill text-2xl font-extrabold tracking-[-0.05em] text-white",
              focusRing(),
            )}
          >
            jassmin
            <span aria-hidden="true" className="text-primary-light">
              .
            </span>
            <span className="ml-2 text-sm font-bold tracking-normal">admin</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm font-bold sm:inline">{adminName}</span>
            <Form method="post" action="/logout">
              <Button type="submit" variant="outline-light" size="sm">
                Log out
              </Button>
            </Form>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <nav
          aria-label="Admin"
          className="border-line border-b bg-white md:w-60 md:shrink-0 md:border-r md:border-b-0"
        >
          <ul className="flex gap-1 overflow-x-auto p-3 md:flex-col">
            {ADMIN_NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={({ isActive }) => adminNavItemClasses(isActive)}>
                  {item.label}
                </NavLink>
              </li>
            ))}
            <li>
              <a
                href={strapiAdminUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={adminNavItemClasses()}
              >
                Content (Strapi)
                <span aria-hidden="true">↗</span>
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
            <li className="md:mt-4">
              <Link to="/" className={adminNavItemClasses()}>
                Back to shop
              </Link>
            </li>
          </ul>
        </nav>

        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
