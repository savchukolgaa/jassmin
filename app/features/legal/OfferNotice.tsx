import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { type TextKey, usePathFor, useT } from "~/lib/i18n";

/**
 * "By placing an order, you accept the public offer." under a submit button (#190): placing the
 * order (or paying for a gift card) accepts the offer, with no extra checkbox.
 */
export function OfferNotice({ notice, link }: { notice: TextKey; link: TextKey }) {
  const { t } = useT();
  const path = usePathFor();
  return (
    <p className="text-sm text-muted">
      {t(notice)}{" "}
      <Link
        to={path("offerTerms")}
        className={`rounded-pill font-bold text-primary-dark underline ${focusRing("onLight")}`}
      >
        {t(link)}
      </Link>
      .
    </p>
  );
}
