import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mergeProjectRecords, projectPathKey, stableDigest, readProjectsDocument } from "../src/projects-document";
import {
  migrateLegacyProjectsRegistry,
  migrateProjectsRegistry,
  resolveLegacyProjectsFilePath,
  resolveLegacyProjectsFilePaths,
} from "../src/projects-migration";

function project(id: string, projectPath: string) {
  return { id, name: path.basename(projectPath), path: projectPath, addedAt: "2026-08-20T00:00:00.000Z" };
}

test("merges project records by canonical path and resolves id collisions", () => {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-projects-"));
  const firstPath = path.join(root, "first");
  const secondPath = path.join(root, "second");
  mkdirSync(firstPath);
  mkdirSync(secondPath);
  const merged = mergeProjectRecords(
    [project("same", firstPath)],
    [project("same", secondPath), project("duplicate", firstPath)],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.id, "same");
  assert.equal(merged[1]?.id, "proj-migrated-" + stableDigest(projectPathKey(secondPath)));
});

test("backs up and migrates a legacy registry without writing to the legacy path", () => {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-projects-"));
  const cwd = path.join(root, "bundle", "app");
  const legacy = resolveLegacyProjectsFilePath(cwd);
  const canonical = path.join(root, "user-data", "projects.json");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.dirname(legacy), { recursive: true });
  mkdirSync(workspace);
  const content = JSON.stringify({ projects: [project("legacy", workspace)] }, null, 2) + "\n";
  writeFileSync(legacy, content, { mode: 0o600 });
  chmodSync(legacy, 0o600);
  migrateProjectsRegistry({ canonicalFile: canonical, legacyFile: legacy });
  assert.deepEqual(readProjectsDocument(canonical).projects, [project("legacy", workspace)]);
  assert.equal(readFileSync(legacy, "utf8"), content);
});

test("repeating migration does not duplicate projects", () => {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-projects-"));
  const legacy = path.join(root, "legacy", "projects.json");
  const canonical = path.join(root, "user-data", "projects.json");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.dirname(legacy), { recursive: true });
  mkdirSync(workspace);
  writeFileSync(
    legacy,
    JSON.stringify({ projects: [project("legacy", workspace)] }) + "\n",
    { mode: 0o600 },
  );

  migrateProjectsRegistry({ canonicalFile: canonical, legacyFile: legacy });
  migrateProjectsRegistry({ canonicalFile: canonical, legacyFile: legacy });

  assert.equal(readProjectsDocument(canonical).projects.length, 1);
});

test("migrates the repository registry when runtime starts at the repository root", () => {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-projects-root-cwd-"));
  const legacy = path.join(root, "data", "agentfs", "projects.json");
  const canonical = path.join(root, "user-data", "projects.json");
  const workspace = path.join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  const content = JSON.stringify({ projects: [project("root", workspace)] }) + "\n";
  mkdirSync(path.dirname(legacy), { recursive: true });
  writeFileSync(legacy, content, { mode: 0o600 });
  const previousCwd = process.cwd();
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  const previousOverride = process.env.LOCAL_STUDIO_PROJECTS_FILE;
  try {
    process.chdir(root);
    process.env.LOCAL_STUDIO_DATA_DIR = path.dirname(canonical);
    delete process.env.LOCAL_STUDIO_PROJECTS_FILE;
    migrateLegacyProjectsRegistry();
    assert.deepEqual(readProjectsDocument(canonical).projects, [project("root", workspace)]);
  } finally {
    process.chdir(previousCwd);
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    if (previousOverride === undefined) delete process.env.LOCAL_STUDIO_PROJECTS_FILE;
    else process.env.LOCAL_STUDIO_PROJECTS_FILE = previousOverride;
  }
});

test("migrates the repository registry from a nested runtime cwd", () => {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-projects-nested-cwd-"));
  const runtimeCwd = path.join(root, "services", "agent-runtime");
  const legacy = path.join(root, "data", "agentfs", "projects.json");
  const canonical = path.join(root, "user-data", "projects.json");
  const workspace = path.join(root, "workspace");
  mkdirSync(runtimeCwd, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const content = JSON.stringify({ projects: [project("nested", workspace)] }) + "\n";
  mkdirSync(path.dirname(legacy), { recursive: true });
  writeFileSync(legacy, content, { mode: 0o600 });
  const previousCwd = process.cwd();
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  const previousOverride = process.env.LOCAL_STUDIO_PROJECTS_FILE;
  try {
    process.chdir(runtimeCwd);
    process.env.LOCAL_STUDIO_DATA_DIR = path.dirname(canonical);
    delete process.env.LOCAL_STUDIO_PROJECTS_FILE;
    migrateLegacyProjectsRegistry();
    assert.deepEqual(readProjectsDocument(canonical).projects, [project("nested", workspace)]);
  } finally {
    process.chdir(previousCwd);
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    if (previousOverride === undefined) delete process.env.LOCAL_STUDIO_PROJECTS_FILE;
    else process.env.LOCAL_STUDIO_PROJECTS_FILE = previousOverride;
  }
});

test("bounds legacy registry discovery to eight cwd ancestors", () => {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-projects-bounded-cwd-"));
  const shallowCwd = path.join(root, "a", "b", "c");
  const deepCwd = path.join(root, ...Array.from({ length: 8 }, (_, index) => `level-${index}`));
  mkdirSync(deepCwd, { recursive: true });
  const paths = resolveLegacyProjectsFilePaths(shallowCwd, undefined);
  assert.equal(paths.length, 8);
  assert(paths.includes(path.join(root, "data", "agentfs", "projects.json")));
  assert(
    !resolveLegacyProjectsFilePaths(deepCwd, undefined).includes(
      path.join(root, "data", "agentfs", "projects.json"),
    ),
  );
});
