import { Fragment } from "react";
import { FREE_SHIPPING_THRESHOLD } from "~/lib/checkout";
import { useT } from "~/lib/i18n";
import type { TrioOffer } from "~/lib/trio";

type OfferMarqueeProps = { trioOffer: TrioOffer | null };

/**
 * Times the offers repeat in each half of the track: two short offers are narrower than a wide
 * screen, and the loop would show a gap.
 */
const REPEAT = 4;

/**
 * The slim dark band that scrolls the shop's offers: the tester trio (when the rule exists) and
 * free delivery from `FREE_SHIPPING_THRESHOLD` (#72). Decorative: both are on the hero badge, the
 * offers page and the cart, so screen readers skip it.
 */
export function OfferMarquee({ trioOffer }: OfferMarqueeProps) {
  const { t, formatPrice } = useT();
  const offers = [
    ...(trioOffer
      ? [
          t("home.marquee.offer", {
            count: trioOffer.setSize,
            price: formatPrice(trioOffer.price),
          }),
        ]
      : []),
    t("home.marquee.freeDelivery", { threshold: formatPrice(FREE_SHIPPING_THRESHOLD) }),
  ];
  const items = Array.from({ length: REPEAT }, (_, round) =>
    offers.map((label, index) => ({ key: `${round}-${index}`, label })),
  ).flat();

  // The track holds the items twice, so scrolling it by half loops seamlessly.
  return (
    <div className="overflow-hidden bg-ink py-2 text-white">
      <div aria-hidden="true" className="animate-marquee marquee-pause flex w-max">
        {[0, 1].map((copy) => (
          <div
            key={copy}
            className="flex gap-8 pr-8 text-base font-extrabold whitespace-nowrap md:text-lg"
          >
            {items.map((item) => (
              <Fragment key={item.key}>
                <span>{item.label}</span>
                <span className="text-primary-light">✦</span>
              </Fragment>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
