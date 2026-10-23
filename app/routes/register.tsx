import { data, Form, redirect, useNavigation } from "react-router";
import { db } from "~/.server/db";
import { getUser, onUserAuthenticated, registerUser } from "~/.server/services/auth";
import { createUserSession } from "~/.server/session";
import { Button } from "~/components/ui/Button";
import { AuthLayout, FormAlert } from "~/features/auth/AuthLayout";
import { TextField } from "~/features/auth/TextField";
import {
  type AuthFormErrors,
  type RegisterField,
  registerSchema,
  resolveAcquisitionChannel,
  safeRedirect,
  toFieldErrors,
} from "~/lib/auth";
import type { Route } from "./+types/register";

const FIELDS = ["fullName", "email", "password", "phone"] as const satisfies RegisterField[];

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Sign up — Jassmin" }];
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

export async function action({ request }: Route.ActionArgs) {
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
      { fieldErrors: { email: "An account with this email already exists." }, values },
      { status: 400 },
    );
  }

  await onUserAuthenticated(request, result.userId, "register");
  return createUserSession({
    request,
    userId: result.userId,
    redirectTo: safeRedirect(redirectTo),
  });
}

export default function Register({ loaderData, actionData }: Route.ComponentProps) {
  const submitting = useNavigation().state === "submitting";
  const errors = actionData?.fieldErrors;
  const values = actionData?.values;

  return (
    <AuthLayout mode="register" redirectTo={loaderData.redirectTo}>
      <Form method="post" aria-label="Create account" className="flex flex-col gap-4" noValidate>
        {actionData?.formError && <FormAlert>{actionData.formError}</FormAlert>}
        <TextField
          name="fullName"
          label="Full name"
          autoComplete="name"
          defaultValue={values?.fullName}
          error={errors?.fullName}
        />
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          defaultValue={values?.email}
          error={errors?.email}
        />
        <TextField
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          error={errors?.password}
        />
        <TextField
          name="phone"
          label="Phone"
          type="tel"
          autoComplete="tel"
          placeholder="+380"
          optional
          defaultValue={values?.phone}
          error={errors?.phone}
        />
        <input type="hidden" name="acquisitionChannel" value={loaderData.acquisitionChannel} />
        {loaderData.redirectTo && (
          <input type="hidden" name="redirectTo" value={loaderData.redirectTo} />
        )}
        <Button type="submit" size="lg" className="rounded-full" loading={submitting}>
          Create account
        </Button>
      </Form>
    </AuthLayout>
  );
}
