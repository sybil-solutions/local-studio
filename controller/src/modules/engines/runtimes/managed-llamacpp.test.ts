import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  assetCudaVersion,
  managedLlamaServerPath,
  parseDriverCudaVersion,
  pickCudaAsset,
  resolveLlamaServerHelpBinary,
  type ReleaseAsset,
} from "./managed-llamacpp";

const asset = (name: string): ReleaseAsset => ({
  name,
  browser_download_url: `https://example.invalid/${name}`,
});

const RELEASE_ASSETS = [
  asset("cudart-llama-bin-win-cuda-12.4-x64.zip"),
  asset("cudart-llama-bin-win-cuda-13.3-x64.zip"),
  asset("llama-b9940-bin-win-cpu-x64.zip"),
  asset("llama-b9940-bin-win-cuda-12.4-x64.zip"),
  asset("llama-b9940-bin-win-cuda-13.3-x64.zip"),
  asset("llama-b9940-bin-win-vulkan-x64.zip"),
];

const SERVER_PATTERN = /^llama-.+-bin-win-cuda-.+-x64\.zip$/;

describe("assetCudaVersion", () => {
  test("parses major.minor from asset names", () => {
    expect(assetCudaVersion("llama-b9940-bin-win-cuda-12.4-x64.zip")).toBeCloseTo(12.04);
    expect(assetCudaVersion("cudart-llama-bin-win-cuda-13.3-x64.zip")).toBeCloseTo(13.03);
    expect(assetCudaVersion("llama-b9940-bin-win-vulkan-x64.zip")).toBe(0);
  });
});

describe("parseDriverCudaVersion", () => {
  test("reads classic and UMD nvidia-smi banners", () => {
    expect(parseDriverCudaVersion("| NVIDIA-SMI 555.85    Driver Version: 555.85    CUDA Version: 12.5 |")).toBeCloseTo(12.5);
    expect(parseDriverCudaVersion("| NVIDIA-SMI 610.47    Driver Version: 610.47    CUDA UMD Version: 13.3 |")).toBeCloseTo(13.3);
    expect(parseDriverCudaVersion("no gpu here")).toBeNull();
  });
});

describe("pickCudaAsset", () => {
  test("picks the highest cuda build the driver supports", () => {
    expect(pickCudaAsset(RELEASE_ASSETS, SERVER_PATTERN, 13.03)?.name).toBe(
      "llama-b9940-bin-win-cuda-13.3-x64.zip",
    );
    expect(pickCudaAsset(RELEASE_ASSETS, SERVER_PATTERN, 12.5)?.name).toBe(
      "llama-b9940-bin-win-cuda-12.4-x64.zip",
    );
  });

  test("falls back to the lowest cuda build when the driver is unknown or too old", () => {
    expect(pickCudaAsset(RELEASE_ASSETS, SERVER_PATTERN, null)?.name).toBe(
      "llama-b9940-bin-win-cuda-12.4-x64.zip",
    );
    expect(pickCudaAsset(RELEASE_ASSETS, SERVER_PATTERN, 11)?.name).toBe(
      "llama-b9940-bin-win-cuda-12.4-x64.zip",
    );
  });

  test("returns null when no asset matches", () => {
    expect(pickCudaAsset(RELEASE_ASSETS, /never-matches/, null)).toBeNull();
  });
});

describe("managedLlamaServerPath", () => {
  test("locates llama-server.exe anywhere under the prebuilt root on Windows", () => {
    if (process.platform !== "win32") return;
    const dataDirectory = mkdtempSync(join(tmpdir(), "managed-llamacpp-"));
    try {
      const nested = join(dataDirectory, "runtime", "llamacpp", "prebuilt", "build", "bin");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, "llama-server.exe"), "");
      expect(managedLlamaServerPath({ data_dir: dataDirectory })).toBe(
        join(nested, "llama-server.exe"),
      );
    } finally {
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });

  test("keeps the source build path on POSIX", () => {
    if (process.platform === "win32") return;
    expect(managedLlamaServerPath({ data_dir: "/data" })).toBe(
      "/data/runtime/llamacpp/src/build/bin/llama-server",
    );
  });
});

describe("resolveLlamaServerHelpBinary", () => {
  test("falls back to the managed install when llama_bin is unset", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "managed-llamacpp-help-"));
    try {
      const managed = managedLlamaServerPath({ data_dir: dataDirectory });
      mkdirSync(dirname(managed), { recursive: true });
      writeFileSync(managed, "");
      expect(
        resolveLlamaServerHelpBinary({ data_dir: dataDirectory, llama_bin: "" }),
      ).toBe(managed);
    } finally {
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });

  test("keeps the bare command when nothing is installed", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "managed-llamacpp-help-"));
    try {
      expect(
        resolveLlamaServerHelpBinary({ data_dir: dataDirectory, llama_bin: "" }),
      ).toBe("llama-server");
    } finally {
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });

  test("prefers an explicitly configured llama_bin path", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "managed-llamacpp-help-"));
    try {
      const configured = join(dataDirectory, "custom-llama-server");
      writeFileSync(configured, "");
      const managed = managedLlamaServerPath({ data_dir: dataDirectory });
      mkdirSync(dirname(managed), { recursive: true });
      writeFileSync(managed, "");
      expect(
        resolveLlamaServerHelpBinary({ data_dir: dataDirectory, llama_bin: configured }),
      ).toBe(resolve(configured));
    } finally {
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });
});
