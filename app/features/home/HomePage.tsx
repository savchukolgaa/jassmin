import type { ContactActionResult } from "~/lib/contact";
import type { HomePageView } from "~/lib/home";
import { AboutSection } from "./AboutSection";
import { CategoryTiles } from "./CategoryTiles";
import { ContactForm } from "./ContactForm";
import { ContactsSection } from "./ContactsSection";
import { HeroSection } from "./HeroSection";
import { HowItWorks } from "./HowItWorks";
import { LocationSection } from "./LocationSection";
import { OfferMarquee } from "./OfferMarquee";
import { TrioBuilder } from "./TrioBuilder";

type HomePageProps = {
  view: HomePageView;
  /** Contact form result after a full-page (no-JS) submission. */
  actionData?: ContactActionResult;
};

/** The home page sections, in the order of the C+ `HomeBoldPlus` artboard (#64). */
export function HomePage({ view, actionData }: HomePageProps) {
  return (
    <main>
      <HeroSection hero={view.hero} trioOffer={view.trioOffer} contentLocale={view.contentLocale} />
      <OfferMarquee trioOffer={view.trioOffer} families={view.trio.families} />
      {view.trioOffer && <HowItWorks trioOffer={view.trioOffer} />}
      <TrioBuilder
        families={view.trio.families}
        selected={view.trio.selected}
        trioOffer={view.trioOffer}
      />
      <CategoryTiles />
      <AboutSection about={view.about} contentLocale={view.contentLocale} />
      <LocationSection location={view.location} contentLocale={view.contentLocale} />
      <ContactsSection contacts={view.contacts}>
        <ContactForm actionData={actionData} />
      </ContactsSection>
    </main>
  );
}
