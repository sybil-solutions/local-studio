"use client";

import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { useFormControlAttributes } from "./form-field-context";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    error,
    className = "",
    id,
    required,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const field = useFormControlAttributes({
    id,
    required,
    describedBy: ariaDescribedBy,
    invalid: ariaInvalid,
  });
  const textareaId = field.id ?? (label ? generatedId : undefined);
  const errorId = error ? `${textareaId ?? generatedId}-error` : undefined;
  const describedBy = [field.describedBy, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      {label && (
        <label
          htmlFor={textareaId}
          className="mb-2 block text-xs font-medium uppercase tracking-wider text-(--ui-muted)"
        >
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        required={field.required}
        aria-describedby={describedBy}
        aria-invalid={field.invalid ?? (error ? true : undefined)}
        className={`w-full resize-none rounded-xl border border-(--ui-border) bg-(--surface-3) px-3 py-2.5 text-[length:var(--fs-base)] text-(--ui-fg) transition-all placeholder:text-(--hl2) focus:border-(--link)/70 focus:outline-none focus:ring-1 focus:ring-(--link)/25 ${error ? "border-(--ui-danger)" : ""} ${className}`}
        {...props}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-(--ui-danger)">
          {error}
        </p>
      )}
    </div>
  );
});

export { Textarea };
export type { TextareaProps };
