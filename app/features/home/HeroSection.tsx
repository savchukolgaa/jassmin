import { ButtonLink } from "~/components/ui/ButtonLink";
import { buttonClasses } from "~/components/ui/button-styles";
import type { HomePageView } from "~/lib/home";
import { resolveCtaHref } from "~/lib/links";

type HeroSectionProps = { hero: HomePageView["hero"] };

/** The current offer from Strapi: headline and CTA on the left, the hero image on the right. */
export function HeroSection({ hero }: HeroSectionProps) {
  const cta = resolveCtaHref(hero.ctaHref);

  return (
    <section aria-labelledby="hero-title" className="bg-primary-light/15">
      <div className="container mx-auto grid items-center gap-10 px-4 py-12 md:grid-cols-2 md:py-20">
        <div>
          <h1
            id="hero-title"
            className="text-4xl font-extrabold tracking-tight text-balance text-gray-950 sm:text-5xl lg:text-6xl dark:text-white"
          >
            {hero.headline}
          </h1>
          <div className="mt-8">
            {cta.kind === "internal" ? (
              <ButtonLink to={cta.to} size="lg">
                {hero.ctaLabel}
              </ButtonLink>
            ) : (
              <a href={cta.href} className={buttonClasses({ size: "lg" })}>
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

const imageFrame = "aspect-[4/5] w-full max-w-md justify-self-center rounded-t-full";

function HeroImage({ image }: { image: HomePageView["hero"]["image"] }) {
  if (!image) {
    return <div aria-hidden="true" className={`${imageFrame} bg-primary-light/30`} />;
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
      className={`${imageFrame} object-cover shadow-lg`}
    />
  );
}
