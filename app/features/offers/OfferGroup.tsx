import { useT } from "~/lib/i18n";
import type { OfferGroupView } from "~/lib/offers";
import { OfferCard } from "./OfferCard";

/** The offers of one kind (discovery sets, seasonal, gifts, …) under a section heading. */
export function OfferGroup({ group }: { group: OfferGroupView }) {
  const { t } = useT();
  const headingId = `offers-${group.kind}`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <h2
        id={headingId}
        className="text-3xl font-extrabold tracking-[-0.03em] text-ink md:text-4xl"
      >
        {t(`offers.kinds.${group.kind}`)}
      </h2>
      <ul className="flex flex-col gap-6">
        {group.offers.map((offer) => (
          <li key={offer.slug}>
            <OfferCard offer={offer} />
          </li>
        ))}
      </ul>
    </section>
  );
}
