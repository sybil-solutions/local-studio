// CRITICAL
import { existsSync } from "node:fs";

const DEFAULT_CANONICAL_PYTHON_PATH = "/opt/venvs/active/vllm-latest/bin/python";

const getExplicitPythonOverride = (): string | null => {
  const explicit = process.env["VLLM_STUDIO_RUNTIME_PYTHON"]?.trim();
  if (!explicit) {
    return null;
  }
  return explicit;
};

/**
 * Resolve the first valid vLLM python path in precedence order.
 * @returns Resolved Python executable path or null.
 */
export const resolveVllmPythonPath = (): string | null => {
  const candidates = [getExplicitPythonOverride(), DEFAULT_CANONICAL_PYTHON_PATH];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

/**
 * Resolve a recipe python path to a usable vLLM python path.
 * If the recipe path is missing/invalid, falls back to the canonical runtime path.
 * @param recipePythonPath - Recipe configured python path.
 * @returns Normalized python path to use.
 */
export const resolveVllmRecipePythonPath = (recipePythonPath: string | null | undefined): string | null => {
  if (recipePythonPath && existsSync(recipePythonPath)) {
    return recipePythonPath;
  }
  return resolveVllmPythonPath();
};
