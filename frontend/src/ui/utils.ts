type ClassValue = string | false | null | undefined;

export function cx(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * The one form-label style. Sentence case at body size, no uppercase and no
 * letter-spacing: ChatGPT labels its fields the way it writes everything else,
 * and micro-caps read as chrome shouting at the value underneath.
 *
 * Every label-bearing control (FormField, Input, Select, ColorField) must use
 * this — divergent label styling is what made the same form look like three
 * different apps.
 */
export const FIELD_LABEL_CLASS =
  "mb-1.5 block text-[length:var(--fs-base)] font-medium text-(--ui-fg)" as const;
