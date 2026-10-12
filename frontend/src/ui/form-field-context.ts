"use client";

import { createContext, useContext, type AriaAttributes } from "react";

type FormFieldContextValue = {
  controlId: string;
  describedBy?: string;
  required: boolean;
  invalid: boolean;
};

type FormControlAttributes = {
  id?: string;
  describedBy?: string;
  required?: boolean;
  invalid?: AriaAttributes["aria-invalid"];
};

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

function joinedIds(first?: string, second?: string): string | undefined {
  const ids = `${first ?? ""} ${second ?? ""}`.trim().split(/\s+/).filter(Boolean);
  return ids.length ? [...new Set(ids)].join(" ") : undefined;
}

function useFormControlAttributes(attributes: FormControlAttributes): FormControlAttributes {
  const field = useContext(FormFieldContext);
  return {
    id: field?.controlId ?? attributes.id,
    describedBy: joinedIds(attributes.describedBy, field?.describedBy),
    required: attributes.required ?? field?.required,
    invalid: attributes.invalid ?? (field?.invalid || undefined),
  };
}

export { FormFieldContext, useFormControlAttributes };
