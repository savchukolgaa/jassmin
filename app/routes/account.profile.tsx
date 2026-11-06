import { data, useNavigation } from "react-router";
import { getEnv, getSiteUrl } from "~/.server/env";
import { getLocale } from "~/.server/locale";
import { profilePasswordLimiter } from "~/.server/rate-limit";
import { type PublicUser, requireUser } from "~/.server/services/auth";
import { sendVerificationEmail } from "~/.server/services/email-verification";
import {
  changeEmail,
  changePassword,
  getProfile,
  notifyEmailChanged,
  updateContact,
  updateMarketingOptIn,
} from "~/.server/services/profile";
import { renewSessionAuth } from "~/.server/session";
import {
  ContactPanel,
  EmailPanel,
  MarketingPanel,
  type PanelResult,
  PasswordPanel,
} from "~/features/account/ProfileForms";
import { FormAlert } from "~/features/auth/AuthLayout";
import type {
  ChangeEmailField,
  ChangePasswordField,
  ContactField,
  ProfileActionData,
  ProfileIntent,
} from "~/lib/auth";
import {
  changeEmailSchema,
  changePasswordSchema,
  contactSchema,
  marketingSchema,
  profileIntentSchema,
  toFieldErrors,
} from "~/lib/auth.schema";
import { metaTranslator, useT } from "~/lib/i18n";
import { errorMeta, noindexMeta } from "~/lib/seo";
import type { Route } from "./+types/account.profile";

const CONTACT_FIELDS = ["fullName", "phone"] as const satisfies ContactField[];
const EMAIL_FIELDS = ["email", "currentPassword"] as const satisfies ChangeEmailField[];
const PASSWORD_FIELDS = [
  "currentPassword",
  "newPassword",
  "confirmNewPassword",
] as const satisfies ChangePasswordField[];

// Private or transactional: kept out of search results (#85).
export function meta({ matches, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return noindexMeta(t("meta.title", { page: t("account.profile.title") }));
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

// The account layout's loader doesn't protect this one: loaders run in parallel.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return getProfile(user.id);
}

const reply = (result: ProfileActionData, status = 200, headers?: HeadersInit) =>
  data<ProfileActionData>(result, { status, headers });

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const formData = await request.formData();
  const intent = profileIntentSchema.safeParse(formData.get("intent"));
  if (!intent.success) {
    return reply(
      { ok: false, intent: null, formError: "account.profile.errors.invalidIntent" },
      400,
    );
  }

  switch (intent.data) {
    case "contact":
      return saveContact(user, formData);
    case "email":
      return saveEmail(user, formData, request);
    case "password":
      return savePassword(user, formData, request);
    case "marketing":
      return saveMarketing(user, formData);
  }
}

async function saveMarketing(user: PublicUser, formData: FormData) {
  // A checkbox can't be invalid: anything but a ticked box withdraws the consent.
  const { marketingOptIn } = marketingSchema.parse({
    marketingOptIn: formData.get("marketingOptIn") ?? undefined,
  });
  await updateMarketingOptIn(user.id, marketingOptIn);
  return reply({ ok: true, intent: "marketing" });
}

async function saveContact(user: PublicUser, formData: FormData) {
  const values = {
    fullName: String(formData.get("fullName") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  };
  const parsed = contactSchema.safeParse(values);
  if (!parsed.success) {
    return reply(
      {
        ok: false,
        intent: "contact",
        fieldErrors: toFieldErrors(parsed.error, CONTACT_FIELDS),
        values,
      },
      400,
    );
  }

  await updateContact(user.id, parsed.data);
  return reply({ ok: true, intent: "contact" });
}

const limiterKey = (user: PublicUser) => String(user.id);

async function saveEmail(user: PublicUser, formData: FormData, request: Request) {
  // Refill the new email after an error; the password is never sent back.
  const values = { email: String(formData.get("email") ?? "") };
  if (await profilePasswordLimiter.isBlocked(limiterKey(user))) {
    return reply(
      { ok: false, intent: "email", formError: "account.profile.errors.tooManyAttempts", values },
      429,
    );
  }
  const parsed = changeEmailSchema.safeParse({
    email: values.email,
    currentPassword: String(formData.get("currentPassword") ?? ""),
  });
  if (!parsed.success) {
    return reply(
      {
        ok: false,
        intent: "email",
        fieldErrors: toFieldErrors(parsed.error, EMAIL_FIELDS),
        values,
      },
      400,
    );
  }

  const { email, currentPassword } = parsed.data;
  const result = await changeEmail(user.id, currentPassword, email);
  if (!result.ok) {
    if (result.error === "wrong-password") await profilePasswordLimiter.hit(limiterKey(user));
    const fieldErrors =
      result.error === "wrong-password"
        ? { currentPassword: "account.profile.errors.currentPasswordWrong" as const }
        : { email: "auth.errors.emailTaken" as const };
    return reply({ ok: false, intent: "email", fieldErrors, values }, 400);
  }

  await profilePasswordLimiter.reset(limiterKey(user));
  if (result.previousEmail !== null) {
    const locale = await getLocale(request);
    void notifyEmailChanged({
      to: result.previousEmail,
      newEmail: email,
      fullName: user.fullName,
      locale,
    });
    // The new address starts unverified (#135): send it a confirmation link.
    void sendVerificationEmail({ userId: user.id, locale, siteUrl: getSiteUrl(getEnv(), request) });
  }
  return reply({ ok: true, intent: "email" });
}

async function savePassword(user: PublicUser, formData: FormData, request: Request) {
  if (await profilePasswordLimiter.isBlocked(limiterKey(user))) {
    return reply(
      { ok: false, intent: "password", formError: "account.profile.errors.tooManyAttempts" },
      429,
    );
  }
  const parsed = changePasswordSchema.safeParse({
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
    confirmNewPassword: String(formData.get("confirmNewPassword") ?? ""),
  });
  if (!parsed.success) {
    return reply(
      {
        ok: false,
        intent: "password",
        fieldErrors: toFieldErrors(parsed.error, PASSWORD_FIELDS),
      },
      400,
    );
  }

  const { currentPassword, newPassword } = parsed.data;
  const result = await changePassword(user.id, currentPassword, newPassword);
  if (!result.ok) {
    await profilePasswordLimiter.hit(limiterKey(user));
    return reply(
      {
        ok: false,
        intent: "password",
        fieldErrors: { currentPassword: "account.profile.errors.currentPasswordWrong" },
      },
      400,
    );
  }

  await profilePasswordLimiter.reset(limiterKey(user));
  // The change logs out every other session (#135); this one stays logged in.
  return reply({ ok: true, intent: "password" }, 200, {
    "Set-Cookie": await renewSessionAuth(request, result.changedAt),
  });
}

/** The action result for one panel, or `undefined` when the last post was another panel's. */
function resultFor<Intent extends ProfileIntent>(
  actionData: ProfileActionData | undefined,
  intent: Intent,
): PanelResult<Intent> | undefined {
  if (actionData?.intent !== intent) return undefined;
  return actionData as PanelResult<Intent>;
}

export default function AccountProfile({ loaderData, actionData }: Route.ComponentProps) {
  const { t, formatDate } = useT();
  const navigation = useNavigation();
  const sending = (intent: ProfileIntent) =>
    navigation.state === "submitting" && navigation.formData?.get("intent") === intent;
  const profile = loaderData;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-3xl font-bold tracking-[-0.01em] text-ink md:text-4xl">
          {t("account.profile.title")}
        </h2>
        <p className="text-muted">
          {t("account.profile.memberSince", { date: formatDate(profile.createdAt.toISOString()) })}
        </p>
      </div>
      {actionData?.intent === null && <FormAlert>{t(actionData.formError)}</FormAlert>}
      <ContactPanel
        profile={profile}
        result={resultFor(actionData, "contact")}
        submitting={sending("contact")}
      />
      <EmailPanel
        profile={profile}
        result={resultFor(actionData, "email")}
        submitting={sending("email")}
      />
      <PasswordPanel
        profile={profile}
        result={resultFor(actionData, "password")}
        submitting={sending("password")}
      />
      <MarketingPanel
        profile={profile}
        result={resultFor(actionData, "marketing")}
        submitting={sending("marketing")}
      />
    </div>
  );
}
