import { ButtonLink } from "~/components/ui/ButtonLink";
import { useT } from "~/lib/i18n";

/** Shown when no campaign is running: both catalogs and the blog instead. */
export function OffersEmpty() {
  const { t } = useT();

  return (
    <section
      aria-labelledby="offers-empty"
      className="flex flex-col items-start gap-4 rounded-card-lg bg-blush p-8 md:p-14"
    >
      <h2 id="offers-empty" className="text-3xl font-bold tracking-[-0.01em] text-ink md:text-4xl">
        {t("offers.empty.heading")}
      </h2>
      <p className="max-w-xl text-lg text-body">{t("offers.empty.text")}</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink to="/catalog/women">{t("offers.empty.women")}</ButtonLink>
        <ButtonLink to="/catalog/men" variant="dark">
          {t("offers.empty.men")}
        </ButtonLink>
        <ButtonLink to="/blog" variant="ghost">
          {t("offers.empty.blog")}
        </ButtonLink>
      </div>
    </section>
  );
}
