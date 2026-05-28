import { getControllerApiKey } from "./controllers";
import { getStoredBackendUrl } from "./backend-url";

/**
 * API key management utilities
 */

let runtimeApiKey = "";

/**
 * Get the API key from environment variables or in-memory runtime state.
 */
export function getApiKey(): string {
  // Prefer env var if available (build-time or runtime)
  const envKey = process.env.NEXT_PUBLIC_VLLM_STUDIO_API_KEY || process.env.VLLM_STUDIO_API_KEY;
  if (envKey) return envKey;

  if (runtimeApiKey) return runtimeApiKey;

  if (typeof window !== "undefined") {
    return getControllerApiKey(getStoredBackendUrl());
  }

  return "";
}

/**
 * Save API key only for the current browser runtime.
 */
export function setApiKey(key: string): void {
  runtimeApiKey = key.trim();
}

/**
 * Remove the in-memory runtime API key.
 */
export function clearApiKey(): void {
  runtimeApiKey = "";
}
