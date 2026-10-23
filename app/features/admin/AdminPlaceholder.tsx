/** Body of an admin section whose screens land in a later issue. */
export function AdminPlaceholder({ title, issue }: { title: string; issue: number }) {
  return (
    <>
      <h1 className="text-4xl font-extrabold tracking-[-0.03em] text-ink">{title}</h1>
      <p className="mt-2 text-muted">Coming in #{issue}.</p>
    </>
  );
}
