// CRITICAL
import type { Config } from "../config/env.js";
import type { BackendAvailability, BackendTarget } from "../types/models.js";

/**
 * Health check timeout in milliseconds.
 */
const HEALTH_CHECK_TIMEOUT = 2000;

/**
 * Check if a backend is healthy by hitting its /health endpoint.
 * @param url - Backend URL.
 * @param timeoutMs - Timeout in milliseconds.
 * @returns True if backend is healthy.
 */
export async function checkBackendHealth(
  url: string,
  timeoutMs: number = HEALTH_CHECK_TIMEOUT,
  headers: Record<string, string> = {},
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${url}/health`, {
      signal: controller.signal,
      headers: { "User-Agent": "vllm-studio/1.0", ...headers },
    });

    clearTimeout(timeoutId);
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Detect which backends are available.
 * @param config - Runtime configuration.
 * @returns Backend availability status.
 */
export async function detectAvailableBackends(
  config: Config,
): Promise<BackendAvailability> {
  const masterKey = process.env["LITELLM_MASTER_KEY"] ?? "sk-master";
  const litellmHeaders = { Authorization: `Bearer ${masterKey}` };
  const [litellmAvailable, inferenceAvailable] = await Promise.all([
    checkBackendHealth(config.litellm_url, HEALTH_CHECK_TIMEOUT, litellmHeaders),
    checkBackendHealth(config.inference_url),
  ]);

  return {
    litellm_available: litellmAvailable,
    inference_available: inferenceAvailable,
    selected_mode: "auto",
  };
}

/**
 * Select the best backend target based on configuration and availability.
 * @param config - Runtime configuration.
 * @param availability - Backend availability status.
 * @returns Selected backend target.
 * @throws Error if no backend is available.
 */
export function selectBackend(
  config: Config,
  availability: BackendAvailability,
): BackendTarget {
  // Direct mode forced by configuration
  if (config.direct_mode) {
    return {
      mode: "direct",
      url: config.inference_url,
      name: "Direct Inference",
    };
  }

  // Prefer LiteLLM if available
  if (availability.litellm_available) {
    return {
      mode: "litellm",
      url: config.litellm_url,
      name: "LiteLLM Gateway",
    };
  }

  // Fallback to direct inference
  if (availability.inference_available) {
    return {
      mode: "direct",
      url: config.inference_url,
      name: "Direct Inference (fallback)",
    };
  }

  // No backend available
  throw new Error(
    "No inference backend available. LiteLLM is not running and vLLM/SGLang is not reachable. " +
      `Ensure either ${config.litellm_url} or ${config.inference_url} is accessible.`,
  );
}
