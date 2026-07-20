import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import type { ProcessInventoryEntry } from "../../src/modules/engines/process/process-inventory";
import {
  createProcessOwnershipStore,
  inspectOwnedProcessGroup,
  type ActiveProcessOwnershipRecord,
  type DockerBindingEnvironment,
  type PendingProcessOwnershipRecord,
} from "../../src/modules/engines/process/process-ownership";

const directories = new Set<string>();
const START_IDENTITY = "1789000000000";
const DOCKER_ENVIRONMENT: DockerBindingEnvironment = {
  DOCKER_HOST: "tcp://docker.internal:2376",
  DOCKER_CONTEXT: "remote",
  DOCKER_CONFIG: "/private/docker-config",
  DOCKER_TLS_VERIFY: "1",
  DOCKER_CERT_PATH: "/private/docker-certs",
};

afterEach(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-process-owner-"));
  directories.add(directory);
  return directory;
};

const pendingRecord = (
  overrides: Partial<PendingProcessOwnershipRecord> = {},
): PendingProcessOwnershipRecord => ({
  version: 1,
  state: "pending",
  launchId: "00000000-0000-4000-8000-000000000001",
  recipeId: "recipe-one",
  backend: "vllm",
  port: 8000,
  createdAtMs: 1_789_000_000_000,
  runtimeKind: "native",
  commandFingerprint: createHash("sha256").update("recipe-one").digest("hex"),
  ...overrides,
});

const activeRecord = (
  overrides: Partial<ActiveProcessOwnershipRecord> = {},
): ActiveProcessOwnershipRecord => ({
  ...pendingRecord(),
  state: "active",
  rootPid: 42_000,
  processGroupId: 42_000,
  startIdentity: START_IDENTITY,
  ...overrides,
});

const entry = (
  pid: number,
  overrides: Partial<ProcessInventoryEntry> = {},
): ProcessInventoryEntry => ({
  pid,
  ppid: 1,
  processGroupId: 42_000,
  startIdentity: START_IDENTITY,
  stat: "S",
  command: "python -m vllm.entrypoints.openai.api_server",
  args: ["python", "-m", "vllm.entrypoints.openai.api_server"],
  ...overrides,
});

test("ownership records round-trip atomically with owner-only permissions", () => {
  const store = createProcessOwnershipStore(temporaryDirectory());
  const expected = pendingRecord();

  store.create(expected);

  expect(store.read()).toEqual({ status: "found", record: expected });
  expect(statSync(store.path).mode & 0o777).toBe(0o600);
  expect(statSync(dirname(store.path)).mode & 0o777).toBe(0o700);
});

test("Docker ownership requires a complete private restart binding", () => {
  const store = createProcessOwnershipStore(temporaryDirectory());

  expect(() => store.create(pendingRecord({ runtimeKind: "docker" }))).toThrow(
    "Process ownership record is invalid",
  );
  expect(() =>
    store.create(
      pendingRecord({
        runtimeKind: "docker",
        dockerAuthority: "direct",
        dockerDaemonFingerprint: "a".repeat(64),
        dockerExecutable: "docker",
        dockerEnvironment: DOCKER_ENVIRONMENT,
      }),
    ),
  ).toThrow("Process ownership record is invalid");
  expect(() =>
    store.create(
      pendingRecord({
        runtimeKind: "docker",
        dockerAuthority: "direct",
        dockerDaemonFingerprint: "a".repeat(64),
        dockerExecutable: "/opt/docker/../bin/docker",
        dockerEnvironment: DOCKER_ENVIRONMENT,
      }),
    ),
  ).toThrow("Process ownership record is invalid");
  const expected = pendingRecord({
    runtimeKind: "docker",
    dockerAuthority: "direct",
    dockerDaemonFingerprint: "a".repeat(64),
    dockerExecutable: "/opt/docker/bin/docker",
    dockerEnvironment: DOCKER_ENVIRONMENT,
  });
  store.create(expected);

  expect(store.read()).toEqual({ status: "found", record: expected });
  expect(statSync(store.path).mode & 0o777).toBe(0o600);
});

test("native ownership rejects Docker binding inputs", () => {
  const store = createProcessOwnershipStore(temporaryDirectory());

  expect(() =>
    store.create(
      pendingRecord({
        dockerAuthority: "direct",
        dockerDaemonFingerprint: "a".repeat(64),
        dockerExecutable: "docker",
        dockerEnvironment: DOCKER_ENVIRONMENT,
      }),
    ),
  ).toThrow("Process ownership record is invalid");
  expect(store.read()).toEqual({ status: "missing" });
});

test("an existing ownership record cannot be overwritten", () => {
  const store = createProcessOwnershipStore(temporaryDirectory());
  const first = pendingRecord();
  store.create(first);

  expect(() => store.create(pendingRecord({ launchId: "second" }))).toThrow(
    "A process ownership record already exists",
  );
  expect(store.read()).toEqual({ status: "found", record: first });
});

test("insecure ownership record permissions fail closed", () => {
  const store = createProcessOwnershipStore(temporaryDirectory());
  store.create(pendingRecord());
  chmodSync(store.path, 0o644);

  expect(store.read()).toEqual({
    status: "invalid",
    reason: "ownership record is not private",
  });
});

test("remove only clears the exact ownership generation", () => {
  const store = createProcessOwnershipStore(temporaryDirectory());
  const expected = pendingRecord();
  store.create(expected);

  expect(store.remove(pendingRecord({ launchId: "different" }))).toBe(false);
  expect(store.read().status).toBe("found");
  expect(store.remove(expected)).toBe(true);
  expect(store.read()).toEqual({ status: "missing" });
});

test("an exact-generation scope excludes a second store through compare-and-delete", async () => {
  const directory = temporaryDirectory();
  const first = createProcessOwnershipStore(directory);
  const second = createProcessOwnershipStore(directory);
  const expected = pendingRecord();
  const replacement = pendingRecord({
    launchId: "00000000-0000-4000-8000-000000000002",
    createdAtMs: expected.createdAtMs + 1,
  });
  first.create(expected);
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const operation = Effect.runPromise(
    first.withExactGeneration(expected, (scope) =>
      Effect.tryPromise(async () => {
        entered.resolve();
        await resume.promise;
        return scope.remove();
      }),
    ),
  );

  await entered.promise;
  expect(second.remove(expected)).toBe(false);
  expect(() => second.create(replacement)).toThrow("Process ownership generation is busy");
  expect(statSync(join(directory, "processes", ".inference-owner.lock")).mode & 0o777).toBe(0o700);
  expect(
    statSync(join(directory, "processes", ".inference-owner.lock", "owner.json")).mode & 0o777,
  ).toBe(0o600);
  resume.resolve();
  expect(await operation).toEqual({ status: "acquired", value: true });
  second.create(replacement);
  expect(first.read()).toEqual({ status: "found", record: replacement });
});

test("a launch scope serializes pending creation through activation", () => {
  const directory = temporaryDirectory();
  const launchingStore = createProcessOwnershipStore(directory);
  const competingStore = createProcessOwnershipStore(directory);
  const pending = pendingRecord();
  const launch = launchingStore.beginLaunch(pending);

  expect(competingStore.remove(pending)).toBe(false);
  const spawned = launch.markSpawned({ rootPid: 42_000, processGroupId: 42_000 });
  const active = launch.activate({
    rootPid: 42_000,
    processGroupId: 42_000,
    startIdentity: START_IDENTITY,
  });
  expect(spawned.state).toBe("spawned");
  expect(competingStore.remove(active)).toBe(false);
  launch.release();

  expect(competingStore.remove(active)).toBe(true);
  expect(launchingStore.read()).toEqual({ status: "missing" });
});

test("a crashed ownership lock is reclaimed from stable process identity", () => {
  const directory = temporaryDirectory();
  const store = createProcessOwnershipStore(directory);
  const expected = pendingRecord();
  store.create(expected);
  const lockDirectory = join(directory, "processes", ".inference-owner.lock");
  mkdirSync(lockDirectory, { mode: 0o700 });
  writeFileSync(
    join(lockDirectory, "owner.json"),
    JSON.stringify({
      version: 1,
      token: "00000000-0000-4000-8000-000000000099",
      pid: 2_147_483_647,
      startIdentity: "linux:1",
      createdAtMs: Date.now(),
    }),
    { mode: 0o600 },
  );

  expect(store.remove(expected)).toBe(true);
  expect(store.read()).toEqual({ status: "missing" });
  expect(readdirSync(join(directory, "processes"))).toEqual([]);
});

test("missing and partially written lock owners recover within one bounded acquisition", async () => {
  for (const residue of ["missing", "partial"] as const) {
    const directory = temporaryDirectory();
    const store = createProcessOwnershipStore(directory, {
      acquireTimeoutMs: 100,
      invalidOwnerGraceMs: 20,
      retryIntervalMs: 5,
    });
    const expected = pendingRecord({
      launchId: `00000000-0000-4000-8000-0000000000${residue === "missing" ? "10" : "11"}`,
    });
    store.create(expected);
    const lockDirectory = join(directory, "processes", ".inference-owner.lock");
    mkdirSync(lockDirectory, { mode: 0o700 });
    if (residue === "partial") {
      writeFileSync(join(lockDirectory, "owner.json"), "{", { mode: 0o600 });
    }

    const result = await Effect.runPromise(
      store.withExactGeneration(expected, (scope) => Effect.sync(scope.remove)),
    );

    expect(result).toEqual({ status: "acquired", value: true });
    expect(store.read()).toEqual({ status: "missing" });
    expect(readdirSync(join(directory, "processes"))).toEqual([]);
  }
});

test("a valid live lock is not reclaimed after invalid-owner grace expires", async () => {
  const directory = temporaryDirectory();
  const timing = {
    acquireTimeoutMs: 40,
    invalidOwnerGraceMs: 10,
    retryIntervalMs: 5,
  };
  const owner = createProcessOwnershipStore(directory, timing);
  const contender = createProcessOwnershipStore(directory, timing);
  const expected = pendingRecord();
  const launch = owner.beginLaunch(expected);
  await Bun.sleep(15);

  await expect(
    Effect.runPromise(contender.withExactGeneration(expected, () => Effect.succeed(true))),
  ).rejects.toThrow("Process ownership lock acquisition timed out");
  expect(owner.read()).toEqual({ status: "found", record: expected });
  expect(launch.remove()).toBe(true);
});

test("a symlinked ownership lock fails closed without following its target", () => {
  const directory = temporaryDirectory();
  const store = createProcessOwnershipStore(directory);
  const expected = pendingRecord();
  store.create(expected);
  const target = join(directory, "lock-target");
  mkdirSync(target, { mode: 0o700 });
  symlinkSync(target, join(directory, "processes", ".inference-owner.lock"));

  expect(() => store.remove(expected)).toThrow("Process ownership lock is not trustworthy");
  expect(store.read()).toEqual({ status: "found", record: expected });
  expect(readdirSync(target)).toEqual([]);
});

test("an exact-generation scope rejects a replaced record before use", async () => {
  const directory = temporaryDirectory();
  const store = createProcessOwnershipStore(directory);
  const stale = pendingRecord();
  const replacement = pendingRecord({
    launchId: "00000000-0000-4000-8000-000000000003",
    createdAtMs: stale.createdAtMs + 1,
  });
  store.create(stale);
  expect(store.remove(stale)).toBe(true);
  store.create(replacement);
  let invoked = false;

  const result = await Effect.runPromise(
    store.withExactGeneration(stale, () =>
      Effect.sync(() => {
        invoked = true;
      }),
    ),
  );

  expect(result).toEqual({ status: "changed" });
  expect(invoked).toBe(false);
  expect(store.read()).toEqual({ status: "found", record: replacement });
});

test("activation adds an immutable generation without replacing the pending record", () => {
  const directory = temporaryDirectory();
  const store = createProcessOwnershipStore(directory);
  const pending = pendingRecord();
  store.create(pending);

  const spawned = store.markSpawned(pending, {
    rootPid: 42_000,
    processGroupId: 42_000,
  });
  if (spawned.state !== "spawned") throw new Error("Expected spawned generation");
  const active = store.activate(spawned, {
    rootPid: 42_000,
    processGroupId: 42_000,
    startIdentity: START_IDENTITY,
  });

  expect(active).toEqual(activeRecord());
  expect(store.read()).toEqual({ status: "found", record: active });
  expect(store.markSpawned(pending, spawned)).toEqual(active);
  expect(store.activate(spawned, active)).toEqual(active);
  expect(
    readdirSync(dirname(store.path))
      .map((name) => statSync(join(dirname(store.path), name)).mode & 0o777)
      .every((mode) => mode === 0o600),
  ).toBe(true);
  expect(store.remove(active)).toBe(true);
  expect(store.read()).toEqual({ status: "missing" });
});

test("a stale activation cannot overwrite a replacement generation", () => {
  const directory = temporaryDirectory();
  const staleStore = createProcessOwnershipStore(directory);
  const replacementStore = createProcessOwnershipStore(directory);
  const stalePending = pendingRecord();
  staleStore.create(stalePending);
  const staleSpawned = staleStore.markSpawned(stalePending, {
    rootPid: 42_000,
    processGroupId: 42_000,
  });
  if (staleSpawned.state !== "spawned") throw new Error("Expected spawned generation");
  expect(replacementStore.remove(staleSpawned)).toBe(true);
  const replacement = pendingRecord({
    launchId: "00000000-0000-4000-8000-000000000002",
    createdAtMs: 1_789_000_000_001,
  });
  replacementStore.create(replacement);

  expect(() =>
    staleStore.activate(staleSpawned, {
      rootPid: 42_000,
      processGroupId: 42_000,
      startIdentity: START_IDENTITY,
    }),
  ).toThrow("Process ownership generation changed");
  expect(replacementStore.read()).toEqual({ status: "found", record: replacement });
});

test("oversized ownership data is rejected before persistence", () => {
  const store = createProcessOwnershipStore(temporaryDirectory());

  expect(() => store.create(pendingRecord({ recipeId: "x".repeat(17_000) }))).toThrow();
  expect(store.read()).toEqual({ status: "missing" });
});

test("a live leader requires both its start identity and launch marker", () => {
  const expected = activeRecord();
  const inventory = [entry(expected.rootPid)];

  expect(inspectOwnedProcessGroup(expected, inventory, () => expected.launchId).status).toBe(
    "owned",
  );
  expect(inspectOwnedProcessGroup(expected, inventory, () => null).status).toBe(
    "identity-mismatch",
  );
  expect(
    inspectOwnedProcessGroup(
      expected,
      [entry(expected.rootPid, { startIdentity: "1789000001000" })],
      () => expected.launchId,
    ).status,
  ).toBe("identity-mismatch");
});

test("an orphan group requires every surviving member to carry the launch marker", () => {
  const expected = activeRecord();
  const inventory = [entry(42_001), entry(42_002)];

  expect(inspectOwnedProcessGroup(expected, inventory, () => expected.launchId).status).toBe(
    "owned",
  );
  expect(
    inspectOwnedProcessGroup(expected, inventory, (pid) =>
      pid === 42_001 ? expected.launchId : null,
    ).status,
  ).toBe("identity-mismatch");
});

test("a group with no live members is gone", () => {
  const expected = activeRecord();

  expect(inspectOwnedProcessGroup(expected, [], () => null)).toEqual({ status: "gone" });
  expect(
    inspectOwnedProcessGroup(
      expected,
      [entry(expected.rootPid, { stat: "Z" })],
      () => expected.launchId,
    ),
  ).toEqual({ status: "gone" });
});
