import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NextRequest } from "next/server";
import {
  DELETE as removeProject,
  GET as listProjects,
  POST as addProject,
} from "@/app/api/agent/projects/route";
import { listDirectory } from "@/features/agent/fs-store";
import { selectedDirectoryPath } from "../desktop/logic/project-directory";
import { resolveProjectsFilePath } from "@local-studio/agent-runtime/data-dir";
import { handleAllSessions } from "@local-studio/agent-runtime/http/session-handlers";
import { listProjectsFromStore } from "@local-studio/agent-runtime/projects-store";
import {
  projectPathKey,
  readProjectsDocument,
  stableDigest,
  writeProjectsDocument,
  type ProjectRecord,
} from "@local-studio/agent-runtime/projects-document";
import {
  migrateProjectsRegistries,
  migrateProjectsRegistry,
  resolveLegacyProjectsFilePath,
  resolveLegacyProjectsFilePaths,
} from "@local-studio/agent-runtime/projects-migration";
import {
  lockOwnerIsActive,
  type LockOwner,
  type LockProcessInspection,
  withProjectsFileTransaction,
} from "@local-studio/agent-runtime/projects-lock";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function temporaryRoot(name: string): string {
  return mkdtempSync(path.join(tmpdir(), name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}

function stringValue(value: unknown): string {
  assert.ok(typeof value === "string");
  return value;
}

function projectResult(value: unknown): { id: string; path: string } {
  const project = recordValue(recordValue(value).project);
  return { id: stringValue(project.id), path: stringValue(project.path) };
}

function arrayValue(value: unknown): readonly unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function record(id: string, projectPath: string): ProjectRecord {
  return {
    id,
    name: path.basename(projectPath),
    path: projectPath,
    addedAt: "2026-07-17T00:00:00.000Z",
  };
}

function writeRegistry(filePath: string, projects: readonly ProjectRecord[]): string {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const content = `${JSON.stringify({ projects }, null, 2)}\n`;
  writeFileSync(filePath, content, { mode: 0o644 });
  chmodSync(filePath, 0o644);
  return content;
}

function lockClaimsDirectory(filePath: string): string {
  return `${filePath}.lock-claims`;
}

function writeLockClaim(filePath: string, owner: LockOwner): string {
  const directory = lockClaimsDirectory(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const claim = path.join(directory, `${owner.token}.claim`);
  writeFileSync(claim, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
  return claim;
}

function lockClaimFiles(filePath: string): string[] {
  const directory = lockClaimsDirectory(filePath);
  return existsSync(directory)
    ? readdirSync(directory).filter((entry) => entry.endsWith(".claim"))
    : [];
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function encodeCwdForPi(cwd: string): string {
  const normalized = path.resolve(cwd).replace(/\\+/g, "/");
  return `--${normalized.replace(/^\//, "").replace(/\/+/g, "-")}--`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForFiles(filePaths: readonly string[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!filePaths.every(existsSync)) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for project writers");
    await delay(10);
  }
}

function concurrentWriter(input: {
  moduleUrl: string;
  cwd: string;
  dataDir: string;
  workspace: string;
  readyFile: string;
  startFile: string;
}): Promise<void> {
  const source = `
    import { existsSync, writeFileSync } from "node:fs";
    import { addProjectToStore } from ${JSON.stringify(input.moduleUrl)};
    writeFileSync(process.env.PROJECTS_WRITER_READY, "");
    while (!existsSync(process.env.PROJECTS_WRITER_START)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    addProjectToStore(process.env.PROJECTS_WRITER_WORKSPACE);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", source], {
      cwd: input.cwd,
      env: {
        ...process.env,
        LOCAL_STUDIO_DATA_DIR: input.dataDir,
        LOCAL_STUDIO_PROJECTS_FILE: "",
        PROJECTS_WRITER_WORKSPACE: input.workspace,
        PROJECTS_WRITER_READY: input.readyFile,
        PROJECTS_WRITER_START: input.startFile,
        WORKSPACE_ROOTS: input.workspace,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Project writer exited with ${code}: ${stderr.trim()}`));
    });
  });
}

function concurrentTransaction(input: {
  moduleUrl: string;
  cwd: string;
  filePath: string;
  counterFile: string;
  activeDirectory: string;
  violationFile: string;
  readyFile: string;
  startFile: string;
}): Promise<void> {
  const source = `
    import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
    import { withProjectsFileTransaction } from ${JSON.stringify(input.moduleUrl)};
    writeFileSync(process.env.PROJECTS_WRITER_READY, "");
    while (!existsSync(process.env.PROJECTS_WRITER_START)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    withProjectsFileTransaction(process.env.PROJECTS_FILE, () => {
      let entered = false;
      try {
        mkdirSync(process.env.PROJECTS_ACTIVE);
        entered = true;
      } catch {
        writeFileSync(process.env.PROJECTS_VIOLATION, "overlap");
      }
      const value = Number(readFileSync(process.env.PROJECTS_COUNTER, "utf8"));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      writeFileSync(process.env.PROJECTS_COUNTER, String(value + 1));
      if (entered) rmSync(process.env.PROJECTS_ACTIVE, { recursive: true, force: true });
    });
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", source], {
      cwd: input.cwd,
      env: {
        ...process.env,
        PROJECTS_FILE: input.filePath,
        PROJECTS_COUNTER: input.counterFile,
        PROJECTS_ACTIVE: input.activeDirectory,
        PROJECTS_VIOLATION: input.violationFile,
        PROJECTS_WRITER_READY: input.readyFile,
        PROJECTS_WRITER_START: input.startFile,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Project transaction exited with ${code}: ${stderr.trim()}`));
    });
  });
}

async function leaveCrashedClaim(input: {
  moduleUrl: string;
  cwd: string;
  filePath: string;
  readyFile: string;
}): Promise<void> {
  const source = `
    import { writeFileSync } from "node:fs";
    import { withProjectsFileTransaction } from ${JSON.stringify(input.moduleUrl)};
    withProjectsFileTransaction(process.env.PROJECTS_FILE, () => {
      writeFileSync(process.env.PROJECTS_WRITER_READY, "");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
    });
  `;
  const child = spawn(process.execPath, ["-e", source], {
    cwd: input.cwd,
    env: {
      ...process.env,
      PROJECTS_FILE: input.filePath,
      PROJECTS_WRITER_READY: input.readyFile,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const closed = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal === "SIGKILL") resolve();
      else reject(new Error(`Crash owner exited with ${code}/${signal}: ${stderr.trim()}`));
    });
  });
  await waitForFiles([input.readyFile]);
  if (!child.kill("SIGKILL")) throw new Error("Unable to terminate crash owner");
  await closed;
}

function exitedProcessId(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", ""]);
    const pid = child.pid;
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && pid !== undefined) resolve(pid);
      else reject(new Error(`Stale-lock process exited with ${code}`));
    });
  });
}

test("packaged selection uses one HTTP-owned registry for every consumer", async () => {
  const root = temporaryRoot("local-studio-projects-packaged-");
  const originalCwd = process.cwd();
  const environment = new Map(
    [
      "HOME",
      "LOCAL_STUDIO_DATA_DIR",
      "LOCAL_STUDIO_PROJECTS_FILE",
      "PI_CODING_AGENT_DIR",
      "WORKSPACE_ROOTS",
    ].map((name) => [name, process.env[name]]),
  );
  const bundleRoot = path.join(root, "writable-bundle-root");
  const serverRoot = path.join(
    bundleRoot,
    "Local Studio.app",
    "Contents",
    "Resources",
    "app",
    "frontend",
  );
  const dataDir = path.join(root, "user-data");
  const workspace = path.join(root, "workspace");
  const piDir = path.join(root, "pi-agent");
  const sessionId = "packaged-project-session";

  try {
    mkdirSync(serverRoot, { recursive: true });
    chmodSync(bundleRoot, 0o777);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(workspace, "README.md"), "workspace");
    process.chdir(serverRoot);
    process.env.HOME = path.join(root, "home");
    process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
    delete process.env.LOCAL_STUDIO_PROJECTS_FILE;
    process.env.PI_CODING_AGENT_DIR = piDir;
    process.env.WORKSPACE_ROOTS = root;

    const selected = selectedDirectoryPath({ canceled: false, filePaths: [workspace] });
    assert.equal(selected, workspace);
    const added = await addProject(
      new NextRequest("http://127.0.0.1/api/agent/projects", {
        method: "POST",
        body: JSON.stringify({ path: selected }),
        headers: { "content-type": "application/json" },
      }),
    );
    assert.equal(added.status, 200);
    const project = projectResult(await added.json());

    const listed = arrayValue(recordValue(await (await listProjects()).json()).projects);
    assert.equal(
      listed.some((entry) => recordValue(entry).id === project.id),
      true,
    );
    assert.deepEqual(
      listDirectory(workspace, "").map((entry) => entry.name),
      ["README.md"],
    );

    const sessionDirectory = path.join(piDir, "sessions", encodeCwdForPi(project.path));
    mkdirSync(sessionDirectory, { recursive: true });
    writeFileSync(
      path.join(sessionDirectory, `${sessionId}.jsonl`),
      `${JSON.stringify({
        type: "session",
        id: sessionId,
        cwd: project.path,
        timestamp: "2026-07-17T00:00:00.000Z",
      })}\n`,
    );
    const sessions = arrayValue(
      recordValue(
        await (
          await handleAllSessions(
            new Request(`http://127.0.0.1/api/agent/sessions/all?ids=${sessionId}`),
          )
        ).json(),
      ).sessions,
    );
    assert.equal(sessions.length, 1);
    assert.equal(recordValue(sessions[0]).projectId, project.id);

    const removed = await removeProject(
      new NextRequest(`http://127.0.0.1/api/agent/projects?id=${project.id}`, {
        method: "DELETE",
      }),
    );
    assert.equal(removed.status, 200);
    assert.deepEqual(readProjectsDocument(resolveProjectsFilePath()).projects, []);
    assert.equal(resolveProjectsFilePath(), path.join(dataDir, "projects.json"));
    assert.equal(existsSync(resolveLegacyProjectsFilePath(serverRoot)), false);
  } finally {
    process.chdir(originalCwd);
    for (const [name, value] of environment) restoreEnvironment(name, value);
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration discovers every source and imports only newly appearing legacy paths", () => {
  const root = temporaryRoot("local-studio-projects-migration-");
  const packagedRoot = path.join(root, "Applications", "Local Studio.app");
  const cwd = path.join(packagedRoot, "Contents", "Resources", "app", "frontend");
  const canonicalFile = path.join(root, "data", "projects.json");
  const overrideFile = path.join(root, "override", "projects.json");
  const cwdFile = resolveLegacyProjectsFilePath(cwd);
  const first = path.join(root, "first");
  const firstLink = path.join(root, "first-link");
  const second = path.join(root, "second");
  const third = path.join(root, "third");
  const fourth = path.join(root, "fourth");
  const fifth = path.join(root, "fifth");
  const sixth = path.join(root, "sixth");
  const lateFile = path.join(root, "late", "projects.json");

  try {
    for (const directory of [cwd, first, second, third, fourth, fifth, sixth]) {
      mkdirSync(directory, { recursive: true });
    }
    symlinkSync(first, firstLink);
    const canonicalOriginal = writeRegistry(canonicalFile, [
      record("canonical-first", first),
      record("shared-id", second),
    ]);
    const overrideOriginal = writeRegistry(overrideFile, [
      record("legacy-duplicate", firstLink),
      record("shared-id", third),
    ]);
    chmodSync(path.dirname(overrideFile), 0o777);
    const cwdOriginal = writeRegistry(cwdFile, [record("cwd-project", fourth)]);
    chmodSync(packagedRoot, 0o775);
    const preexistingBackup = `${canonicalFile}.legacy-${stableDigest(overrideOriginal)}.backup`;
    writeFileSync(preexistingBackup, overrideOriginal, { mode: 0o644 });
    chmodSync(preexistingBackup, 0o644);
    const legacyFiles = [...resolveLegacyProjectsFilePaths(cwd, overrideFile), lateFile].sort();
    assert.deepEqual(legacyFiles, [cwdFile, lateFile, overrideFile].sort());

    migrateProjectsRegistries({ canonicalFile, legacyFiles });
    let projects = readProjectsDocument(canonicalFile).projects;
    assert.equal(projects.length, 4);
    assert.equal(projects.find((project) => project.path === first)?.id, "canonical-first");
    assert.equal(projects.find((project) => project.path === second)?.id, "shared-id");
    assert.equal(
      projects.find((project) => project.path === third)?.id,
      `proj-migrated-${stableDigest(projectPathKey(third))}`,
    );

    const artifacts = readdirSync(path.dirname(canonicalFile));
    const backups = artifacts.filter((file) => file.endsWith(".backup"));
    const backupContents = backups.map((file) =>
      readFileSync(path.join(path.dirname(canonicalFile), file), "utf8"),
    );
    assert.equal(backupContents.includes(canonicalOriginal), true);
    assert.equal(backupContents.includes(overrideOriginal), true);
    assert.equal(backupContents.includes(cwdOriginal), true);
    for (const file of artifacts.filter(
      (entry) => entry.endsWith(".backup") || entry.endsWith(".migrated.json"),
    )) {
      assert.equal(statSync(path.join(path.dirname(canonicalFile), file)).mode & 0o777, 0o600);
    }
    assert.equal(statSync(canonicalFile).mode & 0o777, 0o600);

    writeProjectsDocument(canonicalFile, {
      projects: projects.filter((project) => project.path !== third),
    });
    migrateProjectsRegistries({ canonicalFile, legacyFiles });
    assert.equal(
      readProjectsDocument(canonicalFile).projects.some((project) => project.path === third),
      false,
    );

    writeRegistry(overrideFile, [record("legacy-duplicate", firstLink)]);
    migrateProjectsRegistries({ canonicalFile, legacyFiles });
    assert.equal(
      readProjectsDocument(canonicalFile).projects.some((project) => project.path === third),
      false,
    );

    writeRegistry(overrideFile, [
      record("legacy-duplicate", firstLink),
      record("shared-id", third),
      record("new-project", fifth),
    ]);
    writeRegistry(lateFile, [record("late-project", sixth)]);
    migrateProjectsRegistries({ canonicalFile, legacyFiles });
    projects = readProjectsDocument(canonicalFile).projects;
    assert.equal(
      projects.some((project) => project.path === third),
      false,
    );
    assert.equal(
      projects.some((project) => project.path === fifth),
      true,
    );
    assert.equal(
      projects.some((project) => project.path === sixth),
      true,
    );
    const idempotentDocument = readFileSync(canonicalFile, "utf8");
    const idempotentArtifacts = readdirSync(path.dirname(canonicalFile)).sort();
    migrateProjectsRegistries({ canonicalFile, legacyFiles });
    assert.equal(readFileSync(canonicalFile, "utf8"), idempotentDocument);
    assert.deepEqual(readdirSync(path.dirname(canonicalFile)).sort(), idempotentArtifacts);

    const marker = readdirSync(path.dirname(canonicalFile)).find((file) =>
      file.endsWith(".migrated.json"),
    );
    assert.ok(marker);
    const markerPath = path.join(path.dirname(canonicalFile), marker);
    const originalMarker = readFileSync(markerPath, "utf8");
    writeFileSync(markerPath, "not-json");
    assert.throws(
      () => migrateProjectsRegistries({ canonicalFile, legacyFiles }),
      /Invalid projects migration marker/,
    );
    assert.equal(readFileSync(canonicalFile, "utf8"), idempotentDocument);

    writeFileSync(markerPath, originalMarker, { mode: 0o600 });
    rmSync(canonicalFile);
    migrateProjectsRegistries({ canonicalFile, legacyFiles });
    assert.deepEqual(readProjectsDocument(canonicalFile), { projects: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration fails closed for corrupt sources and symbolic-link targets", () => {
  const root = temporaryRoot("local-studio-projects-fail-closed-");
  const canonicalFile = path.join(root, "data", "projects.json");
  const legacyFile = path.join(root, "legacy", "projects.json");
  const workspace = path.join(root, "workspace");
  const canonicalOriginal = writeRegistry(canonicalFile, [record("canonical", workspace)]);
  mkdirSync(path.dirname(legacyFile), { recursive: true });
  writeFileSync(legacyFile, "not-json");

  try {
    assert.throws(
      () => migrateProjectsRegistry({ canonicalFile, legacyFile }),
      /Invalid projects registry/,
    );
    assert.equal(readFileSync(canonicalFile, "utf8"), canonicalOriginal);
    assert.equal(
      readdirSync(path.dirname(canonicalFile)).some((file) => file.endsWith(".backup")),
      false,
    );

    const externalFile = path.join(root, "external-projects.json");
    rmSync(legacyFile);
    writeFileSync(externalFile, canonicalOriginal, { mode: 0o644 });
    symlinkSync(externalFile, legacyFile);
    assert.throws(() => migrateProjectsRegistry({ canonicalFile, legacyFile }), /Symbolic links/);
    assert.equal(readFileSync(canonicalFile, "utf8"), canonicalOriginal);

    rmSync(legacyFile);
    rmSync(canonicalFile);
    writeRegistry(legacyFile, [record("legacy", workspace)]);
    symlinkSync(externalFile, canonicalFile);
    assert.throws(() => migrateProjectsRegistry({ canonicalFile, legacyFile }), /Symbolic links/);
    assert.equal(readFileSync(externalFile, "utf8"), canonicalOriginal);
    assert.equal(statSync(externalFile).mode & 0o777, 0o644);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project resolution rejects a symbolic-link data directory without mutation", () => {
  const root = temporaryRoot("local-studio-projects-data-symlink-");
  const originalDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  const externalDirectory = path.join(root, "external-data");
  const dataDirectory = path.join(root, "user-data");
  const sentinel = path.join(externalDirectory, "sentinel");

  try {
    mkdirSync(externalDirectory, { recursive: true, mode: 0o755 });
    chmodSync(externalDirectory, 0o755);
    writeFileSync(sentinel, "unchanged");
    symlinkSync(externalDirectory, dataDirectory);
    process.env.LOCAL_STUDIO_DATA_DIR = dataDirectory;
    assert.throws(() => listProjectsFromStore(), /Symbolic links/);
    assert.equal(statSync(externalDirectory).mode & 0o777, 0o755);
    assert.equal(readFileSync(sentinel, "utf8"), "unchanged");
    assert.equal(existsSync(path.join(externalDirectory, "projects.json")), false);
    assert.equal(existsSync(path.join(externalDirectory, "api-settings.json")), false);
  } finally {
    restoreEnvironment("LOCAL_STUDIO_DATA_DIR", originalDataDir);
    rmSync(root, { recursive: true, force: true });
  }
});

test("project locks retain all concurrent writers", { timeout: 30_000 }, async () => {
  const root = temporaryRoot("local-studio-projects-concurrent-");
  const dataDir = path.join(root, "user-data");
  const serverRoot = path.join(root, "packaged-server");
  const startFile = path.join(root, "start");
  const moduleUrl = pathToFileURL(
    path.join(REPOSITORY_ROOT, "services/agent-runtime/src/projects-store.ts"),
  ).href;
  const workspaces = Array.from({ length: 12 }, (_, index) => {
    const workspace = path.join(root, `workspace-${index}`);
    mkdirSync(workspace, { recursive: true });
    return workspace;
  });
  const readyFiles = workspaces.map((_, index) => path.join(root, `ready-${index}`));
  mkdirSync(serverRoot, { recursive: true });
  const writers = workspaces.map((workspace, index) =>
    concurrentWriter({
      moduleUrl,
      cwd: serverRoot,
      dataDir,
      workspace,
      readyFile: readyFiles[index] ?? "",
      startFile,
    }),
  );

  try {
    await waitForFiles(readyFiles);
    writeFileSync(startFile, "");
    await Promise.all(writers);
    const canonicalFile = path.join(dataDir, "projects.json");
    const projects = readProjectsDocument(canonicalFile).projects;
    assert.equal(projects.length, workspaces.length);
    assert.equal(new Set(projects.map((project) => project.id)).size, workspaces.length);
    assert.equal(existsSync(`${canonicalFile}.lock`), false);
    assert.equal(existsSync(`${canonicalFile}.lock.reaper`), false);
    assert.deepEqual(lockClaimFiles(canonicalFile), []);
  } finally {
    if (!existsSync(startFile)) writeFileSync(startFile, "");
    await Promise.allSettled(writers);
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "crashed and competing stale generations cannot overlap replacement transactions",
  { timeout: 30_000 },
  async () => {
    const root = temporaryRoot("local-studio-projects-adversarial-lock-");
    const serverRoot = path.join(root, "server");
    const canonicalFile = path.join(root, "data", "projects.json");
    const counterFile = path.join(root, "counter");
    const activeDirectory = path.join(root, "active");
    const violationFile = path.join(root, "violation");
    const crashReadyFile = path.join(root, "crash-ready");
    const startFile = path.join(root, "start");
    const moduleUrl = pathToFileURL(
      path.join(REPOSITORY_ROOT, "services/agent-runtime/src/projects-lock.ts"),
    ).href;
    const writerCount = 16;
    const readyFiles = Array.from({ length: writerCount }, (_, index) =>
      path.join(root, `ready-${index}`),
    );
    mkdirSync(serverRoot, { recursive: true });
    mkdirSync(path.dirname(canonicalFile), { recursive: true });
    writeFileSync(counterFile, "0");

    await leaveCrashedClaim({
      moduleUrl,
      cwd: serverRoot,
      filePath: canonicalFile,
      readyFile: crashReadyFile,
    });
    const stalePid = await exitedProcessId();
    for (const token of [
      "00000000-0000-4000-8000-000000000005",
      "00000000-0000-4000-8000-000000000006",
    ]) {
      writeLockClaim(canonicalFile, {
        pid: stalePid,
        startIdentity: `${process.platform}:1`,
        token,
        createdAt: Date.now(),
      });
    }
    assert.equal(lockClaimFiles(canonicalFile).length, 3);
    const writers = readyFiles.map((readyFile) =>
      concurrentTransaction({
        moduleUrl,
        cwd: serverRoot,
        filePath: canonicalFile,
        counterFile,
        activeDirectory,
        violationFile,
        readyFile,
        startFile,
      }),
    );

    try {
      await waitForFiles(readyFiles);
      writeFileSync(startFile, "");
      await Promise.all(writers);
      assert.equal(readFileSync(counterFile, "utf8"), String(writerCount));
      assert.equal(existsSync(violationFile), false);
      assert.equal(existsSync(activeDirectory), false);
      assert.deepEqual(lockClaimFiles(canonicalFile), []);
    } finally {
      if (!existsSync(startFile)) writeFileSync(startFile, "");
      await Promise.allSettled(writers);
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("project transactions recover claim generations left by exited processes", async () => {
  const root = temporaryRoot("local-studio-projects-stale-lock-");
  const canonicalFile = path.join(root, "data", "projects.json");

  try {
    mkdirSync(path.dirname(canonicalFile), { recursive: true });
    const pid = await exitedProcessId();
    for (const token of [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]) {
      writeLockClaim(canonicalFile, {
        pid,
        startIdentity: `${process.platform}:1`,
        token,
        createdAt: Date.now(),
      });
    }
    withProjectsFileTransaction(canonicalFile, () =>
      writeProjectsDocument(canonicalFile, { projects: [] }),
    );
    assert.deepEqual(lockClaimFiles(canonicalFile), []);
    assert.deepEqual(readProjectsDocument(canonicalFile), { projects: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project locks fail closed when a live owner identity cannot be verified", () => {
  const owner: LockOwner = {
    pid: 42,
    startIdentity: "unavailable-generation",
    token: "writer-token",
    createdAt: Date.now() - 60_000,
  };
  const liveUnverifiable: LockProcessInspection = {
    startIdentity: () => null,
    exists: () => true,
  };
  assert.equal(lockOwnerIsActive(owner, liveUnverifiable), true);
  assert.equal(lockOwnerIsActive(owner, { ...liveUnverifiable, exists: () => false }), false);
  assert.equal(
    lockOwnerIsActive(owner, {
      ...liveUnverifiable,
      startIdentity: () => "different-generation",
    }),
    false,
  );
  assert.equal(
    lockOwnerIsActive(
      { ...owner, startIdentity: `runtime:${owner.pid}:00000000-0000-4000-8000-000000000001` },
      { startIdentity: () => "different-generation", exists: () => true },
    ),
    true,
  );
});

test("project transactions fail closed for invalid claim owners", () => {
  const root = temporaryRoot("local-studio-projects-invalid-lock-");
  const canonicalFile = path.join(root, "data", "projects.json");

  try {
    mkdirSync(path.dirname(canonicalFile), { recursive: true });
    for (const [token, content] of [
      ["00000000-0000-4000-8000-000000000003", "not-json"],
      [
        "00000000-0000-4000-8000-000000000004",
        `${JSON.stringify({
          pid: process.pid,
          startIdentity: "malformed",
          token: "partial",
          createdAt: Date.now(),
        })}\n`,
      ],
    ]) {
      const directory = lockClaimsDirectory(canonicalFile);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const filePath = path.join(directory, `${token}.claim`);
      writeFileSync(filePath, content, { mode: 0o600 });
      assert.throws(
        () => withProjectsFileTransaction(canonicalFile, () => undefined),
        /Invalid projects registry lock owner/,
      );
      assert.equal(readFileSync(filePath, "utf8"), content);
      rmSync(filePath);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
