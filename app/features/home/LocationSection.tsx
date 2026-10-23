import { ClockIcon, MapPinIcon } from "~/components/layout/icons";
import { buttonClasses } from "~/components/ui/button-styles";
import type { HomePageView } from "~/lib/home";
import { useT } from "~/lib/i18n";
import { Eyebrow } from "./Eyebrow";

type LocationSectionProps = { location: HomePageView["location"] };

/** Store / pickup address, opening hours and the embedded map from Strapi. */
export function LocationSection({ location }: LocationSectionProps) {
  const { t } = useT();

  return (
    <section aria-labelledby="location-title" className="bg-white py-16 md:py-24">
      <div className="reveal container mx-auto grid gap-10 px-4 md:grid-cols-2 md:items-center">
        <div>
          <Eyebrow>{t("home.location.eyebrow")}</Eyebrow>
          <h2
            id="location-title"
            className="mt-2 text-3xl leading-tight font-extrabold tracking-[-0.04em] text-ink md:text-4xl"
          >
            {t("home.location.title")}
          </h2>
          <dl className="mt-8 space-y-6 text-body">
            <div className="flex gap-4">
              <MapPinIcon className="size-6 shrink-0 text-primary-dark" />
              <div>
                <dt className="font-bold text-ink">{t("home.location.address")}</dt>
                <dd className="mt-1">{location.address}</dd>
              </div>
            </div>
            {location.openingHours && (
              <div className="flex gap-4">
                <ClockIcon className="size-6 shrink-0 text-primary-dark" />
                <div>
                  <dt className="font-bold text-ink">{t("home.location.hours")}</dt>
                  <dd className="mt-1 whitespace-pre-line">{location.openingHours}</dd>
                </div>
              </div>
            )}
          </dl>
          <a
            href={location.directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ className: "mt-8" })}
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
            className="aspect-[4/3] w-full rounded-card-lg border-0 bg-card shadow-md"
          />
        )}
      </div>
    </section>
  );
}
