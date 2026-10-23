import { ClockIcon, MapPinIcon } from "~/components/layout/icons";
import { buttonClasses } from "~/components/ui/button-styles";
import type { HomePageView } from "~/lib/home";
import { Eyebrow } from "./Eyebrow";

type LocationSectionProps = { location: HomePageView["location"] };

/** Store / pickup address, opening hours and the embedded map from Strapi. */
export function LocationSection({ location }: LocationSectionProps) {
  return (
    <section
      aria-labelledby="location-title"
      className="bg-primary-light/10 py-16 md:py-24 dark:bg-gray-900"
    >
      <div className="container mx-auto grid gap-10 px-4 md:grid-cols-2 md:items-center">
        <div>
          <Eyebrow>Location</Eyebrow>
          <h2
            id="location-title"
            className="mt-2 text-3xl font-extrabold tracking-tight text-gray-950 md:text-4xl dark:text-white"
          >
            Visit our store
          </h2>
          <dl className="mt-8 space-y-6 text-gray-800 dark:text-gray-200">
            <div className="flex gap-4">
              <MapPinIcon className="size-6 shrink-0 text-primary-dark" />
              <div>
                <dt className="font-bold">Address</dt>
                <dd className="mt-1">{location.address}</dd>
              </div>
            </div>
            {location.openingHours && (
              <div className="flex gap-4">
                <ClockIcon className="size-6 shrink-0 text-primary-dark" />
                <div>
                  <dt className="font-bold">Opening hours</dt>
                  <dd className="mt-1 whitespace-pre-line">{location.openingHours}</dd>
                </div>
              </div>
            )}
          </dl>
          <a
            href={location.directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ variant: "secondary", className: "mt-8" })}
          >
            Get directions
          </a>
        </div>
        {location.mapEmbedUrl && (
          <iframe
            src={location.mapEmbedUrl}
            title={`Map: ${location.address}`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="aspect-[4/3] w-full rounded-3xl border-0 shadow-md"
          />
        )}
      </div>
    </section>
  );
}
