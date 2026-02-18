import { afterEach, describe, expect, it } from "bun:test";
import type { RuntimeTorchBuildInfo } from "../types";
import { detectPlatformKind } from "../runtime-info";

const torch = (overrides: Partial<RuntimeTorchBuildInfo> = {}): RuntimeTorchBuildInfo => ({
  torch_version: null,
  torch_cuda: null,
  torch_hip: null,
  ...overrides,
});

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("platform detection", () => {
  it("uses explicit override first", () => {
    expect(
      detectPlatformKind({
        forcedSmiTool: "amd-smi",
        torch: torch({ torch_cuda: "12.4" }),
        hasNvidiaSmi: true,
        hasRocmSmi: true,
      })
    ).toBe("rocm");
  });

  it("uses torch metadata second", () => {
    expect(
      detectPlatformKind({
        forcedSmiTool: undefined,
        torch: torch({ torch_hip: "6.2" }),
        hasNvidiaSmi: true,
        hasRocmSmi: false,
      })
    ).toBe("rocm");
  });

  it("falls back to binary presence", () => {
    expect(
      detectPlatformKind({
        forcedSmiTool: undefined,
        torch: torch(),
        hasNvidiaSmi: false,
        hasRocmSmi: true,
      })
    ).toBe("rocm");
  });
});
