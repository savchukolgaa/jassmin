import { data, Form, useNavigation } from "react-router";
import { db } from "~/.server/db";
import { getEnv } from "~/.server/env";
import { inspectUnsubscribeToken, unsubscribeMarketing } from "~/.server/services/marketing";
import { Button } from "~/components/ui/Button";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { FormNotice } from "~/features/auth/AuthLayout";
import { metaTranslator, usePathFor, useT } from "~/lib/i18n";
import { errorMeta, noindexMeta } from "~/lib/seo";
import { unsubscribeFormSchema, unsubscribeTokenSchema } from "~/lib/unsubscribe.schema";
import type { Route } from "./+types/unsubscribe";

// The unsubscribe link in marketing emails (#139). The loader only checks the token, so a mail
// scanner opening the link changes nothing; the button posts the form. The same URL is the
// email's `List-Unsubscribe` target, so a mail client's one-click POST (RFC 8058, body
// `List-Unsubscribe=One-Click`, no cookies) lands in the same action and gets a 200.

export type UnsubscribeActionData = { unsubscribed: true } | { error: "invalid-token" | "invalid" };

export function meta({ matches, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return noindexMeta(t("meta.title", { page: t("unsubscribe.title") }));
}

/** The token stays out of other sites' `Referer` and out of every cache. */
export function headers() {
  return { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
}

export function loader({ params }: Route.LoaderArgs) {
  const token = unsubscribeTokenSchema.safeParse(params.token);
  const valid =
    token.success && inspectUnsubscribeToken(token.data, { env: getEnv() }) !== undefined;
  return { valid };
}

export async function action({ request, params }: Route.ActionArgs) {
  const token = unsubscribeTokenSchema.safeParse(params.token);
  if (!token.success) {
    return data<UnsubscribeActionData>({ error: "invalid-token" }, { status: 400 });
  }
  const formData = await request.formData().catch(() => new FormData());
  const form = unsubscribeFormSchema.safeParse(Object.fromEntries(formData));
  if (!form.success) {
    return data<UnsubscribeActionData>({ error: "invalid" }, { status: 400 });
  }
  const result = await unsubscribeMarketing(token.data, { db, env: getEnv() });
  if (!result.ok) {
    return data<UnsubscribeActionData>({ error: result.error }, { status: 400 });
  }
  return data<UnsubscribeActionData>({ unsubscribed: true });
}

export default function Unsubscribe({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useT();
  const path = usePathFor();
  const submitting = useNavigation().state === "submitting";
  const done = actionData !== undefined && "unsubscribed" in actionData;
  const invalid = !loaderData.valid || (actionData !== undefined && "error" in actionData);

  return (
    <main className="container mx-auto px-4 pt-14 pb-20">
      <section
        aria-labelledby="unsubscribe-heading"
        className="mx-auto flex max-w-xl flex-col items-start gap-5 rounded-[40px] bg-white p-8 sm:p-12"
      >
        <h1 id="unsubscribe-heading" className="text-3xl font-bold text-ink sm:text-4xl">
          {t(done ? "unsubscribe.doneHeadline" : "unsubscribe.headline")}
        </h1>
        {done ? (
          <>
            <FormNotice>{t("unsubscribe.doneSub")}</FormNotice>
            <p className="text-body">{t("unsubscribe.changeLater")}</p>
            <ButtonLink to={path("home")} size="lg" className="rounded-full">
              {t("unsubscribe.toShop")}
            </ButtonLink>
          </>
        ) : invalid ? (
          <>
            <p role="alert" className="text-body">
              {t("unsubscribe.invalid")}
            </p>
            <ButtonLink to={path("accountProfile")} size="lg" className="rounded-full">
              {t("unsubscribe.toProfile")}
            </ButtonLink>
          </>
        ) : (
          <>
            <p className="text-body">{t("unsubscribe.sub")}</p>
            <Form method="post" aria-label={t("unsubscribe.form")}>
              <Button type="submit" size="lg" className="rounded-full" loading={submitting}>
                {t("unsubscribe.submit")}
              </Button>
            </Form>
          </>
        )}
      </section>
    </main>
  );
}
