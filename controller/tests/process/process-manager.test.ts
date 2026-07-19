import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PassThrough } from "node:stream";
import { Effect, Fiber } from "effect";
import type { Config } from "../../src/config/env";
import {
  resolveBinaryFromEnvironment,
  type CommandResult,
  type ProcessEnvironmentValue,
  type ProcessRunner,
  type RunSyncOptions,
  type SpawnDetachedOptions,
  type SpawnedProcess,
} from "../../src/core/command";
import { createLogger } from "../../src/core/logger";
import { asRecipeId, type Recipe } from "../../src/modules/models/types";
import {
  createProcessManager,
  type ProcessManager,
} from "../../src/modules/engines/process/process-manager";
import type { ProcessInventoryEntry } from "../../src/modules/engines/process/process-inventory";
import {
  createProcessOwnershipStore,
  type ActiveProcessOwnershipRecord,
  type DockerBindingEnvironment,
  type PendingProcessOwnershipRecord,
} from "../../src/modules/engines/process/process-ownership";

const directories = new Set<string>();
const environmentKeys = ["LOCAL_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND", "PATH"] as const;
let environmentSnapshot: Record<(typeof environmentKeys)[number], string | undefined>;

beforeEach(() => {
  environmentSnapshot = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  ) as Record<(typeof environmentKeys)[number], string | undefined>;
});

afterEach(() => {
  for (const key of environmentKeys) {
    const value = environmentSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-process-manager-"));
  directories.add(directory);
  return directory;
};

const waitFor = async (predicate: () => boolean, timeoutMs = 1_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error("Condition did not become true");
};

const executable = (directory: string, name: string): string => {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, "");
  chmodSync(path, 0o755);
  return realpathSync(path);
};

const renderStartIdentity = (value: string): string => {
  const date = new Date(Number(value));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const day = String(date.getDate()).padStart(2, " ");
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return `${weekdays[date.getDay()]} ${months[date.getMonth()]} ${day} ${time} ${date.getFullYear()}`;
};

class FakeSpawnedProcess implements SpawnedProcess {
  public exitCode: number | null = null;
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  private readonly events = new EventEmitter();

  public constructor(public readonly pid: number) {}

  public on(event: "error", listener: (error: Error) => void): void;
  public on(event: "exit", listener: () => void): void;
  public on(event: "error" | "exit", listener: ((error: Error) => void) | (() => void)): void {
    this.events.on(event, listener);
  }

  public removeListener(event: "error", listener: (error: Error) => void): void;
  public removeListener(event: "exit", listener: () => void): void;
  public removeListener(
    event: "error" | "exit",
    listener: ((error: Error) => void) | (() => void),
  ): void {
    this.events.removeListener(event, listener);
  }

  public listenerCount(event: "error" | "exit"): number {
    return this.events.listenerCount(event);
  }

  public kill(_signal: NodeJS.Signals): boolean {
    return true;
  }

  public unref(): void {}

  public exit(code: number): void {
    this.exitCode = code;
    this.stdout.end();
    this.stderr.end();
    this.events.emit("exit");
  }
}

class FocusedProcessRunner implements ProcessRunner {
  public inventory: ProcessInventoryEntry[] = [];
  public inventoryReads = 0;
  public environmentReads: number[] = [];
  public spawnCount = 0;
  public readonly signals: Array<{
    readonly processGroupId: number;
    readonly signal: NodeJS.Signals;
  }> = [];
  public dockerCommands: string[][] = [];
  public dockerContainerIds: string[] = [];
  public spawnPid: number | null = null;
  public beforeInventoryRead: ((count: number) => void) | null = null;
  public beforeEnvironmentRead: ((pid: number, key: string) => void) | null = null;
  public beforeDockerCommand: ((command: string, args: string[]) => void) | null = null;
  public onSpawn:
    | ((
        child: FakeSpawnedProcess,
        command: string,
        args: string[],
        options: SpawnDetachedOptions,
      ) => void)
    | null = null;
  public signalHandler: ((processGroupId: number, signal: NodeJS.Signals) => boolean) | null = null;
  public readonly unavailableEnvironment = new Set<number>();
  public readonly processEnvironment = new Map<number, Record<string, string>>();

  public get signalCount(): number {
    return this.signals.length;
  }

  public readProcessEnvironmentVariable(pid: number, key: string): ProcessEnvironmentValue {
    this.environmentReads.push(pid);
    this.beforeEnvironmentRead?.(pid, key);
    if (this.unavailableEnvironment.has(pid)) return { status: "unavailable" };
    const value = this.processEnvironment.get(pid)?.[key];
    return value === undefined ? { status: "missing" } : { status: "found", value };
  }

  public runSync(command: string, args: string[], _options?: RunSyncOptions): CommandResult {
    if (command === "ps") {
      this.inventoryReads += 1;
      this.beforeInventoryRead?.(this.inventoryReads);
      return {
        status: 0,
        stdout: this.inventory
          .map(
            (entry) =>
              `${entry.pid} ${entry.ppid} ${entry.processGroupId} ${renderStartIdentity(entry.startIdentity)} ${entry.stat} ${entry.command}`,
          )
          .join("\n"),
        stderr: "",
      };
    }
    if (basename(command) === "docker") {
      this.dockerCommands.push([command, ...args]);
      this.beforeDockerCommand?.(command, args);
      if (args[0] === "context") {
        return { status: 0, stdout: "default|unix:///var/run/docker.sock", stderr: "" };
      }
      if (args[0] === "info") {
        return { status: 0, stdout: "fake-daemon|fake-host|/var/lib/docker", stderr: "" };
      }
      if (args[0] === "ps") {
        return { status: 0, stdout: this.dockerContainerIds.join("\n"), stderr: "" };
      }
      if (["kill", "stop", "rm"].includes(args[0] ?? "")) {
        const id = args.at(-1);
        if (id) this.dockerContainerIds = this.dockerContainerIds.filter((value) => value !== id);
        return { status: 0, stdout: "", stderr: "" };
      }
    }
    return { status: 0, stdout: "", stderr: "" };
  }

  public signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): boolean {
    this.signals.push({ processGroupId, signal });
    return this.signalHandler?.(processGroupId, signal) ?? false;
  }

  public spawnDetached(
    command: string,
    args: string[],
    options: SpawnDetachedOptions,
  ): SpawnedProcess {
    this.spawnCount += 1;
    if (this.spawnPid === null) throw new Error("Unexpected process spawn");
    const child = new FakeSpawnedProcess(this.spawnPid);
    this.onSpawn?.(child, command, args, options);
    return child;
  }
}

const config = (dataDirectory: string): Config => ({
  host: "127.0.0.1",
  port: 18_080,
  inference_host: "127.0.0.1",
  inference_port: 65_534,
  data_dir: dataDirectory,
  db_path: join(dataDirectory, "controller.db"),
  models_dir: join(dataDirectory, "models"),
  strict_openai_models: false,
  providers: [],
});

const recipe = (id: string, command: string, path: string): Recipe => ({
  id: asRecipeId(id),
  name: id,
  model_path: join(path, "model"),
  vision: null,
  backend: "vllm",
  runtime: { kind: "system", ref: join(path, "vllm") },
  env_vars: { PATH: path },
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  max_model_len: 4_096,
  gpu_memory_utilization: 0.8,
  kv_cache_dtype: "auto",
  max_num_seqs: 8,
  trust_remote_code: false,
  tool_call_parser: null,
  reasoning_parser: null,
  enable_auto_tool_choice: false,
  quantization: null,
  dtype: null,
  host: "127.0.0.1",
  port: 8_000,
  served_model_name: "test-model",
  python_path: null,
  extra_args: { launch_command: command },
  max_thinking_tokens: null,
  thinking_mode: "auto",
});

const createdAtMs = (): number => Math.floor(Date.now() / 1_000) * 1_000;

const commandFingerprint = (command: readonly string[]): string =>
  createHash("sha256").update(JSON.stringify(command)).digest("hex");

const pendingRecord = (
  created: number,
  overrides: Partial<PendingProcessOwnershipRecord> = {},
): PendingProcessOwnershipRecord => ({
  version: 1,
  state: "pending",
  launchId: "00000000-0000-4000-8000-000000000001",
  recipeId: "pending-recipe",
  backend: "vllm",
  port: 8_000,
  createdAtMs: created,
  runtimeKind: "native",
  commandFingerprint: "a".repeat(64),
  ...overrides,
});

const inventoryEntry = (
  pid: number,
  startIdentity: string,
  command = "protected-host-process",
  processGroupId = pid,
): ProcessInventoryEntry => ({
  pid,
  ppid: 1,
  processGroupId,
  startIdentity,
  stat: "S",
  command,
  args: [command],
});

const configureNativeSpawn = (runner: FocusedProcessRunner, pid: number): FakeSpawnedProcess[] => {
  const children: FakeSpawnedProcess[] = [];
  runner.spawnPid = pid;
  runner.onSpawn = (spawned, command, args, options): void => {
    children.push(spawned);
    const startIdentity = String(createdAtMs());
    runner.inventory = [inventoryEntry(spawned.pid, startIdentity, [command, ...args].join(" "))];
    runner.processEnvironment.set(spawned.pid, {
      LOCAL_STUDIO_LAUNCH_ID: options.env?.["LOCAL_STUDIO_LAUNCH_ID"] ?? "",
    });
  };
  return children;
};

const expectResourcesReleased = (child: FakeSpawnedProcess): void => {
  expect(child.listenerCount("error")).toBe(0);
  expect(child.listenerCount("exit")).toBe(0);
  expect(child.stdout.listenerCount("data")).toBe(0);
  expect(child.stderr.listenerCount("data")).toBe(0);
};

const dockerEnvironment: DockerBindingEnvironment = {
  DOCKER_HOST: null,
  DOCKER_CONTEXT: null,
  DOCKER_CONFIG: null,
  DOCKER_TLS_VERIFY: null,
  DOCKER_CERT_PATH: null,
};

const dockerDaemonFingerprint = (): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        "default|unix:///var/run/docker.sock",
        "fake-daemon|fake-host|/var/lib/docker",
        dockerEnvironment,
      ]),
    )
    .digest("hex");

const activeRecord = (
  store: ReturnType<typeof createProcessOwnershipStore>,
  pending: PendingProcessOwnershipRecord,
  pid: number,
  startIdentity: string,
): ActiveProcessOwnershipRecord => {
  store.create(pending);
  const spawned = store.markSpawned(pending, { rootPid: pid, processGroupId: pid });
  if (spawned.state === "active") return spawned;
  return store.activate(spawned, {
    rootPid: pid,
    processGroupId: pid,
    startIdentity,
  });
};

const dockerRecord = (
  created: number,
  docker: string,
  overrides: Partial<PendingProcessOwnershipRecord> = {},
): PendingProcessOwnershipRecord =>
  pendingRecord(created, {
    runtimeKind: "docker",
    dockerAuthority: "direct",
    dockerDaemonFingerprint: dockerDaemonFingerprint(),
    dockerExecutable: docker,
    dockerEnvironment,
    ...overrides,
  });

const managerForPlatform = (
  dataDirectory: string,
  runner: ProcessRunner,
  platform: NodeJS.Platform,
): ProcessManager =>
  createProcessManager(config(dataDirectory), createLogger("error"), undefined, runner, platform);

const managerFor = (dataDirectory: string, runner: ProcessRunner): ProcessManager =>
  managerForPlatform(dataDirectory, runner, "linux");

const runEffect = <Value>(effect: Effect.Effect<Value>): Promise<Value> =>
  Effect.runPromise(effect);

describe("owned process lifecycle boundaries", () => {
  test("constructing duplicate controllers before bind has no reconciliation side effects", () => {
    const dataDirectory = temporaryDirectory();
    const created = createdAtMs();
    const pending = pendingRecord(created);
    const store = createProcessOwnershipStore(dataDirectory);
    const active = activeRecord(store, pending, 43_000, String(created));
    const runner = new FocusedProcessRunner();
    runner.inventory = [inventoryEntry(active.rootPid, active.startIdentity)];
    runner.processEnvironment.set(active.rootPid, {
      LOCAL_STUDIO_LAUNCH_ID: active.launchId,
    });

    managerFor(dataDirectory, runner);
    managerFor(dataDirectory, runner);

    expect(runner.inventoryReads).toBe(0);
    expect(runner.environmentReads).toEqual([]);
    expect(runner.signalCount).toBe(0);
    expect(runner.dockerCommands).toEqual([]);
    expect(runner.spawnCount).toBe(0);
    expect(store.read()).toEqual({ status: "found", record: active });
  });

  test("retries startup reconciliation after a settled failure", async () => {
    const dataDirectory = temporaryDirectory();
    const created = createdAtMs();
    const store = createProcessOwnershipStore(dataDirectory);
    const active = activeRecord(store, pendingRecord(created), 43_050, String(created));
    const runner = new FocusedProcessRunner();
    runner.inventory = [inventoryEntry(active.rootPid, active.startIdentity)];
    const manager = managerFor(dataDirectory, runner);

    expect(await runEffect(manager.confirmInferenceStopped(8_000))).toBe(false);
    expect(runner.signalCount).toBe(0);
    expect(store.read()).toEqual({ status: "found", record: active });
    runner.processEnvironment.set(active.rootPid, {
      LOCAL_STUDIO_LAUNCH_ID: active.launchId,
    });
    runner.signalHandler = (processGroupId): boolean => {
      runner.inventory = runner.inventory.filter(
        (entry) => entry.processGroupId !== processGroupId,
      );
      return true;
    };

    expect(await runEffect(manager.confirmInferenceStopped(8_000))).toBe(true);
    expect(runner.signals).toEqual([{ processGroupId: active.processGroupId, signal: "SIGTERM" }]);
    expect(store.read()).toEqual({ status: "missing" });
  });

  test("shares one in-flight startup reconciliation across concurrent callers", async () => {
    const dataDirectory = temporaryDirectory();
    const created = createdAtMs();
    const store = createProcessOwnershipStore(dataDirectory);
    const active = activeRecord(store, pendingRecord(created), 43_075, String(created));
    const runner = new FocusedProcessRunner();
    runner.inventory = [inventoryEntry(active.rootPid, active.startIdentity)];
    runner.processEnvironment.set(active.rootPid, {
      LOCAL_STUDIO_LAUNCH_ID: active.launchId,
    });
    runner.signalHandler = (processGroupId): boolean => {
      runner.inventory = runner.inventory.filter(
        (entry) => entry.processGroupId !== processGroupId,
      );
      return true;
    };
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const holder = Effect.runPromise(
      store.withExactGeneration(active, () =>
        Effect.tryPromise(async () => {
          entered.resolve();
          await resume.promise;
          return true;
        }),
      ),
    );
    await entered.promise;
    const manager = managerFor(dataDirectory, runner);
    const first = runEffect(manager.confirmInferenceStopped(8_000));
    await Bun.sleep(20);
    const inventoryReads = runner.inventoryReads;
    const second = runEffect(manager.confirmInferenceStopped(8_000));
    await Bun.sleep(20);

    expect(inventoryReads).toBeGreaterThan(0);
    expect(runner.inventoryReads).toBe(inventoryReads);
    resume.resolve();
    expect(await holder).toEqual({ status: "acquired", value: true });
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(runner.signalCount).toBe(1);
    expect(store.read()).toEqual({ status: "missing" });
  });

  test("rejects bare, absolute, and canonical sudo wrappers before ownership or spawn", async () => {
    process.env["LOCAL_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND"] = "true";
    const binaryDirectory = join(temporaryDirectory(), "bin");
    const sudo = executable(binaryDirectory, "sudo");
    const alias = join(binaryDirectory, "privileged-launcher");
    symlinkSync(sudo, alias);
    const runner = new FocusedProcessRunner();

    for (const [index, wrapper] of ["sudo", sudo, alias].entries()) {
      const dataDirectory = temporaryDirectory();
      const result = await runEffect(
        managerFor(dataDirectory, runner).launchModel(
          recipe(`sudo-${index}`, `${wrapper} -n engine`, binaryDirectory),
        ),
      );

      expect(result).toMatchObject({
        success: false,
        pid: null,
        message: "Native privilege-wrapper launches cannot preserve process ownership",
      });
      expect(createProcessOwnershipStore(dataDirectory).read()).toEqual({ status: "missing" });
    }

    expect(runner.spawnCount).toBe(0);
  });

  test("launches and activates an owned native process generation", async () => {
    process.env["LOCAL_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND"] = "true";
    const dataDirectory = temporaryDirectory();
    const binaryDirectory = join(dataDirectory, "bin");
    const engine = executable(binaryDirectory, "engine");
    const runner = new FocusedProcessRunner();
    const children = configureNativeSpawn(runner, 43_100);

    const result = await runEffect(
      managerFor(dataDirectory, runner).launchModel(
        recipe("successful-native", engine, binaryDirectory),
      ),
    );
    const persisted = createProcessOwnershipStore(dataDirectory).read();

    expect(result).toMatchObject({ success: true, pid: 43_100, message: "Process started" });
    expect(persisted.status).toBe("found");
    if (persisted.status !== "found") throw new Error("Expected active ownership");
    expect(persisted.record).toMatchObject({
      state: "active",
      recipeId: "successful-native",
      rootPid: 43_100,
      processGroupId: 43_100,
      runtimeKind: "native",
    });
    expect(runner.spawnCount).toBe(1);
    const child = children[0];
    if (!child) throw new Error("Expected spawned process");
    expect(child.listenerCount("error")).toBe(1);
    expect(child.listenerCount("exit")).toBe(1);
    runner.inventory = [];
    child.exit(0);
    await waitFor(() => createProcessOwnershipStore(dataDirectory).read().status === "missing");
    expectResourcesReleased(child);
  });

  test("interrupting launch cleans the exact generation and releases process resources", async () => {
    process.env["LOCAL_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND"] = "true";
    const dataDirectory = temporaryDirectory();
    const binaryDirectory = join(dataDirectory, "bin");
    const engine = executable(binaryDirectory, "engine");
    const runner = new FocusedProcessRunner();
    const children = configureNativeSpawn(runner, 43_110);
    runner.signalHandler = (processGroupId): boolean => {
      runner.inventory = runner.inventory.filter(
        (entry) => entry.processGroupId !== processGroupId,
      );
      return true;
    };
    const manager = managerFor(dataDirectory, runner);
    const fiber = Effect.runFork(
      manager.launchModel(recipe("interrupted-native", engine, binaryDirectory)),
    );
    await waitFor(() => {
      const ownership = createProcessOwnershipStore(dataDirectory).read();
      return ownership.status === "found" && ownership.record.state === "active";
    }, 2_000);
    await runEffect(Fiber.interrupt(fiber));

    const child = children[0];
    if (!child) throw new Error("Expected spawned process");
    expect(runner.signals).toEqual([{ processGroupId: 43_110, signal: "SIGTERM" }]);
    expect(createProcessOwnershipStore(dataDirectory).read()).toEqual({ status: "missing" });
    expectResourcesReleased(child);
  });

  test("interrupting a Windows launch releases its in-memory process resources", async () => {
    process.env["LOCAL_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND"] = "true";
    const dataDirectory = temporaryDirectory();
    const binaryDirectory = join(dataDirectory, "bin");
    const engine = executable(binaryDirectory, "engine");
    const runner = new FocusedProcessRunner();
    const children = configureNativeSpawn(runner, 2_000_000_000);
    const manager = managerForPlatform(dataDirectory, runner, "win32");
    const fiber = Effect.runFork(
      manager.launchModel(recipe("interrupted-windows", engine, binaryDirectory)),
    );
    await waitFor(() => children[0]?.listenerCount("exit") === 1);
    await runEffect(Fiber.interrupt(fiber));

    const child = children[0];
    if (!child) throw new Error("Expected spawned process");
    expect(createProcessOwnershipStore(dataDirectory).read()).toEqual({ status: "missing" });
    expectResourcesReleased(child);
  });

  test("shutdown stops an active owned launch and releases process resources", async () => {
    process.env["LOCAL_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND"] = "true";
    const dataDirectory = temporaryDirectory();
    const binaryDirectory = join(dataDirectory, "bin");
    const engine = executable(binaryDirectory, "engine");
    const runner = new FocusedProcessRunner();
    const children = configureNativeSpawn(runner, 43_120);
    const manager = managerFor(dataDirectory, runner);
    const launched = await runEffect(
      manager.launchModel(recipe("shutdown-native", engine, binaryDirectory)),
    );
    runner.signalHandler = (processGroupId): boolean => {
      runner.inventory = runner.inventory.filter(
        (entry) => entry.processGroupId !== processGroupId,
      );
      return true;
    };

    expect(launched.success).toBe(true);
    expect(await runEffect(manager.shutdown())).toBe(true);
    const child = children[0];
    if (!child) throw new Error("Expected spawned process");
    expect(runner.signals).toEqual([{ processGroupId: 43_120, signal: "SIGTERM" }]);
    expect(createProcessOwnershipStore(dataDirectory).read()).toEqual({ status: "missing" });
    expectResourcesReleased(child);
  });

  test("recovers a native pending generation left by a crash before spawn", async () => {
    const dataDirectory = temporaryDirectory();
    const store = createProcessOwnershipStore(dataDirectory);
    store.create(pendingRecord(createdAtMs()));
    const runner = new FocusedProcessRunner();

    expect(await runEffect(managerFor(dataDirectory, runner).confirmInferenceStopped(8_000))).toBe(
      true,
    );
    expect(store.read()).toEqual({ status: "missing" });
    expect(runner.signalCount).toBe(0);
  });

  test("activates a pending generation that appears after the first inventory scan", async () => {
    const dataDirectory = temporaryDirectory();
    const created = createdAtMs();
    const command = ["engine"];
    const pending = pendingRecord(created, {
      commandFingerprint: commandFingerprint(command),
    });
    const store = createProcessOwnershipStore(dataDirectory);
    store.create(pending);
    const runner = new FocusedProcessRunner();
    runner.beforeInventoryRead = (count): void => {
      if (count !== 2) return;
      runner.inventory = [inventoryEntry(43_150, String(created), command[0])];
      runner.processEnvironment.set(43_150, {
        LOCAL_STUDIO_LAUNCH_ID: pending.launchId,
      });
    };
    runner.signalHandler = (processGroupId): boolean => {
      runner.inventory = runner.inventory.filter(
        (entry) => entry.processGroupId !== processGroupId,
      );
      return true;
    };

    expect(await runEffect(managerFor(dataDirectory, runner).confirmInferenceStopped(8_000))).toBe(
      true,
    );
    expect(runner.signals).toEqual([{ processGroupId: 43_150, signal: "SIGTERM" }]);
    expect(store.read()).toEqual({ status: "missing" });
  });

  test("terminates an active native group with TERM then KILL without touching unrelated workers", async () => {
    const dataDirectory = temporaryDirectory();
    const runner = new FocusedProcessRunner();
    const manager = managerFor(dataDirectory, runner);
    expect(await runEffect(manager.findInferenceProcess(8_000))).toBeNull();
    const created = createdAtMs();
    const store = createProcessOwnershipStore(dataDirectory);
    const active = activeRecord(store, pendingRecord(created), 43_200, String(created));
    const unrelated = inventoryEntry(99_001, String(created), "unrelated-worker");
    runner.inventory = [
      inventoryEntry(active.rootPid, active.startIdentity),
      inventoryEntry(43_201, active.startIdentity, "owned-worker", active.processGroupId),
      unrelated,
    ];
    runner.processEnvironment.set(active.rootPid, {
      LOCAL_STUDIO_LAUNCH_ID: active.launchId,
    });
    runner.processEnvironment.set(43_201, {
      LOCAL_STUDIO_LAUNCH_ID: active.launchId,
    });
    runner.signalHandler = (processGroupId, signal): boolean => {
      if (signal === "SIGKILL") {
        runner.inventory = runner.inventory.filter(
          (entry) => entry.processGroupId !== processGroupId,
        );
      }
      return true;
    };

    expect(await runEffect(manager.killProcess(43_201, false))).toBe(true);
    expect(runner.signals).toEqual([
      { processGroupId: active.processGroupId, signal: "SIGTERM" },
      { processGroupId: active.processGroupId, signal: "SIGKILL" },
    ]);
    expect(runner.inventory).toEqual([unrelated]);
    expect(store.read()).toEqual({ status: "missing" });
  });

  test("recovers an owned native orphan group by verified launch markers", async () => {
    const dataDirectory = temporaryDirectory();
    const runner = new FocusedProcessRunner();
    const manager = managerFor(dataDirectory, runner);
    expect(await runEffect(manager.findInferenceProcess(8_000))).toBeNull();
    const created = createdAtMs();
    const store = createProcessOwnershipStore(dataDirectory);
    const active = activeRecord(store, pendingRecord(created), 43_300, String(created));
    runner.inventory = [
      inventoryEntry(43_301, active.startIdentity, "owned-worker-a", active.processGroupId),
      inventoryEntry(43_302, active.startIdentity, "owned-worker-b", active.processGroupId),
    ];
    for (const member of runner.inventory) {
      runner.processEnvironment.set(member.pid, { LOCAL_STUDIO_LAUNCH_ID: active.launchId });
    }
    runner.signalHandler = (processGroupId): boolean => {
      runner.inventory = runner.inventory.filter(
        (entry) => entry.processGroupId !== processGroupId,
      );
      return true;
    };

    expect(await runEffect(manager.killProcess(43_302, false))).toBe(true);
    expect(runner.signals).toEqual([{ processGroupId: active.processGroupId, signal: "SIGTERM" }]);
    expect(store.read()).toEqual({ status: "missing" });
  });

  test("fails closed for PID reuse, marker loss, and unreadable process identity", async () => {
    for (const mode of ["pid-reuse", "marker-loss", "identity-unreadable"] as const) {
      const dataDirectory = temporaryDirectory();
      const runner = new FocusedProcessRunner();
      const manager = managerFor(dataDirectory, runner);
      expect(await runEffect(manager.findInferenceProcess(8_000))).toBeNull();
      const created = createdAtMs();
      const store = createProcessOwnershipStore(dataDirectory);
      const active = activeRecord(store, pendingRecord(created), 43_400, String(created));
      runner.inventory = [
        inventoryEntry(
          active.rootPid,
          mode === "pid-reuse" ? String(created + 1_000) : active.startIdentity,
        ),
      ];
      if (mode !== "marker-loss") {
        runner.processEnvironment.set(active.rootPid, {
          LOCAL_STUDIO_LAUNCH_ID: active.launchId,
        });
      }
      if (mode === "identity-unreadable") runner.unavailableEnvironment.add(active.rootPid);

      expect(await runEffect(manager.killProcess(active.rootPid, false))).toBe(false);
      expect(runner.signalCount).toBe(0);
      expect(store.read()).toEqual({ status: "found", record: active });
    }
  });

  test("retains native pending ownership when a plausible candidate is unreadable", async () => {
    const dataDirectory = temporaryDirectory();
    const created = createdAtMs();
    const record = pendingRecord(created);
    const store = createProcessOwnershipStore(dataDirectory);
    store.create(record);
    const runner = new FocusedProcessRunner();
    runner.inventory = [inventoryEntry(44_001, String(created))];
    runner.unavailableEnvironment.add(44_001);

    expect(await runEffect(managerFor(dataDirectory, runner).confirmInferenceStopped(8_000))).toBe(
      false,
    );
    expect(store.read()).toEqual({ status: "found", record });
    expect(runner.environmentReads).toContain(44_001);
    expect(runner.signalCount).toBe(0);
  });

  test("retains native pending ownership for a plausible command fingerprint", async () => {
    const dataDirectory = temporaryDirectory();
    const created = createdAtMs();
    const command = ["python", "-m", "vllm.entrypoints.openai.api_server"];
    const record = pendingRecord(created, {
      commandFingerprint: commandFingerprint(command),
    });
    const store = createProcessOwnershipStore(dataDirectory);
    store.create(record);
    const runner = new FocusedProcessRunner();
    runner.inventory = [inventoryEntry(44_002, String(created), command.join(" "))];

    expect(await runEffect(managerFor(dataDirectory, runner).confirmInferenceStopped(8_000))).toBe(
      false,
    );
    expect(store.read()).toEqual({ status: "found", record });
    expect(runner.signalCount).toBe(0);
  });

  test("serializes negative proof through compare-and-delete across stores", async () => {
    const dataDirectory = temporaryDirectory();
    const created = createdAtMs();
    const original = pendingRecord(created);
    const replacement = pendingRecord(created + 1_000, {
      launchId: "00000000-0000-4000-8000-000000000002",
      commandFingerprint: "b".repeat(64),
    });
    const store = createProcessOwnershipStore(dataDirectory);
    store.create(original);
    const runner = new FocusedProcessRunner();
    let competingRemoval = false;
    let competingRemovalAttempted = false;
    let competingCreationBlocked = false;
    runner.beforeInventoryRead = (count): void => {
      if (count !== 2) return;
      const competingStore = createProcessOwnershipStore(dataDirectory);
      competingRemovalAttempted = true;
      competingRemoval = competingStore.remove(original);
      try {
        competingStore.create(replacement);
      } catch {
        competingCreationBlocked = true;
      }
    };

    expect(await runEffect(managerFor(dataDirectory, runner).confirmInferenceStopped(8_000))).toBe(
      true,
    );
    expect(competingRemovalAttempted).toBe(true);
    expect(competingRemoval).toBe(false);
    expect(competingCreationBlocked).toBe(true);
    store.create(replacement);
    expect(store.read()).toEqual({ status: "found", record: replacement });
    expect(runner.signalCount).toBe(0);
  });

  test("a generation swapped after marker proof is never signaled or removed", async () => {
    const dataDirectory = temporaryDirectory();
    const created = createdAtMs();
    const store = createProcessOwnershipStore(dataDirectory);
    const original = activeRecord(store, pendingRecord(created), 44_100, String(created));
    const replacement = pendingRecord(created + 1_000, {
      launchId: "00000000-0000-4000-8000-000000000009",
      commandFingerprint: "c".repeat(64),
    });
    const runner = new FocusedProcessRunner();
    runner.inventory = [inventoryEntry(original.rootPid, original.startIdentity)];
    runner.processEnvironment.set(original.rootPid, {
      LOCAL_STUDIO_LAUNCH_ID: original.launchId,
    });
    let swapped = false;
    runner.beforeEnvironmentRead = (): void => {
      if (swapped) return;
      swapped = true;
      const competingStore = createProcessOwnershipStore(dataDirectory);
      expect(competingStore.remove(original)).toBe(true);
      competingStore.create(replacement);
    };

    const firstManager = managerFor(dataDirectory, runner);
    managerFor(dataDirectory, runner);
    expect(await runEffect(firstManager.confirmInferenceStopped(8_000))).toBe(false);
    expect(runner.signalCount).toBe(0);
    expect(store.read()).toEqual({ status: "found", record: replacement });
  });

  test("ignores old protected rows during pending Docker label recovery", async () => {
    const dataDirectory = temporaryDirectory();
    const created = createdAtMs();
    const docker = executable(join(dataDirectory, "bin"), "docker");
    const record = pendingRecord(created, {
      runtimeKind: "docker",
      dockerAuthority: "direct",
      dockerDaemonFingerprint: dockerDaemonFingerprint(),
      dockerExecutable: docker,
      dockerEnvironment,
    });
    const store = createProcessOwnershipStore(dataDirectory);
    store.create(record);
    const runner = new FocusedProcessRunner();
    runner.inventory = [inventoryEntry(45_001, String(created - 60_000))];
    runner.unavailableEnvironment.add(45_001);

    expect(await runEffect(managerFor(dataDirectory, runner).confirmInferenceStopped(8_000))).toBe(
      true,
    );
    expect(store.read()).toEqual({ status: "missing" });
    expect(runner.environmentReads).toEqual([]);
    expect(runner.dockerCommands.length).toBeGreaterThan(0);
  });

  test("recovers a pending Docker generation by its exact launch label", async () => {
    const dataDirectory = temporaryDirectory();
    const created = createdAtMs();
    const docker = executable(join(dataDirectory, "bin"), "docker");
    const record = dockerRecord(created, docker);
    const store = createProcessOwnershipStore(dataDirectory);
    store.create(record);
    const runner = new FocusedProcessRunner();
    const containerId = "d".repeat(64);
    runner.dockerContainerIds = [containerId];

    expect(await runEffect(managerFor(dataDirectory, runner).confirmInferenceStopped(8_000))).toBe(
      true,
    );
    expect(store.read()).toEqual({ status: "missing" });
    expect(runner.signalCount).toBe(0);
    expect(runner.dockerCommands).toContainEqual([docker, "rm", "-f", containerId]);
  });

  test("stops a running Docker generation with its persisted canonical executable after PATH drift", async () => {
    const dataDirectory = temporaryDirectory();
    const firstDirectory = join(dataDirectory, "docker-a");
    const secondDirectory = join(dataDirectory, "docker-b");
    const persistedDocker = executable(firstDirectory, "docker");
    executable(secondDirectory, "docker");
    process.env["PATH"] = secondDirectory;
    const runner = new FocusedProcessRunner();
    const manager = managerFor(dataDirectory, runner);
    expect(await runEffect(manager.findInferenceProcess(8_000))).toBeNull();
    const created = createdAtMs();
    const store = createProcessOwnershipStore(dataDirectory);
    const active = activeRecord(
      store,
      dockerRecord(created, persistedDocker),
      45_100,
      String(created),
    );
    const containerId = "e".repeat(64);
    runner.dockerContainerIds = [containerId];
    runner.inventory = [inventoryEntry(active.rootPid, active.startIdentity)];
    runner.processEnvironment.set(active.rootPid, {
      LOCAL_STUDIO_LAUNCH_ID: active.launchId,
    });
    runner.signalHandler = (processGroupId): boolean => {
      runner.inventory = runner.inventory.filter(
        (entry) => entry.processGroupId !== processGroupId,
      );
      return true;
    };

    expect(await runEffect(manager.killProcess(active.rootPid, false))).toBe(true);
    expect(runner.dockerCommands).toContainEqual([
      persistedDocker,
      "stop",
      "--time",
      "2",
      containerId,
    ]);
    expect(runner.dockerCommands.every(([command]) => command === persistedDocker)).toBe(true);
    expect(store.read()).toEqual({ status: "missing" });
  });

  test("blocks Docker cleanup when the labeled container changes during action revalidation", async () => {
    const dataDirectory = temporaryDirectory();
    const docker = executable(join(dataDirectory, "bin"), "docker");
    const runner = new FocusedProcessRunner();
    const manager = managerFor(dataDirectory, runner);
    expect(await runEffect(manager.findInferenceProcess(8_000))).toBeNull();
    const created = createdAtMs();
    const store = createProcessOwnershipStore(dataDirectory);
    const active = activeRecord(store, dockerRecord(created, docker), 45_200, String(created));
    const originalContainer = "a".repeat(64);
    const replacementContainer = "b".repeat(64);
    runner.dockerContainerIds = [originalContainer];
    runner.inventory = [inventoryEntry(active.rootPid, active.startIdentity)];
    runner.processEnvironment.set(active.rootPid, {
      LOCAL_STUDIO_LAUNCH_ID: active.launchId,
    });
    let lookupCount = 0;
    runner.beforeDockerCommand = (_command, args): void => {
      if (args[0] !== "ps") return;
      lookupCount += 1;
      if (lookupCount === 2) runner.dockerContainerIds = [replacementContainer];
    };

    expect(await runEffect(manager.killProcess(active.rootPid, false))).toBe(false);
    expect(runner.signalCount).toBe(0);
    expect(runner.dockerContainerIds).toEqual([replacementContainer]);
    expect(store.read()).toEqual({ status: "found", record: active });
    expect(
      runner.dockerCommands.some(
        ([, action, ...args]) =>
          ["stop", "kill", "rm"].includes(action ?? "") && args.includes(originalContainer),
      ),
    ).toBe(false);
  });

  test("resolves a launch executable from its supplied PATH and canonical target", () => {
    const firstDirectory = join(temporaryDirectory(), "path-a");
    const secondDirectory = join(temporaryDirectory(), "path-b");
    const expected = executable(firstDirectory, "docker");
    executable(secondDirectory, "docker");
    process.env["PATH"] = secondDirectory;

    expect(resolveBinaryFromEnvironment("docker", { PATH: firstDirectory })).toBe(expected);
  });
});
