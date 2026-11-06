// Product list tracking (#129): wrap a list of `ProductCard`s in `ProductListProvider` and each
// card records a `product_impression` once it has been seen (`impressions.ts`) and a
// `product_click` when its links are followed, with the list, its position and the search it came
// from. Nothing is sent without analytics consent (`useTrackingAllowed`).
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  absoluteListPosition,
  type ListContext,
  type ListedProductEvent,
  type ListId,
  productEventContext,
} from "~/lib/analytics";
import type { ProductSummary } from "~/lib/products";
import { clientEvents } from "./client-events";
import { createImpressionTracker, type ImpressionTracker } from "./impressions";
import { useTrackingAllowed } from "./tracking";

/** A card registered with its list: how to describe it when it's seen. */
type Describe = () => ListedProductEvent;

interface ProductListValue {
  listId: ListId;
  searchId?: string;
  page: number;
  pageSize: number;
  enabled: boolean;
  /** Watches the card's element; returns the cleanup. */
  register(element: Element, key: string, describe: Describe): () => void;
}

const ProductListContext = createContext<ProductListValue | null>(null);

/** Half the card in view, as `MIN_IMPRESSION_VISIBLE_MS` asks. */
const VISIBLE_RATIO = 0.5;

function currentPath(): string {
  return window.location.pathname + window.location.search;
}

export interface ProductListProviderProps {
  listId: ListId;
  /** The `search` event the list shows the results of (the filtered catalog). */
  searchId?: string | null;
  /** For positions across pages: the list's page (1-based) and its page size. */
  page?: number;
  pageSize?: number;
  /** The products shown, in order: a new set (or page, or search) is a new list render. */
  productIds: readonly string[];
  children: ReactNode;
}

export function ProductListProvider({
  listId,
  searchId,
  page = 1,
  pageSize = 0,
  productIds,
  children,
}: ProductListProviderProps) {
  const enabled = useTrackingAllowed();
  const renderKey = [listId, searchId ?? "", page, productIds.join(",")].join("|");
  const cards = useRef(new Map<Element, { key: string; describe: Describe }>());
  const observer = useRef<IntersectionObserver | null>(null);
  const tracker = useRef<ImpressionTracker | null>(null);

  // A new tracker and observer per list render, so each card counts once per render. Observing
  // the cards again reports the ones already in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `renderKey` starts a new list render.
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") {
      return;
    }
    const impressions = createImpressionTracker();
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const card = cards.current.get(entry.target);
          if (!card) continue;
          if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO) {
            impressions.enter(card.key, () => {
              clientEvents.batch({
                type: "product_impression",
                path: currentPath(),
                properties: card.describe(),
              });
            });
          } else {
            impressions.leave(card.key);
          }
        }
      },
      { threshold: VISIBLE_RATIO },
    );
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        impressions.pause();
      } else {
        impressions.resume();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    tracker.current = impressions;
    observer.current = watcher;
    for (const element of cards.current.keys()) {
      watcher.observe(element);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      watcher.disconnect();
      impressions.dispose();
      observer.current = null;
      tracker.current = null;
    };
  }, [enabled, renderKey]);

  const register = useCallback((element: Element, key: string, describe: Describe) => {
    cards.current.set(element, { key, describe });
    observer.current?.observe(element);
    return () => {
      cards.current.delete(element);
      observer.current?.unobserve(element);
      tracker.current?.leave(key);
    };
  }, []);

  const value = useMemo<ProductListValue>(
    () => ({ listId, searchId: searchId ?? undefined, page, pageSize, enabled, register }),
    [listId, searchId, page, pageSize, enabled, register],
  );
  return <ProductListContext value={value}>{children}</ProductListContext>;
}

export interface ListedProduct {
  /** Put on the card's root element, so its impressions are watched. */
  ref: (element: HTMLElement | null) => (() => void) | undefined;
  /** Where the card is shown, for the add-to-cart form; `undefined` outside a list. */
  list: ListContext | undefined;
  /** Records a `product_click` with the size picked on the card. */
  trackClick: (variantId: string) => void;
}

/**
 * The tracking for the `index`th card (0-based, on this page) of the surrounding product list.
 * Outside a `ProductListProvider` every part does nothing.
 */
export function useListedProduct(
  product: ProductSummary,
  index: number | undefined,
): ListedProduct {
  const context = useContext(ProductListContext);
  const list = useMemo<ListContext | undefined>(() => {
    if (!context || index === undefined) {
      return undefined;
    }
    return {
      list_id: context.listId,
      list_position: absoluteListPosition(context.page, context.pageSize, index),
      ...(context.searchId && { search_id: context.searchId }),
    };
  }, [context, index]);

  // Read when the card is seen, so it describes the card as it is then.
  const latest = useRef({ product, list });
  latest.current = { product, list };

  const enabled = context?.enabled === true && list !== undefined;
  const register = context?.register;
  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (!element || !enabled || !register) {
        return undefined;
      }
      return register(element, product.id, () => {
        const { product: shown, list: where } = latest.current;
        if (!where) throw new Error("A listed card has no list");
        // An impression is the card as it first renders: its preselected size.
        return { ...productEventContext(shown), ...where };
      });
    },
    [enabled, register, product.id],
  );

  const trackClick = useCallback(
    (variantId: string) => {
      const where = latest.current.list;
      if (!enabled || !where) {
        return;
      }
      clientEvents.push({
        type: "product_click",
        path: currentPath(),
        properties: { ...productEventContext(latest.current.product, variantId), ...where },
      });
      // Right away: `sendBeacon` survives the navigation the click starts.
      clientEvents.flush();
    },
    [enabled],
  );

  return { ref, list, trackClick };
}
