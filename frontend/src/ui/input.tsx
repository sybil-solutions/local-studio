"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { useFormControlAttributes } from "./form-field-context";
import { cx, FIELD_LABEL_CLASS } from "./utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    error,
    icon,
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
  const inputId = field.id ?? (label ? generatedId : undefined);
  const errorId = error ? `${inputId ?? generatedId}-error` : undefined;
  const describedBy = [field.describedBy, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      {label && (
        <label htmlFor={inputId} className={FIELD_LABEL_CLASS}>
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-muted)">{icon}</div>
        )}
        <input
          ref={ref}
          id={inputId}
          required={field.required}
          aria-describedby={describedBy}
          aria-invalid={field.invalid ?? (error ? true : undefined)}
          className={`h-9 w-full rounded-[10px] border border-(--ui-separator) bg-(--surface-3) px-3 text-[length:var(--fs-base)] text-(--ui-fg) transition-all placeholder:text-(--hl2) focus:border-(--link)/70 focus:outline-none focus:ring-1 focus:ring-(--link)/25 ${icon ? "pl-9" : ""} ${error ? "border-(--ui-danger)" : ""} ${className}`}
          {...props}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-(--ui-danger)">
          {error}
        </p>
      )}
    </div>
  );
});

export { Input };
export type { InputProps };
