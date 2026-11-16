import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import {
  MAX_PERFUMER_TURN,
  PERFUMER_MAX_INPUT_LENGTH,
  type PerfumerActionResult,
  type PerfumerEntry,
  type PerfumerRating,
  type ThreadItem,
  toHistory,
} from "~/lib/perfumer";
import { loadThread, loadThreadEntry, saveThread } from "./thread-storage";

// The perfumer chat's state (#163): the thread (restored from `sessionStorage` after hydration, so
// the server render and the first client render match), the message being answered, and the
// fetcher that posts the conversation to the route's action.

export interface PendingTurn {
  id: string;
  /** The message being answered, for the error's retry. */
  text: string;
  /** Its number among the customer's messages in the thread (#166). */
  turn: number;
}

export interface PerfumerThread {
  items: ThreadItem[];
  pending: PendingTurn | null;
  /** Counts finished turns (a reply, an error or a cancel), so the page can move focus back. */
  finishedTurns: number;
  /** Sends a message; `false` when it's empty, too long or a reply is still awaited. */
  send: (text: string) => boolean;
  /** Stops waiting: aborts the request and notes the cancel in the thread. */
  cancel: () => void;
  /** Sends the message behind an error again, without repeating its bubble. */
  retry: (errorId: string) => void;
  /** Clears the thread and its stored copy. */
  startOver: () => void;
  /** Notes the customer's rating of a perfumer answer (#166); the button posts it. */
  rate: (itemId: string, rating: PerfumerRating) => void;
}

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/** The customer's message number of the newest message in `thread`, for analytics (#166). */
function turnOf(thread: readonly ThreadItem[]): number {
  const asked = thread.filter((item) => item.role === "user").length;
  return Math.min(Math.max(asked, 1), MAX_PERFUMER_TURN);
}

/**
 * `urlEntry`: how this page was opened (`?from=`, #166). A restored conversation keeps the entry
 * it was started with; a new one (also after "Start over") takes the page's.
 */
export function usePerfumerThread(urlEntry: PerfumerEntry = "direct"): PerfumerThread {
  const fetcher = useFetcher<PerfumerActionResult>();
  const { reset, submit: submitForm } = fetcher;
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [restored, setRestored] = useState(false);
  const [finishedTurns, setFinishedTurns] = useState(0);
  const [entry, setEntry] = useState<PerfumerEntry>(urlEntry);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restored once, on hydration.
  useEffect(() => {
    setItems(loadThread());
    setEntry(loadThreadEntry() ?? urlEntry);
    setRestored(true);
  }, []);

  useEffect(() => {
    if (restored) saveThread(items, undefined, entry);
  }, [items, restored, entry]);

  // A finished request: its result joins the thread. `reset()` sets `fetcher.data` to `null`, so
  // an old result is never taken for the next message's (which is sent while the fetcher still
  // looks idle).
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  useEffect(() => {
    if (!pending || result == null) return;
    const item: ThreadItem = result.ok
      ? {
          id: newId(),
          role: "perfumer",
          reply: result.reply,
          replyId: result.replyId,
          turn: pending.turn,
        }
      : { id: newId(), role: "error", error: result.error, retryText: pending.text };
    setItems((current) => [...current, item]);
    setPending(null);
    setFinishedTurns((count) => count + 1);
    reset();
  }, [pending, result, reset]);

  const submit = useCallback(
    (thread: readonly ThreadItem[], text: string) => {
      const turn = turnOf(thread);
      setPending({ id: newId(), text, turn });
      void submitForm(
        { payload: JSON.stringify({ messages: toHistory(thread), turn, entry }) },
        { method: "post" },
      );
    },
    [submitForm, entry],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || text.length > PERFUMER_MAX_INPUT_LENGTH || pending) return false;
      const thread: ThreadItem[] = [...items, { id: newId(), role: "user", text }];
      setItems(thread);
      submit(thread, text);
      return true;
    },
    [items, pending, submit],
  );

  const cancel = useCallback(() => {
    if (!pending) return;
    reset({ reason: "cancelled" });
    setPending(null);
    setItems((current) => [...current, { id: newId(), role: "cancelled" }]);
    setFinishedTurns((count) => count + 1);
  }, [reset, pending]);

  const retry = useCallback(
    (errorId: string) => {
      // Only the latest turn can be retried: later messages would otherwise come before it.
      const error = items.at(-1);
      if (pending || error?.id !== errorId || error.role !== "error") return;
      const thread = items.filter((item) => item.id !== errorId);
      setItems(thread);
      submit(thread, error.retryText);
    },
    [items, pending, submit],
  );

  const startOver = useCallback(() => {
    reset({ reason: "start over" });
    setPending(null);
    setItems([]);
    setEntry(urlEntry);
  }, [reset, urlEntry]);

  const rate = useCallback((itemId: string, rating: PerfumerRating) => {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId && item.role === "perfumer" ? { ...item, rating } : item,
      ),
    );
  }, []);

  return { items, pending, finishedTurns, send, cancel, retry, startOver, rate };
}
