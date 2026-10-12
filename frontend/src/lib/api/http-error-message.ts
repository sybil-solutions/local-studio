export function isRetryableError(error: unknown, status?: number): boolean {
  if (status && status >= 500) return true;
  if (status === 429) return true;
  if (status === 408) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.name === "AbortError") return false;
  return false;
}

/** Normalize FastAPI / generic JSON error bodies into a single string for `Error.message`. */
export function formatHttpErrorMessage(status: number, body: unknown): string {
  const fallback = `HTTP ${status}`;
  if (body == null) return fallback;

  if (typeof body === "string") {
    const t = body.trim();
    return t.length > 0 ? t : fallback;
  }

  if (typeof body !== "object" || Array.isArray(body)) {
    return fallback;
  }

  const b = body as Record<string, unknown>;
  const detail = b["detail"];

  if (typeof detail === "string") {
    const t = detail.trim();
    return t.length > 0 ? t : fallback;
  }

  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        const msg =
          typeof o["msg"] === "string"
            ? o["msg"].trim()
            : typeof o["message"] === "string"
              ? (o["message"] as string).trim()
              : "";
        if (msg) {
          const locRaw = o["loc"];
          const loc =
            Array.isArray(locRaw) && locRaw.length > 0
              ? locRaw
                  .filter(
                    (x): x is string | number => typeof x === "string" || typeof x === "number",
                  )
                  .join(".")
              : "";
          return loc ? `${loc}: ${msg}` : msg;
        }
      }
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    });
    const joined = parts.filter((p) => p.length > 0).join("; ");
    return joined.length > 0 ? joined : fallback;
  }

  if (detail && typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch {
      return fallback;
    }
  }

  const nested = b["error"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const msg = (nested as Record<string, unknown>)["message"];
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  }

  if (typeof b["message"] === "string" && b["message"].trim()) {
    return (b["message"] as string).trim();
  }

  return fallback;
}
