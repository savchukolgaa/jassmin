import { type TextKey, useT } from "~/lib/i18n";
import { REQUIRED_SELLER_FIELDS, type SellerDetails } from "~/lib/legal";

const FIELDS = [
  "legalName",
  "taxId",
  "legalAddress",
  "registrationNote",
  "phone",
  "email",
] as const satisfies readonly (keyof SellerDetails)[];

const LABELS: Record<(typeof FIELDS)[number], TextKey> = {
  legalName: "legal.seller.legalName",
  taxId: "legal.seller.taxId",
  legalAddress: "legal.seller.legalAddress",
  registrationNote: "legal.seller.registrationNote",
  phone: "legal.seller.phone",
  email: "legal.seller.email",
};

function isRequired(field: keyof SellerDetails): boolean {
  return (REQUIRED_SELLER_FIELDS as readonly string[]).includes(field);
}

/**
 * The seller's details from the Strapi site settings (#190), on the public offer. An empty required
 * detail shows a highlighted placeholder outside production (`showPlaceholders`) and is left out in
 * production, where the server warns at startup instead. `seller` is `null` when Strapi is down.
 */
export function SellerDetailsList({
  seller,
  showPlaceholders,
}: {
  seller: SellerDetails | null;
  showPlaceholders: boolean;
}) {
  const { t } = useT();
  if (!seller) {
    return <p>{t("legal.seller.unavailable")}</p>;
  }
  const rows = FIELDS.flatMap((field) => {
    const value = seller[field];
    if (value) {
      return [
        {
          field,
          value: field === "legalName" ? t("legal.seller.legalNameValue", { name: value }) : value,
          missing: false,
        },
      ];
    }
    return showPlaceholders && isRequired(field)
      ? [{ field, value: t("legal.seller.missing"), missing: true }]
      : [];
  });
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
      {rows.map(({ field, value, missing }) => (
        <div key={field} className="contents">
          <dt className="font-bold text-ink">{t(LABELS[field])}</dt>
          <dd className="break-words">
            {missing ? (
              <mark data-missing={field} className="rounded bg-primary-light/40 px-1 text-ink">
                ⚠ {value}
              </mark>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
