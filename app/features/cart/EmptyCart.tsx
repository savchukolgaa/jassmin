import { ButtonLink } from "~/components/ui/ButtonLink";
import { CATALOG_TITLE_KEYS } from "~/lib/catalog";
import { usePathFor, useT } from "~/lib/i18n";

/** The cart page without lines: links to both catalogs (there's no Unisex catalog). */
export function EmptyCart() {
  const { t } = useT();
  const path = usePathFor();

  return (
    <section className="mt-8 flex flex-col items-start gap-4 rounded-card-lg bg-blush p-6 md:p-10">
      <h2 className="text-2xl font-bold tracking-[-0.01em] text-ink">{t("cart.empty")}</h2>
      <p className="text-body">{t("cart.emptyHint")}</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink to={path("catalog", { gender: "women" })}>
          {t(CATALOG_TITLE_KEYS.women)}
        </ButtonLink>
        <ButtonLink to={path("catalog", { gender: "men" })} variant="ghost">
          {t(CATALOG_TITLE_KEYS.men)}
        </ButtonLink>
      </div>
    </section>
  );
}
