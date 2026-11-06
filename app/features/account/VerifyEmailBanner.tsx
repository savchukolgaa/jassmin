import { Form } from "react-router";
import { Button } from "~/components/ui/Button";
import { type TextKey, useT } from "~/lib/i18n";

/** The account index action's intent that resends the verification email (#135). */
export const RESEND_VERIFICATION_INTENT = "resend-verification";

/**
 * "Confirm your email" on the account page (#135), shown until the email is confirmed, with a
 * button that sends the link again.
 */
export function VerifyEmailBanner({
  email,
  resent,
  error,
  submitting,
}: {
  email: string;
  /** The link was just sent again. */
  resent: boolean;
  error?: TextKey;
  submitting: boolean;
}) {
  const { t } = useT();
  return (
    <section
      aria-labelledby="verify-email-heading"
      className="flex flex-col items-start gap-3 rounded-card-lg bg-blush p-6 md:p-8"
    >
      <h2 id="verify-email-heading" className="text-2xl font-bold text-ink">
        {t("account.verifyBanner.title")}
      </h2>
      <p className="max-w-xl text-body">{t("account.verifyBanner.body", { email })}</p>
      {resent && (
        <p role="status" className="rounded-2xl bg-success-bg px-4 py-3 font-bold text-success">
          {t("account.verifyBanner.resent", { email })}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-800">
          {t(error)}
        </p>
      )}
      <Form method="post">
        <input type="hidden" name="intent" value={RESEND_VERIFICATION_INTENT} />
        <Button type="submit" variant="dark" loading={submitting}>
          {t("account.verifyBanner.resend")}
        </Button>
      </Form>
    </section>
  );
}
