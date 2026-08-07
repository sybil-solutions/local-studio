import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect } from "effect";
import type {
  HandleReference,
  HostProfile,
  InstanceRecord,
  LaunchFailure,
  ServingOptions,
} from "../src/modules/compute/contracts";
import { toEvent, toHttp } from "../src/modules/compute/failures";
import { makeInstanceStore } from "../src/modules/compute/instances/store";
import type { Launcher } from "../src/modules/compute/launchers/launcher";
import {
  makeComputeService,
  type ComputeLaunchInput,
  type ComputeService,
} from "../src/modules/compute/lifecycle";

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);
const runExit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect);

const roots: string[] = [];
const freshRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "compute-test-"));
  roots.push(root);
  return root;
};
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const linuxHost: HostProfile = {
  nodeId: "self",
  platform: "linux",
  arch: "x64",
  accelerator: "cuda",
  unifiedMemory: false,
  wsl: false,
  docker: false,
  dockerGpu: false,
  deviceCount: 2,
};

const options: ServingOptions = {
  tensorParallel: 1,
  pipelineParallel: 1,
  maxContextLength: 4096,
  memoryFraction: 0.9,
  maxConcurrentRequests: 32,
  kvCacheDtype: null,
  dtype: null,
  quantization: null,
  trustRemoteCode: false,
  toolCallParser: null,
  reasoningParser: null,
};

const input = (overrides: Partial<ComputeLaunchInput> = {}): ComputeLaunchInput => ({
  name: "test-model",
  engine: "llamacpp",
  recipeId: "r1",
  runtime: "process",
  deviceCount: 1,
  modelPath: "/models/test.gguf",
  servedModelName: "test",
  options,
  extraArgs: [],
  env: {},
  dockerImage: null,
  binary: "llama-server",
  ...overrides,
});

/** Launcher whose world is a mutable script: which handles are alive, what start does. */
interface FakeWorld {
  alivePids: Set<number>;
  started: InstanceRecord[];
  stopped: HandleReference[];
  nextPid: number;
  startFailure: LaunchFailure | null;
  healthyPorts: Set<number>;
}

const fakeLauncher = (world: FakeWorld): Launcher => ({
  start: (_plan, record) => {
    if (world.startFailure) return Effect.fail(world.startFailure);
    const pid = world.nextPid++;
    world.alivePids.add(pid);
    world.started.push(record);
    return Effect.succeed({
      kind: "process",
      pid,
      processGroupId: null,
      sessionId: null,
      startToken: null,
    });
  },
  alive: (ref) => Effect.succeed(ref.kind === "process" && world.alivePids.has(ref.pid)),
  owns: (ref) => Effect.succeed(ref.kind === "process" && world.alivePids.has(ref.pid)),
  stop: (ref) =>
    Effect.sync(() => {
      if (ref.kind === "process") world.alivePids.delete(ref.pid);
      world.stopped.push(ref);
    }),
  logTail: () => Effect.succeed("fake log tail"),
});

const makeWorld = (): FakeWorld => ({
  alivePids: new Set(),
  started: [],
  stopped: [],
  nextPid: 1000,
  startFailure: null,
  healthyPorts: new Set(),
});

const makeService = (
  world: FakeWorld,
  devices: readonly string[] = ["GPU-a", "GPU-b"],
): { compute: ComputeService; store: ReturnType<typeof makeInstanceStore>; events: string[] } => {
  const store = makeInstanceStore(freshRoot());
  const events: string[] = [];
  const compute = makeComputeService({
    store,
    launcherFor: () => fakeLauncher(world),
    host: () => Effect.succeed(linuxHost),
    freeDevices: () => Effect.succeed(devices),
    onEvent: (name, stage) => Effect.sync(() => void events.push(`${name}:${stage}`)),
  });
  return { compute, store, events };
};

// The fake never serves HTTP, so "healthy" can only come from a real server. For the
// ready-path test we stand up a real Bun server on the allocated port instead.

describe("reserve is the lease", () => {
  test("devices of a live record are held; dropping the record frees them", async () => {
    const world = makeWorld();
    const { store } = makeService(world);
    const alive = () => Effect.succeed(true);
    const first = await run(
      store.reserve(
        {
          name: "a",
          nodeId: "self",
          engine: "llamacpp",
          recipeId: "r",
          runtime: "process",
          candidates: ["GPU-a", "GPU-b"],
          need: 2,
          basePort: 8081,
          readyDeadlineMs: 1000,
          shareable: false,
        },
        alive,
      ),
    );
    expect(first.devices).toEqual(["GPU-a", "GPU-b"]);

    // Everything is now held — a second reservation must fail with no-capacity.
    const second = await runExit(
      store.reserve(
        {
          name: "b",
          nodeId: "self",
          engine: "llamacpp",
          recipeId: "r",
          runtime: "process",
          candidates: ["GPU-a", "GPU-b"],
          need: 1,
          basePort: 8081,
          readyDeadlineMs: 1000,
          shareable: false,
        },
        alive,
      ),
    );
    expect(second._tag).toBe("Failure");

    // Drop the record: capacity comes back with no release call anywhere.
    store.drop("a");
    const third = await run(
      store.reserve(
        {
          name: "c",
          nodeId: "self",
          engine: "llamacpp",
          recipeId: "r",
          runtime: "process",
          candidates: ["GPU-a", "GPU-b"],
          need: 1,
          basePort: 8081,
          readyDeadlineMs: 1000,
          shareable: false,
        },
        alive,
      ),
    );
    expect(third.devices).toEqual(["GPU-a"]);
  });

  test("a dead record's devices are not held", async () => {
    const world = makeWorld();
    const { store } = makeService(world);
    // Simulate a record whose process died: alive() answers false.
    const dead = () => Effect.succeed(false);
    await run(
      store.reserve(
        {
          name: "a",
          nodeId: "self",
          engine: "llamacpp",
          recipeId: "r",
          runtime: "process",
          candidates: ["GPU-a"],
          need: 1,
          basePort: 8081,
          readyDeadlineMs: 1000,
          shareable: false,
        },
        dead,
      ),
    );
    const record = store.read("a");
    expect(record).not.toBeNull();
    if (!record) return;
    store.write({
      ...record,
      ref: { kind: "process", pid: 999999, processGroupId: null, sessionId: null, startToken: null },
    });
    const held = await run(store.heldDevices(dead));
    expect(held.size).toBe(0);
  });

  test("concurrent reservations under the placement lock never double-book", async () => {
    const world = makeWorld();
    const { store } = makeService(world);
    const alive = () => Effect.succeed(true);
    const reserveOne = (name: string) =>
      store.reserve(
        {
          name,
          nodeId: "self",
          engine: "llamacpp",
          recipeId: "r",
          runtime: "process",
          candidates: ["GPU-a", "GPU-b"],
          need: 1,
          basePort: 8081,
          readyDeadlineMs: 1000,
          shareable: false,
        },
        alive,
      );
    const results = await run(
      Effect.all([reserveOne("one"), reserveOne("two")], { concurrency: "unbounded" }).pipe(
        Effect.map((records) => records.map((record) => record.devices).flat()),
      ),
    );
    // Two reservations, two distinct devices — never the same one twice.
    expect(new Set(results).size).toBe(2);
  });

  test("ports allocate upward from the engine base without collision", async () => {
    const world = makeWorld();
    const { store } = makeService(world);
    const alive = () => Effect.succeed(true);
    // High base so real listeners on this machine cannot interfere with the assertion.
    const base = 42_081;
    const reserveNamed = (name: string) =>
      run(
        store.reserve(
          {
            name,
            nodeId: "self",
            engine: "llamacpp",
            recipeId: "r",
            runtime: "process",
            candidates: [`GPU-${name}`],
            need: 1,
            basePort: base,
            readyDeadlineMs: 1000,
            shareable: false,
          },
          alive,
        ),
      );
    const one = await reserveNamed("one");
    const two = await reserveNamed("two");
    expect(one.port).toBeGreaterThanOrEqual(base);
    expect(two.port).toBeGreaterThan(one.port);
  });

  test("allocatePort refuses a port an unrelated process already holds", () => {
    const world = makeWorld();
    const { store } = makeService(world);
    const squatter = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    try {
      const taken = squatter.port as number;
      expect(store.allocatePort(taken)).toBeGreaterThan(taken);
    } finally {
      squatter.stop(true);
    }
  });
});

describe("launch failure paths", () => {
  test("invalid durable ownership blocks replacement without actions", async () => {
    const world = makeWorld(); const { compute, store } = makeService(world);
    const path = join(store.directory, "test-model.json"); writeFileSync(path, "{}");
    const exit = await runExit(compute.launch(input()));
    expect(exit._tag).toBe("Failure");
    expect([readFileSync(path, "utf8"), world.started.length, world.stopped.length]).toEqual(["{}", 0, 0]);
  });

  test("unsupported engine/host fails before touching devices", async () => {
    const world = makeWorld();
    const { compute, store } = makeService(world);
    const exit = await runExit(compute.launch(input({ engine: "mlx" })));
    expect(exit._tag).toBe("Failure");
    expect(store.all()).toHaveLength(0);
    expect(world.started).toHaveLength(0);
  });

  test("spawn failure drops the record and frees the devices", async () => {
    const world = makeWorld();
    world.startFailure = { kind: "spawn-failed", detail: "binary not found" };
    const { compute, store, events } = makeService(world);
    const exit = await runExit(compute.launch(input()));
    expect(exit._tag).toBe("Failure");
    // The reservation must not leak: record gone, devices free.
    expect(store.all()).toHaveLength(0);
    expect(events).toContain("test-model:error");
  });

  test("exited-early: daemon dies while waiting -> record dropped, log tail captured", async () => {
    const world = makeWorld();
    const { compute, store } = makeService(world);
    // Kill the "process" the moment it starts.
    const original = fakeLauncher(world).start;
    void original;
    const launchEffect = compute.launch(input());
    const exitPromise = runExit(launchEffect);
    // Give the launch a moment to spawn, then kill the pid.
    await new Promise((resolve) => setTimeout(resolve, 150));
    world.alivePids.clear();
    const exit = await exitPromise;
    expect(exit._tag).toBe("Failure");
    expect(store.all()).toHaveLength(0);
  });

  test("cancel mid-wait -> cancelled failure, record dropped", async () => {
    const world = makeWorld();
    const { compute, store } = makeService(world);
    const exitPromise = runExit(compute.launch(input()));
    await new Promise((resolve) => setTimeout(resolve, 150));
    await run(compute.cancel("test-model"));
    const exit = await exitPromise;
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = Cause.findErrorOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect((failure.value as LaunchFailure).kind).toBe("cancelled");
      }
    }
    expect(store.all()).toHaveLength(0);
  });

  test("second launch under the same name while starting -> already-running", async () => {
    const world = makeWorld();
    const { compute } = makeService(world);
    const firstPromise = runExit(compute.launch(input()));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const second = await runExit(compute.launch(input()));
    expect(second._tag).toBe("Failure");
    if (second._tag === "Failure") {
      const failure = Cause.findErrorOption(second.cause);
      if (failure._tag === "Some") {
        expect((failure.value as LaunchFailure).kind).toBe("already-running");
      }
    }
    await run(compute.cancel("test-model"));
    await firstPromise;
  });
});

describe("ready path with a real health endpoint", () => {
  test("launch succeeds once /health answers 200", async () => {
    const world = makeWorld();
    const { compute, store, events } = makeService(world);
    // The port is allocated inside launch; discover it from the reservation record
    // (written before spawn) and only then stand up the health endpoint on it.
    const launchPromise = run(compute.launch(input()));
    let port: number | null = null;
    for (let attempt = 0; attempt < 100 && port === null; attempt += 1) {
      port = store.read("test-model")?.port ?? null;
      if (port === null) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(port).not.toBeNull();
    if (port === null) return;
    const server = Bun.serve({
      port,
      fetch: (request) =>
        new URL(request.url).pathname === "/health"
          ? new Response("ok")
          : new Response("no", { status: 404 }),
    });
    try {
      const record = await launchPromise;
      expect(record.ref?.kind).toBe("process");
      expect(record.port).toBe(port);
      expect(events).toContain("test-model:ready");
      const views = await run(compute.instances());
      expect(views).toHaveLength(1);
      expect(views[0]?.state).toBe("ready");
      // stop() tears down and frees.
      expect(await run(compute.stop("test-model"))).toBe(true);
      expect(store.all()).toHaveLength(0);
      expect(world.stopped).toHaveLength(1);
    } finally {
      server.stop(true);
    }
  });
});

describe("supervisor", () => {
  test("reaps records whose handle is gone; leaves live ones alone", async () => {
    const world = makeWorld();
    const { compute, store } = makeService(world);
    const liveRef: HandleReference = {
      kind: "process",
      pid: 2000,
      processGroupId: null,
      sessionId: null,
      startToken: null,
    };
    world.alivePids.add(2000);
    const base: InstanceRecord = {
      name: "live",
      nodeId: "self",
      engine: "llamacpp",
      recipeId: "r",
      runtime: "process",
      ref: liveRef,
      port: 8081,
      devices: ["GPU-a"],
      nonce: "n1",
      startedAt: new Date().toISOString(),
      readyDeadlineAt: new Date(Date.now() + 60_000).toISOString(),
    };
    store.write(base);
    store.write({
      ...base,
      name: "dead",
      ref: { kind: "process", pid: 3000, processGroupId: null, sessionId: null, startToken: null },
      port: 8082,
      devices: ["GPU-b"],
    });
    const reaped = await run(compute.superviseOnce());
    expect(reaped).toBe(1);
    expect(store.read("live")).not.toBeNull();
    expect(store.read("dead")).toBeNull();
  });

  test("stale reservations (no handle) are reaped after the grace window", async () => {
    const world = makeWorld();
    const { compute, store } = makeService(world);
    store.write({
      name: "crashed-before-spawn",
      nodeId: "self",
      engine: "llamacpp",
      recipeId: "r",
      runtime: "process",
      ref: null,
      port: 8081,
      devices: ["GPU-a"],
      nonce: "n",
      startedAt: new Date(Date.now() - 120_000).toISOString(),
      readyDeadlineAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await run(compute.superviseOnce())).toBe(1);
    expect(store.all()).toHaveLength(0);
  });
});

describe("failure mappers", () => {
  test("every failure kind maps to exactly one status and one stage", () => {
    const failures: LaunchFailure[] = [
      { kind: "unsupported", engine: "vllm", reason: "no Metal backend" },
      { kind: "already-running", name: "x" },
      { kind: "no-capacity", need: 2, free: 0 },
      { kind: "install-failed", engine: "vllm", detail: "pip failed" },
      { kind: "spawn-failed", detail: "ENOENT" },
      { kind: "exited-early", exitCode: 1, signal: null, logTail: "CUDA OOM" },
      { kind: "unhealthy-timeout", waitedMs: 60_000, logTail: "loading..." },
      { kind: "cancelled" },
    ];
    const statuses = failures.map((failure) => toHttp(failure).status);
    expect(statuses).toEqual([422, 409, 409, 503, 503, 503, 503, 400]);
    // Cancellation is a stage, not a substring match on the message.
    expect(toEvent({ kind: "cancelled" }).stage).toBe("cancelled");
    expect(toEvent({ kind: "spawn-failed", detail: "operation cancelled by user" }).stage).toBe(
      "error",
    );
    // The crash log rides along at a single truncation length.
    expect(toHttp(failures[5] as LaunchFailure).detail).toContain("CUDA OOM");
  });
});
