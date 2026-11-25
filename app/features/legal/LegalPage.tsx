import type { ReactNode } from "react";
import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { useT } from "~/lib/i18n";

/**
 * The shell of a legal page (#190), like the privacy policy's: the title, the version date when the
 * text has one, the intro and the sections.
 */
export function LegalPage({
  title,
  updatedAt,
  intro,
  children,
}: {
  title: string;
  /** `YYYY-MM-DD`, shown as "Version of …". */
  updatedAt?: string;
  intro: string;
  children: ReactNode;
}) {
  const { t, formatDate } = useT();
  return (
    <main className="container mx-auto px-4 pt-10 pb-16">
      <article className="mx-auto max-w-3xl">
        <h1 className="text-4xl font-bold leading-tight tracking-[-0.01em] text-ink md:text-5xl">
          {title}
        </h1>
        {updatedAt ? (
          <p className="mt-3 text-sm font-bold text-muted">
            <time dateTime={updatedAt}>{t("legal.updated", { date: formatDate(updatedAt) })}</time>
          </p>
        ) : null}
        <p className="mt-4 text-lg text-body">{intro}</p>
        {children}
      </article>
    </main>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold tracking-[-0.01em] text-ink">{heading}</h2>
      <div className="mt-3 space-y-3 text-body">{children}</div>
    </section>
  );
}

/** "More details: <link>." — a link to another page in a section's text. */
export function MoreLink({ label, to, children }: { label: string; to: string; children: string }) {
  return (
    <p>
      {label}{" "}
      <Link
        to={to}
        className={`rounded-pill font-bold text-primary-dark underline ${focusRing("onLight")}`}
      >
        {children}
      </Link>
      .
    </p>
  );
}
