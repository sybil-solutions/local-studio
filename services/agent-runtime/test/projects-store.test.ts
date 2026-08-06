import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import lockfile from "proper-lockfile";
import { resolveAllowedWorkspace } from "../src/projects-store";
import {
  listProjectsFromStore,
  removeProjectFromStore,
  resolveProjectsFilePath,
} from "../src/projects-store";

const originalRoots = process.env.WORKSPACE_ROOTS;
const originalDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
const originalProjectsFile = process.env.LOCAL_STUDIO_PROJECTS_FILE;
const originalCwd = process.cwd();
const temporaryRoots: string[] = [];

afterEach(() => {
  if (originalRoots === undefined) delete process.env.WORKSPACE_ROOTS;
  else process.env.WORKSPACE_ROOTS = originalRoots;
  if (originalDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDir;
  if (originalProjectsFile === undefined) delete process.env.LOCAL_STUDIO_PROJECTS_FILE;
  else process.env.LOCAL_STUDIO_PROJECTS_FILE = originalProjectsFile;
  process.chdir(originalCwd);
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-workspace-"));
  temporaryRoots.push(root);
  const allowed = path.join(root, "allowed");
  const sibling = path.join(root, "allowed-prefix-trap");
  mkdirSync(allowed);
  mkdirSync(sibling);
  process.env.WORKSPACE_ROOTS = allowed;
  return { root, allowed, sibling };
}

describe("workspace containment", () => {
  test("accepts a real descendant and rejects a path-prefix sibling", () => {
    const { allowed, sibling } = fixture();
    const child = path.join(allowed, "project");
    mkdirSync(child);
    expect(resolveAllowedWorkspace(child)).toBe(realpathSync.native(child));
    expect(() => resolveAllowedWorkspace(sibling)).toThrow(/outside WORKSPACE_ROOTS/);
  });

  test("rejects a symlink that escapes an allowed root", () => {
    const { allowed, sibling } = fixture();
    const link = path.join(allowed, "escape");
    symlinkSync(sibling, link, "dir");
    expect(() => resolveAllowedWorkspace(link)).toThrow(/outside WORKSPACE_ROOTS/);
  });
});

function record(id: string, projectPath: string) {
  return {
    id,
    name: path.basename(projectPath),
    path: projectPath,
    addedAt: "2026-08-06T00:00:00.000Z",
  };
}

function writeRegistry(filePath: string, projects: ReturnType<typeof record>[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({ projects }, null, 2)}\n`, { mode: 0o644 });
}

test("migrates registries without reopening completed legacy sources", () => {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-projects-migration-"));
  temporaryRoots.push(root);
  const dataDir = path.join(root, "user-data");
  const legacyFile = path.join(root, "legacy", "projects.json");
  const bundleCwd = path.join(root, "Local Studio.app", "Contents", "Resources", "app", "frontend");
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  const third = path.join(root, "third");
  const legacyProject = path.join(root, "legacy-project");
  [bundleCwd, first, second, third].forEach((directory) =>
    mkdirSync(directory, { recursive: true }),
  );
  process.chdir(bundleCwd);
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  process.env.LOCAL_STUDIO_PROJECTS_FILE = legacyFile;
  process.env.WORKSPACE_ROOTS = root;
  const canonicalFile = resolveProjectsFilePath();
  writeRegistry(canonicalFile, [record("shared", first), record("duplicate", first)]);
  symlinkSync(second, legacyProject, "dir");
  writeRegistry(legacyFile, [record("shared", legacyProject)]);

  let projects = listProjectsFromStore().filter((project) => project.id !== "chats");
  expect(projects.map((project) => project.path).sort()).toEqual([first, legacyProject].sort());
  expect(new Set(projects.map((project) => project.id)).size).toBe(2);
  expect(statSync(canonicalFile).mode & 0o777).toBe(0o600);
  expect(statSync(legacyFile).mode & 0o777).toBe(0o644);
  expect(statSync(dataDir).mode & 0o777).toBe(0o700);
  expect(readdirSync(dataDir).filter((entry) => entry.endsWith(".backup"))).toHaveLength(2);
  expect(statSync(path.join(dataDir, "projects-migration.json")).mode & 0o777).toBe(0o600);

  const migrated = projects.find((project) => project.path === legacyProject);
  removeProjectFromStore(migrated?.id ?? "");
  rmSync(legacyProject);
  symlinkSync(third, legacyProject, "dir");
  projects = listProjectsFromStore().filter((project) => project.id !== "chats");
  expect(projects.map((project) => project.path)).toEqual([first]);
  writeFileSync(legacyFile, "{");
  projects = listProjectsFromStore().filter((project) => project.id !== "chats");
  expect(projects.map((project) => project.path)).toEqual([first]);
  expect(existsSync(path.join(bundleCwd, "data", "agentfs", "projects.json"))).toBeFalse();
});

test("serializes concurrent project writers", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-projects-concurrent-"));
  temporaryRoots.push(root);
  const dataDir = path.join(root, "data");
  const canonicalFile = path.join(dataDir, "projects.json");
  const workspaces = Array.from({ length: 6 }, (_, index) => path.join(root, `workspace-${index}`));
  workspaces.forEach((directory) => mkdirSync(directory, { recursive: true }));
  mkdirSync(dataDir, { recursive: true });
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  process.env.LOCAL_STUDIO_PROJECTS_FILE = "";
  process.env.WORKSPACE_ROOTS = root;
  const release = lockfile.lockSync(canonicalFile, { realpath: false });
  const moduleUrl = new URL("../src/projects-store.ts", import.meta.url).href;
  const source = `import {addProjectToStore} from ${JSON.stringify(moduleUrl)};addProjectToStore(process.env.WORKSPACE);`;
  const children = workspaces.map((workspace) =>
    Bun.spawn([process.execPath, "-e", source], {
      env: { ...process.env, WORKSPACE: workspace },
      stderr: "pipe",
    }),
  );
  await Bun.sleep(100);
  release();
  expect(await Promise.all(children.map((child) => child.exited))).toEqual(Array(6).fill(0));
  expect(listProjectsFromStore().filter((project) => project.id !== "chats")).toHaveLength(6);
});
