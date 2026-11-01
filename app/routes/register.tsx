import { data, Form, Link, redirect, useNavigation } from "react-router";
import { db } from "~/.server/db";
import { getUser, onUserAuthenticated, registerUser } from "~/.server/services/auth";
import { createUserSession } from "~/.server/session";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import { TextField } from "~/components/ui/TextField";
import { AuthLayout, FormAlert } from "~/features/auth/AuthLayout";
import {
  type AuthFormErrors,
  type RegisterField,
  registerSchema,
  resolveAcquisitionChannel,
  safeRedirect,
  toFieldErrors,
} from "~/lib/auth";
import { PRIVACY_POLICY_PATH } from "~/lib/consent";
import { metaTranslator, useT } from "~/lib/i18n";
import { errorMeta, noindexMeta } from "~/lib/seo";
import type { Route } from "./+types/register";

const FIELDS = ["fullName", "email", "password", "phone"] as const satisfies RegisterField[];

// Private or transactional: kept out of search results (#85).
export function meta({ matches, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return noindexMeta(t("meta.title", { page: t("auth.register.title") }));
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirectTo") ?? undefined;
  if (await getUser(request)) {
    throw redirect(safeRedirect(redirectTo));
  }
  // Worked out here, not in the action: when the form is posted, the referrer is this page.
  return {
    redirectTo,
    acquisitionChannel: resolveAcquisitionChannel(url, request.headers.get("Referer")),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  // Refill the form after an error; the password is never sent back.
  const values = {
    fullName: String(formData.get("fullName") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  };
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return data<AuthFormErrors<RegisterField>>(
      { fieldErrors: toFieldErrors(parsed.error, FIELDS), values },
      { status: 400 },
    );
  }

  const { redirectTo, ...registration } = parsed.data;
  const result = await registerUser(db, registration);
  if (!result.ok) {
    return data<AuthFormErrors<RegisterField>>(
      { fieldErrors: { email: "auth.errors.emailTaken" }, values },
      { status: 400 },
    );
  }

  await onUserAuthenticated({ request, context }, result.userId, "register");
  return createUserSession({
    request,
    userId: result.userId,
    redirectTo: safeRedirect(redirectTo),
  });
}

export default function Register({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useT();
  const submitting = useNavigation().state === "submitting";
  const errors = actionData?.fieldErrors;
  const values = actionData?.values;

  return (
    <AuthLayout mode="register" redirectTo={loaderData.redirectTo}>
      <Form
        method="post"
        aria-label={t("auth.register.form")}
        className="flex flex-col gap-4"
        noValidate
      >
        {actionData?.formError && <FormAlert>{t(actionData.formError)}</FormAlert>}
        <TextField
          name="fullName"
          label={t("auth.fields.fullName")}
          autoComplete="name"
          defaultValue={values?.fullName}
          error={errors?.fullName && t(errors.fullName)}
        />
        <TextField
          name="email"
          label={t("auth.fields.email")}
          type="email"
          autoComplete="email"
          defaultValue={values?.email}
          error={errors?.email && t(errors.email)}
        />
        <TextField
          name="password"
          label={t("auth.fields.password")}
          type="password"
          autoComplete="new-password"
          hint={t("auth.fields.passwordHint")}
          error={errors?.password && t(errors.password)}
        />
        <TextField
          name="phone"
          label={t("auth.fields.phone")}
          type="tel"
          autoComplete="tel"
          placeholder="+380"
          optional
          defaultValue={values?.phone}
          error={errors?.phone && t(errors.phone)}
        />
        <input type="hidden" name="acquisitionChannel" value={loaderData.acquisitionChannel} />
        {loaderData.redirectTo && (
          <input type="hidden" name="redirectTo" value={loaderData.redirectTo} />
        )}
        <p className="text-sm text-muted">
          {t("auth.register.privacyNotice")}{" "}
          <Link
            to={PRIVACY_POLICY_PATH}
            className={`rounded-pill font-bold text-primary-dark underline ${focusRing("onLight")}`}
          >
            {t("auth.register.privacyLink")}
          </Link>
          .
        </p>
        <Button type="submit" size="lg" className="rounded-full" loading={submitting}>
          {t("auth.register.submit")}
        </Button>
      </Form>
    </AuthLayout>
  );
}
