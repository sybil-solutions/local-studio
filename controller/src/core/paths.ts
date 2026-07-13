import { basename } from "node:path";

export const modelBasename = (modelPath: string | null | undefined): string | null => {
  if (!modelPath) return null;
  return basename(modelPath) || null;
};
