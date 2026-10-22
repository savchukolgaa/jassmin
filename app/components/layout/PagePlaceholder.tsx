/** Body of a page whose real content lands in a later issue. */
export function PagePlaceholder({ title }: { title: string }) {
  return (
    <main className="container mx-auto p-4 pt-16">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-gray-600 dark:text-gray-400">Coming soon.</p>
    </main>
  );
}
