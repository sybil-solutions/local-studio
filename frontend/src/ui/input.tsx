"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, icon, className = "", id, ...props },
  ref,
) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div>
      {label && (
        <label
          htmlFor={inputId}
          className="mb-2 block text-xs font-medium uppercase tracking-wider text-(--ui-muted)"
        >
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
          className={`h-8 w-full rounded-md border border-(--ui-separator) bg-(--ui-bg) px-2.5 text-[length:var(--fs-base)] text-(--ui-fg) transition-all placeholder:text-(--ui-muted)/50 focus:border-(--ui-info)/50 focus:outline-none focus:ring-1 focus:ring-(--ui-info)/20 ${icon ? "pl-9" : ""} ${error ? "border-(--ui-danger)" : ""} ${className}`}
          {...props}
        />
      </div>
      {error && <p className="mt-1.5 text-xs text-(--ui-danger)">{error}</p>}
    </div>
  );
});

export { Input };
export type { InputProps };
