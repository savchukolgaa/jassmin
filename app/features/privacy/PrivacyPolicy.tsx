import type { ReactNode } from "react";
import { Form, useLocation } from "react-router";
import { Button } from "~/components/ui/Button";
import { COOKIE_INVENTORY, PRIVACY_POLICY_UPDATED_AT } from "~/lib/consent";
import { type TextKey, useT } from "~/lib/i18n";

/** Who controls the data and how to reach them, from the CMS site settings. */
export interface PrivacyContacts {
  /** The ФОП's name; `null` until the owner fills it in. */
  legalName: string | null;
  email: string;
  phone: string;
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold tracking-[-0.01em] text-ink">{heading}</h2>
      <div className="mt-3 space-y-3 text-body">{children}</div>
    </section>
  );
}

const COLLECTED: TextKey[] = [
  "privacy.collect.account",
  "privacy.collect.orders",
  "privacy.collect.cart",
  "privacy.collect.analytics",
];

/**
 * The `/privacy` page (#18): who controls the data, what is collected and why, the cookies (from
 * `COOKIE_INVENTORY`), retention, sharing and the visitor's rights. The copy is a draft for the
 * store owner to review.
 */
export function PrivacyPolicy({ contacts }: { contacts: PrivacyContacts | null }) {
  const { t, formatDate } = useT();
  const { pathname } = useLocation();

  return (
    <main className="container mx-auto px-4 pt-10 pb-16">
      <article className="mx-auto max-w-3xl">
        <h1 className="text-4xl font-bold leading-tight tracking-[-0.01em] text-ink md:text-5xl">
          {t("privacy.title")}
        </h1>
        <p className="mt-3 text-sm font-bold text-muted">
          <time dateTime={PRIVACY_POLICY_UPDATED_AT}>
            {t("privacy.updated", { date: formatDate(PRIVACY_POLICY_UPDATED_AT) })}
          </time>
        </p>
        <p className="mt-4 text-lg text-body">{t("privacy.intro")}</p>

        <Section heading={t("privacy.controller.heading")}>
          <p>
            {contacts?.legalName
              ? t("privacy.controller.named", { name: contacts.legalName })
              : t("privacy.controller.unnamed")}
          </p>
          <p>
            {contacts
              ? t("privacy.controller.contact", { email: contacts.email, phone: contacts.phone })
              : t("privacy.controller.contactFallback")}
          </p>
        </Section>

        <Section heading={t("privacy.collect.heading")}>
          <ul className="list-disc space-y-2 pl-5">
            {COLLECTED.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          <p>{t("privacy.collect.noIp")}</p>
        </Section>

        <Section heading={t("privacy.purpose.heading")}>
          <p>{t("privacy.purpose.contract")}</p>
          <p>{t("privacy.purpose.consent")}</p>
          <p>{t("privacy.purpose.marketing")}</p>
        </Section>

        <Section heading={t("privacy.cookies.heading")}>
          <p>{t("privacy.cookies.intro")}</p>
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">{t("privacy.cookies.caption")}</caption>
              <thead className="bg-card text-ink">
                <tr>
                  <th scope="col" className="px-4 py-3 font-bold">
                    {t("privacy.cookies.name")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-bold">
                    {t("privacy.cookies.purpose")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-bold">
                    {t("privacy.cookies.lifetime")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COOKIE_INVENTORY.map((cookie) => (
                  <tr key={cookie.name} className="border-t border-line align-top">
                    <th scope="row" className="px-4 py-3 font-mono font-normal text-ink">
                      {cookie.name}
                    </th>
                    <td className="px-4 py-3">{t(cookie.purposeKey)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{t(cookie.lifetimeKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section heading={t("privacy.retention.heading")}>
          <p>{t("privacy.retention.account")}</p>
          <p>{t("privacy.retention.analytics")}</p>
        </Section>

        <Section heading={t("privacy.sharing.heading")}>
          <p>{t("privacy.sharing.text")}</p>
        </Section>

        <Section heading={t("privacy.rights.heading")}>
          <p>{t("privacy.rights.text")}</p>
          {/* Forgets the cookie banner's answer (`/consent`), so the banner shows again. */}
          <Form method="post" action="/consent">
            <input type="hidden" name="redirectTo" value={pathname} />
            <Button type="submit" name="consent" value="reset" variant="dark" size="sm">
              {t("consent.settings")}
            </Button>
          </Form>
        </Section>
      </article>
    </main>
  );
}
