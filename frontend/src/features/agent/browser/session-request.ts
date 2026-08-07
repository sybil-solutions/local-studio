import { BROWSER_SESSION_HEADER, type BrowserSessionKey } from "@shared/agent/browser-session";

export type BrowserSessionRequest = {
  input: string;
  init: RequestInit;
};

export function browserSessionRequest(
  sessionId: BrowserSessionKey | null,
  path: string,
  init: RequestInit = {},
): BrowserSessionRequest | null {
  if (!sessionId) return null;
  const headers = new Headers(init.headers);
  headers.set(BROWSER_SESSION_HEADER, sessionId);
  return {
    input: `/api/agent/browser/${path}`,
    init: { ...init, headers },
  };
}
