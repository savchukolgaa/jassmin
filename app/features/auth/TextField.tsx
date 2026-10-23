import type { ComponentProps } from "react";
import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";

export type TextFieldProps = Omit<ComponentProps<"input">, "id" | "name"> & {
  name: string;
  label: string;
  /** Shown under the input and announced with it; marks the input invalid. */
  error?: string;
  /** Help text under the input, e.g. password rules. */
  hint?: string;
  optional?: boolean;
};

/** A labelled input with its validation error, for the auth forms. */
export function TextField({
  name,
  label,
  error,
  hint,
  optional = false,
  className,
  ...props
}: TextFieldProps) {
  const { t } = useT();
  const id = `field-${name}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error && errorId, hint && hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-extrabold">
        {label}
        {optional && <span className="font-semibold text-gray-600"> {t("common.optional")}</span>}
      </label>
      <input
        {...props}
        id={id}
        name={name}
        required={!optional}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "min-h-14 rounded-2xl border-2 bg-white px-4 text-base text-gray-900",
          "focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary-light",
          error ? "border-red-700" : "border-gray-200",
          className,
        )}
      />
      {error && (
        <span id={errorId} className="text-sm font-bold text-red-700">
          {error}
        </span>
      )}
      {hint && (
        <span id={hintId} className="text-sm text-gray-600">
          {hint}
        </span>
      )}
    </div>
  );
}
