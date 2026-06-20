import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { missingDesktopReleaseAssets } from "./verify-desktop-release-assets.mjs";

async function createDist(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vllm-studio-release-assets-"));
  const distDir = path.join(root, "frontend", "dist-desktop");
  await mkdir(distDir, { recursive: true });

  for (const file of files) {
    await writeFile(path.join(distDir, file), "");
  }

  return distDir;
}

test("accepts versioned Apple Silicon DMG, ZIP, and update metadata", async () => {
  const distDir = await createDist([
    "vLLM Studio-1.49.1-arm64.dmg",
    "vLLM Studio-1.49.1-arm64.dmg.blockmap",
    "vLLM Studio-1.49.1-arm64.zip",
    "vLLM Studio-1.49.1-arm64.zip.blockmap",
    "latest-mac.yml",
  ]);

  assert.deepEqual(await missingDesktopReleaseAssets({ distDir, version: "1.49.1" }), []);
});

test("reports missing versioned Apple Silicon assets", async () => {
  const distDir = await createDist([
    "vLLM Studio-0.2.9-arm64.dmg",
    "vLLM Studio-1.49.1-x64.zip",
  ]);

  assert.deepEqual(await missingDesktopReleaseAssets({ distDir, version: "1.49.1" }), [
    "versioned arm64 DMG",
    "versioned arm64 DMG blockmap",
    "versioned arm64 ZIP",
    "versioned arm64 ZIP blockmap",
    "latest-mac.yml",
  ]);
});
