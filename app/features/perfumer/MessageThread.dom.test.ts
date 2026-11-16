// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientEvents } from "~/features/analytics/client-events";
import { TrackingProvider } from "~/features/analytics/tracking";
import type { ClientEvent } from "~/lib/analytics";
import { I18nProvider, type Locale } from "~/lib/i18n";
import type { PerfumerRating, ThreadItem } from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import { MessageThread } from "./MessageThread";

// The perfumer's answers in the browser (#166): the cards are a `perfumer` product list, and each
// answer can be rated 👍/👎, which posts the rating to the chat route's action.

const REPLY_ID = "6f9b3c2a-1d4e-4b8a-9c7d-2e5f8a1b3c4d";

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
    variants: [{ id: `${id.slice(0, -2)}05`, volumeMl: 5, price: "290.00", inStock: true }],
    minPrice: "290.00",
    hasPriceRange: false,
    volumes: [5],
    inStock: true,
    defaultVariant: { id: `${id.slice(0, -2)}05`, volumeMl: 5 },
    fragranceFamily: null,
  };
}

const answer = (fields: Partial<Extract<ThreadItem, { role: "perfumer" }>> = {}): ThreadItem => ({
  id: "a1",
  role: "perfumer",
  reply: {
    intro: "Ось два аромати.",
    picks: [
      { product: product(1), reason: "Свіжий." },
      { product: product(2), reason: "Морський." },
    ],
  },
  replyId: REPLY_ID,
  turn: 2,
  ...fields,
});

let posted: Record<string, string>[];
let pushed: ClientEvent[];
let onRate: ReturnType<typeof vi.fn<(itemId: string, rating: PerfumerRating) => void>>;

function renderThread(item: ThreadItem, locale: Locale = "uk") {
  const element = createElement(
    TrackingProvider,
    { enabled: true },
    createElement(MessageThread, {
      items: [item],
      pending: null,
      onCancel: () => {},
      onRetry: () => {},
      onRate,
    }),
  );
  const router = createMemoryRouter(
    [
      {
        path: "/parfumer",
        element,
        action: async ({ request }) => {
          posted.push(Object.fromEntries(await request.formData()) as Record<string, string>);
          return { ok: true };
        },
      },
      { path: "*", element: null },
    ],
    { initialEntries: ["/parfumer"] },
  );
  return render(createElement(I18nProvider, { locale }, createElement(RouterProvider, { router })));
}

beforeEach(() => {
  posted = [];
  pushed = [];
  onRate = vi.fn();
  vi.spyOn(clientEvents, "push").mockImplementation((event) => pushed.push(event));
  vi.spyOn(clientEvents, "flush").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("perfumer answers (#166)", () => {
  it("tags a click on a recommended card with the perfumer list and its position", () => {
    renderThread(answer());

    fireEvent.click(screen.getAllByRole("link", { name: "Perfume 2" })[0] as HTMLElement);

    expect(pushed).toEqual([
      {
        type: "product_click",
        // `window.location`: a memory router doesn't change it.
        path: expect.any(String),
        properties: expect.objectContaining({
          product_public_id: product(2).id,
          list_id: "perfumer",
          list_position: 2,
        }),
      },
    ]);
  });

  it("rates an answer: notes it in the thread and posts it to the chat's action", async () => {
    renderThread(answer());
    const up = screen.getByRole("button", { name: "Так, корисна" });
    expect(up.getAttribute("aria-pressed")).toBe("false");

    await act(async () => fireEvent.click(up));

    expect(onRate).toHaveBeenCalledWith("a1", "up");
    await waitFor(() =>
      expect(posted).toEqual([{ intent: "feedback", replyId: REPLY_ID, turn: "2", rating: "up" }]),
    );
  });

  it("shows the chosen rating pressed with a thanks note, and ignores pressing it again", async () => {
    renderThread(answer({ rating: "down" }));

    expect(
      screen.getByRole("button", { name: "Ні, не допомогла" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("Дякуємо за відгук!")).toBeTruthy();

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Ні, не допомогла" })),
    );
    expect(onRate).not.toHaveBeenCalled();
    expect(posted).toEqual([]);

    // The other button changes the rating.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Так, корисна" })));
    expect(onRate).toHaveBeenCalledWith("a1", "up");
  });

  it("labels the rating in English", () => {
    renderThread(answer(), "en");
    expect(screen.getByText("Was this helpful?")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Was this helpful?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes, helpful" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "No, not helpful" })).toBeTruthy();
  });

  it("offers no rating for an answer kept from before #166", () => {
    renderThread(answer({ replyId: undefined, turn: undefined }));
    expect(screen.queryByText("Відповідь була корисною?")).toBeNull();
  });
});
