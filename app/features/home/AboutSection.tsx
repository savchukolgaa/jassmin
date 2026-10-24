import { RichText } from "~/components/ui/RichText";
import type { HomePageView } from "~/lib/home";
import { type Locale, useContentLang, useT } from "~/lib/i18n";
import { Eyebrow } from "./Eyebrow";

type AboutSectionProps = { about: HomePageView["about"]; contentLocale: Locale };

/** Brand story from Strapi; the header's "About us" link scrolls here (`/#about`). */
export function AboutSection({ about, contentLocale }: AboutSectionProps) {
  const { t } = useT();
  const lang = useContentLang(contentLocale);

  return (
    <section
      id="about"
      aria-labelledby="about-title"
      className="scroll-mt-20 bg-blush py-16 md:py-24"
    >
      <div className="reveal container mx-auto max-w-3xl px-4">
        <Eyebrow>{t("home.about")}</Eyebrow>
        <h2
          id="about-title"
          lang={lang}
          className="mt-2 text-3xl leading-tight font-extrabold tracking-[-0.04em] text-ink md:text-4xl"
        >
          {about.title}
        </h2>
        <RichText
          html={about.bodyHtml}
          lang={lang}
          className="mt-6 text-lg text-body [&_a]:text-primary-dark"
        />
      </div>
    </section>
  );
}
