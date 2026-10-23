import { useT } from "~/lib/i18n";

/** Body of an admin section whose screens land in a later issue; `title` is already translated. */
export function AdminPlaceholder({ title, issue }: { title: string; issue: number }) {
  const { t } = useT();

  return (
    <>
      <h1 className="text-4xl font-extrabold tracking-[-0.03em] text-ink">{title}</h1>
      <p className="mt-2 text-muted">{t("admin.placeholder", { issue: String(issue) })}</p>
    </>
  );
}
