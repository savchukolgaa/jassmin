import { describe, expect, it } from "vitest";
import type { ThreadItem } from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import { loadThread, MAX_STORED_ITEMS, saveThread, THREAD_STORAGE_KEY } from "./thread-storage";

/** A `Storage` backed by a map. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const product: ProductSummary = {
  id: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  slug: "acqua-di-gio",
  title: "Acqua Di Gio",
  brand: "Armani",
  gender: "men",
  packSize: 1,
  image: null,
  variants: [{ id: "v5", volumeMl: 5, price: "290.00", inStock: true }],
  minPrice: "290.00",
  hasPriceRange: false,
  volumes: [5],
  inStock: true,
  defaultVariant: { id: "v5", volumeMl: 5 },
  fragranceFamily: "водяні",
};

const thread: ThreadItem[] = [
  { id: "1", role: "user", text: "Щось морське" },
  {
    id: "2",
    role: "perfumer",
    reply: { intro: "Ось.", picks: [{ product, reason: "Морські ноти." }], question: "Для кого?" },
  },
  { id: "3", role: "user", text: "Дешевше" },
  { id: "4", role: "error", error: "timeout", retryText: "Дешевше" },
  { id: "5", role: "cancelled" },
];

describe("thread storage", () => {
  it("restores a saved thread", () => {
    const storage = memoryStorage();
    saveThread(thread, storage);
    expect(loadThread(storage)).toEqual(thread);
  });

  it("removes the key for an empty thread", () => {
    const storage = memoryStorage();
    saveThread(thread, storage);
    saveThread([], storage);
    expect(storage.getItem(THREAD_STORAGE_KEY)).toBeNull();
  });

  it("keeps only the last 50 items", () => {
    const storage = memoryStorage();
    const long: ThreadItem[] = Array.from({ length: 60 }, (_, n) => ({
      id: String(n),
      role: "user",
      text: `m${n}`,
    }));
    saveThread(long, storage);
    const restored = loadThread(storage);
    expect(restored).toHaveLength(MAX_STORED_ITEMS);
    expect(restored[0]).toEqual(long[10]);
  });

  it.each([
    ["broken JSON", "{"],
    ["another version", JSON.stringify({ v: 2, items: thread })],
    ["no items", JSON.stringify({ v: 1 })],
    ["an unknown role", JSON.stringify({ v: 1, items: [{ id: "1", role: "system", text: "x" }] })],
    ["an unknown error", JSON.stringify({ v: 1, items: [{ id: "1", role: "error", error: "x" }] })],
    [
      "a pick without a product",
      JSON.stringify({
        v: 1,
        items: [{ id: "1", role: "perfumer", reply: { intro: "x", picks: [{ reason: "y" }] } }],
      }),
    ],
  ])("drops %s", (_name, raw) => {
    expect(loadThread(memoryStorage({ [THREAD_STORAGE_KEY]: raw }))).toEqual([]);
  });

  it("works without storage (server, blocked storage)", () => {
    expect(loadThread(undefined)).toEqual([]);
    expect(() => saveThread(thread, undefined)).not.toThrow();
    const throwing = memoryStorage();
    throwing.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => saveThread(thread, throwing)).not.toThrow();
  });
});
