import { Effect, Schema } from "effect";
import type { AppContext } from "../app-context";

export type LocalFetchOptions = RequestInit & { host?: string; timeoutMs?: number };

export class LocalFetchError extends Schema.TaggedErrorClass<LocalFetchError>()("LocalFetchError", {
  stage: Schema.Literals(["fetch", "timeout"]),
  url: Schema.String,
  message: Schema.String,
  source: Schema.Unknown,
}) {}

const normalizePath = (path: string): string => {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
};

const buildLocalUrl = (port: number, path: string, host = "localhost"): string =>
  `http://${host}:${port}${normalizePath(path)}`;

export const fetchLocal = (
  port: number,
  path: string,
  options: LocalFetchOptions = {},
): Effect.Effect<Response, LocalFetchError> => {
  const { host, timeoutMs, signal: requestSignal, ...init } = options;
  const url = buildLocalUrl(port, path, host);
  const request = Effect.tryPromise({
    try: (effectSignal) =>
      fetch(url, {
        ...init,
        signal: requestSignal ? AbortSignal.any([requestSignal, effectSignal]) : effectSignal,
      }),
    catch: (source) =>
      new LocalFetchError({
        stage: "fetch",
        url,
        message: `Request to ${url} failed: ${String(source)}`,
        source,
      }),
  });
  if (!timeoutMs || timeoutMs <= 0) return request;
  return request.pipe(
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () =>
        Effect.fail(
          new LocalFetchError({
            stage: "timeout",
            url,
            message: `Request to ${url} timed out after ${timeoutMs}ms`,
            source: null,
          }),
        ),
    }),
  );
};

export const buildInferenceUrl = (context: AppContext, path: string): string =>
  buildLocalUrl(context.config.inference_port, path, context.config.inference_host);

export const fetchInference = (
  context: AppContext,
  path: string,
  options: LocalFetchOptions = {},
): Effect.Effect<Response, LocalFetchError> =>
  fetchLocal(context.config.inference_port, path, {
    host: context.config.inference_host,
    ...options,
  });
