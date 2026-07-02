import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Environment } from "../../../controller/src/modules/environments/types";
import { startEnvironment } from "../../../controller/src/modules/environments/environment-process";
import type { Recipe } from "../../../controller/src/modules/models/types";
import { FakeProcessRunner } from "../../support/controller/fake-process-runner";
import { registerControllerTestLifecycle, tempDir } from "./fixtures";

registerControllerTestLifecycle();

// Unlike environments-lifecycle.test.ts (which only covers the spawn-free
// guard paths), these tests exercise the real start path — docker argv
// construction, spawn, and the launch-then-verify liveness check — by
// scripting the process boundary instead of running `docker run` for real.
// startEnvironment's 3s liveness delay is real time, hence the timeouts.

const START_TIMEOUT_MS = 10_000;

const recipe = (): Recipe => ({
  id: "qwen3-32b",
  name: "Qwen3-32B",
  model_path: join(tempDir, "models", "qwen3-32b"),
  backend: "vllm",
  env_vars: null,
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  max_model_len: 4096,
  gpu_memory_utilization: 0.8,
  kv_cache_dtype: "auto",
  max_num_seqs: 8,
  trust_remote_code: false,
  tool_call_parser: null,
  reasoning_parser: null,
  enable_auto_tool_choice: false,
  quantization: null,
  dtype: null,
  host: "127.0.0.1",
  port: 8000,
  served_model_name: "qwen3-32b-serve",
  python_path: null,
  extra_args: {},
  max_thinking_tokens: null,
  thinking_mode: null,
});

const environment = (): Environment => ({
  id: "env-qwen3-32b",
  name: "Qwen3-32B (vLLM v0.11.0)",
  recipeId: "qwen3-32b",
  engineId: "vllm",
  version: "0.11.0",
  variant: null,
  image: null,
  seeded: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("startEnvironment via the process seam", () => {
  test(
    "spawns docker run with the environment container name and reports started once it survives the liveness window",
    async () => {
      const runner = new FakeProcessRunner();

      const result = await startEnvironment(environment(), recipe(), runner);

      expect(result).toEqual({ started: true, message: "Container starting" });
      const spawns = runner.spawns();
      expect(spawns).toHaveLength(1);
      expect(spawns[0]!.command).toBe("docker");
      // Container is keyed by the environment id (not the recipe id) and runs
      // the pinned official image for the environment's engine version.
      expect(spawns[0]!.args.slice(0, 4)).toEqual([
        "run",
        "--rm",
        "--name",
        "local-studio-env-env-qwen3-32b",
      ]);
      const imageIndex = spawns[0]!.args.indexOf("vllm/vllm-openai:v0.11.0");
      expect(imageIndex).toBeGreaterThan(0);
      // vLLM's image ENTRYPOINT is `vllm serve`, so the model path is the
      // first in-container argument, followed by the recipe flag set.
      expect(spawns[0]!.args.slice(imageIndex + 1)).toEqual([
        recipe().model_path,
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
        "--served-model-name",
        "qwen3-32b-serve",
        "--max-model-len",
        "4096",
        "--gpu-memory-utilization",
        "0.8",
        "--max-num-seqs",
        "8",
        // Qwen3 models get a default reasoning parser (model-runtime-defaults).
        "--reasoning-parser",
        "qwen3",
      ]);
    },
    START_TIMEOUT_MS,
  );

  test(
    "a container that dies inside the liveness window is reported as an early exit",
    async () => {
      const runner = new FakeProcessRunner().onSpawn("docker", {
        exitCode: 125,
        exitAfterMs: 50,
      });

      const result = await startEnvironment(environment(), recipe(), runner);

      expect(result.started).toBe(false);
      expect(result.message).toBe("Container exited early (code 125)");
    },
    START_TIMEOUT_MS,
  );

  test(
    "a spawn error (docker missing) is surfaced in the start result",
    async () => {
      const runner = new FakeProcessRunner().onSpawn("docker", {
        spawnError: "spawn docker ENOENT",
      });

      const result = await startEnvironment(environment(), recipe(), runner);

      expect(result.started).toBe(false);
      expect(result.message).toContain("ENOENT");
    },
    START_TIMEOUT_MS,
  );
});
