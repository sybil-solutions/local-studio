import {
  FRONTEND_CALLBACK_TOKEN_ENV,
  FRONTEND_CALLBACK_TOKEN_HEADER,
  isFrontendCallbackRoute,
} from "../../../shared/agent/frontend-callback-auth";
import { scrubReservedFrontendEnvironment } from "../../../shared/agent/frontend-environment.mjs";
import { setRuntimeFrontendOrigin } from "../../../frontend/desktop/resources/pi-extensions/frontend-callback-origin";

type MutableEnvironment = Record<string, string | undefined>;

export type RuntimeCallbackCredential = {
  readonly frontendOrigin: string;
  readonly token: string;
};

function resolvedOrigin(value: string | undefined): string {
  try {
    return new URL(value?.trim() || "http://127.0.0.1:3000").origin;
  } catch {
    return "";
  }
}

export function captureRuntimeCallbackCredential(
  environment: MutableEnvironment = process.env,
): RuntimeCallbackCredential {
  const credential = {
    frontendOrigin: resolvedOrigin(environment.LOCAL_STUDIO_FRONTEND_BASE),
    token: environment[FRONTEND_CALLBACK_TOKEN_ENV]?.trim() ?? "",
  };
  setRuntimeFrontendOrigin(credential.frontendOrigin);
  scrubReservedFrontendEnvironment(environment);
  return credential;
}

function requestUrl(input: string | URL | Request): URL | null {
  try {
    return new URL(input instanceof Request ? input.url : input);
  } catch {
    return null;
  }
}

function requestMethod(input: string | URL | Request, init?: RequestInit): string {
  return init?.method ?? (input instanceof Request ? input.method : "GET");
}

export function createFrontendCallbackFetch(
  credential: RuntimeCallbackCredential,
  fetchImplementation: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  return (input, init) => {
    const url = requestUrl(input);
    if (
      !credential.token ||
      !url ||
      url.origin !== credential.frontendOrigin ||
      !isFrontendCallbackRoute(requestMethod(input, init), url.pathname)
    ) {
      return fetchImplementation(input, init);
    }
    const inheritedHeaders = input instanceof Request ? input.headers : undefined;
    const headers = new Headers(init?.headers ?? inheritedHeaders);
    headers.set(FRONTEND_CALLBACK_TOKEN_HEADER, credential.token);
    return fetchImplementation(input, { ...init, headers });
  };
}
