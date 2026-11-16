import { ButtonLink, type ButtonLinkProps } from "~/components/ui/ButtonLink";
import { usePathFor } from "~/lib/i18n";
import { perfumerPrefillSearch } from "~/lib/perfumer";
import { usePerfumerEnabled } from "./usePerfumerEnabled";

export type PerfumerEntryLinkProps = Omit<ButtonLinkProps, "to" | "rel"> & {
  /** Sent to the perfumer once the chat opens (`?q=`). */
  message: string;
};

/**
 * A button-styled link to the AI perfumer chat with a message to send (#165). Renders nothing while
 * the perfumer is disabled. `nofollow`, so crawlers that run scripts don't start conversations
 * (robots.txt also blocks `?q=` chat URLs).
 */
export function PerfumerEntryLink({ message, ...props }: PerfumerEntryLinkProps) {
  const path = usePathFor();
  const enabled = usePerfumerEnabled();
  if (!enabled) return null;
  return (
    <ButtonLink
      {...props}
      to={path("perfumer", {}, { search: perfumerPrefillSearch(message) })}
      rel="nofollow"
    />
  );
}
