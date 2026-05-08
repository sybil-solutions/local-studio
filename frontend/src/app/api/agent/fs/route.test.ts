import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as listFs } from "./route";
import { GET as readFsFile } from "./file/route";

const ROOTS_ENV_KEY = "VLLM_STUDIO_AGENT_FS_ROOTS";
const REMOTE_FS_ENV_KEY = "VLLM_STUDIO_ENABLE_REMOTE_AGENT_FS";

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("agent filesystem API", () => {
  let sandbox: string;
  let project: string;
  let outside: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), "vllm-studio-fs-test-"));
    project = path.join(sandbox, "project");
    outside = path.join(sandbox, "outside");
    await mkdir(project);
    await mkdir(outside);
    await writeFile(path.join(project, "README.md"), "project file\n");
    await writeFile(path.join(outside, "secret.txt"), "outside file\n");
    process.env[ROOTS_ENV_KEY] = project;
  });

  afterEach(async () => {
    delete process.env[ROOTS_ENV_KEY];
    delete process.env[REMOTE_FS_ENV_KEY];
    await rm(sandbox, { recursive: true, force: true });
  });

  it("lists files under an allowed project root", async () => {
    const request = new NextRequest(
      `http://localhost/api/agent/fs?cwd=${encodeURIComponent(project)}&path=`,
      { headers: { host: "localhost" } },
    );

    const response = await listFs(request);
    const payload = await responseJson(response);

    expect(response.status).toBe(200);
    expect(payload.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "README.md", rel: "README.md", kind: "file" }),
      ]),
    );
  });

  it("rejects cwd values outside configured agent filesystem roots", async () => {
    const request = new NextRequest(
      `http://localhost/api/agent/fs/file?cwd=${encodeURIComponent(path.parse(project).root)}&path=${encodeURIComponent(
        path.relative(path.parse(project).root, path.join(outside, "secret.txt")),
      )}`,
      { headers: { host: "localhost" } },
    );

    const response = await readFsFile(request);
    const payload = await responseJson(response);

    expect(response.status).toBe(403);
    expect(payload.error).toBe("cwd is outside the allowed directories");
  });

  it("blocks relative traversal out of the project root", async () => {
    const request = new NextRequest(
      `http://localhost/api/agent/fs/file?cwd=${encodeURIComponent(project)}&path=${encodeURIComponent(
        "../outside/secret.txt",
      )}`,
      { headers: { host: "localhost" } },
    );

    const response = await readFsFile(request);
    const payload = await responseJson(response);

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Path escapes project root");
  });

  it("blocks symlink escapes out of the project root", async () => {
    await symlink(path.join(outside, "secret.txt"), path.join(project, "linked-secret.txt"));
    const request = new NextRequest(
      `http://localhost/api/agent/fs/file?cwd=${encodeURIComponent(project)}&path=linked-secret.txt`,
      { headers: { host: "localhost" } },
    );

    const response = await readFsFile(request);
    const payload = await responseJson(response);

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Path escapes project root");
  });

  it("blocks remote host access unless explicitly enabled", async () => {
    const request = new NextRequest(
      `http://studio.example.test/api/agent/fs?cwd=${encodeURIComponent(project)}&path=`,
      { headers: { host: "studio.example.test" } },
    );

    const response = await listFs(request);
    const payload = await responseJson(response);

    expect(response.status).toBe(403);
    expect(payload.error).toBe("Agent filesystem browsing is only available locally");
  });

  it("allows remote host access only after explicit opt-in", async () => {
    process.env[REMOTE_FS_ENV_KEY] = "1";
    const request = new NextRequest(
      `http://studio.example.test/api/agent/fs?cwd=${encodeURIComponent(project)}&path=`,
      { headers: { host: "studio.example.test" } },
    );

    const response = await listFs(request);
    const payload = await responseJson(response);

    expect(response.status).toBe(200);
    expect(payload.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "README.md", rel: "README.md", kind: "file" }),
      ]),
    );
  });
});
