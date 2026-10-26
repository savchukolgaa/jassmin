import { fragranceFamilyLabel } from "~/lib/catalog";
import { useT } from "~/lib/i18n";

const SIZES = {
  sm: "px-2.5 py-0.5 text-xs",
  md: "px-3 py-1 text-sm",
} as const;

/** A fragrance family as a blush pill, in the UI's language (#65). */
export function FamilyChip({ family, size = "md" }: { family: string; size?: keyof typeof SIZES }) {
  const translator = useT();
  return (
    <span className={`rounded-pill bg-blush font-bold text-primary-dark ${SIZES[size]}`}>
      {fragranceFamilyLabel(family, translator)}
    </span>
  );
}
