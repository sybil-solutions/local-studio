import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  listDirectory,
  readFileSnippet,
  writeFileContent,
} from "@/features/agent/fs-store";
import {
  addProjectToStore,
  removeProjectFromStore,
} from "@local-studio/agent-runtime/projects-store";

async function rejectsWith(
  fn: () => unknown,
  expectedMessage: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal((error as Error).message, expectedMessage);
    return;
  }
  throw new Error(`Expected rejection with "${expectedMessage}"`);
}

describe("agent filesystem root boundary", () => {
  let originalProjectsFile: string | undefined;
  let projectDir: string;
  let projectsFile: string;
  let projectId: string;

  beforeEach(() => {
    originalProjectsFile = process.env.LOCAL_STUDIO_PROJECTS_FILE;
    const testDir = mkdtempSync(
      path.join(tmpdir(), "local-studio-agentfs-test-"),
    );
    projectDir = path.join(testDir, "project");
    projectsFile = path.join(testDir, "projects.json");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(path.join(projectDir, "sub"));
    writeFileSync(path.join(projectDir, "file.txt"), "hello");
    process.env.LOCAL_STUDIO_PROJECTS_FILE = projectsFile;
    projectId = addProjectToStore(projectDir).id;
  });

  afterEach(() => {
    removeProjectFromStore(projectId);
    if (originalProjectsFile === undefined) {
      delete process.env.LOCAL_STUDIO_PROJECTS_FILE;
    } else {
      process.env.LOCAL_STUDIO_PROJECTS_FILE = originalProjectsFile;
    }
    rmSync(path.dirname(projectDir), { recursive: true, force: true });
  });

  it("lists a registered project directory", () => {
    const entries = listDirectory(projectDir, "");
    const names = entries.map((entry) => entry.name).sort();
    assert.deepEqual(names, ["file.txt", "sub"]);
  });

  it("reads a file inside a registered project directory", async () => {
    const result = await readFileSnippet(projectDir, "file.txt");
    assert.equal(result.content, "hello");
    assert.equal(result.truncated, false);
  });

  it("writes a file inside a registered project directory", async () => {
    await writeFileContent(projectDir, "file.txt", "updated");
    const result = await readFileSnippet(projectDir, "file.txt");
    assert.equal(result.content, "updated");
  });

  it("lists an unregistered safe workspace cwd", () => {
    const otherDir = mkdtempSync(
      path.join(tmpdir(), "local-studio-agentfs-other-"),
    );
    try {
      writeFileSync(path.join(otherDir, "note.txt"), "hello");
      const entries = listDirectory(otherDir, "");
      assert.deepEqual(entries.map((entry) => entry.name), ["note.txt"]);
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it("rejects a system root as cwd", async () => {
    await rejectsWith(
      () => listDirectory(path.parse(projectDir).root, ""),
      "Path is not an allowed workspace root",
    );
  });

  it("rejects windows system directories as cwd", async () => {
    if (process.platform !== "win32") return;
    const systemDirs = [
      "C:\\Windows",
      "C:\\Program Files",
      "C:\\Users",
      "\\\\?\\C:\\Windows",
      "\\\\localhost\\C$\\Windows",
    ];
    if (existsSync("C:\\PROGRA~1")) systemDirs.push("C:\\PROGRA~1");
    for (const systemDir of systemDirs) {
      await rejectsWith(
        () => listDirectory(systemDir, ""),
        "Path is not an allowed workspace root",
      );
    }
  });

  it("rejects traversal outside the project root", async () => {
    await rejectsWith(
      () => listDirectory(projectDir, ".."),
      "Path escapes project root",
    );
    await rejectsWith(
      () => writeFileContent(projectDir, "../outside.txt", "nope"),
      "Path escapes project root",
    );
  });

  it("rejects a symlinked target that escapes the project root", async () => {
    const outsideFile = path.join(path.dirname(projectDir), "outside.txt");
    writeFileSync(outsideFile, "secret");
    const linkPath = path.join(projectDir, "link.txt");
    symlinkSync(outsideFile, linkPath);
    try {
      await rejectsWith(
        () => readFileSnippet(projectDir, "link.txt"),
        "Path escapes project root",
      );
    } finally {
      if (existsSync(outsideFile)) rmSync(outsideFile);
    }
  });

  it("accepts access through a symlinked project root that resolves inside the real project", () => {
    const linkRoot = path.join(path.dirname(projectDir), "project-link");
    symlinkSync(projectDir, linkRoot);
    projectId = addProjectToStore(linkRoot).id;
    try {
      const entries = listDirectory(linkRoot, "");
      const names = entries.map((entry) => entry.name).sort();
      assert.deepEqual(names, ["file.txt", "sub"]);
    } finally {
      removeProjectFromStore(projectId);
      if (existsSync(linkRoot)) rmSync(linkRoot);
    }
  });
});
