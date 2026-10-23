import { data, Form, redirect, useNavigation } from "react-router";
import { db } from "~/.server/db";
import { getClientIp, loginLimiters } from "~/.server/rate-limit";
import { getUser, onUserAuthenticated, verifyLogin } from "~/.server/services/auth";
import { createUserSession } from "~/.server/session";
import { Button } from "~/components/ui/Button";
import { AuthLayout, FormAlert } from "~/features/auth/AuthLayout";
import { TextField } from "~/features/auth/TextField";
import {
  type AuthFormErrors,
  type LoginField,
  loginSchema,
  safeRedirect,
  toFieldErrors,
} from "~/lib/auth";
import { metaTranslator, useT } from "~/lib/i18n";
import type { Route } from "./+types/login";

const FIELDS = ["email", "password"] as const satisfies LoginField[];

export function meta({ matches }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  return [{ title: t("meta.title", { page: t("auth.login.title") }) }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const redirectTo = new URL(request.url).searchParams.get("redirectTo") ?? undefined;
  if (await getUser(request)) {
    throw redirect(safeRedirect(redirectTo));
  }
  return { redirectTo };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  // Refill the form after an error; the password is never sent back.
  const values = { email: String(formData.get("email") ?? "") };
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return data<AuthFormErrors<LoginField>>(
      { fieldErrors: toFieldErrors(parsed.error, FIELDS), values },
      { status: 400 },
    );
  }

  const { email, password, redirectTo } = parsed.data;
  const ip = getClientIp(request);
  if (loginLimiters.byEmail.isBlocked(email) || (ip && loginLimiters.byIp.isBlocked(ip))) {
    return data<AuthFormErrors<LoginField>>(
      { formError: "auth.errors.tooManyAttempts", values },
      { status: 429 },
    );
  }

  const result = await verifyLogin(db, email, password);
  if (!result.ok) {
    loginLimiters.byEmail.hit(email);
    if (ip) loginLimiters.byIp.hit(ip);
    // The same message for an unknown email and a wrong password.
    return data<AuthFormErrors<LoginField>>(
      { formError: "auth.errors.invalidCredentials", values },
      { status: 400 },
    );
  }

  loginLimiters.byEmail.reset(email);
  await onUserAuthenticated(request, result.userId, "login");
  return createUserSession({
    request,
    userId: result.userId,
    redirectTo: safeRedirect(redirectTo),
  });
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useT();
  const submitting = useNavigation().state === "submitting";
  const errors = actionData?.fieldErrors;

  return (
    <AuthLayout mode="login" redirectTo={loaderData.redirectTo}>
      <Form
        method="post"
        aria-label={t("auth.login.form")}
        className="flex flex-col gap-4"
        noValidate
      >
        {actionData?.formError && <FormAlert>{t(actionData.formError)}</FormAlert>}
        <TextField
          name="email"
          label={t("auth.fields.email")}
          type="email"
          autoComplete="email"
          defaultValue={actionData?.values?.email}
          error={errors?.email && t(errors.email)}
        />
        <TextField
          name="password"
          label={t("auth.fields.password")}
          type="password"
          autoComplete="current-password"
          error={errors?.password && t(errors.password)}
        />
        {loaderData.redirectTo && (
          <input type="hidden" name="redirectTo" value={loaderData.redirectTo} />
        )}
        <Button type="submit" size="lg" className="rounded-full" loading={submitting}>
          {t("auth.login.submit")}
        </Button>
      </Form>
    </AuthLayout>
  );
}
