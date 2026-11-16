// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { createElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";
import type { PerfumerActionResult, PerfumerMessage, ThreadItem } from "~/lib/perfumer";
import { PerfumerPage } from "./PerfumerPage";
import { CANCEL_AFTER_MS } from "./ThinkingBubble";
import { THREAD_STORAGE_KEY } from "./thread-storage";

// The chat page in the browser (#163): example chips, sending, the thinking state, cancel, errors
// with retry, the thread surviving a reload, start over, focus and an axe check.

/** A request the test answers when it wants to. */
interface Call {
  messages: PerfumerMessage[];
  turn: unknown;
  entry: unknown;
  answer: (result: PerfumerActionResult) => void;
}

let calls: Call[] = [];

function renderPage(locale: Locale = "uk", url = "/parfumer") {
  const router = createMemoryRouter(
    [
      {
        path: "/parfumer",
        element: createElement(PerfumerPage),
        action: async ({ request }) => {
          const form = await request.formData();
          const { messages, turn, entry } = JSON.parse(String(form.get("payload"))) as {
            messages: PerfumerMessage[];
            turn: unknown;
            entry: unknown;
          };
          return new Promise<PerfumerActionResult>((resolve) => {
            calls.push({ messages, turn, entry, answer: resolve });
          });
        },
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

beforeEach(() => {
  calls = [];
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PerfumerPage", () => {
  it("sends an example chip, shows it at once with the thinking state, then the reply", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Подарунок чоловікові" }));

    expect(screen.getByText("Подарунок чоловікові", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Парфумер підбирає аромати…");
    expect(input().disabled).toBe(true);
    // The hero gives way to the strip with "Start over".
    expect(screen.queryByRole("button", { name: "Подарунок чоловікові" })).toBeNull();
    expect(screen.getByRole("button", { name: "Почати спочатку" })).toBeTruthy();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.messages).toEqual([{ role: "user", content: "Подарунок чоловікові" }]);

    await answerLast(reply("Ось кілька ідей."));

    expect(await screen.findByText("Ось кілька ідей.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(input()));
  });

  it("sends with Enter, adds a line with Shift+Enter, and sends the conversation so far", async () => {
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
    expect(calls[1]?.messages).toEqual([
      { role: "user", content: "Щось свіже\nна літо" },
      { role: "assistant", content: "Ось свіжі аромати." },
      { role: "user", content: "Дешевше" },
    ]);
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
    expect(calls[1]?.messages).toEqual([{ role: "user", content: "Щось морське" }]);
    expect(screen.queryByText(/думав надто довго/)).toBeNull();
    expect(screen.getAllByText("Щось морське", { selector: "p" })).toHaveLength(1);

    await answerLast(reply("Ось морські аромати."));
    expect(await screen.findByText("Ось морські аромати.")).toBeTruthy();
  });

  it("keeps the thread across a reload and clears it on start over", async () => {
    const stored: ThreadItem[] = [
      { id: "1", role: "user", text: "Щось ванільне" },
      { id: "2", role: "perfumer", reply: { intro: "Ось ванільні аромати.", picks: [] } },
    ];
    sessionStorage.setItem(THREAD_STORAGE_KEY, JSON.stringify({ v: 1, items: stored }));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Ось ванільні аромати.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Почати спочатку" }));

    expect(screen.queryByText("Ось ванільні аромати.")).toBeNull();
    expect(screen.getByRole("button", { name: "Подарунок чоловікові" })).toBeTruthy();
    expect(sessionStorage.getItem(THREAD_STORAGE_KEY)).toBeNull();
  });

  it("saves the thread as it grows", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(input(), "Щось легке{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
    await answerLast(reply("Ось легкі."));
    await screen.findByText("Ось легкі.");

    const saved = JSON.parse(sessionStorage.getItem(THREAD_STORAGE_KEY) ?? "{}") as {
      items: ThreadItem[];
    };
    expect(saved.items.map((item) => item.role)).toEqual(["user", "perfumer"]);
  });

  it("sends each message's turn and the entry the chat was opened from (#166)", async () => {
    const user = userEvent.setup();
    renderPage("uk", "/parfumer?from=catalog");

    await user.type(input(), "Щось легке{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ turn: 1, entry: "catalog" });
    await answerLast(reply("Ось легкі.", "6f9b3c2a-1d4e-4b8a-9c7d-2e5f8a1b3c4d"));

    await user.type(await screen.findByRole("textbox"), "Дешевше{Enter}");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ turn: 2, entry: "catalog" });

    // The answer's reply id and turn are kept for its rating.
    const saved = JSON.parse(sessionStorage.getItem(THREAD_STORAGE_KEY) ?? "{}") as {
      entry: string;
      items: ThreadItem[];
    };
    expect(saved.entry).toBe("catalog");
    expect(saved.items[1]).toMatchObject({
      role: "perfumer",
      replyId: "6f9b3c2a-1d4e-4b8a-9c7d-2e5f8a1b3c4d",
      turn: 1,
    });
  });

  it("keeps a restored conversation's entry, and counts an unknown one as direct", async () => {
    sessionStorage.setItem(
      THREAD_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        entry: "product",
        items: [{ id: "1", role: "user", text: "Щось ванільне" }],
      }),
    );
    const user = userEvent.setup();
    renderPage("uk", "/parfumer?from=nonsense");

    await user.type(await screen.findByRole("textbox"), "Ще{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ turn: 2, entry: "product" });

    await answerLast(reply("Ось."));
    await user.click(await screen.findByRole("button", { name: "Почати спочатку" }));
    await user.type(input(), "Нове{Enter}");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ turn: 1, entry: "direct" });
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
});
