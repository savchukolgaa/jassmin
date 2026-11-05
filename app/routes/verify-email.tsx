import { data, Form, useNavigation } from "react-router";
import { getUser } from "~/.server/services/auth";
import { inspectVerificationToken, verifyEmail } from "~/.server/services/email-verification";
import { Button } from "~/components/ui/Button";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { AuthLayout, FormNotice } from "~/features/auth/AuthLayout";
import { AuthTokenError } from "~/features/auth/AuthTokenError";
import type { AuthTokenError as TokenError } from "~/lib/auth";
import { authTokenSchema } from "~/lib/auth.schema";
import { metaTranslator, usePathFor, useT } from "~/lib/i18n";
import { errorMeta, noindexMeta } from "~/lib/seo";
import type { Route } from "./+types/verify-email";

// The page a verification email links to (#135). The loader only checks the token, so a mail
// scanner opening the link doesn't confirm anything; the "Confirm my email" button does.

export type VerifyEmailActionData = { verified: true } | { tokenError: TokenError };

export function meta({ matches, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return noindexMeta(t("meta.title", { page: t("auth.verify.title") }));
}

/** The token stays out of other sites' `Referer` and out of every cache. */
export function headers() {
  return { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const loggedIn = (await getUser(request)) !== null;
  const token = authTokenSchema.safeParse(params.token);
  if (!token.success) return { loggedIn, tokenError: "unknown" as TokenError };
  const check = await inspectVerificationToken(token.data);
  return { loggedIn, tokenError: check.ok ? undefined : check.error };
}

export async function action({ params }: Route.ActionArgs) {
  const token = authTokenSchema.safeParse(params.token);
  if (!token.success) {
    return data<VerifyEmailActionData>({ tokenError: "unknown" }, { status: 400 });
  }
  const result = await verifyEmail(token.data);
  if (!result.ok) {
    return data<VerifyEmailActionData>({ tokenError: result.error }, { status: 400 });
  }
  return data<VerifyEmailActionData>({ verified: true });
}

export default function VerifyEmail({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useT();
  const path = usePathFor();
  const submitting = useNavigation().state === "submitting";
  const next = loaderData.loggedIn
    ? { to: path("account"), label: t("auth.verify.toAccount") }
    : { to: path("login"), label: t("auth.verify.toLogin") };

  // After confirming, the loader sees a used token: the action's answer wins.
  if (actionData && "verified" in actionData) {
    return (
      <AuthLayout mode="verify">
        <div className="flex flex-col items-start gap-4">
          <h2 className="text-3xl font-bold text-ink">{t("auth.verify.doneHeadline")}</h2>
          <FormNotice>{t("auth.verify.doneSub")}</FormNotice>
          <ButtonLink to={next.to} size="lg" className="rounded-full">
            {next.label}
          </ButtonLink>
        </div>
      </AuthLayout>
    );
  }

  const tokenError =
    actionData && "tokenError" in actionData ? actionData.tokenError : loaderData.tokenError;
  return (
    <AuthLayout mode="verify">
      {tokenError ? (
        <AuthTokenError error={tokenError}>
          <p>{t("auth.verify.resendHint")}</p>
          <ButtonLink to={next.to} size="lg" className="rounded-full">
            {next.label}
          </ButtonLink>
        </AuthTokenError>
      ) : (
        <Form method="post" aria-label={t("auth.verify.form")} className="flex flex-col gap-4">
          <Button type="submit" size="lg" className="rounded-full" loading={submitting}>
            {t("auth.verify.submit")}
          </Button>
        </Form>
      )}
    </AuthLayout>
  );
}
