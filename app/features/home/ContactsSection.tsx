import type { ReactNode } from "react";
import { ClockIcon, MailIcon, PhoneIcon } from "~/components/layout/icons";
import { buttonClasses } from "~/components/ui/button-styles";
import { SOCIAL_LABELS } from "~/lib/cms";
import { cn } from "~/lib/cn";
import type { HomePageView } from "~/lib/home";
import { useT } from "~/lib/i18n";
import { telHref } from "~/lib/links";
import { Eyebrow } from "./Eyebrow";

type ContactsSectionProps = {
  contacts: HomePageView["contacts"];
  /** The contact form, rendered next to the contact details. */
  children?: ReactNode;
};

// On `ink`, the focus ring is `primary-light` (7.93:1, docs/design.md).
const onInkFocus =
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary-light";

const contactLink = cn(
  "inline-flex min-h-11 items-center gap-3 rounded-pill text-lg font-bold transition-colors",
  "hover:text-primary-light",
  onInkFocus,
);

/** Customer service details from Strapi site settings; the header's "Contacts" scrolls here. */
export function ContactsSection({ contacts, children }: ContactsSectionProps) {
  const { t } = useT();

  return (
    <section
      id="contacts"
      aria-labelledby="contacts-title"
      className="scroll-mt-20 bg-ink py-16 text-white md:py-24"
    >
      <div className="reveal container mx-auto grid gap-12 px-4 md:grid-cols-2">
        <div>
          <Eyebrow tone="onDark">{t("home.contacts.eyebrow")}</Eyebrow>
          <h2
            id="contacts-title"
            className="mt-2 text-3xl leading-tight font-extrabold tracking-[-0.04em] md:text-4xl"
          >
            {t("home.contacts.title")}
          </h2>
          <ul className="mt-8 space-y-3">
            <li>
              <a href={telHref(contacts.phone)} className={contactLink}>
                <PhoneIcon className="size-6 text-primary-light" />
                {contacts.phone}
              </a>
            </li>
            <li>
              <a href={`mailto:${contacts.email}`} className={contactLink}>
                <MailIcon className="size-6 text-primary-light" />
                {contacts.email}
              </a>
            </li>
            {contacts.customerServiceHours && (
              <li className="flex items-start gap-3 py-2.5 text-on-dark-muted">
                <ClockIcon className="size-6 shrink-0 text-primary-light" />
                <span className="whitespace-pre-line">
                  <span className="sr-only">{t("home.contacts.serviceHours")}</span>
                  {contacts.customerServiceHours}
                </span>
              </li>
            )}
          </ul>
          {contacts.socialLinks.length > 0 && (
            <ul aria-label={t("home.contacts.social")} className="mt-8 flex flex-wrap gap-3">
              {contacts.socialLinks.map((link) => (
                <li key={`${link.platform}-${link.url}`}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClasses({ variant: "outline-light", size: "sm" })}
                  >
                    {SOCIAL_LABELS[link.platform]}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
