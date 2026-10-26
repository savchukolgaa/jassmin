import { RichText } from "~/components/ui/RichText";
import type { HomePageView } from "~/lib/home";
import { type Locale, useContentLang, useT } from "~/lib/i18n";
import { Eyebrow } from "./Eyebrow";

type AboutSectionProps = { about: HomePageView["about"]; contentLocale: Locale };

/** Store photo and brand story from Strapi; the header's "About us" link scrolls here (`/#about`). */
export function AboutSection({ about, contentLocale }: AboutSectionProps) {
  const { t } = useT();
  const lang = useContentLang(contentLocale);

  return (
    <section id="about" aria-labelledby="about-title" className="scroll-mt-20 bg-blush">
      <div className="reveal container mx-auto flex flex-wrap items-center gap-14 px-4 py-16 md:py-26">
        <StorePhoto image={about.image} />
        <div className="flex min-w-0 flex-[1_1_27rem] flex-col gap-5">
          <Eyebrow>{t("home.about")}</Eyebrow>
          <h2
            id="about-title"
            lang={lang}
            className="text-4xl leading-[1.02] font-extrabold tracking-[-0.04em] text-balance text-ink md:text-5xl"
          >
            {about.title}
          </h2>
          <RichText
            html={about.bodyHtml}
            lang={lang}
            className="text-lg leading-[1.7] text-body [&_a]:text-primary-dark"
          />
        </div>
      </div>
    </section>
  );
}

// The artboard's asymmetric arch: one big rounded corner, top right.
const photoFrame =
  "h-80 w-full min-w-0 flex-[1_1_24rem] rounded-[1.75rem_13.75rem_1.75rem_1.75rem] bg-primary-light object-cover md:h-115";

function StorePhoto({ image }: { image: HomePageView["about"]["image"] }) {
  if (!image) {
    return <div aria-hidden="true" className={photoFrame} />;
  }
  return (
    <img
      src={image.url}
      srcSet={image.srcSet ?? undefined}
      sizes="(min-width: 768px) 560px, 100vw"
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      alt={image.alt}
      loading="lazy"
      decoding="async"
      className={photoFrame}
    />
  );
}
