// Env-derived default backend URL, shared by the frontend connection module
// and the agent runtime package's settings service.

const LOCAL_BACKEND_FALLBACK = "http://localhost:8080";

export const pickFirstNonEmpty = (...values: Array<string | undefined>): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

/**
 * Default backend URL shown in settings/config UIs on first run.
 */
export const resolveSettingsDefaultBackendUrl = (): string =>
  pickFirstNonEmpty(
    process.env.BACKEND_URL,
    process.env.NEXT_PUBLIC_API_URL,
    process.env.NEXT_PUBLIC_BACKEND_URL,
  ) ?? LOCAL_BACKEND_FALLBACK;
