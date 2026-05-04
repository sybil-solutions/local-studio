// CRITICAL
import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../../../config/env";
import type { Logger } from "../../../core/logger";
import type { EventManager } from "../../system/event-manager";
import { DownloadManager } from "./download-manager";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    try {
      chmodSync(root, 0o700);
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

const createManager = (modelsDirectory: string): DownloadManager => {
  return new DownloadManager(
    {
      models_dir: modelsDirectory,
    } as Config,
    {
      list: () => [],
      get: () => null,
      save: () => {},
      delete: () => false,
    } as never,
    {
      publish: async () => {},
    } as unknown as EventManager,
    {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as Logger
  );
};

describe("DownloadManager", () => {
  it("fails before queueing when the configured server models directory is not writable", async () => {
    const root = mkdtempSync(join(tmpdir(), "vllm-studio-downloads-"));
    temporaryRoots.push(root);
    chmodSync(root, 0o500);

    const manager = createManager(root);

    await expect(
      manager.start({
        model_id: "sshleifer/tiny-gpt2",
        allow_patterns: ["config.json"],
      })
    ).rejects.toThrow("Models directory is not writable by the controller");
  });
});
