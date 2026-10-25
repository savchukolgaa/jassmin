import { hasNoOffers, type OffersPageView } from "~/lib/offers";
import { OfferGroup } from "./OfferGroup";
import { OffersEmpty } from "./OffersEmpty";
import { OffersHero } from "./OffersHero";
import { PerksStrip } from "./PerksStrip";

/** /offers (#55): the main campaign, the perks strip, then the other offers grouped by kind. */
export function OffersPage({ view }: { view: OffersPageView }) {
  return (
    <main>
      <OffersHero hero={view.hero} />
      <PerksStrip perks={view.perks} />
      <div className="container mx-auto flex flex-col gap-14 px-4 pt-12 pb-16">
        {hasNoOffers(view) ? (
          <OffersEmpty />
        ) : (
          view.groups.map((group) => <OfferGroup key={group.kind} group={group} />)
        )}
      </div>
    </main>
  );
}
