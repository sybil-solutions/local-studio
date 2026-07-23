import { Schema } from "effect";

export const BROWSER_SESSION_HEADER = "x-local-studio-browser-session";

export const BrowserSessionKeySchema = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
    Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  ),
);

export type BrowserSessionKey = typeof BrowserSessionKeySchema.Type;

export function decodeBrowserSessionKey(input: unknown): BrowserSessionKey {
  return Schema.decodeUnknownSync(BrowserSessionKeySchema)(input);
}

export function browserSessionHeaders(sessionKey: BrowserSessionKey): Record<string, string> {
  return { [BROWSER_SESSION_HEADER]: sessionKey };
}

export function browserSessionHeadersOption(input: unknown): Record<string, string> | null {
  try {
    return browserSessionHeaders(decodeBrowserSessionKey(input));
  } catch {
    return null;
  }
}
