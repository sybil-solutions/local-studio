import { RESERVED_EXTRA_ARGS } from "./reserved-extra-args";

export const filterExtraArgsForEditor = (
  extraArgs: Record<string, unknown>,
): Record<string, unknown> => {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extraArgs ?? {})) {
    if (!RESERVED_EXTRA_ARGS.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
};

export const mergeExtraArgsFromEditor = (
  extraArgs: Record<string, unknown>,
  editorArgs: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...extraArgs };
  for (const key of Object.keys(merged)) {
    if (!RESERVED_EXTRA_ARGS.has(key)) {
      delete merged[key];
    }
  }
  for (const [key, value] of Object.entries(editorArgs ?? {})) {
    merged[key] = value;
  }
  return merged;
};
