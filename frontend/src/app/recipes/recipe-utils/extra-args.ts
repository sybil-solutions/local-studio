import type { ExtraArgField } from "./extra-arg-fields";
import { coerceNumber } from "./coercion";

export const normalizeExtraArgKey = (key: string): string => key.replace(/-/g, "_").toLowerCase();

export const getCandidateKeys = (
  field: ExtraArgField | { key: string; aliases?: string[] },
): string[] => {
  const keys = new Set<string>();
  keys.add(field.key);
  keys.add(field.key.replace(/-/g, "_"));
  keys.add(field.key.replace(/_/g, "-"));
  if (field.aliases) {
    for (const alias of field.aliases) {
      keys.add(alias);
      keys.add(alias.replace(/-/g, "_"));
      keys.add(alias.replace(/_/g, "-"));
    }
  }
  return Array.from(keys);
};

export const getExtraArgValue = (
  extraArgs: Record<string, unknown>,
  field: ExtraArgField | { key: string; aliases?: string[] },
): unknown => {
  const keys = getCandidateKeys(field);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(extraArgs, key)) {
      return extraArgs[key];
    }
  }
  return undefined;
};

/**
 * Get an extra argument value by key, checking common key variants (kebab, snake case).
 * @param extraArgs - Extra arguments record.
 * @param key - The argument key to look up.
 * @returns The value if found, or undefined.
 */
export const getExtraArgValueForKey = (
  extraArgs: Record<string, unknown>,
  key: string,
): unknown => {
  return getExtraArgValue(extraArgs, { key });
};

export const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
};

export const extractThinkingBudget = (extraArgs: Record<string, unknown>): number | undefined => {
  const raw = getExtraArgValue(extraArgs, {
    key: "default-chat-template-kwargs",
    aliases: ["default_chat_template_kwargs"],
  });
  const parsed = parseJsonObject(raw);
  if (!parsed) return undefined;
  const budget = parsed["thinking_budget"];
  return coerceNumber(budget);
};

export const setExtraArgValue = (
  extraArgs: Record<string, unknown>,
  field: ExtraArgField | { key: string; aliases?: string[] },
  value: unknown,
): void => {
  for (const key of getCandidateKeys(field)) {
    delete extraArgs[key];
  }
  if (value === undefined || value === null || value === "") {
    return;
  }
  extraArgs[field.key] = value;
};

/**
 * Set an extra argument value by key, normalizing to kebab-case and clearing aliases.
 * @param extraArgs - Extra arguments record.
 * @param key - The argument key to set.
 * @param value - The value to set (deletes key if empty/null/undefined).
 * @returns A new record with the updated value.
 */
export const setExtraArgValueForKey = (
  extraArgs: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> => {
  const next = { ...extraArgs } as Record<string, unknown>;
  setExtraArgValue(next, { key }, value);
  return next;
};
