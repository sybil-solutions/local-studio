import { homedir } from "node:os";
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import { LocalSnapshot } from "@t3tools/contracts/local-studio";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
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
  /^(?:snapshot|tailnet|tailnet\/deploy|recipes|recipes\/[^/]+\/run|runs\/[^/]+\/stop|ports\/\d+\/stop|name|peers|registry|registry\/records\/[^/]+|registry\/download|registry\/share)$/;

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
    for (const name of ["archived", "all", "port"])
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

const CONTROLLER_API = 2;
const ControllerHealth = Schema.Struct({
  ok: Schema.Boolean,
  id: Schema.String,
  version: Schema.String,
  api: Schema.optionalKey(Schema.Number),
});

const ensureController = Effect.gen(function* () {
  const paths = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const client = yield* HttpClient.HttpClient;
  const port = yield* Config.Number("LOCAL_STUDIO_T3_PORT").pipe(Config.withDefault(18091));
  const health = client.get(`http://127.0.0.1:${port}/api/health`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(ControllerHealth)),
    Effect.timeout("1500 millis"),
    Effect.option,
  );
  const current = yield* health;
  if (current._tag === "Some" && (current.value.api ?? 0) >= CONTROLLER_API) return;
  if (current._tag === "Some" && process.platform !== "win32") {
    const pids = (yield* spawner.string(
      ChildProcess.make("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
        stdin: "ignore",
        stderr: "ignore",
      }),
    ))
      .split(/\s+/)
      .filter(Boolean);
    for (const pid of pids) process.kill(Number(pid), "SIGTERM");
    yield* health.pipe(
      Effect.flatMap((result) => (result._tag === "Some" ? Effect.fail("busy") : Effect.void)),
      Effect.retry({ schedule: Schedule.spaced("250 millis"), times: 20 }),
    );
  }
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  const binary = resources
    ? paths.join(
        resources,
        "local-controller",
        process.platform === "win32" ? "local-studio-controller.exe" : "local-studio-controller",
      )
    : "";
  const source = paths.resolve(import.meta.dirname, "../../local-controller/src/main.ts");
  const bun = [
    paths.join(homedir(), ".bun/bin/bun"),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
  ];
  const runtime = (yield* Effect.filter(bun, (candidate) => fs.exists(candidate)))[0] ?? "bun";
  const [command, args] =
    binary && (yield* fs.exists(binary))
      ? [binary, []]
      : (yield* fs.exists(source))
        ? [runtime, [source]]
        : [undefined, []];
  if (!command) return;
  yield* spawner.spawn(
    ChildProcess.make(command, args, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }),
  );
});

export const localStudioProxyRouteLayer = Layer.mergeAll(
  HttpRouter.add("*", "/api/local/*", handler),
  Layer.effectDiscard(Effect.ignore(ensureController)),
);
