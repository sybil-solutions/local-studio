import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { createConfig } from "../../src/config/env";
import { getEngineSpec } from "../../src/modules/engines/engine-spec";
import { runPlatformUpgrade } from "../../src/modules/engines/runtimes/runtime-upgrade";
import { registerControllerTestLifecycle } from "./fixtures";

registerControllerTestLifecycle();

const UPGRADE_ENV_KEYS = [
  "LOCAL_STUDIO_VLLM_UPGRADE_CMD",
  "LOCAL_STUDIO_SGLANG_UPGRADE_CMD",
  "LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD",
  "LOCAL_STUDIO_CUDA_UPGRADE_CMD",
  "LOCAL_STUDIO_ROCM_UPGRADE_CMD",
] as const;

describe("runtime upgrade env-command path", () => {
  let envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    envSnapshot = Object.fromEntries(UPGRADE_ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of UPGRADE_ENV_KEYS) {
      process.env[key] = "true";
    }
    // The test lifecycle skips system python; allow it so vllm-runtime can find a python binary.
    delete process.env.LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM;
  });

  afterEach(() => {
    for (const key of UPGRADE_ENV_KEYS) {
      const value = envSnapshot[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // Unlike the other engines, the vllm path probes for a real python binary and
  // re-reads runtime info after the command, so on a machine without vllm the
  // python startup/import probes can take ~20s. Give it a generous timeout.
  test("upgradeVllmRuntime uses the operator-configured command", async () => {
    const result = await getEngineSpec("vllm").install({ config: createConfig() });
    expect(result.used_command).toBe("true");
  }, 60_000);

  test("upgradeSglangRuntime uses the operator-configured command", async () => {
    const config = createConfig();
    const result = await getEngineSpec("sglang").install({ config });
    expect(result.used_command).toBe("true");
  });

  test("upgradeLlamacppRuntime uses the operator-configured command", async () => {
    const config = createConfig();
    const result = await getEngineSpec("llamacpp").install({ config });
    expect(result.used_command).toBe("true");
  });

  test("runPlatformUpgrade uses the operator-configured command for CUDA", async () => {
    const result = await runPlatformUpgrade("cuda", {});
    expect(result.used_command).toBe("true");
  });

  test("runPlatformUpgrade uses the operator-configured command for ROCm", async () => {
    const result = await runPlatformUpgrade("rocm", {});
    expect(result.used_command).toBe("true");
  });
});
