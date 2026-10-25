import { Form, NavLink, Outlet } from "react-router";
import { requireUser } from "~/.server/services/auth";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import { firstName } from "~/lib/account";
import { cn } from "~/lib/cn";
import { metaTranslator, type TextKey, useT } from "~/lib/i18n";
import type { Route } from "./+types/account";

export function meta({ matches }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  return [
    { title: t("meta.title", { page: t("account.title") }) },
    { name: "robots", content: "noindex" },
  ];
}

// The account shows personal data, so no cache may keep it.
export function headers() {
  return { "Cache-Control": "private, no-store" };
}

// Layout of the account area (#12). Child loaders run in parallel with this one, so each of them
// calls `requireUser` itself.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return { firstName: firstName(user.fullName), email: user.email };
}

const NAV: { to: string; labelKey: TextKey; end?: boolean }[] = [
  { to: "/account", labelKey: "account.nav.orders" },
  { to: "/", labelKey: "account.nav.continueShopping", end: true },
];

export default function AccountLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useT();

  return (
    <main>
      <section className="bg-primary text-white">
        <div className="container mx-auto flex flex-wrap items-end justify-between gap-6 px-4 pt-10 pb-14">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-sm font-extrabold uppercase tracking-widest">{t("account.title")}</p>
            <h1 className="break-words text-5xl font-extrabold leading-none tracking-[-0.05em] md:text-7xl">
              {t("account.greeting", { name: loaderData.firstName })}
              <span aria-hidden="true" className="text-primary-light">
                .
              </span>
            </h1>
            <p className="break-all text-lg">{loaderData.email}</p>
          </div>
          <Form method="post" action="/logout">
            <Button type="submit" variant="outline-light">
              {t("account.logOut")}
            </Button>
          </Form>
        </div>
      </section>
      <div className="container mx-auto flex flex-col gap-10 px-4 pt-10 pb-24 lg:flex-row lg:items-start">
        <nav aria-label={t("account.nav.label")} className="lg:w-60 lg:shrink-0">
          <ul className="flex flex-wrap gap-2 lg:flex-col">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-13 items-center rounded-pill px-5 font-extrabold transition-colors",
                      focusRing("onLight"),
                      isActive ? "bg-ink text-white" : "text-ink hover:bg-blush",
                    )
                  }
                >
                  {t(item.labelKey)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
