import { ButtonLink } from "~/components/ui/ButtonLink";
import { RichText } from "~/components/ui/RichText";
import { useContentLang, useT } from "~/lib/i18n";
import type { OfferView } from "~/lib/offers";
import { ctaLabel, validUntilText } from "./offer-text";

/**
 * The deep-pink band at the top of /offers: the page title, then the main campaign with its
 * arched image. Without a campaign it shows only the title and intro.
 */
export function OffersHero({ hero }: { hero: OfferView | null }) {
  const { t } = useT();
  const lang = useContentLang(hero?.contentLocale ?? "uk");

  if (!hero) {
    return (
      <section aria-labelledby="offers-title" className="bg-primary text-white">
        <div className="container mx-auto px-4 py-14 md:py-20">
          <h1
            id="offers-title"
            className="animate-fade-up text-4xl leading-tight font-extrabold tracking-[-0.04em] md:text-5xl"
          >
            {t("offers.title")}
          </h1>
          <p className="mt-3 max-w-2xl animate-fade-up anim-delay-1 text-lg">{t("offers.intro")}</p>
        </div>
      </section>
    );
  }

  const until = validUntilText(hero.validUntil, t);
  return (
    <section aria-labelledby="offers-hero-title" className="overflow-hidden bg-primary text-white">
      <div className="container mx-auto grid items-center gap-10 px-4 py-14 md:grid-cols-2 md:py-20">
        <div>
          <h1
            id="offers-title"
            className="animate-fade-up text-sm font-bold tracking-widest uppercase"
          >
            {t("offers.title")}
          </h1>
          <h2
            id="offers-hero-title"
            lang={lang}
            className="mt-4 animate-fade-up anim-delay-1 text-5xl leading-none font-extrabold tracking-[-0.05em] text-balance md:text-7xl"
          >
            {hero.title}
          </h2>
          {hero.summary && (
            <p lang={lang} className="mt-5 max-w-xl animate-fade-up anim-delay-2 text-xl">
              {hero.summary}
            </p>
          )}
          {hero.bodyHtml && (
            <RichText
              html={hero.bodyHtml}
              lang={lang}
              className="mt-4 max-w-xl animate-fade-up anim-delay-2 [&_a]:text-white"
            />
          )}
          <div className="mt-6 flex animate-fade-up anim-delay-3 flex-wrap items-center gap-x-5 gap-y-3">
            {hero.priceNote && (
              <p
                lang={lang}
                className="rounded-pill bg-white px-4 py-2 font-extrabold text-primary-dark"
              >
                {hero.priceNote}
              </p>
            )}
            {until && <p className="font-bold">{until}</p>}
          </div>
          {hero.cta && (
            <div className="mt-8 animate-fade-up anim-delay-4">
              <ButtonLink to={hero.cta.to} variant="dark" size="lg">
                {ctaLabel(hero.cta, t)}
              </ButtonLink>
            </div>
          )}
        </div>
        <HeroImage image={hero.image} />
      </div>
    </section>
  );
}

const imageFrame =
  "aspect-[4/5] w-full max-w-md justify-self-center rounded-t-full bg-primary-dark animate-fade-up anim-delay-3";

function HeroImage({ image }: { image: OfferView["image"] }) {
  if (!image) {
    return <div aria-hidden="true" className={imageFrame} />;
  }
  return (
    <img
      src={image.url}
      srcSet={image.srcSet ?? undefined}
      sizes="(min-width: 768px) 448px, 100vw"
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      alt={image.alt}
      fetchPriority="high"
      decoding="async"
      className={`${imageFrame} object-cover shadow-xl`}
    />
  );
}
