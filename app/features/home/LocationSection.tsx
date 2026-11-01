import { ClockIcon, MapPinIcon } from "~/components/layout/icons";
import { buttonClasses } from "~/components/ui/button-styles";
import type { HomePageView } from "~/lib/home";
import { type Locale, useContentLang, useT } from "~/lib/i18n";
import { Eyebrow } from "./Eyebrow";

type LocationSectionProps = { location: HomePageView["location"]; contentLocale: Locale };

/**
 * Store / pickup address and opening hours from Strapi on a deep-pink card, beside the embedded
 * map.
 */
export function LocationSection({ location, contentLocale }: LocationSectionProps) {
  const { t } = useT();
  const lang = useContentLang(contentLocale);

  return (
    <section aria-labelledby="location-title" className="bg-white">
      <div className="reveal container mx-auto flex flex-wrap gap-6 px-4 py-16 md:py-26">
        <div className="flex min-w-0 flex-[1_1_21rem] flex-col gap-6 rounded-card-lg bg-primary p-8 text-white sm:p-10">
          <Eyebrow tone="onPrimary">{t("home.location.eyebrow")}</Eyebrow>
          <h2
            id="location-title"
            className="text-4xl leading-[1.05] font-bold tracking-[-0.01em] text-balance md:text-5xl"
          >
            {t("home.location.title")}
          </h2>
          <dl className="space-y-6">
            <div className="flex gap-3.5">
              <MapPinIcon className="mt-0.5 size-6 shrink-0" />
              <div>
                <dt className="font-extrabold">{t("home.location.address")}</dt>
                <dd className="mt-1 leading-relaxed" lang={lang}>
                  {location.address}
                </dd>
              </div>
            </div>
            {location.openingHours && (
              <div className="flex gap-3.5">
                <ClockIcon className="mt-0.5 size-6 shrink-0" />
                <div>
                  <dt className="font-extrabold">{t("home.location.hours")}</dt>
                  <dd className="mt-1 leading-relaxed whitespace-pre-line" lang={lang}>
                    {location.openingHours}
                  </dd>
                </div>
              </div>
            )}
          </dl>
          <a
            href={location.directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ variant: "outline-light", className: "self-start" })}
          >
            {t("home.location.directions")}
          </a>
        </div>
        {location.mapEmbedUrl && (
          <iframe
            src={location.mapEmbedUrl}
            title={t("home.location.map", { address: location.address })}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="min-h-80 w-full min-w-0 flex-[2_1_30rem] rounded-card-lg border-0 bg-card md:min-h-110"
          />
        )}
      </div>
    </section>
  );
}
