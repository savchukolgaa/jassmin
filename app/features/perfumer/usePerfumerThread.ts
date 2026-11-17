import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { usePathFor } from "~/lib/i18n";
import {
  MAX_PERFUMER_TURN,
  PERFUMER_MAX_INPUT_LENGTH,
  type PerfumerActionResult,
  type PerfumerEntry,
  type PerfumerEvent,
  type PerfumerPick,
  type PerfumerRating,
  type PerfumerStep,
  type ThreadItem,
  toHistory,
} from "~/lib/perfumer";
import { canStream, StreamFailedError, streamPerfumerReply } from "./perfumer-stream";
import { loadThread, loadThreadEntry, saveThread } from "./thread-storage";

// The perfumer chat's state (#163): the thread (restored from `sessionStorage` after hydration, so
// the server render and the first client render match), the message being answered, and how it's
// sent. Each message is streamed from `/parfumer/stream` first (#164), so the turn fills in as the
// perfumer works: its steps, the intro sentence by sentence, then the cards. When streaming isn't
// possible or fails, the fetcher posts the same conversation to the route's action.

export interface PendingTurn {
  id: string;
  /** The message being answered, for the error's retry. */
  text: string;
  /** Its number among the customer's messages in the thread (#166). */
  turn: number;
  /** The catalog searches so far (#164). */
  steps: PerfumerStep[];
  /** The intro so far, as it streams (#164). */
  intro: string;
  /** The cards, once they've arrived (#164). */
  picks?: PerfumerPick[];
}

export interface PerfumerThread {
  items: ThreadItem[];
  pending: PendingTurn | null;
  /** Whether the stored thread has been read, so a message sent now joins it (#165). */
  restored: boolean;
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
 * `urlEntry`: how this page was opened (`?from=`, #166). A restored conversation keeps the entry it
 * was started with, unless the page was opened from an entry point again; a new one (also after
 * "Start over") takes the page's.
 */
export function usePerfumerThread(urlEntry: PerfumerEntry = "direct"): PerfumerThread {
  const fetcher = useFetcher<PerfumerActionResult>();
  const { reset, submit: submitForm } = fetcher;
  const pathFor = usePathFor();
  const streamUrl = pathFor("perfumerStream");
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [restored, setRestored] = useState(false);
  const [finishedTurns, setFinishedTurns] = useState(0);
  const [entry, setEntry] = useState<PerfumerEntry>(urlEntry);
  /** The stream being read; replaced or cleared when it's no longer wanted. */
  const streamRef = useRef<AbortController | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restored once, on hydration.
  useEffect(() => {
    setItems(loadThread());
    setEntry(urlEntry === "direct" ? (loadThreadEntry() ?? urlEntry) : urlEntry);
    setRestored(true);
  }, []);

  useEffect(() => {
    if (restored) saveThread(items, undefined, entry);
  }, [items, restored, entry]);

  // Leaving the page stops the stream, and with it the model call on the server.
  useEffect(() => () => streamRef.current?.abort(), []);

  const finish = useCallback((item: ThreadItem) => {
    setItems((current) => [...current, item]);
    setPending(null);
    setFinishedTurns((count) => count + 1);
  }, []);

  // A finished request: its result joins the thread. `reset()` sets `fetcher.data` to `null`, so
  // an old result is never taken for the next message's (which is sent while the fetcher still
  // looks idle).
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  useEffect(() => {
    if (!pending || result == null) return;
    finish(
      result.ok
        ? {
            // The streaming turn's id, so its cards keep their cart state (#169).
            id: pending.id,
            role: "perfumer",
            reply: result.reply,
            replyId: result.replyId,
            turn: pending.turn,
          }
        : { id: newId(), role: "error", error: result.error, retryText: pending.text },
    );
    reset();
  }, [pending, result, reset, finish]);

  /** Stops the stream being read, if any, without a trace in the thread. */
  const stopStream = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
  }, []);

  const submit = useCallback(
    (thread: readonly ThreadItem[], text: string) => {
      const id = newId();
      const turn = turnOf(thread);
      const payload = JSON.stringify({ messages: toHistory(thread), turn, entry });
      const viaAction = () => void submitForm({ payload }, { method: "post" });
      setPending({ id, text, turn, steps: [], intro: "" });
      if (!canStream()) {
        viaAction();
        return;
      }

      const controller = new AbortController();
      streamRef.current = controller;
      const current = () => streamRef.current === controller;
      const update = (change: (turn: PendingTurn) => PendingTurn) =>
        setPending((turn) => (turn?.id === id ? change(turn) : turn));
      let intro = "";
      let picks: PerfumerPick[] = [];
      let question: string | undefined;

      const onEvent = (event: PerfumerEvent) => {
        if (!current()) return;
        switch (event.type) {
          case "step":
            update((turn) => ({ ...turn, steps: [...turn.steps, event.step] }));
            break;
          case "intro":
            intro += event.text;
            update((turn) => ({ ...turn, intro }));
            break;
          case "picks":
            picks = event.picks;
            update((turn) => ({ ...turn, picks }));
            break;
          case "question":
            question = event.text;
            break;
        }
      };

      streamPerfumerReply({ url: streamUrl, payload, signal: controller.signal, onEvent }).then(
        (end) => {
          if (!current()) return;
          streamRef.current = null;
          finish(
            end.type === "done"
              ? {
                  // The streaming turn's id, so its cards keep their cart state (#169).
                  id,
                  role: "perfumer",
                  reply: { intro, picks, ...(question ? { question } : {}) },
                  ...(end.replyId ? { replyId: end.replyId } : {}),
                  turn,
                }
              : { id: newId(), role: "error", error: end.error, retryText: text },
          );
        },
        (error: unknown) => {
          // A cancel, start over or a newer message: nothing to do.
          if (!current() || controller.signal.aborted) return;
          streamRef.current = null;
          if (!(error instanceof StreamFailedError)) {
            console.error("AI perfumer: the stream failed", error);
          }
          // Fall back to the normal request; the steps already shown stay, the rest starts over.
          update((turn) => ({ ...turn, intro: "", picks: undefined }));
          viaAction();
        },
      );
    },
    [submitForm, streamUrl, finish, entry],
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
    stopStream();
    reset({ reason: "cancelled" });
    setPending(null);
    setItems((current) => [...current, { id: newId(), role: "cancelled" }]);
    setFinishedTurns((count) => count + 1);
  }, [reset, pending, stopStream]);

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
    stopStream();
    reset({ reason: "start over" });
    setPending(null);
    setItems([]);
    setEntry(urlEntry);
  }, [reset, stopStream, urlEntry]);

  const rate = useCallback((itemId: string, rating: PerfumerRating) => {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId && item.role === "perfumer" ? { ...item, rating } : item,
      ),
    );
  }, []);

  return { items, pending, restored, finishedTurns, send, cancel, retry, startOver, rate };
}
