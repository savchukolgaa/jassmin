import type { Translator } from "~/lib/i18n";
import type { OfferView } from "~/lib/offers";

/** "Valid until 8 January 2027" / "Діє до 27 листопада 2026 р., 23:59", or `null`. */
export function validUntilText(
  validUntil: OfferView["validUntil"],
  t: Translator["t"],
): string | null {
  if (!validUntil) {
    return null;
  }
  return validUntil.time
    ? t("offers.validUntilAt", { date: validUntil.date, time: validUntil.time })
    : t("offers.validUntil", { date: validUntil.date });
}

/** The CTA label, or the default when the editor left it blank. */
export function ctaLabel(cta: NonNullable<OfferView["cta"]>, t: Translator["t"]): string {
  return cta.label ?? t("offers.defaultCta");
}
