"use client";

import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import { useFormControlAttributes } from "./form-field-context";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options?: SelectOption[];
  placeholder?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    options,
    placeholder,
    children,
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
  const selectId = field.id ?? (label ? generatedId : undefined);

  return (
    <div>
      {label && (
        <label
          htmlFor={selectId}
          className="mb-2 block text-xs font-medium uppercase tracking-wider text-(--ui-muted)"
        >
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        required={field.required}
        aria-describedby={field.describedBy}
        aria-invalid={field.invalid}
        className={`h-9 w-full rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) px-3 text-[length:var(--fs-base)] text-(--ui-fg) transition-colors focus:border-(--ui-accent)/60 focus:outline-none focus:ring-1 focus:ring-(--ui-accent)/20 ${className}`}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options
          ? options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
    </div>
  );
});

export { Select };
export type { SelectProps, SelectOption };
