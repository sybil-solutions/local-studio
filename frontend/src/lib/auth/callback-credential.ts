import {
  FRONTEND_CALLBACK_TOKEN_ENV,
  FRONTEND_CALLBACK_TOKEN_HEADER,
  isFrontendCallbackRoute,
} from "@shared/agent/frontend-callback-auth";
import { timingSafeStringEqual } from "./access";

const GLOBAL_KEY = "__localStudioFrontendCallbackCredential";

type CallbackCredentialState = { token: string };
type MutableEnvironment = Record<string, string | undefined>;

function callbackCredentialState(): CallbackCredentialState {
  const scope = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: CallbackCredentialState;
  };
  scope[GLOBAL_KEY] ??= { token: "" };
  return scope[GLOBAL_KEY];
}

export function captureFrontendCallbackCredential(
  environment: MutableEnvironment = process.env,
): void {
  callbackCredentialState().token = environment[FRONTEND_CALLBACK_TOKEN_ENV]?.trim() ?? "";
  delete environment[FRONTEND_CALLBACK_TOKEN_ENV];
}

export function matchesFrontendCallbackCredential(request: Request): boolean {
  const url = new URL(request.url);
  if (!isFrontendCallbackRoute(request.method, url.pathname)) return false;
  const expected = callbackCredentialState().token;
  const presented = request.headers.get(FRONTEND_CALLBACK_TOKEN_HEADER)?.trim() ?? "";
  return Boolean(expected && presented) && timingSafeStringEqual(presented, expected);
}
