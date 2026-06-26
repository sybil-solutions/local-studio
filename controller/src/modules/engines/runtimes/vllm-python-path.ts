import { existsSync } from "node:fs";
import { DEFAULT_CANONICAL_PYTHON_PATH } from "../configs";

const getExplicitPythonOverride = (): string | null => {
  const explicit = process.env["LOCAL_STUDIO_RUNTIME_PYTHON"]?.trim();
  if (!explicit) {
    return null;
  }
  return explicit;
};

export const resolveVllmPythonPath = (): string | null => {
  const candidates = [getExplicitPythonOverride(), DEFAULT_CANONICAL_PYTHON_PATH];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

export const resolveVllmRecipePythonPath = (
  recipePythonPath: string | null | undefined
): string | null => {
  if (recipePythonPath && existsSync(recipePythonPath)) {
    return recipePythonPath;
  }
  return resolveVllmPythonPath();
};
