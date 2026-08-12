import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProjectsStore, projectPathParts } from "./projects-store-core";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("projectPathParts", () => {
  test("preserves Windows drive and UNC semantics", () => {
    expect(projectPathParts("C:\\work\\local-studio\\\\", path.win32)).toEqual({
      normalizedPath: "C:\\work\\local-studio",
      name: "local-studio",
    });
    expect(projectPathParts("\\\\server\\share\\projects\\demo\\", path.win32)).toEqual({
      normalizedPath: "\\\\server\\share\\projects\\demo",
      name: "demo",
    });
    expect(projectPathParts("F:\\Studio Local\\João\\", path.win32)).toEqual({
      normalizedPath: "F:\\Studio Local\\João",
      name: "João",
    });
  });

  test("preserves Windows drive and UNC roots", () => {
    expect(projectPathParts("C:\\", path.win32).normalizedPath).toBe("C:\\");
    expect(projectPathParts("\\\\server\\share\\", path.win32).normalizedPath).toBe(
      "\\\\server\\share\\",
    );
  });
});

describe("createProjectsStore", () => {
  test("normalizes native separators before storing a project", () => {
    const root = mkdtempSync(path.join(tmpdir(), "local-studio-projects-"));
    temporaryRoots.push(root);
    const project = path.join(root, "workspace");
    mkdirSync(project);
    const store = createProjectsStore({
      projectsFilePath: () => path.join(root, "projects.json"),
      chatsProjectId: "chats",
      emptyPathMessage: "required",
    });
    const added = store.addProject(`${project}${path.sep}`);
    expect(added.path).toBe(project);
    expect(added.name).toBe("workspace");
  });
});
