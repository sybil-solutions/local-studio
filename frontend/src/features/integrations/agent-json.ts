import { Schema } from "effect";
import { ApiErrorResponseSchema } from "@local-studio/agent-runtime/api-contract";

/**
 * Call one of this app's own `/api/agent/*` routes and decode the result.
 *
 * Distinct from `lib/api`, which speaks to a remote inference controller over a
 * proxy and has to cope with FastAPI's error shapes. These are Next route
 * handlers in the same process, answering with the runtime's `{ error }`
 * contract. One helper for that second kind keeps every caller here from
 * restating the same six lines — and, more importantly, keeps them all
 * surfacing the server's sentence rather than "HTTP 409", which is the
 * difference between "Tool names would collide with connector github" and a
 * number the user has to guess about.
 *
 * It lives beside its callers rather than in `lib` because those callers are
 * all on this page; the structure check enforces that, and it is right to.
 */
export function agentRouteError(body: unknown, fallback: string): string {
  try {
    return Schema.decodeUnknownSync(ApiErrorResponseSchema)(body).error;
  } catch {
    return fallback;
  }
}

export async function requestAgentJson<T>(
  url: string,
  decode: (input: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(agentRouteError(body, `HTTP ${response.status}`));
  return decode(body);
}

export const jsonBody = (payload: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
