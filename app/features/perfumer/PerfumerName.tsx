import { useT } from "~/lib/i18n";
import { BottleIcon } from "./icons";

/** The blush bottle avatar and "AI парфумер" above each of the perfumer's turns. */
export function PerfumerName() {
  const { t } = useT();
  return (
    <p className="flex items-center gap-2.5 text-sm font-extrabold text-muted">
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-full bg-blush text-primary-dark"
      >
        <BottleIcon className="size-4.5" />
      </span>
      {t("perfumer.title")}
    </p>
  );
}
