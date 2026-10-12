"use client";

import { useId, type ReactNode } from "react";
import { FormFieldContext } from "./form-field-context";
import { FIELD_LABEL_CLASS } from "./utils";

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  asGroup?: boolean;
}

function FormField({
  label,
  required = false,
  error,
  description,
  children,
  className = "",
  asGroup = false,
}: FormFieldProps) {
  const controlId = useId();
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const fieldLabel = (
    <>
      {label}
      {required && <span className="text-(--ui-accent)"> *</span>}
    </>
  );
  const messages = (
    <>
      {description && (
        <p id={descriptionId} className="mt-1.5 text-xs text-(--ui-muted)">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-(--ui-danger)">
          {error}
        </p>
      )}
    </>
  );

  if (asGroup) {
    return (
      <fieldset
        className={`min-w-0 border-0 p-0 ${className}`}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
      >
        <legend className={FIELD_LABEL_CLASS}>
          {fieldLabel}
        </legend>
        {children}
        {messages}
      </fieldset>
    );
  }

  return (
    <FormFieldContext.Provider
      value={{ controlId, describedBy, required, invalid: Boolean(error) }}
    >
      <div className={className}>
        <label
          htmlFor={controlId}
          className={FIELD_LABEL_CLASS}
        >
          {fieldLabel}
        </label>
        {children}
        {messages}
      </div>
    </FormFieldContext.Provider>
  );
}

export { FormField };
export type { FormFieldProps };
