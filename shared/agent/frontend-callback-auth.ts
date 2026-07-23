export const FRONTEND_CALLBACK_TOKEN_ENV = "LOCAL_STUDIO_FRONTEND_CALLBACK_TOKEN";
export const FRONTEND_CALLBACK_TOKEN_HEADER = "x-local-studio-callback-token";

const callbackMethods = new Map<string, ReadonlySet<string>>([
  ["/api/agent/plan", new Set(["GET", "POST"])],
  ["/api/agent/canvas", new Set(["GET", "POST"])],
  ["/api/agent/connectors/call", new Set(["GET", "POST"])],
]);

const browserVerbs = new Set([
  "navigate",
  "get-url",
  "get-text",
  "get-html",
  "screenshot",
  "click",
  "scroll",
  "fill",
]);

export function isFrontendCallbackRoute(method: string, pathname: string): boolean {
  const methods = callbackMethods.get(pathname);
  if (methods) return methods.has(method.toUpperCase());
  const prefix = "/api/agent/browser/";
  if (method.toUpperCase() !== "POST" || !pathname.startsWith(prefix)) return false;
  return browserVerbs.has(pathname.slice(prefix.length));
}
