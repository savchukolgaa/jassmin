import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "~/lib/cn";

export type AuthMode = "login" | "register";

const COPY: Record<AuthMode, { headline: string; sub: string }> = {
  login: {
    headline: "Welcome back.",
    sub: "Sign in to see your orders and pick up where you left off.",
  },
  register: {
    headline: "Join jassmin.",
    sub: "Create an account in a minute. Your cart comes with you.",
  },
};

const BENEFITS = [
  "Track current and previous orders",
  "Your cart, saved across devices",
  "Faster checkout next time",
];

/** `?redirectTo=…` to carry between the login and register pages. */
function withRedirect(path: string, redirectTo: string | undefined): string {
  return redirectTo ? `${path}?${new URLSearchParams({ redirectTo })}` : path;
}

/**
 * The two-column frame of `/login` and `/register` (C+ "Sign in / Sign up"): a brand panel and
 * the form with tabs to switch between the two pages.
 */
export function AuthLayout({
  mode,
  redirectTo,
  children,
}: {
  mode: AuthMode;
  redirectTo?: string;
  children: ReactNode;
}) {
  const { headline, sub } = COPY[mode];

  return (
    <main className="container mx-auto flex flex-wrap items-stretch gap-10 px-4 pt-14 pb-20">
      <section
        aria-labelledby="auth-heading"
        className="relative flex min-w-0 flex-[1_1_400px] flex-col justify-between gap-8 overflow-hidden rounded-[40px] bg-primary p-8 text-white sm:p-12"
      >
        <div className="flex flex-col gap-4">
          <h1
            id="auth-heading"
            className="max-w-[8ch] text-5xl leading-[0.92] font-extrabold tracking-tighter sm:text-7xl"
          >
            {headline}
          </h1>
          <p className="max-w-sm text-lg leading-relaxed">{sub}</p>
        </div>
        <ul className="flex flex-col gap-3 font-bold">
          {BENEFITS.map((benefit) => (
            <li key={benefit} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-8 items-center justify-center rounded-full bg-white font-extrabold text-primary"
              >
                ✓
              </span>
              {benefit}
            </li>
          ))}
        </ul>
      </section>

      <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-6">
        <nav
          aria-label="Account"
          className="flex gap-1.5 self-start rounded-full bg-gray-100 p-1.5"
        >
          <AuthTab to={withRedirect("/login", redirectTo)} active={mode === "login"}>
            Sign in
          </AuthTab>
          <AuthTab to={withRedirect("/register", redirectTo)} active={mode === "register"}>
            Create account
          </AuthTab>
        </nav>

        {children}

        <p className="rounded-2xl bg-primary-light/10 px-5 py-4 leading-normal">
          Just shopping? You can{" "}
          <Link to="/cart" className="font-extrabold text-primary-dark underline">
            check out as a guest
          </Link>
          , no account needed.
        </p>
      </div>
    </main>
  );
}

function AuthTab({ to, active, children }: { to: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-12 items-center rounded-full px-6 font-extrabold transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        active ? "bg-gray-900 text-white" : "text-gray-900 hover:bg-white",
      )}
    >
      {children}
    </Link>
  );
}

/** An error about the whole form, e.g. wrong credentials. */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-2xl bg-red-50 px-5 py-3.5 font-bold text-red-800">
      {children}
    </p>
  );
}
