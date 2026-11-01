import { ButtonLink } from "~/components/ui/ButtonLink";
import { RichText } from "~/components/ui/RichText";
import { ProductCard } from "~/features/catalog/ProductCard";
import { cn } from "~/lib/cn";
import { useContentLang, useT } from "~/lib/i18n";
import type { OfferView } from "~/lib/offers";
import { ctaLabel, validUntilText } from "./offer-text";

/**
 * One offer: image, title, text, price note, end date and CTA, then the products it links to.
 * The price note is editorial: adding the products to the cart charges their usual prices.
 */
export function OfferCard({ offer }: { offer: OfferView }) {
  const { t } = useT();
  const lang = useContentLang(offer.contentLocale);
  const until = validUntilText(offer.validUntil, t);
  const titleId = `offer-${offer.slug}`;

  return (
    <article
      aria-labelledby={titleId}
      className="reveal rounded-card-lg bg-white p-4 ring-1 ring-line md:p-6"
    >
      <div
        className={cn("grid gap-6", offer.image && "md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}
      >
        {offer.image && (
          <img
            src={offer.image.url}
            srcSet={offer.image.srcSet ?? undefined}
            sizes="(min-width: 768px) 40vw, 100vw"
            width={offer.image.width ?? undefined}
            height={offer.image.height ?? undefined}
            alt={offer.image.alt || t("offers.imageAlt", { title: offer.title })}
            loading="lazy"
            decoding="async"
            className="aspect-[4/3] w-full rounded-card object-cover"
          />
        )}
        <div className="flex flex-col items-start gap-3">
          <h3
            id={titleId}
            lang={lang}
            className="text-2xl leading-tight font-bold tracking-[-0.01em] text-ink md:text-3xl"
          >
            {offer.title}
          </h3>
          {offer.summary && (
            <p lang={lang} className="text-lg text-body">
              {offer.summary}
            </p>
          )}
          {offer.bodyHtml && <RichText html={offer.bodyHtml} lang={lang} className="text-body" />}
          {(offer.priceNote || until) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {offer.priceNote && (
                <p
                  lang={lang}
                  className="rounded-pill bg-blush px-4 py-2 font-extrabold text-primary-dark"
                >
                  {offer.priceNote}
                </p>
              )}
              {until && <p className="text-sm font-bold text-muted">{until}</p>}
            </div>
          )}
          {offer.cta && (
            <ButtonLink to={offer.cta.to} size="sm" className="mt-2">
              {ctaLabel(offer.cta, t)}
            </ButtonLink>
          )}
        </div>
      </div>

      {offer.products.length > 0 && (
        <ul
          aria-label={t("offers.products")}
          className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {offer.products.map((product) => (
            <li key={product.id} className="flex">
              <ProductCard product={product} headingLevel={4} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
