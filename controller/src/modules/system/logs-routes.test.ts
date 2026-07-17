import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createAppContext, type AppContext } from "../../app-context";
import {
  createLogsRouteRegistrar,
  DOCKER_LOG_CONTEXT_LINES,
  type DockerLogSnapshot,
  type DockerLogSource,
} from "./logs-routes";

const SECRET = "SYNTHETIC_DOCKER_TAIL_SECRET";
const NORMALIZED_SECRET = "SYNTHETIC_DOCKER_NORMALIZED_SECRET";
const QUERY_SECRET = "SYNTHETIC_PROBE_SECRET";
const QUERY_PREFIX = "https://service.invalid/path?process%2Eenv%2EACCESS_TOKEN=";
const ENVIRONMENT_KEYS = [
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_DB_PATH",
  "LOCAL_STUDIO_HOST",
  "LOCAL_STUDIO_INFERENCE_HOST",
  "LOCAL_STUDIO_MODELS_DIR",
] as const;

let context: AppContext;
let directory: string;
const originalEnvironment = new Map<string, string | undefined>();

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "local-studio-log-routes-"));
  for (const key of ENVIRONMENT_KEYS) originalEnvironment.set(key, process.env[key]);
  process.env["LOCAL_STUDIO_DATA_DIR"] = join(directory, "data");
  process.env["LOCAL_STUDIO_DB_PATH"] = join(directory, "data", "controller.db");
  process.env["LOCAL_STUDIO_HOST"] = "127.0.0.1";
  process.env["LOCAL_STUDIO_INFERENCE_HOST"] = "127.0.0.1";
  process.env["LOCAL_STUDIO_MODELS_DIR"] = join(directory, "models");
  context = createAppContext();
});

afterAll(() => {
  for (const key of ENVIRONMENT_KEYS) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(directory, { recursive: true, force: true });
});

const snapshot = (lines: readonly string[], complete: boolean): DockerLogSnapshot => ({
  lines,
  complete,
  cursor: "1970-01-01T00:00:00.000000000Z",
  overlap: [],
});

class FiniteDockerLogSource implements DockerLogSource {
  public readonly requestedLimits: number[] = [];

  public constructor(
    private readonly snapshotValue: DockerLogSnapshot,
    private readonly followedLines: readonly string[] = [],
  ) {}

  public snapshot(_container: string, limit: number): DockerLogSnapshot {
    this.requestedLimits.push(limit);
    return this.snapshotValue;
  }

  public async *follow(
    _container: string,
    _snapshot: DockerLogSnapshot,
    _signal: AbortSignal,
  ): AsyncIterable<string> {
    for (const line of this.followedLines) yield line;
  }
}

class ControlledDockerLogSource implements DockerLogSource {
  public produced = 0;
  public returned = 0;
  public signal: AbortSignal | null = null;

  public snapshot(): DockerLogSnapshot {
    return snapshot([], true);
  }

  public async *follow(
    _container: string,
    _snapshot: DockerLogSnapshot,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    this.signal = signal;
    try {
      while (true) {
        this.produced += 1;
        yield `ordinary live ${this.produced}`;
      }
    } finally {
      this.returned += 1;
    }
  }
}

const appFor = (dockerLogs: DockerLogSource): Hono => {
  const app = new Hono();
  createLogsRouteRegistrar({
    dockerLogs,
    dockerContainer: () => "synthetic-container",
  })(app, context);
  return app;
};

test("fails closed when a Docker JSON tail starts inside a multiline secret", async () => {
  const dockerLogs = new FiniteDockerLogSource(snapshot([SECRET, 'end"'], false));
  const response = await appFor(dockerLogs).request("/logs/synthetic?limit=2");
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(JSON.stringify(payload)).not.toContain(SECRET);
  expect(JSON.stringify(payload)).toContain("[redacted]");
  expect(dockerLogs.requestedLimits).toEqual([DOCKER_LOG_CONTEXT_LINES + 2]);
});

test("preserves ordinary Docker JSON tails when the bounded window reaches the start", async () => {
  const dockerLogs = new FiniteDockerLogSource(snapshot(["ordinary one", "ordinary two"], true));
  const response = await appFor(dockerLogs).request("/logs/synthetic?limit=2");
  const payload = await response.json();

  expect(payload).toEqual({
    id: "synthetic",
    logs: ["ordinary one", "ordinary two"],
    content: "ordinary one\nordinary two",
  });
});

test("fails closed after an oversized Docker record", async () => {
  const dockerLogs = new FiniteDockerLogSource(snapshot(["x".repeat(65_537), SECRET], true));
  const response = await appFor(dockerLogs).request("/logs/synthetic?limit=2");
  const payload = await response.json();

  expect(JSON.stringify(payload)).not.toContain(SECRET);
  expect(JSON.stringify(payload)).toContain("[redacted]");
});

test("fails closed across Docker SSE replay and live multiline boundaries", async () => {
  const dockerLogs = new FiniteDockerLogSource(
    snapshot([SECRET], false),
    ['end" trailing diagnostic', "ordinary live diagnostic"],
  );
  const response = await appFor(dockerLogs).request("/logs/synthetic/stream?tail=1");
  const content = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  expect(content).not.toContain(SECRET);
  expect(content).toContain("[redacted]");
  expect(dockerLogs.requestedLimits).toEqual([DOCKER_LOG_CONTEXT_LINES + 1]);
});

test("preserves ordinary Docker SSE replay and live records from a complete snapshot", async () => {
  const dockerLogs = new FiniteDockerLogSource(
    snapshot(["ordinary replay diagnostic"], true),
    ["ordinary live diagnostic"],
  );
  const response = await appFor(dockerLogs).request("/logs/synthetic/stream?tail=1");
  const content = await response.text();

  expect(content).toContain("ordinary replay diagnostic");
  expect(content).toContain("ordinary live diagnostic");
});

test("redacts normalized environment labels from Docker JSON and SSE views", async () => {
  const apiLogs = new FiniteDockerLogSource(
    snapshot([`process.env.ACCESS_TOKEN=${NORMALIZED_SECRET}`], true),
  );
  const apiResponse = await appFor(apiLogs).request("/logs/synthetic?limit=1");
  const apiPayload = JSON.stringify(await apiResponse.json());
  const streamLogs = new FiniteDockerLogSource(
    snapshot([`OPENAI__API__KEY=${NORMALIZED_SECRET}`], true),
    [`service.config--refresh__token=${NORMALIZED_SECRET}`],
  );
  const streamResponse = await appFor(streamLogs).request("/logs/synthetic/stream?tail=1");
  const streamPayload = await streamResponse.text();

  expect(`${apiPayload}\n${streamPayload}`).not.toContain(NORMALIZED_SECRET);
  expect(`${apiPayload}\n${streamPayload}`).toContain("[redacted]");
});

test("retains normalized query intent from Docker replay into SSE follow", async () => {
  const dockerLogs = new FiniteDockerLogSource(snapshot([QUERY_PREFIX], true), [QUERY_SECRET]);
  const response = await appFor(dockerLogs).request("/logs/synthetic/stream?tail=1");
  const content = await response.text();

  expect(content).not.toContain(QUERY_SECRET);
  expect(content).toContain("[redacted]");
});

test("keeps Docker SSE production pull-bound and returns the source on cancellation", async () => {
  const dockerLogs = new ControlledDockerLogSource();
  const request = new Request("http://local/logs/synthetic/stream?tail=0");
  const response = await appFor(dockerLogs).request(request);
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();

  const first = await reader?.read();
  expect(new TextDecoder().decode(first?.value)).toContain("ordinary live 1");
  expect(dockerLogs.produced).toBeLessThan(4);
  expect(dockerLogs.signal).toBe(request.signal);
  await reader?.cancel();
  expect(dockerLogs.returned).toBe(1);
});
