import { homedir } from "node:os";
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import { LocalSnapshot } from "@t3tools/contracts/local-studio";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { authenticateRawRouteWithScope } from "./http.ts";

const ControllerConfig = Schema.fromJsonString(
  Schema.Struct({
    url: Schema.String,
    fleetKey: Schema.String,
    peers: Schema.Array(Schema.String),
  }),
);
const allowed =
  /^(?:snapshot|tailnet|tailnet\/deploy|recipes|recipes\/[^/]+\/run|runs\/[^/]+\/stop|ports\/\d+\/stop|name|peers|registry|registry\/records\/[^/]+|registry\/download)$/;

const handler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const post = request.method === "POST";
  yield* authenticateRawRouteWithScope(
    post ? AuthOrchestrationOperateScope : AuthOrchestrationReadScope,
  );
  const url = new URL(request.url, "http://local.invalid");
  const path = url.pathname.slice("/api/local/".length);
  if (!allowed.test(path) || !(post || request.method === "GET"))
    return HttpServerResponse.empty({ status: 404 });
  return yield* Effect.gen(function* () {
    const paths = yield* Path.Path;
    const home = yield* Config.String("LOCAL_STUDIO_T3_HOME").pipe(
      Config.withDefault(paths.join(homedir(), ".local-studio-t3")),
    );
    const config = yield* (yield* FileSystem.FileSystem)
      .readFileString(paths.join(home, "config.json"))
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(ControllerConfig)));
    const target = url.searchParams.get("controller") ?? config.url;
    const client = HttpClient.withScope(yield* HttpClient.HttpClient);
    const call = (
      method: "GET" | "POST",
      upstreamUrl: URL,
      body?: HttpServerRequest.HttpServerRequest,
    ) =>
      client.execute(
        HttpClientRequest.make(method)(upstreamUrl).pipe(
          HttpClientRequest.bearerToken(config.fleetKey),
          HttpClientRequest.setHeader("content-type", "application/json"),
          body ? HttpClientRequest.bodyStream(body.stream) : (self) => self,
        ),
      );
    if (target !== config.url && !config.peers.includes(target)) {
      const root = yield* call("GET", new URL("/api/snapshot", config.url));
      const graph = yield* root.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(LocalSnapshot)),
      );
      if (!graph.controllers.some((link) => link.reachable && link.url === target))
        return HttpServerResponse.empty({ status: 403 });
    }
    const upstreamUrl = new URL(`/api/${path}`, target);
    for (const name of ["archived", "all"])
      if (url.searchParams.has(name))
        upstreamUrl.searchParams.set(name, url.searchParams.get(name) ?? "");
    const upstream = yield* call(post ? "POST" : "GET", upstreamUrl, post ? request : undefined);
    return HttpServerResponse.stream(upstream.stream, {
      status: upstream.status,
      contentType: upstream.headers["content-type"] ?? "application/json",
      headers: { "cache-control": "no-store" },
    });
  }).pipe(
    Effect.timeout("3 minutes"),
    Effect.catch(() =>
      Effect.succeed(HttpServerResponse.text("Local controller unavailable", { status: 503 })),
    ),
  );
});

const startBundledController = Effect.gen(function* () {
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (!resources) return;
  const binary = (yield* Path.Path).join(
    resources,
    "local-controller",
    process.platform === "win32" ? "local-studio-controller.exe" : "local-studio-controller",
  );
  if (!(yield* (yield* FileSystem.FileSystem).exists(binary))) return;
  const port = yield* Config.Number("LOCAL_STUDIO_T3_PORT").pipe(Config.withDefault(18091));
  const running = yield* (yield* HttpClient.HttpClient)
    .get(`http://127.0.0.1:${port}/api/health`)
    .pipe(Effect.timeout("1500 millis"), Effect.option);
  if (running._tag === "Some") return;
  yield* (yield* ChildProcessSpawner.ChildProcessSpawner).spawn(
    ChildProcess.make(binary, [], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }),
  );
});

export const localStudioProxyRouteLayer = Layer.mergeAll(
  HttpRouter.add("*", "/api/local/*", handler),
  Layer.effectDiscard(Effect.ignore(startBundledController)),
);
