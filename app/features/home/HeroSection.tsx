import { ButtonLink } from "~/components/ui/ButtonLink";
import { buttonClasses } from "~/components/ui/button-styles";
import type { HomePageView } from "~/lib/home";
import { type Locale, useContentLang } from "~/lib/i18n";
import { resolveCtaHref } from "~/lib/links";

type HeroSectionProps = { hero: HomePageView["hero"]; contentLocale: Locale };

// "Order Now" uses the `dark` variant, which stands out on the deep-pink band (docs/design.md).
const ctaStyle = { variant: "dark", size: "lg" } as const;

/** The current offer from Strapi on a deep-pink band: headline and CTA, then the arched image. */
export function HeroSection({ hero, contentLocale }: HeroSectionProps) {
  const cta = resolveCtaHref(hero.ctaHref);
  const lang = useContentLang(contentLocale);

  return (
    <section aria-labelledby="hero-title" className="overflow-hidden bg-primary text-white">
      <div className="container mx-auto grid items-center gap-10 px-4 py-14 md:grid-cols-2 md:py-20">
        <div lang={lang}>
          <h1
            id="hero-title"
            className="animate-fade-up text-5xl leading-none font-extrabold tracking-[-0.05em] text-balance md:text-7xl"
          >
            {hero.headline}
          </h1>
          <div className="mt-8 animate-fade-up anim-delay-2">
            {cta.kind === "internal" ? (
              <ButtonLink to={cta.to} {...ctaStyle}>
                {hero.ctaLabel}
              </ButtonLink>
            ) : (
              <a href={cta.href} className={buttonClasses(ctaStyle)}>
                {hero.ctaLabel}
              </a>
            )}
          </div>
        </div>
        <HeroImage image={hero.image} />
      </div>
    </section>
  );
}

const imageFrame =
  "aspect-[4/5] w-full max-w-md justify-self-center rounded-t-full bg-primary-dark animate-fade-up anim-delay-3";

function HeroImage({ image }: { image: HomePageView["hero"]["image"] }) {
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
