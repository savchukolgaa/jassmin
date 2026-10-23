import type { ReactNode } from "react";
import { ClockIcon, MailIcon, PhoneIcon } from "~/components/layout/icons";
import { SOCIAL_LABELS } from "~/lib/cms";
import type { HomePageView } from "~/lib/home";
import { telHref } from "~/lib/links";
import { Eyebrow } from "./Eyebrow";

type ContactsSectionProps = {
  contacts: HomePageView["contacts"];
  /** The contact form, rendered next to the contact details. */
  children?: ReactNode;
};

const contactLink =
  "inline-flex min-h-11 items-center gap-3 rounded-lg text-lg font-semibold hover:text-primary-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light";

/** Customer service details from Strapi site settings; the header's "Kontakt" scrolls here. */
export function ContactsSection({ contacts, children }: ContactsSectionProps) {
  return (
    <section
      id="contacts"
      aria-labelledby="contacts-title"
      className="scroll-mt-20 bg-gray-950 py-16 text-white md:py-24"
    >
      <div className="container mx-auto grid gap-12 px-4 md:grid-cols-2">
        <div>
          <Eyebrow tone="onDark">Kontakt</Eyebrow>
          <h2
            id="contacts-title"
            className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl"
          >
            Questions? Ask us anything.
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
              <li className="flex items-start gap-3 py-2.5 text-gray-200">
                <ClockIcon className="size-6 shrink-0 text-primary-light" />
                <span className="whitespace-pre-line">
                  <span className="sr-only">Customer service hours: </span>
                  {contacts.customerServiceHours}
                </span>
              </li>
            )}
          </ul>
          {contacts.socialLinks.length > 0 && (
            <ul aria-label="Social media" className="mt-8 flex flex-wrap gap-3">
              {contacts.socialLinks.map((link) => (
                <li key={`${link.platform}-${link.url}`}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center rounded-full border-2 border-white px-5 font-semibold transition-colors hover:bg-white hover:text-gray-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light"
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
