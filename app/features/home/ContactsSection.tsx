import type { ReactNode } from "react";
import { ClockIcon, MailIcon, PhoneIcon } from "~/components/layout/icons";
import { SocialLinks } from "~/components/layout/SocialLinks";
import { cn } from "~/lib/cn";
import type { HomePageView } from "~/lib/home";
import { useContentLang, useT } from "~/lib/i18n";
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
  const lang = useContentLang(contacts.locale);

  return (
    <section
      id="contacts"
      aria-labelledby="contacts-title"
      className="scroll-mt-20 bg-ink text-white"
    >
      <div className="reveal container mx-auto flex flex-wrap gap-14 px-4 py-16 md:py-26">
        <div className="min-w-0 flex-[1_1_22rem]">
          <Eyebrow tone="onDark">{t("home.contacts.eyebrow")}</Eyebrow>
          <h2
            id="contacts-title"
            className="mt-6 text-4xl leading-[1.02] font-bold tracking-[-0.01em] text-balance md:text-5xl"
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
                  <span lang={lang}>{contacts.customerServiceHours}</span>
                </span>
              </li>
            )}
          </ul>
          {/* The same icon links as the footer and mobile menu (#101). */}
          <SocialLinks links={contacts.socialLinks} tone="onInk" className="mt-8" />
        </div>
        <div className="min-w-0 flex-[1_1_28rem]">{children}</div>
      </div>
    </section>
  );
}
