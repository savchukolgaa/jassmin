import type { ReactNode } from "react";
import type { AuthTokenError as TokenError } from "~/lib/auth";
import { useT } from "~/lib/i18n";
import { FormAlert } from "./AuthLayout";

/**
 * Why an emailed link (#135) can't be used (unknown, used or expired), with what to do next:
 * `children`, e.g. a link to ask for a new one.
 */
export function AuthTokenError({ error, children }: { error: TokenError; children: ReactNode }) {
  const { t } = useT();
  return (
    <div className="flex flex-col items-start gap-4">
      <FormAlert>{t(`auth.tokens.errors.${error}`)}</FormAlert>
      {children}
    </div>
  );
}
