import { useEffect, useRef, useState } from "react";
import { useRouteLoaderData } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { type TextKey, useT } from "~/lib/i18n";
import type { loader as shopLoader } from "~/routes/_shop";
import { BottleIcon, RestartIcon } from "./icons";
import { MessageThread } from "./MessageThread";
import { PerfumerInput } from "./PerfumerInput";
import { usePerfumerThread } from "./usePerfumerThread";

const EXAMPLES = [
  "perfumer.examples.summer",
  "perfumer.examples.giftHim",
  "perfumer.examples.likeLaVie",
  "perfumer.examples.vanilla",
] as const satisfies readonly TextKey[];

/**
 * The AI perfumer chat page (#163), as drawn on the C+ canvas: a deep-pink hero with example
 * requests while the thread is empty, a slim strip with "Start over" once it isn't, the thread in
 * an 800px column and the message bar stuck to the bottom of the screen.
 */
export function PerfumerPage() {
  const { t } = useT();
  const thread = usePerfumerThread();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The fixed cookie banner (#18) would cover the stuck message bar: until it's answered the bar
  // stays in the flow, with room below it to scroll it above the banner.
  const cookieBanner = useRouteLoaderData<typeof shopLoader>("routes/_shop")?.consent === null;
  const empty = thread.items.length === 0 && !thread.pending;

  // After a reply, an error or a cancel, the customer can type straight away.
  useEffect(() => {
    if (thread.finishedTurns > 0) inputRef.current?.focus();
  }, [thread.finishedTurns]);

  function send(text: string) {
    if (thread.send(text)) setDraft("");
  }

  function startOver() {
    thread.startOver();
    setDraft("");
    inputRef.current?.focus();
  }

  return (
    <main
      className={cn("flex min-h-[calc(100dvh-4rem)] flex-col", cookieBanner && "pb-64 sm:pb-40")}
    >
      {empty ? <Hero onExample={send} /> : <Strip onStartOver={startOver} />}
      <div className="mx-auto flex w-full max-w-212 flex-1 flex-col px-4 pt-8">
        {empty ? (
          <p className="pt-2 pb-10 leading-relaxed text-body">{t("perfumer.tips")}</p>
        ) : (
          <MessageThread
            items={thread.items}
            pending={thread.pending}
            onCancel={thread.cancel}
            onRetry={thread.retry}
          />
        )}
        <PerfumerInput
          value={draft}
          onChange={setDraft}
          onSend={send}
          disabled={thread.pending !== null}
          inputRef={inputRef}
          sticky={!cookieBanner}
        />
      </div>
    </main>
  );
}

function Hero({ onExample }: { onExample: (text: string) => void }) {
  const { t } = useT();
  return (
    <section aria-labelledby="perfumer-title" className="overflow-hidden bg-primary text-white">
      <div className="container mx-auto flex flex-col items-start gap-4 px-4 pt-10 pb-11 md:pt-16 md:pb-18">
        <p className="animate-fade-up text-sm font-extrabold tracking-widest uppercase">
          {t("perfumer.title")}
        </p>
        <h1
          id="perfumer-title"
          className="max-w-205 animate-fade-up anim-delay-1 text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.02] font-bold tracking-[-0.01em] text-balance"
        >
          {t("perfumer.heroTitle")}
        </h1>
        <p className="max-w-155 animate-fade-up anim-delay-2 text-lg leading-relaxed md:text-[1.1875rem]">
          {t("perfumer.heroIntro")}
        </p>
        <div className="flex animate-fade-up anim-delay-3 flex-col gap-2.5 pt-2">
          <span className="font-extrabold">{t("perfumer.tryLabel")}</span>
          <ul aria-label={t("perfumer.examplesLabel")} className="flex flex-wrap gap-2.5">
            {EXAMPLES.map((key) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onExample(t(key))}
                  className={cn(
                    "chip-hover inline-flex min-h-11 items-center rounded-pill bg-white px-4.5 text-left",
                    "font-extrabold text-primary-dark",
                    focusRing("onPrimary"),
                  )}
                >
                  {t(key)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Strip({ onStartOver }: { onStartOver: () => void }) {
  const { t } = useT();
  return (
    <section aria-labelledby="perfumer-title" className="bg-primary text-white">
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-x-5 gap-y-3 px-4 py-5.5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            aria-hidden="true"
            className="flex size-11 flex-none items-center justify-center rounded-full bg-white text-primary"
          >
            <BottleIcon sparkle className="size-5.5" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1
              id="perfumer-title"
              className="text-[1.75rem] leading-tight font-bold tracking-[-0.01em]"
            >
              {t("perfumer.title")}
            </h1>
            <p className="text-sm font-semibold">{t("perfumer.stripNote")}</p>
          </div>
        </div>
        <Button type="button" variant="outline-light" size="sm" onClick={onStartOver}>
          <RestartIcon className="size-4.5" />
          {t("perfumer.startOver")}
        </Button>
      </div>
    </section>
  );
}
