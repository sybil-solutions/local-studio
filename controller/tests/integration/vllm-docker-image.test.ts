import { describe, expect, it } from "bun:test";
import type { Config } from "../../src/config/env";
import { getEngineSpec } from "../../src/modules/engines/engine-spec";
import { parseRecipe } from "../../src/modules/models/recipes/recipe-serializer";
import type { Recipe } from "../../src/modules/models/types";
import { buildDockerGpuFlags } from "../../src/modules/engines/process/backend-builder";

const baseRecipe = (
  runtime: Recipe["runtime"],
  extra: Record<string, unknown>,
  env: Record<string, string> = {},
): Recipe =>
  parseRecipe({
    id: "glm-5.2",
    name: "GLM-5.2",
    model_path: "/mnt/llm_models/GLM-5.2-504B",
    backend: "vllm",
    runtime,
    host: "0.0.0.0",
    port: 8000,
    served_model_name: "glm-5.2",
    tensor_parallel_size: 4,
    pipeline_parallel_size: 1,
    max_model_len: 240000,
    gpu_memory_utilization: 0.92,
    max_num_seqs: 8,
    kv_cache_dtype: "fp8",
    trust_remote_code: true,
    tool_call_parser: "glm47",
    reasoning_parser: "glm45",
    quantization: "modelopt_fp4",
    dtype: "bfloat16",
    python_path: null,
    env_vars: env,
    extra_args: extra,
  });

const config: Config = {
  host: "127.0.0.1",
  port: 8080,
  inference_host: "127.0.0.1",
  inference_port: 8000,
  data_dir: "/tmp/local-studio-test",
  db_path: "/tmp/local-studio-test/controller.db",
  models_dir: "/models",
  strict_openai_models: false,
  providers: [],
};

const buildVllmCommand = (recipe: Recipe): string[] =>
  getEngineSpec("vllm").buildCommand(recipe, config);

const pairIndex = (command: string[], flag: string, value: string): number => {
  for (let index = 0; index < command.length - 1; index += 1) {
    if (command[index] === flag && command[index + 1] === value) return index;
  }
  return -1;
};

describe("vLLM Docker runtime", () => {
  const image = "voipmonitor/vllm:eldritch-enlightenment-cu132";

  it("wraps the Serve in the exact selected image", () => {
    const command = buildVllmCommand(
      baseRecipe({ kind: "docker", ref: image }, { "moe-backend": "b12x" }),
    );
    expect(command[0]).toBe("docker");
    expect(command[1]).toBe("run");
    expect(pairIndex(command, "--network", "host")).toBeGreaterThanOrEqual(0);
    expect(command).toContain("--gpus");
    expect(command).not.toContain("--privileged");
    expect(command).toContain(image);
    const imageIndex = command.indexOf(image);
    expect(command[imageIndex + 1]).toBe("/opt/venv/bin/vllm");
    expect(command[imageIndex + 2]).toBe("serve");
    expect(pairIndex(command, "--moe-backend", "b12x")).toBeGreaterThanOrEqual(0);
    expect(
      pairIndex(command, "-v", "/mnt/llm_models/GLM-5.2-504B:/mnt/llm_models/GLM-5.2-504B:ro"),
    ).toBeGreaterThanOrEqual(0);
  });

  it("exposes only the canonical UUIDs supplied by the launch boundary", () => {
    const uuid = (suffix: string): string => `GPU-00000000-0000-0000-0000-${suffix}`;
    const proUuids = [
      uuid("000000000001"),
      uuid("000000000002"),
      uuid("000000000003"),
      uuid("000000000004"),
    ];
    const rtx3090 = uuid("000000003090");
    const flags = buildDockerGpuFlags(
      baseRecipe({ kind: "docker", ref: image }, {}, { CUDA_VISIBLE_DEVICES: proUuids.join(",") }),
    );
    const selector = proUuids.join(",");

    expect(flags).toEqual([
      "--gpus",
      `"device=${selector}"`,
      "-e",
      `CUDA_VISIBLE_DEVICES=${selector}`,
    ]);
    expect(flags.join(" ")).not.toContain(rtx3090);
  });

  it("keeps an explicitly empty CUDA selector GPU-free", () => {
    expect(
      buildDockerGpuFlags(
        baseRecipe(
          { kind: "docker", ref: image },
          {},
          {
            CUDA_VISIBLE_DEVICES: "",
          },
        ),
      ),
    ).toEqual([]);
  });

  it("forwards NCCL_GRAPH_FILE and skips NCCL_GRAPH_DUMP_FILE", () => {
    const command = buildVllmCommand(
      baseRecipe(
        { kind: "docker", ref: image },
        {},
        { NCCL_GRAPH_FILE: "/dev/null", NCCL_GRAPH_DUMP_FILE: "/tmp/x", NCCL_P2P_DISABLE: "1" },
      ),
    );
    expect(pairIndex(command, "-e", "NCCL_GRAPH_FILE=/dev/null")).toBeGreaterThanOrEqual(0);
    expect(pairIndex(command, "-e", "NCCL_P2P_DISABLE=1")).toBeGreaterThanOrEqual(0);
    expect(pairIndex(command, "-e", "NCCL_GRAPH_DUMP_FILE=/tmp/x")).toBe(-1);
  });

  it("migrates a legacy docker image into the first-class runtime", () => {
    const recipe = parseRecipe({
      id: "legacy",
      name: "Legacy",
      model_path: "/models/legacy",
      extra_args: { docker_image: image },
    });
    expect(recipe.runtime).toEqual({ kind: "docker", ref: image });
  });

  it("builds a host command when the selected runtime is a binary", () => {
    const command = buildVllmCommand(
      baseRecipe({ kind: "system", ref: process.execPath }, { "moe-backend": "b12x" }),
    );
    expect(command[0]).not.toBe("docker");
    expect(command).toContain("serve");
  });
});
