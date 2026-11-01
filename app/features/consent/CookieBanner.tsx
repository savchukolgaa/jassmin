import { useEffect, useId, useState } from "react";
import { Form, Link, useLocation, useNavigation } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import { PRIVACY_POLICY_PATH } from "~/lib/consent";
import { useT } from "~/lib/i18n";

/**
 * Asks for analytics consent until the visitor answers (#18). A plain form post to `/consent`,
 * which stores the answer and comes back to this page, so it works without JS. Accept and Decline
 * are equally prominent.
 */
export function CookieBanner() {
  const { t } = useT();
  const titleId = useId();
  const { pathname, search } = useLocation();
  const navigation = useNavigation();
  // Only known in the browser: where the visitor came from, so an accepted visit keeps its source.
  const [referrer, setReferrer] = useState("");
  useEffect(() => {
    setReferrer(document.referrer);
  }, []);

  // Hide as soon as an answer is on its way.
  if (navigation.formAction === "/consent") {
    return null;
  }

  return (
    <section
      aria-labelledby={titleId}
      className="fixed inset-x-0 bottom-0 z-50 p-4 animate-fade-up"
    >
      <Form
        method="post"
        action="/consent"
        className="mx-auto flex max-w-3xl flex-col gap-4 rounded-card border border-line bg-white p-5 text-ink shadow-xl sm:flex-row sm:items-end sm:gap-6"
      >
        <input type="hidden" name="redirectTo" value={pathname + search} />
        {referrer && <input type="hidden" name="referrer" value={referrer} />}
        <div className="flex-1">
          <h2 id={titleId} className="text-lg font-bold">
            {t("consent.title")}
          </h2>
          <p className="mt-1 text-sm text-body">
            {t("consent.message")}{" "}
            <Link
              to={PRIVACY_POLICY_PATH}
              className={`rounded-pill font-bold text-primary-dark underline ${focusRing("onLight")}`}
            >
              {t("consent.learnMore")}
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="submit" name="consent" value="granted" size="sm" className="flex-1">
            {t("consent.accept")}
          </Button>
          <Button
            type="submit"
            name="consent"
            value="denied"
            variant="dark"
            size="sm"
            className="flex-1"
          >
            {t("consent.decline")}
          </Button>
        </div>
      </Form>
    </section>
  );
}
