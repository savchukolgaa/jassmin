// Rendered share images (#105), so repeated crawler hits don't render again. Keyed on the product
// and its `updated_at`, so an edit gets a fresh image. It holds promises: concurrent requests for
// the same image share one render. ~140 products at about 100 KB each fit easily.

export const MAX_ENTRIES = 256;

const cache = new Map<string, Promise<Buffer>>();

/** The cached image for `key`, else `render()`'s, kept for next time unless it fails. */
export function getOrRender(key: string, render: () => Promise<Buffer>): Promise<Buffer> {
  const cached = cache.get(key);
  if (cached) {
    // Least recently used goes first: move a hit to the end.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const rendering = render();
  cache.set(key, rendering);
  rendering.catch(() => {
    if (cache.get(key) === rendering) {
      cache.delete(key);
    }
  });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return rendering;
}

/** For tests. */
export function clearShareCardCache(): void {
  cache.clear();
}
