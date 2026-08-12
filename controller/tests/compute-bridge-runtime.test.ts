import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config/env";
import { recipeToLaunchInput } from "../src/modules/compute/bridge";
import type { Recipe } from "../src/modules/models/types";

const config = {
  inference_port: 8000,
} as Config;

const recipe = (runtime: Recipe["runtime"]): Recipe =>
  ({
    id: "deepseek-v4",
    name: "DeepSeek V4",
    model_path: "/models/deepseek-v4",
    backend: "sglang",
    runtime,
    port: 8000,
    tensor_parallel_size: 2,
    pipeline_parallel_size: 1,
    max_model_len: 131072,
    gpu_memory_utilization: 0.9,
    max_num_seqs: 16,
    kv_cache_dtype: "auto",
    trust_remote_code: true,
    extra_args: {},
  }) as Recipe;

describe("recipe runtime launch mapping", () => {
  test("system and binary runtimes launch their selected executable", () => {
    const system = recipeToLaunchInput(
      recipe({ kind: "system", ref: "/opt/local-studio/launch-sglang" }),
      config,
      [],
    );
    const binary = recipeToLaunchInput(
      recipe({ kind: "binary", ref: "/opt/sglang/bin/sglang" }),
      config,
      [],
    );

    expect(system.runtime).toBe("process");
    expect(system.binary).toBe("/opt/local-studio/launch-sglang");
    expect(system.dockerImage).toBeNull();
    expect(binary.runtime).toBe("process");
    expect(binary.binary).toBe("/opt/sglang/bin/sglang");
  });

  test("docker runtime launches the selected image", () => {
    const image = "registry.example/sglang:deepseek-v4";
    const input = recipeToLaunchInput(recipe({ kind: "docker", ref: image }), config, []);

    expect(input.runtime).toBe("docker");
    expect(input.dockerImage).toBe(image);
    expect(input.binary).toBeNull();
  });

  test("WSL2 runtime preserves the selected distribution and Linux binary", () => {
    const input = recipeToLaunchInput(
      recipe({ kind: "wsl2", ref: "Ubuntu", binary: "/opt/sglang/bin/sglang" }),
      config,
      [],
    );

    expect(input.runtime).toBe("wsl2");
    expect(input.wslDistribution).toBe("Ubuntu");
    expect(input.binary).toBe("/opt/sglang/bin/sglang");
    expect(input.dockerImage).toBeNull();
  });
});
