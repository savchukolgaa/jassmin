import { data, Form, Link, redirect, useNavigation } from "react-router";
import { getEnv, getSiteUrl } from "~/.server/env";
import { getLocale } from "~/.server/locale";
import { getClientIp, passwordResetLimiters } from "~/.server/rate-limit";
import { getUser } from "~/.server/services/auth";
import { requestPasswordReset } from "~/.server/services/password-reset";
import { Button } from "~/components/ui/Button";
import { TextField } from "~/components/ui/TextField";
import { AuthLayout, FormAlert, FormNotice } from "~/features/auth/AuthLayout";
import type { AuthFormErrors, ForgotPasswordField } from "~/lib/auth";
import { forgotPasswordSchema, toFieldErrors } from "~/lib/auth.schema";
import { metaTranslator, usePathFor, useT } from "~/lib/i18n";
import { pathFor } from "~/lib/paths";
import { errorMeta, noindexMeta } from "~/lib/seo";
import type { Route } from "./+types/forgot-password";

// "Forgot password?" (#135): asks for a reset link by email. The answer is the same whether the
// email is registered or not, and so is its timing: the email goes out after the response.

const FIELDS = ["email"] as const satisfies ForgotPasswordField[];

export type ForgotPasswordActionData = { sent: true } | AuthFormErrors<ForgotPasswordField>;

export function meta({ matches, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return noindexMeta(t("meta.title", { page: t("auth.forgot.title") }));
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUser(request)) {
    throw redirect(pathFor(await getLocale(request), "account"));
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const values = { email: String(formData.get("email") ?? "") };
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return data<ForgotPasswordActionData>(
      { fieldErrors: toFieldErrors(parsed.error, FIELDS), values },
      { status: 400 },
    );
  }

  const { email } = parsed.data;
  const ip = getClientIp(request);
  if (
    passwordResetLimiters.byEmail.isBlocked(email) ||
    (ip && passwordResetLimiters.byIp.isBlocked(ip))
  ) {
    return data<ForgotPasswordActionData>(
      { formError: "auth.errors.tooManyRequests", values },
      { status: 429 },
    );
  }
  // Counted for every email, registered or not, so the limit says nothing about accounts.
  passwordResetLimiters.byEmail.hit(email);
  if (ip) passwordResetLimiters.byIp.hit(ip);

  const locale = await getLocale(request);
  // Not awaited: looking the account up and sending happen after the answer.
  void requestPasswordReset({ email, locale, siteUrl: getSiteUrl(getEnv(), request) });
  return data<ForgotPasswordActionData>({ sent: true });
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const { t } = useT();
  const path = usePathFor();
  const submitting = useNavigation().state === "submitting";
  const sent = actionData !== undefined && "sent" in actionData;
  const errors = actionData && !sent ? actionData : undefined;

  return (
    <AuthLayout mode="forgot">
      <Form
        method="post"
        aria-label={t("auth.forgot.form")}
        className="flex flex-col gap-4"
        noValidate
      >
        {sent && <FormNotice>{t("auth.forgot.sent")}</FormNotice>}
        {errors?.formError && <FormAlert>{t(errors.formError)}</FormAlert>}
        <TextField
          name="email"
          label={t("auth.fields.email")}
          type="email"
          autoComplete="email"
          defaultValue={errors?.values?.email}
          error={errors?.fieldErrors?.email && t(errors.fieldErrors.email)}
        />
        <Button type="submit" size="lg" className="rounded-full" loading={submitting}>
          {t("auth.forgot.submit")}
        </Button>
        <Link to={path("login")} className="self-start font-bold text-primary-dark underline">
          {t("auth.forgot.backToLogin")}
        </Link>
      </Form>
    </AuthLayout>
  );
}
