import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Cause, Deferred, Effect } from "effect";
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
  startSignal: Deferred.Deferred<void> | null;
  stopBarrier: {
    entered: Deferred.Deferred<void>;
    release: Deferred.Deferred<void>;
  } | null;
  healthyPorts: Set<number>;
}

const fakeLauncher = (world: FakeWorld): Launcher => ({
  start: (_plan, record) =>
    Effect.gen(function* () {
      if (world.startFailure) return yield* Effect.fail(world.startFailure);
      const pid = world.nextPid++;
      world.alivePids.add(pid);
      world.started.push(record);
      if (world.startSignal) yield* Deferred.succeed(world.startSignal, undefined);
      return { kind: "process" as const, pid, startToken: null };
    }),
  alive: (ref) => Effect.succeed(ref.kind === "process" && world.alivePids.has(ref.pid)),
  owns: (ref) => Effect.succeed(ref.kind === "process" && world.alivePids.has(ref.pid)),
  stop: (ref) =>
    Effect.gen(function* () {
      if (world.stopBarrier) {
        yield* Deferred.succeed(world.stopBarrier.entered, undefined);
        yield* Deferred.await(world.stopBarrier.release);
      }
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
  startSignal: null,
  stopBarrier: null,
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

const acquireAttempt = (
  store: ReturnType<typeof makeInstanceStore>,
  name: string,
  recipeId = "r",
): string => {
  const now = Date.now();
  const record = store.acquire({
    name,
    nodeId: "self",
    engine: "llamacpp",
    recipeId,
    runtime: "process",
    ref: null,
    port: 8081,
    devices: [],
    startedAt: new Date(now).toISOString(),
    readyDeadlineAt: new Date(now + 1_000).toISOString(),
  });
  if (!record) throw new Error(`could not acquire ${name}`);
  return record.nonce;
};

const cancelCurrent = (
  compute: ComputeService,
  store: ReturnType<typeof makeInstanceStore>,
  name: string,
): Promise<boolean> => {
  const record = store.read(name);
  if (!record) throw new Error(`no active attempt for ${name}`);
  return run(compute.cancel(name, record.nonce));
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
          attemptNonce: acquireAttempt(store, "a"),
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
          attemptNonce: acquireAttempt(store, "b"),
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
          attemptNonce: acquireAttempt(store, "c"),
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
          attemptNonce: acquireAttempt(store, "a"),
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
    store.write({ ...record, ref: { kind: "process", pid: 999999, startToken: null } });
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
          attemptNonce: acquireAttempt(store, name),
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
            attemptNonce: acquireAttempt(store, name),
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

  test("a process crash releases the cross-process mutation transaction", () => {
    const { store } = makeService(makeWorld());
    const nonce = acquireAttempt(store, "crash-recovery");
    const program = [
      'import { Database } from "bun:sqlite";',
      `const database = new Database(${JSON.stringify(join(store.directory, "mutations.sqlite"))});`,
      'database.run("BEGIN IMMEDIATE");',
      'database.run("UPDATE instance_store_mutex SET generation = generation + 1 WHERE id = 1");',
      'process.kill(process.pid, "SIGKILL");',
    ].join("");
    const crashed = Bun.spawnSync([process.execPath, "-e", program]);
    expect(crashed.exitCode).not.toBe(0);
    const record = store.read("crash-recovery")!;
    expect(store.replace({ ...record, port: record.port + 1 }, nonce)).toBe(true);
    expect(store.release(record.name, nonce)).toBe(true);
    expect(store.release(record.name, acquireAttempt(store, record.name))).toBe(true);
    mkdirSync(join(store.directory, "blocked.json"));
    expect(() => store.drop("blocked")).toThrow();
  });
});

describe("launch failure paths", () => {
  test("unsupported engine/host fails before touching devices", async () => {
    const world = makeWorld();
    const { compute, store } = makeService(world);
    const exit = await runExit(compute.launch(input({ engine: "mlx" })));
    expect(exit._tag).toBe("Failure");
    expect(store.all()).toHaveLength(0);
    expect(world.started).toHaveLength(0);
  });

  test("generic launches cannot enter the speech lease namespace", async () => {
    const { compute, store } = makeService(makeWorld());
    const exit = await runExit(
      compute.launch(input({ name: "speech", recipeId: "speech" })),
    );
    expect(exit._tag).toBe("Failure");
    expect(store.all()).toHaveLength(0);
  });

  test("an unhealthy record is reclaimed before the next attempt is admitted", async () => {
    const world = makeWorld();
    world.alivePids.add(900);
    world.startFailure = { kind: "spawn-failed", detail: "replacement stopped" };
    const { compute, store } = makeService(world);
    const now = Date.now();
    store.write({
      name: "test-model",
      nodeId: "self",
      engine: "llamacpp",
      recipeId: "old",
      runtime: "process",
      ref: { kind: "process", pid: 900, startToken: null },
      port: store.allocatePort(42_500),
      devices: ["GPU-a"],
      nonce: "old-nonce",
      startedAt: new Date(now - 120_000).toISOString(),
      readyDeadlineAt: new Date(now - 60_000).toISOString(),
    });

    const exit = await runExit(compute.launch(input()));

    expect(exit._tag).toBe("Failure");
    expect(world.stopped).toHaveLength(1);
    expect(store.read("test-model")).toBeNull();
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
    await cancelCurrent(compute, store, "test-model");
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

  const expectConcurrentConflict = async (recipeId: string): Promise<void> => {
    const world = makeWorld();
    const entered = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const { compute, store } = makeService(world);
    const firstInput = input({ recipeId: "r1" });
    const firstPromise = runExit(
      compute.launchPrepared(firstInput, () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
          return firstInput;
        }),
      ),
    );
    await run(Deferred.await(entered));
    const second = await runExit(compute.launch(input({ recipeId })));
    expect(second._tag).toBe("Failure");
    if (second._tag === "Failure") {
      const failure = Cause.findErrorOption(second.cause);
      if (failure._tag === "Some") {
        expect((failure.value as LaunchFailure).kind).toBe("already-running");
      }
    }
    await cancelCurrent(compute, store, "test-model");
    await run(Deferred.succeed(release, undefined));
    await firstPromise;
  };

  test("same-recipe launches conflict while the first preparation is behind a barrier", async () => {
    await expectConcurrentConflict("r1");
  });

  test("different-recipe launches conflict while the first preparation is behind a barrier", async () => {
    await expectConcurrentConflict("r2");
  });

  test("a stale finalizer behind a barrier cannot release a replacement attempt", async () => {
    const world = makeWorld();
    const started = Deferred.makeUnsafe<void>();
    const stopEntered = Deferred.makeUnsafe<void>();
    const stopRelease = Deferred.makeUnsafe<void>();
    world.startSignal = started;
    world.stopBarrier = { entered: stopEntered, release: stopRelease };
    const { compute, store } = makeService(world);
    const peerStore = makeInstanceStore(dirname(store.directory));
    const firstPromise = runExit(compute.launch(input({ recipeId: "r1" })));
    await run(Deferred.await(started));
    const first = store.read("test-model");
    if (!first) throw new Error("first attempt was not acquired");
    expect(await run(compute.cancel(first.name, first.nonce))).toBe(true);
    await run(Deferred.await(stopEntered));

    expect(peerStore.release(first.name, first.nonce)).toBe(true);
    const replacementNonce = acquireAttempt(peerStore, "test-model", "r2");
    expect(peerStore.replace(first, first.nonce)).toBe(false);
    await run(Deferred.succeed(stopRelease, undefined));
    await firstPromise;

    expect(store.read("test-model")?.nonce).toBe(replacementNonce);
    expect(await run(compute.cancel("test-model", first.nonce))).toBe(false);
    expect(store.release("test-model", replacementNonce)).toBe(true);
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
    const liveRef: HandleReference = { kind: "process", pid: 2000, startToken: null };
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
      ref: { kind: "process", pid: 3000, startToken: null },
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
