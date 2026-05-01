// CRITICAL
import { resolve, sep } from "node:path";
import type { Config } from "../../../config/env";

/** Sanitizes a user-supplied path, stripping traversal segments. */
export const sanitizePathSegments = (value: string): string[] => {
  return value
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => Boolean(segment) && segment !== "." && segment !== "..");
};

/** Resolves a model download directory under `config.models_dir`, rejecting path traversal. */
export const resolveDownloadRoot = (config: Config, modelId: string, destination?: string | null): string => {
  const base = resolve(config.models_dir);
  const segments = destination ? sanitizePathSegments(destination) : sanitizePathSegments(modelId);
  const target = resolve(base, ...segments);
  const normalizedBase = base.endsWith(sep) ? base : base + sep;
  if (!target.startsWith(normalizedBase)) {
    throw new Error("Invalid destination path");
  }
  return target;
};

