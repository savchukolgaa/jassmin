import { ButtonLink } from "~/components/ui/ButtonLink";
import { CATALOG_TITLES } from "~/lib/catalog";

/** The cart page without lines: links to both catalogs (there's no Unisex catalog). */
export function EmptyCart() {
  return (
    <section className="mt-8 flex flex-col items-start gap-4 rounded-card-lg bg-blush p-6 md:p-10">
      <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-ink">Your cart is empty</h2>
      <p className="text-body">Find a perfume you love and add it here.</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink to="/catalog/women">{CATALOG_TITLES.women}</ButtonLink>
        <ButtonLink to="/catalog/men" variant="ghost">
          {CATALOG_TITLES.men}
        </ButtonLink>
      </div>
    </section>
  );
}
