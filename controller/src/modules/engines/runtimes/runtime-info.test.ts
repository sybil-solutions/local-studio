import { describe, expect, test } from "bun:test";
import type { RuntimeTorchBuildInfo } from "@local-studio/contracts/system";
import { detectPlatformKind } from "./runtime-info";

const torch: RuntimeTorchBuildInfo = {
  torch_version: null,
  torch_cuda: null,
  torch_hip: null,
};

describe("runtime platform detection", () => {
  test("detects Apple Silicon as Metal", () => {
    expect(
      detectPlatformKind({
        forcedSmiTool: undefined,
        torch,
        hasNvidiaSmi: false,
        hasRocmSmi: false,
        isAppleSilicon: true,
      }),
    ).toBe("metal");
  });

  test("retains explicit CUDA priority", () => {
    expect(
      detectPlatformKind({
        forcedSmiTool: "nvidia-smi",
        torch,
        hasNvidiaSmi: false,
        hasRocmSmi: false,
        isAppleSilicon: true,
      }),
    ).toBe("cuda");
  });
});
