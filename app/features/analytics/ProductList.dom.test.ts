// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductCard } from "~/features/catalog/ProductCard";
import { type ClientEvent, MIN_IMPRESSION_VISIBLE_MS } from "~/lib/analytics";
import { I18nProvider } from "~/lib/i18n";
import type { ProductSummary } from "~/lib/products";
import { clientEvents } from "./client-events";
import { ProductListProvider, type ProductListProviderProps } from "./ProductList";
import { TrackingProvider } from "./tracking";

// Product lists in the browser (#129): impressions after a second in view, clicks, the list
// fields on the add-to-cart form, and nothing without consent.

function product(n: number): ProductSummary {
  const id = `01a1652b-6e25-7c03-ae47-${String(n).padStart(12, "0")}`;
  return {
    id,
    slug: `perfume-${n}`,
    title: `Perfume ${n}`,
    brand: "Brand",
    gender: "women",
    packSize: 1,
    image: null,
    variants: [
      { id: `${id.slice(0, -2)}05`, volumeMl: 5, price: "290.00", inStock: false },
      { id: `${id.slice(0, -2)}50`, volumeMl: 50, price: "1890.00", inStock: true },
    ],
    minPrice: "290.00",
    hasPriceRange: true,
    volumes: [5, 50],
    inStock: true,
    defaultVariant: { id: `${id.slice(0, -2)}50`, volumeMl: 50 },
    fragranceFamily: null,
  };
}

/** An `IntersectionObserver` the test drives: `show(card, ratio)` reports a card in view. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  report(target: Element, ratio: number) {
    if (!this.targets.has(target)) return;
    const entry = { target, isIntersecting: ratio > 0, intersectionRatio: ratio };
    this.callback([entry as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function show(element: Element, ratio = 1) {
  act(() => {
    for (const observer of FakeObserver.instances) observer.report(element, ratio);
  });
}

const cards = () => screen.getAllByRole("article");

function renderList(
  products: ProductSummary[],
  { enabled = true, ...list }: Partial<ProductListProviderProps> & { enabled?: boolean } = {},
) {
  const tree = (items: ProductSummary[]): ReactNode =>
    createElement(
      TrackingProvider,
      { enabled },
      createElement(
        ProductListProvider,
        { listId: "catalog", productIds: items.map((item) => item.id), ...list },
        items.map((item, index) =>
          createElement(ProductCard, { key: item.id, product: item, listIndex: index }),
        ),
      ),
    );
  const router = createMemoryRouter([
    { path: "/", element: tree(products) },
    { path: "*", element: null },
  ]);
  return render(
    createElement(I18nProvider, { locale: "en" }, createElement(RouterProvider, { router })),
  );
}

let batched: ClientEvent[];
let pushed: ClientEvent[];

beforeEach(() => {
  FakeObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  batched = [];
  pushed = [];
  vi.spyOn(clientEvents, "batch").mockImplementation((event) => batched.push(event));
  vi.spyOn(clientEvents, "push").mockImplementation((event) => pushed.push(event));
  vi.spyOn(clientEvents, "flush").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("product list tracking", () => {
  it("records an impression once a card has been half visible for a second", () => {
    const items = [product(1), product(2)];
    renderList(items, {
      listId: "search",
      searchId: "0b6f1b8e-3f7e-4a52-9a43-3c1f7f1f2c11",
      page: 2,
      pageSize: 12,
    });
    const [, second] = cards();
    if (!second) throw new Error("no card");

    show(second, 0.6);
    act(() => vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS - 1));
    expect(batched).toEqual([]);
    act(() => vi.advanceTimersByTime(1));

    expect(batched).toEqual([
      {
        type: "product_impression",
        path: "/",
        properties: {
          product_public_id: items[1]?.id,
          variant_id: items[1]?.defaultVariant.id,
          volume_ml: 50,
          price: "1890.00",
          in_stock: true,
          list_id: "search",
          // The second card of page 2.
          list_position: 14,
          search_id: "0b6f1b8e-3f7e-4a52-9a43-3c1f7f1f2c11",
        },
      },
    ]);
  });

  it("doesn't count a card under half visible or scrolled past within the second", () => {
    renderList([product(1)]);
    const [card] = cards();
    if (!card) throw new Error("no card");

    show(card, 0.4);
    act(() => vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS * 3));
    show(card, 0.8);
    act(() => vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS / 2));
    show(card, 0);
    act(() => vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS * 3));

    expect(batched).toEqual([]);
  });

  it("records each card once per list render", () => {
    renderList([product(1)]);
    const [card] = cards();
    if (!card) throw new Error("no card");

    for (let round = 0; round < 3; round++) {
      show(card, 1);
      act(() => vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS));
      show(card, 0);
    }

    expect(batched).toHaveLength(1);
  });

  it("records a click with the list and the size picked on the card", () => {
    const items = [product(1), product(2)];
    renderList(items, { listId: "home" });

    fireEvent.click(screen.getAllByRole("radio", { name: /5 ml/ })[0] as HTMLElement);
    fireEvent.click(screen.getAllByRole("link", { name: "Perfume 1" })[0] as HTMLElement);

    expect(pushed).toEqual([
      {
        type: "product_click",
        path: "/",
        properties: {
          product_public_id: items[0]?.id,
          variant_id: items[0]?.variants[0]?.id,
          volume_ml: 5,
          price: "290.00",
          in_stock: false,
          list_id: "home",
          list_position: 1,
        },
      },
    ]);
    expect(clientEvents.flush).toHaveBeenCalled();
  });

  it("posts the list with the card's add-to-cart form", () => {
    const { container } = renderList([product(1), product(2)], {
      listId: "search",
      searchId: "0b6f1b8e-3f7e-4a52-9a43-3c1f7f1f2c11",
      page: 3,
      pageSize: 12,
    });
    const forms = container.querySelectorAll("form");
    const fields = (form: Element | undefined) =>
      Object.fromEntries(new FormData(form as HTMLFormElement));

    expect(fields(forms[1])).toMatchObject({
      listId: "search",
      listPosition: "26",
      searchId: "0b6f1b8e-3f7e-4a52-9a43-3c1f7f1f2c11",
    });
  });

  it("sends nothing without analytics consent", () => {
    renderList([product(1)], { enabled: false });
    const [card] = cards();
    if (!card) throw new Error("no card");

    show(card, 1);
    act(() => vi.advanceTimersByTime(MIN_IMPRESSION_VISIBLE_MS * 2));
    fireEvent.click(screen.getAllByRole("link", { name: "Perfume 1" })[0] as HTMLElement);

    expect(FakeObserver.instances).toEqual([]);
    expect(batched).toEqual([]);
    expect(pushed).toEqual([]);
  });

  it("doesn't track a card outside a product list", () => {
    const router = createMemoryRouter([
      {
        path: "/",
        element: createElement(
          TrackingProvider,
          { enabled: true },
          createElement(ProductCard, { product: product(1) }),
        ),
      },
      { path: "*", element: null },
    ]);
    const { container } = render(
      createElement(I18nProvider, { locale: "en" }, createElement(RouterProvider, { router })),
    );

    expect(new FormData(container.querySelector("form") as HTMLFormElement).has("listId")).toBe(
      false,
    );
    fireEvent.click(screen.getAllByRole("link", { name: "Perfume 1" })[0] as HTMLElement);

    expect(pushed).toEqual([]);
  });
});
