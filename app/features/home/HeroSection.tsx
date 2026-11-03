import type { ReactNode } from "react";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { type ButtonStyleOptions, buttonClasses } from "~/components/ui/button-styles";
import type { HomePageView } from "~/lib/home";
import { type Locale, useContentLang, useT } from "~/lib/i18n";
import { resolveCtaHref } from "~/lib/links";
import type { TrioOffer } from "~/lib/trio";

type HeroSectionProps = {
  hero: HomePageView["hero"];
  trioOffer: TrioOffer | null;
  contentLocale: Locale;
};

/**
 * The current offer from Strapi on a deep-pink band (HomeBoldPlus): eyebrow, headline, subtitle
 * and two CTAs, beside the arched image with the price badge and the floating chip.
 */
export function HeroSection({ hero, trioOffer, contentLocale }: HeroSectionProps) {
  const lang = useContentLang(contentLocale);

  return (
    <section aria-labelledby="hero-title" className="overflow-hidden bg-primary text-white">
      <div className="container mx-auto flex flex-wrap items-end gap-10 px-4 pt-12">
        <div lang={lang} className="flex min-w-0 flex-[3_1_32rem] flex-col gap-7 pb-12 md:pb-18">
          {hero.eyebrow && (
            <p className="animate-fade-up self-start rounded-pill bg-white/15 px-3.5 py-2 text-sm font-extrabold tracking-[0.08em] uppercase">
              {hero.eyebrow}
            </p>
          )}
          <h1
            id="hero-title"
            className="animate-fade-up anim-delay-2 text-5xl leading-[0.92] font-bold tracking-[-0.01em] text-balance sm:text-6xl lg:text-8xl"
          >
            {hero.headline}
          </h1>
          {hero.subtitle && (
            <p className="animate-fade-up anim-delay-4 max-w-lg text-lg leading-normal md:text-xl">
              {hero.subtitle}
            </p>
          )}
          <div className="animate-fade-up anim-delay-6 flex flex-wrap gap-3">
            {/* "Order Now" uses the `dark` variant, which stands out on the deep-pink band. */}
            <CtaLink href={hero.ctaHref} style={{ variant: "dark", size: "lg" }}>
              {hero.ctaLabel}
            </CtaLink>
            {hero.secondaryCta && (
              <CtaLink
                href={hero.secondaryCta.href}
                style={{ variant: "outline-light", size: "lg" }}
              >
                {hero.secondaryCta.label}
              </CtaLink>
            )}
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-lg min-w-0 flex-[2_1_24rem]">
          <HeroImage image={hero.image} />
          {trioOffer && <PriceBadge offer={trioOffer} />}
          <FloatingChip />
        </div>
      </div>
    </section>
  );
}

function CtaLink({
  href,
  style,
  children,
}: {
  href: string;
  style: ButtonStyleOptions;
  children: ReactNode;
}) {
  const { locale } = useT();
  const cta = resolveCtaHref(href, locale);
  return cta.kind === "internal" ? (
    <ButtonLink to={cta.to} {...style}>
      {children}
    </ButtonLink>
  ) : (
    <a href={cta.href} className={buttonClasses(style)}>
      {children}
    </a>
  );
}

// Enlarged in #72; the badge and the chip sit in the same wrapper, so they follow the image.
const imageFrame =
  "animate-rise block h-112 w-full rounded-t-full bg-primary-light object-cover md:h-152";

function HeroImage({ image }: { image: HomePageView["hero"]["image"] }) {
  const { t } = useT();
  if (!image) {
    return <div aria-hidden="true" className={imageFrame} />;
  }
  return (
    <img
      src={image.url}
      srcSet={image.srcSet ?? undefined}
      sizes="(min-width: 768px) 512px, 100vw"
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      alt={image.alt || t("home.hero.imageAlt")}
      fetchPriority="high"
      decoding="async"
      className={imageFrame}
    />
  );
}

/** The round white badge: "only 499 ₴ for 3", from the live tester-trio rule. */
function PriceBadge({ offer }: { offer: TrioOffer }) {
  const { t, formatPrice } = useT();
  const price = formatPrice(offer.price);
  return (
    <p className="animate-badge absolute top-4 left-0 flex size-32 -rotate-8 flex-col items-center justify-center rounded-full bg-white text-ink shadow-2xl md:top-6 md:-left-6 md:size-39">
      <span aria-hidden="true" className="text-xs font-extrabold tracking-[0.08em] uppercase">
        {t("home.hero.badgeOnly")}
      </span>
      <span
        aria-hidden="true"
        className="font-serif text-3xl font-bold tracking-[-0.01em] text-primary-dark md:text-4xl"
      >
        {price}
      </span>
      <span aria-hidden="true" className="text-xs font-bold">
        {t("home.hero.badgeFor", { count: offer.setSize })}
      </span>
      <span className="sr-only">{t("home.hero.badgeLabel", { price, count: offer.setSize })}</span>
    </p>
  );
}

function FloatingChip() {
  const { t } = useT();
  return (
    <p className="animate-float absolute right-4 bottom-9 rounded-2xl bg-ink px-4.5 py-3 text-sm font-extrabold text-white md:right-8">
      {t("home.hero.chip")}
    </p>
  );
}
