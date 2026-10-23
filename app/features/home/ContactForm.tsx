import { type ComponentProps, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import {
  CONTACT_LIMITS,
  type ContactActionResult,
  type ContactField,
  type ContactValues,
  HONEYPOT_FIELD,
} from "~/lib/contact";

type ContactFormProps = {
  /** The action result after a full-page (no-JS) submission. */
  actionData: ContactActionResult | undefined;
};

/**
 * Posts to the home route action. With JS it submits in place through a fetcher; without JS the
 * browser posts the form and lands back on `#contacts` with the result in `actionData`.
 */
export function ContactForm({ actionData }: ContactFormProps) {
  const fetcher = useFetcher<ContactActionResult>();
  const result = fetcher.data ?? actionData;
  const busy = fetcher.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) {
      return;
    }
    if (fetcher.data.status === "success") {
      formRef.current?.reset();
    } else if (fetcher.data.status === "invalid") {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [fetcher.state, fetcher.data]);

  const values: Partial<ContactValues> = result && "values" in result ? result.values : {};
  const errors = result?.status === "invalid" ? result.fieldErrors : {};

  return (
    <fetcher.Form
      ref={formRef}
      method="post"
      action="/?index#contacts"
      noValidate
      aria-labelledby="contact-form-title"
      className="relative flex flex-col gap-5 rounded-card-lg bg-white p-6 text-ink shadow-lg sm:p-9"
    >
      <h3 id="contact-form-title" className="text-2xl font-extrabold tracking-[-0.03em]">
        Send us a message
      </h3>

      <Field
        name="name"
        label="Name"
        autoComplete="name"
        maxLength={CONTACT_LIMITS.nameMax}
        defaultValue={values.name}
        error={errors.name}
      />
      <Field
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        maxLength={CONTACT_LIMITS.emailMax}
        defaultValue={values.email}
        error={errors.email}
      />
      <Field
        name="message"
        label="Message"
        multiline
        maxLength={CONTACT_LIMITS.messageMax}
        defaultValue={values.message}
        error={errors.message}
      />

      {/* Honeypot: hidden from people and assistive tech; bots that fill it are ignored. */}
      <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor={`contact-${HONEYPOT_FIELD}`}>Leave this field empty</label>
        <input
          id={`contact-${HONEYPOT_FIELD}`}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div>
        <Button type="submit" size="lg" loading={busy}>
          {busy ? "Sending…" : "Send message"}
        </Button>
      </div>

      <div role="status" aria-live="polite">
        {result?.status === "success" && (
          <p className="animate-pop rounded-card bg-success-bg p-4 font-bold text-success">
            Thanks! Your message was sent. We'll reply by email.
          </p>
        )}
      </div>
      {result?.status === "rate_limited" && (
        <p role="alert" className="rounded-card bg-red-50 p-4 font-bold text-red-800">
          You've sent several messages in a short time. Please try again in{" "}
          {Math.max(1, Math.ceil(result.retryAfterSeconds / 60))} min.
        </p>
      )}
      {result?.status === "delivery_failed" && (
        <p role="alert" className="rounded-card bg-red-50 p-4 font-bold text-red-800">
          Sorry, we couldn't send your message right now. Please try again later or call or email us
          directly.
        </p>
      )}
    </fetcher.Form>
  );
}

type FieldProps = {
  name: ContactField;
  label: string;
  error: string | undefined;
  multiline?: boolean;
} & Pick<ComponentProps<"input">, "type" | "autoComplete" | "maxLength" | "defaultValue">;

function Field({ name, label, error, multiline = false, ...inputProps }: FieldProps) {
  const id = `contact-${name}`;
  const errorId = `${id}-error`;
  const shared = {
    id,
    name,
    required: true,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
    className: cn(
      "w-full rounded-2xl border bg-card px-4 py-3 text-base text-ink",
      "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
      error ? "border-red-700" : "border-muted",
    ),
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-bold">
        {label}
      </label>
      {multiline ? (
        <textarea
          {...shared}
          rows={5}
          maxLength={inputProps.maxLength}
          defaultValue={inputProps.defaultValue}
        />
      ) : (
        <input {...shared} {...inputProps} type={inputProps.type ?? "text"} />
      )}
      {error && (
        <p id={errorId} className="text-sm font-bold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
