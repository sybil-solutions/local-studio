import { describe, expect, test } from "bun:test";
import {
  managedLlamaServerPathForPlatform,
  selectWindowsLlamacppAssets,
} from "../src/modules/engines/runtimes/managed-llamacpp";

const release = {
  tag_name: "b1234",
  assets: [
    {
      name: "llama-b1234-bin-win-cpu-x64.zip",
      browser_download_url: "https://example.test/cpu.zip",
    },
    {
      name: "llama-b1234-bin-win-cuda-12.4-x64.zip",
      browser_download_url: "https://example.test/cuda.zip",
    },
    {
      name: "cudart-llama-bin-win-cuda-12.4-x64.zip",
      browser_download_url: "https://example.test/cudart.zip",
    },
  ],
};

describe("managed llama.cpp", () => {
  test("uses the existing source build path on POSIX and an executable path on Windows", () => {
    const config = { data_dir: String.raw`D:\Local Studio` };
    expect(managedLlamaServerPathForPlatform(config, "win32")).toBe(
      String.raw`D:\Local Studio\runtime\llamacpp\bin\llama-server.exe`,
    );
    expect(managedLlamaServerPathForPlatform({ data_dir: "/data" }, "darwin")).toBe(
      "/data/runtime/llamacpp/src/build/bin/llama-server",
    );
    expect(managedLlamaServerPathForPlatform({ data_dir: "/data" }, "linux")).toBe(
      "/data/runtime/llamacpp/src/build/bin/llama-server",
    );
  });

  test("selects both official CUDA archives on NVIDIA hosts", () => {
    expect(selectWindowsLlamacppAssets(release, true)?.map((asset) => asset.name)).toEqual([
      "llama-b1234-bin-win-cuda-12.4-x64.zip",
      "cudart-llama-bin-win-cuda-12.4-x64.zip",
    ]);
  });

  test("selects the CPU archive when NVIDIA is unavailable", () => {
    expect(selectWindowsLlamacppAssets(release, false)?.map((asset) => asset.name)).toEqual([
      "llama-b1234-bin-win-cpu-x64.zip",
    ]);
  });

  test("refuses incomplete CUDA releases", () => {
    expect(selectWindowsLlamacppAssets({ ...release, assets: release.assets.slice(0, 2) }, true)).toBe(
      null,
    );
  });
});
