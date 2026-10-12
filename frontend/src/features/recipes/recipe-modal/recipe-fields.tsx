"use client";

import type { ReactNode } from "react";
import { CheckboxRow, FormField, Input, Select } from "@/ui";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";

type FieldOptions = { description?: string; required?: boolean };
type InputOptions = FieldOptions & {
  type?: "text" | "number";
  placeholder?: string;
  min?: number;
  fallback?: string | number;
  icon?: ReactNode;
  preserveEmpty?: boolean;
};
type SelectOptions = FieldOptions & {
  fallback?: string;
  numeric?: boolean;
  empty?: string;
  zeroIsEmpty?: boolean;
};
type SelectChoices = Readonly<Record<string, string | Readonly<Record<string, string>>>>;

const renderChoices = (choices: SelectChoices): ReactNode =>
  Object.entries(choices).map(([value, label]) =>
    typeof label === "string" ? (
      <option key={value} value={value}>
        {label}
      </option>
    ) : (
      <optgroup key={value} label={value}>
        {Object.entries(label).map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </optgroup>
    ),
  );

const numericValue = (value: string): number | undefined => {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function createRecipeFields(recipe: RecipeEditor, onChange: (next: RecipeEditor) => void) {
  const update = (name: keyof RecipeEditor, value: unknown) =>
    onChange({ ...recipe, [name]: value });

  const input = (name: keyof RecipeEditor, label: string, options: InputOptions = {}) => {
    const {
      description,
      required,
      type = "text",
      placeholder,
      min,
      fallback,
      icon,
      preserveEmpty,
    } = options;
    const current = recipe[name];
    const value =
      typeof current === "string" || typeof current === "number" ? current : (fallback ?? "");
    return (
      <FormField label={label} description={description} required={required}>
        <Input
          type={type}
          min={min}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            update(
              name,
              type === "number"
                ? numericValue(next)
                : next === "" && !preserveEmpty
                  ? undefined
                  : next,
            );
          }}
          placeholder={placeholder}
          icon={icon}
        />
      </FormField>
    );
  };

  const select = (
    name: keyof RecipeEditor,
    label: string,
    children: ReactNode,
    options: SelectOptions = {},
  ) => {
    const {
      description,
      fallback = "",
      numeric = false,
      empty = "",
      zeroIsEmpty = false,
    } = options;
    const current = recipe[name];
    const value =
      current === "" || (zeroIsEmpty && current === 0) ? fallback : (current ?? fallback);
    return (
      <FormField label={label} description={description}>
        <Select
          value={String(value)}
          onChange={(event) => {
            const next = event.target.value;
            update(name, next === empty ? undefined : numeric ? numericValue(next) : next);
          }}
        >
          {children}
        </Select>
      </FormField>
    );
  };

  return {
    input,
    select,
    choices(
      name: keyof RecipeEditor,
      label: string,
      choices: SelectChoices,
      options: SelectOptions = {},
    ) {
      return select(name, label, renderChoices(choices), options);
    },
    checkbox(name: keyof RecipeEditor, label: string, description?: string) {
      return (
        <CheckboxRow
          checked={Boolean(recipe[name])}
          onChange={(checked) => update(name, checked)}
          label={label}
          description={description}
        />
      );
    },
  };
}
