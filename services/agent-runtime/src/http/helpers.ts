// Minimal response helpers for the transport-neutral handlers. These mirror
// frontend/src/app/api/_lib/route-helpers.ts (jsonError/errorMessage) — kept
// package-local so the handlers have zero frontend imports; the frontend
// keeps its own copy for the 20+ non-runtime routes that stay in Next.

/** Standard JSON error response used by the runtime handlers. */
export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Normalize an unknown thrown value into a message for jsonError. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
