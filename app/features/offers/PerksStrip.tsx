import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { useContentLang, useT } from "~/lib/i18n";
import type { OfferView } from "~/lib/offers";
import { ctaLabel } from "./offer-text";

/** Always-on perks (free delivery, discovery sizes, the welcome offer) in a blush strip. */
export function PerksStrip({ perks }: { perks: OfferView[] }) {
  const { t } = useT();
  if (perks.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="offers-perks" className="bg-blush">
      <div className="container mx-auto px-4 py-8">
        <h2 id="offers-perks" className="sr-only">
          {t("offers.perks")}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {perks.map((perk) => (
            <Perk key={perk.slug} perk={perk} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function Perk({ perk }: { perk: OfferView }) {
  const { t } = useT();
  const lang = useContentLang(perk.contentLocale);

  return (
    <li className="flex flex-col gap-1 rounded-card bg-white p-5 ring-1 ring-line" lang={lang}>
      <p className="text-lg font-extrabold tracking-[-0.03em] text-ink">{perk.title}</p>
      {perk.summary && <p className="text-body">{perk.summary}</p>}
      {perk.cta && (
        <Link
          to={perk.cta.to}
          className={`mt-1 self-start rounded font-bold text-primary-dark underline underline-offset-2 hover:no-underline ${focusRing("onLight")}`}
        >
          {ctaLabel(perk.cta, t)}
        </Link>
      )}
    </li>
  );
}
