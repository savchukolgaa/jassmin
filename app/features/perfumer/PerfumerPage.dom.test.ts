// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { createElement, Fragment } from "react";
import { createMemoryRouter, Outlet, RouterProvider, useLoaderData } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CartActionResult } from "~/lib/cart";
import { I18nProvider, type Locale } from "~/lib/i18n";
import type {
  PerfumerActionResult,
  PerfumerEvent,
  PerfumerThreadView,
  ThreadItem,
} from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import { PerfumerPage } from "./PerfumerPage";
import { CANCEL_AFTER_MS } from "./ThinkingBubble";

// The chat page in the browser (#163): example chips, sending, the thinking state, cancel, errors
// with retry, the saved chat from the loader (#180), "New chat" and "Delete chat", focus and an axe
// check. Streaming (#164):
// by default `fetch` fails, so these tests also show the fallback to the action; the streaming
// tests at the end answer through a stream they control.

/** A request the test answers when it wants to. */
interface Call {
  /** The posted payload: only the new message, never the conversation (#180). */
  payload: Record<string, unknown>;
  entry: unknown;
  answer: (result: PerfumerActionResult) => void;
}

let calls: Call[] = [];
/** The chat intents posted: `new-chat`, `delete-chat` (#180). */
let intents: string[] = [];

let router: ReturnType<typeof createMemoryRouter>;

/** The route's action as the tests see it: chat intents answer at once, messages wait. */
async function chatAction({ request }: { request: Request }) {
  const form = await request.formData();
  const intent = form.get("intent");
  if (typeof intent === "string") {
    intents.push(intent);
    return { ok: true };
  }
  const payload = JSON.parse(String(form.get("payload"))) as Record<string, unknown>;
  return new Promise<PerfumerActionResult>((resolve) => {
    calls.push({ payload, entry: payload.entry, answer: resolve });
  });
}

function renderPage(
  locale: Locale = "uk",
  {
    prefill = null as string | null,
    url = "/parfumer",
    thread = null as PerfumerThreadView | null,
  } = {},
) {
  router = createMemoryRouter(
    [
      {
        path: "/parfumer",
        element: createElement(PerfumerPage, { prefill, thread }),
        action: chatAction,
      },
    ],
    { initialEntries: [url] },
  );
  return render(createElement(I18nProvider, { locale }, createElement(RouterProvider, { router })));
}

const reply = (intro: string, replyId = crypto.randomUUID()): PerfumerActionResult => ({
  ok: true,
  reply: { intro, picks: [] },
  replyId,
});

const input = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: /AI-парфумеру/ });

/** Answers the latest request. */
async function answerLast(result: PerfumerActionResult) {
  const call = calls.at(-1);
  if (!call) throw new Error("Nothing was sent");
  await act(async () => call.answer(result));
}

/** A streamed request the test answers event by event. */
interface Stream {
  url: string;
  payload: string;
  signal: AbortSignal | undefined;
  push: (event: PerfumerEvent) => Promise<void>;
  /** The connection breaks off. */
  fail: () => Promise<void>;
}

let streams: Stream[] = [];

/** `fetch` answers every request with an event stream the test controls. */
function streamReplies() {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      const encoder = new TextEncoder();
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      });
      const form = init?.body instanceof FormData ? init.body : new FormData();
      streams.push({
        url: String(url),
        payload: String(form.get("payload")),
        signal: init?.signal ?? undefined,
        push: async (event) =>
          act(async () => {
            controller?.enqueue(
              encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
            );
          }),
        fail: async () =>
          act(async () => {
            controller?.error(new TypeError("network error"));
          }),
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    }),
  );
}

beforeEach(() => {
  calls = [];
  intents = [];
  streams = [];
  sessionStorage.clear();
  // No server to stream from: every message falls back to the action, as when streaming fails.
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PerfumerPage", () => {
  it("sends an example chip, shows it at once with the thinking state, then the reply", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Подарунок чоловікові" }));

    expect(screen.getByText("Подарунок чоловікові", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Парфумер підбирає аромати…");
    expect(input().disabled).toBe(true);
    // The hero gives way to the strip with "New chat" and "Delete chat" (#180).
    expect(screen.queryByRole("button", { name: "Подарунок чоловікові" })).toBeNull();
    expect(screen.getByRole("button", { name: "Новий чат" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Видалити чат" })).toBeTruthy();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.payload).toMatchObject({ message: "Подарунок чоловікові", entry: "direct" });

    await answerLast(reply("Ось кілька ідей."));

    expect(await screen.findByText("Ось кілька ідей.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(input()));
  });

  it("sends with Enter, adds a line with Shift+Enter, and sends only the new message", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(input(), "Щось свіже{Shift>}{Enter}{/Shift}на літо");
    expect(calls).toHaveLength(0);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(input().value).toBe("");
    await answerLast(reply("Ось свіжі аромати."));

    await user.type(await screen.findByRole("textbox"), "Дешевше{Enter}");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]?.payload).toMatchObject({ message: "Щось свіже\nна літо" });
    // The server keeps the conversation (#180): the page never sends it.
    expect(calls[1]?.payload).toMatchObject({ message: "Дешевше", entry: "direct" });
    expect(calls[1]?.payload).not.toHaveProperty("messages");
    expect(calls[1]?.payload).not.toHaveProperty("turn");
  });

  it("offers cancel after 10 s, and ignores the late answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    await user.type(input(), "Щось морське{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Скасувати" })).toBeNull();

    await act(async () => vi.advanceTimersByTime(CANCEL_AFTER_MS));
    await user.click(screen.getByRole("button", { name: "Скасувати" }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Запит скасовано. Напишіть ще раз, коли будете готові.")).toBeTruthy();
    expect(screen.getByText("Щось морське", { selector: "p" })).toBeTruthy();
    expect(input().disabled).toBe(false);

    await answerLast(reply("Запізніла відповідь"));
    expect(screen.queryByText("Запізніла відповідь")).toBeNull();
  });

  it("shows an error with a retry that sends the message again without repeating it", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(input(), "Щось морське{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
    await answerLast({ ok: false, error: "timeout" });

    expect(await screen.findByText(/думав надто довго/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    // A retry, so the server answers its saved message again instead of saving a copy (#180).
    expect(calls[1]?.payload).toMatchObject({ message: "Щось морське", retry: true });
    expect(screen.queryByText(/думав надто довго/)).toBeNull();
    expect(screen.getAllByText("Щось морське", { selector: "p" })).toHaveLength(1);

    await answerLast(reply("Ось морські аромати."));
    expect(await screen.findByText("Ось морські аромати.")).toBeTruthy();
  });

  const saved: PerfumerThreadView = {
    entry: "direct",
    items: [
      { id: "1", role: "user", text: "Щось ванільне" },
      { id: "2", role: "perfumer", reply: { intro: "Ось ванільні аромати.", picks: [] } },
    ],
  };

  it('shows the saved chat from the first render, and "New chat" starts another (#180)', async () => {
    const user = userEvent.setup();
    renderPage("uk", { thread: saved });

    // Rendered by the server already: no waiting for the browser.
    expect(screen.getByText("Ось ванільні аромати.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Новий чат" }));

    expect(screen.queryByText("Ось ванільні аромати.")).toBeNull();
    expect(screen.getByRole("button", { name: "Подарунок чоловікові" })).toBeTruthy();
    await waitFor(() => expect(intents).toEqual(["new-chat"]));
    expect(document.activeElement).toBe(input());
  });

  it("deletes the chat after asking, and says so to screen readers (#180)", async () => {
    const user = userEvent.setup();
    renderPage("uk", { thread: saved });

    await user.click(screen.getByRole("button", { name: "Видалити чат" }));
    const question = screen.getByRole("group", { name: "Видалити цю розмову?" });
    expect(question).toBeTruthy();
    // The safe answer takes the focus; changing one's mind keeps the chat.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ні, залишити" }));
    await user.click(screen.getByRole("button", { name: "Ні, залишити" }));
    expect(screen.getByText("Ось ванільні аромати.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Видалити чат" }));
    expect(intents).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Видалити чат" }));
    await user.click(screen.getByRole("button", { name: "Так, видалити" }));

    expect(screen.queryByText("Ось ванільні аромати.")).toBeNull();
    expect(screen.getByText("Розмову видалено.")).toBeTruthy();
    await waitFor(() => expect(intents).toEqual(["delete-chat"]));
  });

  it("links the note about the saved chat to the privacy policy (#180)", () => {
    renderPage("uk", { thread: saved });
    expect(screen.getByText(/Ми зберігаємо розмову 90 днів/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Докладніше" }).getAttribute("href")).toBe(
      "/konfidentsiinist",
    );
  });

  it("clears the chat an older page kept in sessionStorage (#180)", async () => {
    sessionStorage.setItem("jassmin.perfumer.thread", JSON.stringify({ v: 1, items: [] }));
    renderPage();
    await waitFor(() => expect(sessionStorage.getItem("jassmin.perfumer.thread")).toBeNull());
  });

  it("sends the entry the chat was opened from (#166)", async () => {
    const user = userEvent.setup();
    renderPage("uk", { url: "/parfumer?from=catalog" });

    await user.type(input(), "Щось легке{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ entry: "catalog" });
    await answerLast(reply("Ось легкі.", "6f9b3c2a-1d4e-4b8a-9c7d-2e5f8a1b3c4d"));

    await user.type(await screen.findByRole("textbox"), "Дешевше{Enter}");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ entry: "catalog" });
  });

  it("keeps a saved conversation's entry, and counts an unknown one as direct", async () => {
    const user = userEvent.setup();
    renderPage("uk", {
      url: "/parfumer?from=nonsense",
      thread: { entry: "product", items: [{ id: "1", role: "user", text: "Щось ванільне" }] },
    });

    await user.type(screen.getByRole("textbox"), "Ще{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ entry: "product" });

    await answerLast(reply("Ось."));
    await user.click(await screen.findByRole("button", { name: "Новий чат" }));
    await user.type(input(), "Нове{Enter}");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ entry: "direct" });
  });

  it("renders in English", async () => {
    renderPage("en");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Describe a scent and I'll find perfumes from our catalog",
    );
    expect(screen.getByRole("button", { name: "A gift for him" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("has no axe violations, empty or mid-conversation", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    // jsdom has no layout, so colour contrast can't be measured.
    const options: axe.RunOptions = { rules: { "color-contrast": { enabled: false } } };

    expect((await axe.run(container, options)).violations).toEqual([]);

    await user.type(input(), "Щось морське{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
    await answerLast({ ok: false, error: "unavailable" });
    await screen.findByText(/недоступний/);

    expect((await axe.run(container, options)).violations).toEqual([]);
  });

  it("sends a prefilled message once and removes `q` from the URL (#165)", async () => {
    const message = "Схоже на Light Blue від Dolce & Gabbana";
    const { unmount } = renderPage("uk", {
      prefill: message,
      url: `/parfumer?q=${encodeURIComponent(message)}`,
    });

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.payload).toMatchObject({ message });
    expect(screen.getByText(message, { selector: "p" })).toBeTruthy();
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(router.state.historyAction).toBe("REPLACE");
    await answerLast(reply("Ось схожі аромати."));
    await screen.findByText("Ось схожі аромати.");

    // A reload: the URL has no `q` any more, so nothing is sent again.
    unmount();
    renderPage("uk", { url: "/parfumer" });
    await act(async () => {});
    expect(calls).toHaveLength(1);
  });

  it("adds a prefilled message to the saved chat instead of replacing it (#165, #180)", async () => {
    const stored: ThreadItem[] = [
      { id: "1", role: "user", text: "Щось ванільне" },
      { id: "2", role: "perfumer", reply: { intro: "Ось ванільні аромати.", picks: [] } },
    ];
    renderPage("uk", {
      prefill: "Схоже на Libre від YSL",
      url: "/parfumer?q=x&from=product",
      thread: { entry: "direct", items: stored },
    });

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.payload).toMatchObject({
      message: "Схоже на Libre від YSL",
      entry: "product",
    });
    expect(screen.getByText("Ось ванільні аромати.")).toBeTruthy();
    expect(screen.getByText("Схоже на Libre від YSL", { selector: "p" })).toBeTruthy();
  });
});

describe("PerfumerPage streaming (#164)", () => {
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

  beforeEach(() => {
    streamReplies();
    // Reduced motion: the intro appears at once instead of typing in (see TypingText.dom.test.ts).
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
  });

  it("shows the steps, then the intro, then the cards, without calling the action", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(input(), "Щось морське{Enter}");
    await waitFor(() => expect(streams).toHaveLength(1));
    const stream = streams[0];
    expect(stream?.url).toBe("/parfumer/stream");
    expect(JSON.parse(stream?.payload ?? "{}")).toEqual({
      message: "Щось морське",
      entry: "direct",
    });

    await stream?.push({
      type: "step",
      step: { tool: "search", families: ["водяні"], maxPriceUah: 600, found: 3 },
    });
    expect(await screen.findByText(/Шукаю в каталозі: водяні, до 600/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("знайдено 3 аромати");

    await stream?.push({ type: "intro", text: "Ось свіжі морські аромати." });
    expect(await screen.findByText("Ось свіжі морські аромати.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Парфумер пише відповідь…");

    await stream?.push({ type: "picks", picks: [{ product, reason: "Морський бриз." }] });
    expect(await screen.findByText("Acqua Di Gio")).toBeTruthy();
    await stream?.push({ type: "question", text: "Для дня чи вечора?" });
    await stream?.push({ type: "done" });

    expect(await screen.findByText("Для дня чи вечора?")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(input().disabled).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("streams a prefilled message to the end while `q` leaves the URL (#165)", async () => {
    renderPage("uk", { prefill: "Схоже на Libre від YSL", url: "/parfumer?q=x&from=product" });

    await waitFor(() => expect(streams).toHaveLength(1));
    const stream = streams[0];
    expect(JSON.parse(stream?.payload ?? "{}")).toEqual({
      message: "Схоже на Libre від YSL",
      // The entry point's `from` (#166), read before the URL is cleaned.
      entry: "product",
    });
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(stream?.signal?.aborted).toBe(false);

    await stream?.push({ type: "intro", text: "Ось схожі на Libre." });
    await stream?.push({ type: "done" });

    expect(await screen.findByText("Ось схожі на Libre.")).toBeTruthy();
    expect(streams).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it("aborts the stream on cancel, without falling back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    await user.type(input(), "Щось морське{Enter}");
    await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => vi.advanceTimersByTime(CANCEL_AFTER_MS));
    await user.click(screen.getByRole("button", { name: "Скасувати" }));

    expect(streams[0]?.signal?.aborted).toBe(true);
    expect(screen.getByText("Запит скасовано. Напишіть ще раз, коли будете готові.")).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(100));
    expect(calls).toHaveLength(0);
  });

  it("aborts the stream when the page is left", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();

    await user.type(input(), "Щось морське{Enter}");
    await waitFor(() => expect(streams).toHaveLength(1));
    unmount();

    expect(streams[0]?.signal?.aborted).toBe(true);
  });

  it("falls back to the action when the answer is not a stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("<h1>Oops</h1>", { status: 500 })),
    );
    const user = userEvent.setup();
    renderPage();

    await user.type(input(), "Щось морське{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
    // The stream may have saved the message already: the fallback is a retry (#180).
    expect(calls[0]?.payload).toEqual({ message: "Щось морське", entry: "direct", retry: true });
    await answerLast(reply("Ось морські аромати."));

    expect(await screen.findByText("Ось морські аромати.")).toBeTruthy();
  });

  it("falls back to the action when the stream breaks off, keeping the steps shown", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(input(), "Щось морське{Enter}");
    await waitFor(() => expect(streams).toHaveLength(1));
    await streams[0]?.push({ type: "step", step: { tool: "similar", found: 0 } });
    await streams[0]?.fail();

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.getByText(/Шукаю схожі аромати/)).toBeTruthy();
    await answerLast(reply("Ось що є."));
    expect(await screen.findByText("Ось що є.")).toBeTruthy();
    expect(screen.queryByText(/Шукаю схожі аромати/)).toBeNull();
  });

  it("shows an error the server streamed, without falling back", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(input(), "Щось морське{Enter}");
    await waitFor(() => expect(streams).toHaveLength(1));
    await streams[0]?.push({ type: "error", error: "rateLimited" });

    expect(await screen.findByText(/багато повідомлень поспіль/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Спробувати ще раз" })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("has no axe violations while the reply streams", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    const options: axe.RunOptions = { rules: { "color-contrast": { enabled: false } } };

    await user.type(input(), "Щось морське{Enter}");
    await waitFor(() => expect(streams).toHaveLength(1));
    await streams[0]?.push({ type: "step", step: { tool: "search", families: [], found: 2 } });
    await streams[0]?.push({ type: "intro", text: "Ось свіжі аромати." });
    await screen.findByText("Ось свіжі аромати.");

    expect((await axe.run(container, options)).violations).toEqual([]);
  });
});

/** A layout showing its loader's cart count, as the `_shop` layout's header badge does. */
function ShopLayout() {
  const count = useLoaderData() as number;
  return createElement(
    Fragment,
    null,
    createElement("p", { "data-testid": "badge" }, String(count)),
    createElement(Outlet),
  );
}

describe("PerfumerPage cart adds (#169)", () => {
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

  let cartLines: number;
  let pageLoads: number;
  let cartRelease: (() => void) | null;

  /** The chat under a layout whose loader counts the cart, as the `_shop` loader's badge does. */
  function renderShop() {
    router = createMemoryRouter(
      [
        {
          id: "shop",
          path: "/",
          loader: () => cartLines,
          element: createElement(ShopLayout),
          children: [
            {
              path: "parfumer",
              loader: () => {
                pageLoads += 1;
                return null;
              },
              shouldRevalidate: ({ formMethod, defaultShouldRevalidate }) =>
                formMethod ? false : defaultShouldRevalidate,
              element: createElement(PerfumerPage, {}),
              action: chatAction,
            },
            {
              path: "koshyk",
              action: () =>
                new Promise<CartActionResult>((resolve) => {
                  cartRelease = () => {
                    cartLines += 1;
                    resolve({ ok: true, intent: "add" });
                  };
                }),
            },
          ],
        },
      ],
      { initialEntries: ["/parfumer"] },
    );
    return render(
      createElement(I18nProvider, { locale: "uk" }, createElement(RouterProvider, { router })),
    );
  }

  beforeEach(() => {
    cartLines = 0;
    pageLoads = 0;
    cartRelease = null;
    Element.prototype.scrollIntoView = vi.fn();
  });

  const withCard = (intro: string): PerfumerActionResult => ({
    ok: true,
    reply: { intro, picks: [{ product, reason: "Морський бриз." }] },
    replyId: crypto.randomUUID(),
  });

  it("adds a pick and keeps the conversation, the draft and the focus; the badge updates", async () => {
    const user = userEvent.setup();
    renderShop();
    await user.type(await screen.findByRole("textbox"), "Щось морське{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
    await answerLast(withCard("Ось морські аромати."));
    await screen.findByText("Ось морські аромати.");
    await user.type(input(), "А дешевше?");
    const loadsBefore = pageLoads;

    const add = screen.getByRole("button", { name: "Додати в кошик" });
    await user.click(add);
    await waitFor(() => expect(cartRelease).not.toBeNull());
    // A disabled button loses focus in browsers (jsdom keeps it): simulate that.
    add.blur();
    await act(async () => cartRelease?.());

    expect(await screen.findByText("Додано в кошик")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("badge").textContent).toBe("1"));
    expect(pageLoads).toBe(loadsBefore);
    expect(screen.getByText("Щось морське", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("Ось морські аромати.")).toBeTruthy();
    expect(input().value).toBe("А дешевше?");
    await waitFor(() => expect(document.activeElement).toBe(add));
  });

  it('keeps "Added to cart" on a card added while its answer was still streaming', async () => {
    streamReplies();
    const user = userEvent.setup();
    renderShop();
    await user.type(await screen.findByRole("textbox"), "Щось морське{Enter}");
    await waitFor(() => expect(streams).toHaveLength(1));
    const stream = streams[0];
    await stream?.push({ type: "intro", text: "Ось." });
    await stream?.push({ type: "picks", picks: [{ product, reason: "Морський бриз." }] });

    await user.click(await screen.findByRole("button", { name: "Додати в кошик" }));
    await waitFor(() => expect(cartRelease).not.toBeNull());
    await stream?.push({ type: "done" });
    await act(async () => cartRelease?.());

    expect(await screen.findByText("Додано в кошик")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Новий чат" })).toBeTruthy();
  });
});
