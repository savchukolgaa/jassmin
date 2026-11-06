import type { ComponentProps } from "react";
import { cn } from "~/lib/cn";

export type CheckboxFieldProps = Omit<ComponentProps<"input">, "id" | "name" | "type"> & {
  name: string;
  /** Defaults to `field-<name>`; set it when two forms on a page share a field name. */
  id?: string;
  label: string;
  /** A line of help under the label, announced with the checkbox. */
  hint?: string;
};

/**
 * A labelled checkbox (#128), styled like the checkout's payment options: the whole card is the
 * label, so it's a large target, and the focus ring goes round the card. Posts `on` when ticked
 * and nothing otherwise.
 */
export function CheckboxField({
  name,
  id: idProp,
  label,
  hint,
  className,
  ...props
}: CheckboxFieldProps) {
  const id = idProp ?? `field-${name}`;
  const hintId = `${id}-hint`;

  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer gap-3 rounded-2xl border-2 border-gray-200 bg-white p-4",
        "has-checked:border-primary has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-primary",
        className,
      )}
    >
      <input
        {...props}
        id={id}
        name={name}
        type="checkbox"
        aria-describedby={hint ? hintId : undefined}
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-extrabold text-ink">{label}</span>
        {hint && (
          <span id={hintId} className="text-sm text-muted">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
