import { FamilyChip } from "~/features/catalog/FamilyChip";
import { useContentLang, useT } from "~/lib/i18n";
import type { ProductDetail } from "~/lib/products";

/** A product's fragrance families as chips, primary first (#65). */
export function ProductFamilies({ families }: { families: ProductDetail["fragranceFamilies"] }) {
  const { t } = useT();
  if (families.length === 0) return null;
  return (
    <ul aria-label={t("product.families")} className="flex flex-wrap gap-2">
      {families.map((family) => (
        <li key={family}>
          <FamilyChip family={family} />
        </li>
      ))}
    </ul>
  );
}

/** A product's scent notes as pills. Notes are Ukrainian on every site (#65). */
export function ProductNotes({ notes }: { notes: ProductDetail["notes"] }) {
  const { t } = useT();
  const lang = useContentLang("uk");
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="notes-heading" className="mt-2">
      <h2 id="notes-heading" className="text-xl font-bold tracking-[-0.01em] text-ink">
        {t("product.notes")}
      </h2>
      <ul lang={lang} className="mt-3 flex flex-wrap gap-2">
        {notes.map((note) => (
          <li
            key={note}
            className="rounded-pill bg-white px-3 py-1 text-sm text-body ring-1 ring-line"
          >
            {note}
          </li>
        ))}
      </ul>
    </section>
  );
}
