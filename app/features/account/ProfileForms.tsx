import { type ReactNode, type Ref, useEffect, useRef } from "react";
import { Form } from "react-router";
import { Button } from "~/components/ui/Button";
import { TextField } from "~/components/ui/TextField";
import { FormAlert } from "~/features/auth/AuthLayout";
import type { AccountProfile } from "~/lib/account";
import type { AuthFormErrors, ProfileFields, ProfileIntent } from "~/lib/auth";
import { type TextKey, useT } from "~/lib/i18n";

// The three forms of `/account/profile` (#54). Each posts on its own with a hidden `intent`, so
// they work without JavaScript; the route passes a panel only the action result for its intent.

/** The action's result for one panel: saved, or the errors to show. */
export type PanelResult<Intent extends ProfileIntent> =
  | { ok: true }
  | ({ ok: false } & AuthFormErrors<ProfileFields[Intent]>);

interface PanelProps<Intent extends ProfileIntent> {
  profile: AccountProfile;
  result?: PanelResult<Intent>;
  /** This panel's form is being sent. */
  submitting: boolean;
}

function Panel({
  intent,
  heading,
  description,
  saved,
  formError,
  submit,
  submitting,
  formRef,
  children,
}: {
  intent: ProfileIntent;
  heading: string;
  description?: ReactNode;
  saved?: string;
  formError?: TextKey;
  submit: string;
  submitting: boolean;
  formRef?: Ref<HTMLFormElement>;
  children: ReactNode;
}) {
  const { t } = useT();
  const headingId = `profile-${intent}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-5 rounded-card border-2 border-line bg-white p-6 md:p-7"
    >
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="text-2xl font-bold tracking-[-0.01em] text-ink">
          {heading}
        </h3>
        {description && <p className="break-words text-muted">{description}</p>}
      </div>
      {saved && (
        <p role="status" className="rounded-2xl bg-success-bg px-5 py-3.5 font-bold text-success">
          {saved}
        </p>
      )}
      {formError && <FormAlert>{t(formError)}</FormAlert>}
      <Form
        ref={formRef}
        method="post"
        aria-labelledby={headingId}
        className="flex flex-col gap-4"
        noValidate
      >
        <input type="hidden" name="intent" value={intent} />
        {children}
        <div>
          <Button type="submit" loading={submitting}>
            {submitting ? t("account.profile.submitting") : submit}
          </Button>
        </div>
      </Form>
    </section>
  );
}

/** Clears the form's inputs after a successful save (password fields, the new email). */
function useResetOnSuccess(result: { ok: boolean } | undefined) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (result?.ok) ref.current?.reset();
  }, [result]);
  return ref;
}

const fieldError = (t: (key: TextKey) => string, key: TextKey | undefined) => key && t(key);

export function ContactPanel({ profile, result, submitting }: PanelProps<"contact">) {
  const { t } = useT();
  const errors = result?.ok === false ? result : undefined;

  return (
    <Panel
      intent="contact"
      heading={t("account.profile.contact.heading")}
      saved={result?.ok ? t("account.profile.contact.saved") : undefined}
      formError={errors?.formError}
      submit={t("account.profile.contact.submit")}
      submitting={submitting}
    >
      <TextField
        name="fullName"
        label={t("auth.fields.fullName")}
        autoComplete="name"
        defaultValue={errors?.values?.fullName ?? profile.fullName}
        error={fieldError(t, errors?.fieldErrors?.fullName)}
      />
      <TextField
        name="phone"
        label={t("auth.fields.phone")}
        type="tel"
        autoComplete="tel"
        placeholder="+380"
        optional
        defaultValue={errors?.values?.phone ?? profile.phone ?? ""}
        error={fieldError(t, errors?.fieldErrors?.phone)}
      />
    </Panel>
  );
}

export function EmailPanel({ profile, result, submitting }: PanelProps<"email">) {
  const { t } = useT();
  const errors = result?.ok === false ? result : undefined;
  const formRef = useResetOnSuccess(result);

  return (
    <Panel
      intent="email"
      heading={t("account.profile.email.heading")}
      description={t("account.profile.email.current", { email: profile.email })}
      saved={result?.ok ? t("account.profile.email.saved") : undefined}
      formError={errors?.formError}
      submit={t("account.profile.email.submit")}
      submitting={submitting}
      formRef={formRef}
    >
      <TextField
        name="email"
        label={t("account.profile.email.newEmail")}
        type="email"
        autoComplete="email"
        defaultValue={errors?.values?.email}
        error={fieldError(t, errors?.fieldErrors?.email)}
      />
      <TextField
        name="currentPassword"
        id="field-email-currentPassword"
        label={t("account.profile.password.current")}
        type="password"
        autoComplete="current-password"
        error={fieldError(t, errors?.fieldErrors?.currentPassword)}
      />
    </Panel>
  );
}

export function PasswordPanel({ profile, result, submitting }: PanelProps<"password">) {
  const { t } = useT();
  const errors = result?.ok === false ? result : undefined;
  const formRef = useResetOnSuccess(result);

  return (
    <Panel
      intent="password"
      heading={t("account.profile.password.heading")}
      saved={result?.ok ? t("account.profile.password.saved") : undefined}
      formError={errors?.formError}
      submit={t("account.profile.password.submit")}
      submitting={submitting}
      formRef={formRef}
    >
      {/* Tells password managers which account the new password belongs to. */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        value={profile.email}
        readOnly
        hidden
      />
      <TextField
        name="currentPassword"
        id="field-password-currentPassword"
        label={t("account.profile.password.current")}
        type="password"
        autoComplete="current-password"
        error={fieldError(t, errors?.fieldErrors?.currentPassword)}
      />
      <TextField
        name="newPassword"
        label={t("account.profile.password.new")}
        type="password"
        autoComplete="new-password"
        hint={t("account.profile.password.hint")}
        error={fieldError(t, errors?.fieldErrors?.newPassword)}
      />
      <TextField
        name="confirmNewPassword"
        label={t("account.profile.password.confirm")}
        type="password"
        autoComplete="new-password"
        error={fieldError(t, errors?.fieldErrors?.confirmNewPassword)}
      />
    </Panel>
  );
}
