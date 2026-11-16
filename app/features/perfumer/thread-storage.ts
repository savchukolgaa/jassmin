import {
  PERFUMER_ERROR_KEYS,
  PERFUMER_RATINGS,
  type PerfumerEntry,
  type PerfumerReply,
  type ThreadItem,
  toPerfumerEntry,
} from "~/lib/perfumer";

// The perfumer chat's thread in `sessionStorage` (#163): it survives a reload and dies with the
// tab. Parsed defensively without zod (it stays out of the browser bundle, #96): anything that
// doesn't look like a thread this version wrote is dropped.

export const THREAD_STORAGE_KEY = "jassmin.perfumer.thread";

/** Older items are dropped beyond this, so the stored thread stays small. */
export const MAX_STORED_ITEMS = 50;

const VERSION = 1;

type Unknown = Record<string, unknown>;

const isObject = (value: unknown): value is Unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

/** Enough of a `ProductSummary` for the card to render. */
function isProduct(value: unknown): boolean {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.title) &&
    isString(value.brand) &&
    (value.slug === null || isString(value.slug)) &&
    isString(value.minPrice) &&
    typeof value.hasPriceRange === "boolean" &&
    Array.isArray(value.variants) &&
    isObject(value.defaultVariant)
  );
}

function isReply(value: unknown): value is PerfumerReply {
  return (
    isObject(value) &&
    isString(value.intro) &&
    (value.question === undefined || isString(value.question)) &&
    Array.isArray(value.picks) &&
    value.picks.every((pick) => isObject(pick) && isString(pick.reason) && isProduct(pick.product))
  );
}

function isThreadItem(value: unknown): value is ThreadItem {
  if (!isObject(value) || !isString(value.id)) return false;
  switch (value.role) {
    case "user":
      return isString(value.text);
    case "perfumer":
      return (
        isReply(value.reply) &&
        (value.replyId === undefined || isString(value.replyId)) &&
        (value.turn === undefined || Number.isInteger(value.turn)) &&
        (value.rating === undefined || PERFUMER_RATINGS.some((rating) => rating === value.rating))
      );
    case "error":
      return PERFUMER_ERROR_KEYS.some((key) => key === value.error) && isString(value.retryText);
    case "cancelled":
      return true;
    default:
      return false;
  }
}

/** `sessionStorage`, or `undefined` on the server or where reading it throws. */
function safeStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** The stored copy, if it's one this version wrote. */
function readStored(storage: Storage | undefined): { items: ThreadItem[]; entry: unknown } | null {
  try {
    const raw = storage?.getItem(THREAD_STORAGE_KEY);
    if (!raw) return null;
    const stored: unknown = JSON.parse(raw);
    if (!isObject(stored) || stored.v !== VERSION || !Array.isArray(stored.items)) return null;
    const items: unknown[] = stored.items;
    return items.every(isThreadItem)
      ? { items: items.slice(-MAX_STORED_ITEMS), entry: stored.entry }
      : null;
  } catch {
    return null;
  }
}

/** The stored thread, or `[]` when there's none, it's broken or storage is blocked. */
export function loadThread(storage: Storage | undefined = safeStorage()): ThreadItem[] {
  return readStored(storage)?.items ?? [];
}

/**
 * How the stored conversation was opened (#166), or `undefined` without one. A thread stored
 * before #166 has no entry and counts as `direct`.
 */
export function loadThreadEntry(
  storage: Storage | undefined = safeStorage(),
): PerfumerEntry | undefined {
  const stored = readStored(storage);
  if (!stored || stored.items.length === 0) return undefined;
  return toPerfumerEntry(isString(stored.entry) ? stored.entry : undefined);
}

/** Stores the thread (its last 50 items) and its entry; an empty thread removes the key. */
export function saveThread(
  items: readonly ThreadItem[],
  storage: Storage | undefined = safeStorage(),
  entry: PerfumerEntry = "direct",
): void {
  try {
    if (items.length === 0) {
      storage?.removeItem(THREAD_STORAGE_KEY);
    } else {
      storage?.setItem(
        THREAD_STORAGE_KEY,
        JSON.stringify({ v: VERSION, entry, items: items.slice(-MAX_STORED_ITEMS) }),
      );
    }
  } catch {
    // Full or blocked storage: the thread just won't survive a reload.
  }
}
