import { homedir } from "node:os";
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import { LocalSnapshot } from "@t3tools/contracts/local-studio";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import {
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
} from "./auth/http.ts";

const controllerConfig = Schema.Struct({
  url: Schema.String,
  fleetKey: Schema.String,
  peers: Schema.Array(Schema.String),
});
const allowed = /^(?:snapshot|recipes|recipes\/[^/]+\/run|runs\/[^/]+\/stop|peers)$/;

const handler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const session = yield* auth.authenticateHttpRequest(request).pipe(
    Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
      failEnvironmentAuthInvalid(
        EnvironmentAuth.serverAuthCredentialReason(error),
        EnvironmentAuth.serverAuthDpopFailureReason(error),
      ),
    ),
    Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
      failEnvironmentInternal("internal_error", error),
    ),
  );
  const scope =
    request.method === "GET" ? AuthOrchestrationReadScope : AuthOrchestrationOperateScope;
  if (!session.scopes.includes(scope)) return yield* failEnvironmentScopeRequired(scope);
  const url = new URL(request.url, "http://local.invalid");
  const path = url.pathname.slice("/api/local/".length);
  if (!allowed.test(path) || !["GET", "POST"].includes(request.method)) {
    return HttpServerResponse.empty({ status: 404 });
  }
  return yield* Effect.gen(function* () {
    const paths = yield* Path.Path;
    const home = yield* Config.String("LOCAL_STUDIO_T3_HOME").pipe(
      Config.withDefault(paths.join(homedir(), ".local-studio-t3")),
    );
    const fs = yield* FileSystem.FileSystem;
    const config = yield* fs
      .readFileString(paths.join(home, "config.json"))
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(controllerConfig))));
    const target = url.searchParams.get("controller") ?? config.url;
    const client = HttpClient.withScope(yield* HttpClient.HttpClient);
    if (target !== config.url && !config.peers.includes(target)) {
      const root = yield* client.execute(
        HttpClientRequest.get(new URL("/api/snapshot", config.url)).pipe(
          HttpClientRequest.bearerToken(config.fleetKey),
        ),
      );
      const graph = yield* root.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(LocalSnapshot)),
      );
      if (!graph.controllers.some((link) => link.reachable && link.url === target))
        return HttpServerResponse.empty({ status: 403 });
    }
    const upstreamUrl = new URL(`/api/${path}`, target);
    if (path === "recipes" && url.searchParams.get("archived") === "1")
      upstreamUrl.searchParams.set("archived", "1");
    const upstream = yield* client.execute(
      HttpClientRequest.make(request.method)(upstreamUrl).pipe(
        HttpClientRequest.bearerToken(config.fleetKey),
        HttpClientRequest.setHeader("content-type", "application/json"),
        request.method === "POST" ? HttpClientRequest.bodyStream(request.stream) : (self) => self,
      ),
    );
    return HttpServerResponse.stream(upstream.stream, {
      status: upstream.status,
      contentType: upstream.headers["content-type"] ?? "application/json",
      headers: { "cache-control": "no-store" },
    });
  }).pipe(
    Effect.timeout("30 seconds"),
    Effect.catch(() =>
      Effect.succeed(HttpServerResponse.text("Local controller unavailable", { status: 503 })),
    ),
  );
});

export const localStudioProxyRouteLayer = HttpRouter.add("*", "/api/local/*", handler);
