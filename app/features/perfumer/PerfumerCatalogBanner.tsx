import { useT } from "~/lib/i18n";
import { BottleIcon } from "./icons";
import { PerfumerEntryLink } from "./PerfumerEntryLink";
import { usePerfumerEnabled } from "./usePerfumerEnabled";

/**
 * "Не знаєте, що обрати?" above a catalog's results (#165): a blush row with the perfumer's white
 * round bottle and a button that opens the chat with the catalog's filters as the first message.
 * Nothing while the perfumer is disabled.
 */
export function PerfumerCatalogBanner({ message }: { message: string }) {
  const { t } = useT();
  const enabled = usePerfumerEnabled();
  if (!enabled) return null;
  return (
    <aside
      aria-labelledby="perfumer-banner-title"
      className="flex flex-col items-start gap-4 rounded-card-lg bg-blush p-5 sm:flex-row sm:items-center sm:gap-5 sm:px-6"
    >
      <span
        aria-hidden="true"
        className="flex size-12 flex-none items-center justify-center rounded-full bg-white text-primary"
      >
        <BottleIcon sparkle className="size-6" />
      </span>
      <div className="flex-1">
        <p id="perfumer-banner-title" className="text-lg font-bold text-ink">
          {t("perfumer.entry.bannerTitle")}
        </p>
        <p className="mt-0.5 text-body">{t("perfumer.entry.bannerText")}</p>
      </div>
      <PerfumerEntryLink message={message} entry="catalog" size="sm" className="flex-none">
        {t("perfumer.entry.bannerAction")}
      </PerfumerEntryLink>
    </aside>
  );
}
