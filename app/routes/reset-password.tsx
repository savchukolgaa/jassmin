import { data, Form, useNavigation } from "react-router";
import { db } from "~/.server/db";
import { touchLastLogin } from "~/.server/db/queries/users";
import { getLocale } from "~/.server/locale";
import { loginLimiters } from "~/.server/rate-limit";
import { onUserAuthenticated } from "~/.server/services/auth";
import { inspectResetToken, resetPassword } from "~/.server/services/password-reset";
import { createUserSession } from "~/.server/session";
import { Button } from "~/components/ui/Button";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { TextField } from "~/components/ui/TextField";
import { AuthLayout } from "~/features/auth/AuthLayout";
import { AuthTokenError } from "~/features/auth/AuthTokenError";
import type { AuthFormErrors, ResetPasswordField, AuthTokenError as TokenError } from "~/lib/auth";
import { authTokenSchema, resetPasswordSchema, toFieldErrors } from "~/lib/auth.schema";
import { metaTranslator, usePathFor, useT } from "~/lib/i18n";
import { pathFor } from "~/lib/paths";
import { errorMeta, noindexMeta } from "~/lib/seo";
import type { Route } from "./+types/reset-password";

// The page a password reset email links to (#135). The loader only checks the token, so a mail
// scanner opening the link never uses it up; the action sets the password, logs the user in and,
// through `users.password_changed_at`, logs out their other sessions.

const FIELDS = ["password", "confirmPassword"] as const satisfies ResetPasswordField[];

export type ResetPasswordActionData =
  | { tokenError: TokenError }
  | (AuthFormErrors<ResetPasswordField> & { tokenError?: undefined });

export function meta({ matches, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return noindexMeta(t("meta.title", { page: t("auth.reset.title") }));
}

/** The token stays out of other sites' `Referer` and out of every cache. */
export function headers() {
  return { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
}

export async function loader({ params }: Route.LoaderArgs) {
  const token = authTokenSchema.safeParse(params.token);
  if (!token.success) return { tokenError: "unknown" as TokenError };
  const check = await inspectResetToken(token.data);
  return { tokenError: check.ok ? undefined : check.error };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const token = authTokenSchema.safeParse(params.token);
  if (!token.success) {
    return data<ResetPasswordActionData>({ tokenError: "unknown" }, { status: 400 });
  }
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    return data<ResetPasswordActionData>(
      { fieldErrors: toFieldErrors(parsed.error, FIELDS) },
      { status: 400 },
    );
  }

  const result = await resetPassword({ token: token.data, password: parsed.data.password });
  if (!result.ok) {
    return data<ResetPasswordActionData>({ tokenError: result.error }, { status: 400 });
  }

  await touchLastLogin(db, result.userId);
  await loginLimiters.byEmail.reset(result.email);
  await onUserAuthenticated({ request, context }, result.userId, "password_reset");
  return createUserSession({
    request,
    userId: result.userId,
    redirectTo: pathFor(await getLocale(request), "account"),
    // The change time: this session survives the revocation of every older one.
    authenticatedAt: result.changedAt,
  });
}

export default function ResetPassword({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useT();
  const path = usePathFor();
  const submitting = useNavigation().state === "submitting";
  const tokenError = actionData?.tokenError ?? loaderData.tokenError;
  const errors = actionData && !actionData.tokenError ? actionData.fieldErrors : undefined;

  return (
    <AuthLayout mode="reset">
      {tokenError ? (
        <AuthTokenError error={tokenError}>
          <ButtonLink to={path("forgotPassword")} size="lg" className="rounded-full">
            {t("auth.reset.requestNew")}
          </ButtonLink>
        </AuthTokenError>
      ) : (
        <Form
          method="post"
          aria-label={t("auth.reset.form")}
          className="flex flex-col gap-4"
          noValidate
        >
          <TextField
            name="password"
            label={t("auth.reset.fields.password")}
            type="password"
            autoComplete="new-password"
            hint={t("auth.fields.passwordHint")}
            error={errors?.password && t(errors.password)}
          />
          <TextField
            name="confirmPassword"
            label={t("auth.reset.fields.confirmPassword")}
            type="password"
            autoComplete="new-password"
            error={errors?.confirmPassword && t(errors.confirmPassword)}
          />
          <Button type="submit" size="lg" className="rounded-full" loading={submitting}>
            {t("auth.reset.submit")}
          </Button>
        </Form>
      )}
    </AuthLayout>
  );
}
