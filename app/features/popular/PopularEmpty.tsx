import { ButtonLink } from "~/components/ui/ButtonLink";
import { usePathFor, useT } from "~/lib/i18n";
import { popularHref } from "~/lib/popular";

/**
 * Shown when no popular perfume is listed: with the trio's families, a way back to every popular
 * perfume; always both catalogs.
 */
export function PopularEmpty({ filtered }: { filtered: boolean }) {
  const { t, locale } = useT();
  const path = usePathFor();

  return (
    <section
      aria-labelledby="popular-empty"
      className="flex animate-fade-up flex-col items-start gap-4 rounded-card-lg bg-blush p-8 md:p-14"
    >
      <h2 id="popular-empty" className="text-3xl font-bold tracking-[-0.01em] text-ink md:text-4xl">
        {t(filtered ? "popular.empty.filteredHeading" : "popular.empty.heading")}
      </h2>
      <p className="max-w-xl text-lg text-body">
        {t(filtered ? "popular.empty.filteredText" : "popular.empty.text")}
      </p>
      <div className="flex flex-wrap gap-3">
        {filtered && <ButtonLink to={popularHref(locale, [])}>{t("popular.showAll")}</ButtonLink>}
        <ButtonLink
          to={path("catalog", { gender: "women" })}
          variant={filtered ? "dark" : "primary"}
        >
          {t("popular.women")}
        </ButtonLink>
        <ButtonLink to={path("catalog", { gender: "men" })} variant="dark">
          {t("popular.men")}
        </ButtonLink>
      </div>
    </section>
  );
}
