import { Fragment } from "react";
import { useT } from "~/lib/i18n";
import { labelTrioFamilies, type TrioOffer } from "~/lib/trio";

type OfferMarqueeProps = { trioOffer: TrioOffer | null; families: string[] };

/**
 * The dark band that scrolls the tester-trio offer and the fragrance families. Decorative: the
 * offer is on the hero badge and the families are the trio builder's chips, so screen readers
 * skip it.
 */
export function OfferMarquee({ trioOffer, families }: OfferMarqueeProps) {
  const translator = useT();
  const { t, formatPrice } = translator;
  const items = [
    ...(trioOffer
      ? [
          t("home.marquee.offer", {
            count: trioOffer.setSize,
            price: formatPrice(trioOffer.price),
          }),
        ]
      : []),
    ...labelTrioFamilies(families, translator).map((family) => family.label),
  ];
  if (items.length === 0) {
    return null;
  }

  // The track holds the items twice, so scrolling it by half loops seamlessly.
  return (
    <div className="overflow-hidden bg-ink py-4.5 text-white">
      <div aria-hidden="true" className="animate-marquee marquee-pause flex w-max">
        {[0, 1].map((copy) => (
          <div
            key={copy}
            className="flex gap-12 pr-12 text-xl font-extrabold whitespace-nowrap md:text-2xl"
          >
            {items.map((item) => (
              <Fragment key={item}>
                <span>{item}</span>
                <span className="text-primary-light">✦</span>
              </Fragment>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
