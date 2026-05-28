const LOCAL_BACKEND_FALLBACK = "http://localhost:8080";
const CLIENT_PROXY_FALLBACK = "/api/proxy";

const pickFirstNonEmpty = (...values: Array<string | undefined>): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

/**
 * Server-side API client base URL.
 * Used as a first-run fallback when api-settings.json doesn't exist yet.
 */
export const resolveApiServerBaseUrl = (): string =>
  pickFirstNonEmpty(
    process.env.BACKEND_URL,
    process.env.NEXT_PUBLIC_BACKEND_URL,
    process.env.VLLM_STUDIO_BACKEND_URL,
  ) ?? LOCAL_BACKEND_FALLBACK;

/**
 * Default backend URL shown in settings/config UIs on first run.
 */
export const resolveSettingsDefaultBackendUrl = (): string =>
  pickFirstNonEmpty(
    process.env.BACKEND_URL,
    process.env.NEXT_PUBLIC_API_URL,
    process.env.NEXT_PUBLIC_BACKEND_URL,
  ) ?? LOCAL_BACKEND_FALLBACK;

/**
 * Client-side controller event stream base URL.
 */
export const resolveControllerEventsBaseUrl = (): string =>
  pickFirstNonEmpty(
    process.env.NEXT_PUBLIC_BACKEND_URL,
    process.env.VLLM_STUDIO_BACKEND_URL,
    process.env.BACKEND_URL,
  ) ?? CLIENT_PROXY_FALLBACK;
