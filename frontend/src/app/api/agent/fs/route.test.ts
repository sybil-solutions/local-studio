import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listFiles } from "./route";
import { GET as readFile } from "./file/route";

const projectsStoreMock = vi.hoisted(() => ({
  listProjectsFromStore: vi.fn(),
}));

vi.mock("@/lib/agent/projects-store", () => projectsStoreMock);

function request(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

describe("agent filesystem API project-root boundaries", () => {
  let projectRoot: string;
  let outsideRoot: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    projectRoot = mkdtempSync(path.join(os.tmpdir(), "vllm-fs-project-"));
    outsideRoot = mkdtempSync(path.join(os.tmpdir(), "vllm-fs-outside-"));
    writeFileSync(path.join(projectRoot, "inside.txt"), "allowed", "utf8");
    writeFileSync(path.join(outsideRoot, "secret.txt"), "blocked", "utf8");
    projectsStoreMock.listProjectsFromStore.mockReturnValue([
      {
        id: "project-1",
        name: "project",
        path: projectRoot,
        addedAt: new Date(0).toISOString(),
        exists: true,
        hasGit: false,
        branch: null,
      },
    ]);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  });

  it("lists files only when cwd is a registered project root", async () => {
    const response = await listFiles(
      request(`http://localhost/api/agent/fs?cwd=${encodeURIComponent(projectRoot)}&path=`),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { entries: Array<{ name: string }> };
    expect(payload.entries.map((entry) => entry.name)).toContain("inside.txt");
  });

  it("rejects absolute cwd values that were not selected as projects", async () => {
    const response = await listFiles(
      request(`http://localhost/api/agent/fs?cwd=${encodeURIComponent(outsideRoot)}&path=`),
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBe("cwd is not a registered project root");
  });

  it("reads files from registered roots and blocks traversal outside them", async () => {
    const allowed = await readFile(
      request(
        `http://localhost/api/agent/fs/file?cwd=${encodeURIComponent(projectRoot)}&path=${encodeURIComponent("inside.txt")}`,
      ),
    );
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({ content: "allowed" });

    const blocked = await readFile(
      request(
        `http://localhost/api/agent/fs/file?cwd=${encodeURIComponent(projectRoot)}&path=${encodeURIComponent("../secret.txt")}`,
      ),
    );
    expect(blocked.status).toBe(400);
  });

  it("blocks symlinks that resolve outside the registered project root", async () => {
    mkdirSync(path.join(projectRoot, "links"));
    symlinkSync(
      path.join(outsideRoot, "secret.txt"),
      path.join(projectRoot, "links", "secret.txt"),
    );

    const response = await readFile(
      request(
        `http://localhost/api/agent/fs/file?cwd=${encodeURIComponent(projectRoot)}&path=${encodeURIComponent("links/secret.txt")}`,
      ),
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBe("Path escapes project root");
  });
});
