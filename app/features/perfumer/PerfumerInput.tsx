import { type FormEvent, type KeyboardEvent, type RefObject, useLayoutEffect } from "react";
import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { cn } from "~/lib/cn";
import { usePathFor, useT } from "~/lib/i18n";
import { PERFUMER_COUNTER_FROM, PERFUMER_MAX_INPUT_LENGTH } from "~/lib/perfumer";
import { SendIcon } from "./icons";

/** The textarea's tallest size, about 6 lines; it scrolls beyond. */
const MAX_HEIGHT_PX = 168;

export interface PerfumerInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Sends the message; returns whether it was sent (and the field may be cleared). */
  onSend: (text: string) => void;
  /** While a reply is awaited the field and button are disabled. */
  disabled: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Sticks to the bottom of the screen; off while the cookie banner covers it. */
  sticky: boolean;
}

/**
 * The message bar (#163): a growing textarea (Enter sends, Shift+Enter adds a line, an IME
 * composition is left alone), the round send button, the AI disclaimer, and the character counter
 * from 400 characters. Over 500 the field turns deep pink, an alert explains and sending is off;
 * there's no `maxLength`, so pasted text isn't cut silently.
 */
export function PerfumerInput({
  value,
  onChange,
  onSend,
  disabled,
  inputRef,
  sticky,
}: PerfumerInputProps) {
  const { t, formatNumber } = useT();
  const path = usePathFor();
  const length = value.trim().length;
  const tooLong = length > PERFUMER_MAX_INPUT_LENGTH;
  const canSend = !disabled && !tooLong && length > 0;

  // Where `field-sizing: content` isn't supported, the textarea grows with its content in JS.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measured whenever the text changes.
  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field || (typeof CSS !== "undefined" && CSS.supports("field-sizing", "content"))) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value, inputRef]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (canSend) onSend(value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={submit}
      className={cn(
        "z-10 mt-auto flex flex-col gap-2 border-line border-t bg-white pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]",
        sticky && "sticky bottom-0",
      )}
    >
      <label htmlFor="perfumer-input" className="sr-only">
        {t("perfumer.inputLabel")}
      </label>
      <div
        className={cn(
          "flex items-end gap-2.5 rounded-[1.75rem] border-2 bg-card py-2 pr-2 pl-4.5 transition-colors",
          "focus-within:border-primary",
          tooLong ? "border-primary-dark" : "border-transparent",
        )}
      >
        <textarea
          ref={inputRef}
          id="perfumer-input"
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={(event) => event.currentTarget.scrollIntoView?.({ block: "nearest" })}
          disabled={disabled}
          aria-invalid={tooLong || undefined}
          aria-describedby="perfumer-counter perfumer-note"
          placeholder={t("perfumer.placeholder")}
          className="max-h-42 min-h-7 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[1.0625rem] leading-[1.45] text-ink [field-sizing:content] placeholder:text-muted focus:outline-none disabled:cursor-wait"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label={t("perfumer.send")}
          className={cn(
            "flex size-12 flex-none items-center justify-center rounded-full bg-primary text-white transition-colors",
            "hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-muted",
            focusRing("onLight"),
          )}
        >
          <SendIcon className="size-5.5" />
        </button>
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-1.5 text-[0.8125rem] leading-normal">
        <p id="perfumer-note" className="text-muted">
          {t("perfumer.disclaimer")}{" "}
          <Link
            to={path("home", {}, { hash: "contacts" })}
            className={cn("rounded font-bold text-primary-dark underline", focusRing("onLight"))}
          >
            {t("perfumer.contactUs")}
          </Link>
          .
        </p>
        <p
          id="perfumer-counter"
          aria-live="polite"
          className={cn("font-bold", tooLong ? "text-primary-dark" : "text-muted")}
        >
          {length >= PERFUMER_COUNTER_FROM ? (
            t("perfumer.counter", {
              count: formatNumber(length),
              max: formatNumber(PERFUMER_MAX_INPUT_LENGTH),
            })
          ) : (
            <span className="hidden lg:inline">{t("perfumer.keyHint")}</span>
          )}
        </p>
      </div>
      {tooLong && (
        <p role="alert" className="px-1.5 text-sm font-bold text-primary-dark">
          {t("perfumer.errors.tooLong")}
        </p>
      )}
    </form>
  );
}
