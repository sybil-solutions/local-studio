import type { ExtraArgType } from "./extra-arg-fields";

const coerceBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return undefined;
};

export const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") return Number.isNaN(value) ? undefined : value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

export const coerceValue = (value: unknown, type: ExtraArgType): unknown => {
  if (type === "boolean") return coerceBoolean(value);
  if (type === "number") return coerceNumber(value);
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return undefined;
  return String(value);
};
