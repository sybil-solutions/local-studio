import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWindowsSnapshotSecurity,
  trustedWindowsRuntimeHelperPath,
  type WindowsRuntimeHelperSpawn,
} from "../src/windows-runtime-helper";

const previousHelper = process.env.LOCAL_STUDIO_WINDOWS_RUNTIME_HELPER;
const previousNodeRuntime = process.env.LOCAL_STUDIO_NODE_RUNTIME;
const roots: string[] = [];

afterEach(async () => {
  if (previousHelper === undefined) delete process.env.LOCAL_STUDIO_WINDOWS_RUNTIME_HELPER;
  else process.env.LOCAL_STUDIO_WINDOWS_RUNTIME_HELPER = previousHelper;
  if (previousNodeRuntime === undefined) delete process.env.LOCAL_STUDIO_NODE_RUNTIME;
  else process.env.LOCAL_STUDIO_NODE_RUNTIME = previousNodeRuntime;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Windows runtime helper boundary", () => {
  test("ignores environment authority and resolves the verified repository helper", () => {
    process.env.LOCAL_STUDIO_WINDOWS_RUNTIME_HELPER = path.join(tmpdir(), "untrusted-helper.exe");
    const expected = realpathSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../native/windows-runtime-helper.exe",
      ),
    );
    expect(trustedWindowsRuntimeHelperPath()).toBe(expected);
  });

  test("resolves the verified helper beside the packaged Node runtime", async () => {
    const root = realpathSync(await mkdtemp(path.join(tmpdir(), "local-studio-windows-helper-")));
    roots.push(root);
    const helper = path.join(root, "windows-runtime-helper.exe");
    await copyFile(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../native/windows-runtime-helper.exe",
      ),
      helper,
    );
    process.env.LOCAL_STUDIO_NODE_RUNTIME = path.join(root, "node.exe");
    delete process.env.LOCAL_STUDIO_WINDOWS_RUNTIME_HELPER;
    expect(trustedWindowsRuntimeHelperPath()).toBe(realpathSync(helper));
  });

  test("bounds a hung helper without a shell", async () => {
    let shell: boolean | string | undefined;
    const spawnHelper: WindowsRuntimeHelperSpawn = (_command, _args, options) => {
      shell = options.shell;
      return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
    };
    const security = createWindowsSnapshotSecurity({
      helperPath: process.execPath,
      spawn: spawnHelper,
      timeoutMs: 20,
    });
    await expect(security.verify("C:\\snapshot", "directory", "snapshot")).rejects.toThrow(
      "Windows runtime helper failed",
    );
    expect(shell).toBe(false);
  });

  test("parses only the exact successful ACL response", async () => {
    const response =
      (payload: string): WindowsRuntimeHelperSpawn =>
      (_command, _args, options) =>
        spawn(
          process.execPath,
          ["-e", `process.stdout.write(${JSON.stringify(payload)})`],
          options,
        );
    await expect(
      createWindowsSnapshotSecurity({
        helperPath: process.execPath,
        spawn: response('{"ok":true}\n'),
      }).protect("C:\\snapshot", "directory", "snapshot"),
    ).resolves.toBeUndefined();
    await expect(
      createWindowsSnapshotSecurity({
        helperPath: process.execPath,
        spawn: response('{"ok":true,"extra":true}\n'),
      }).verify("C:\\snapshot", "directory", "snapshot"),
    ).rejects.toThrow("Windows runtime helper failed");
  });
});
